import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import * as JSZip from 'jszip';
import { CreateEnvelopeDto, RejectEnvelopeDto, DelegateDto, ForwardRecipientDto } from './dto/envelope.dto';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EnvelopeStatus, RecipientStatus } from '../common/enums';

@Injectable()
export class EnvelopesService {
  constructor(
    @Inject('DATABASE') private db: Knex,
    private emailService: EmailService,
    private notificationsService: NotificationsService,
  ) {}

  async findAll(userId: number, role: string) {
    const query = this.db('t_envelopes as e')
      .join('t_users as u', 'e.created_by', 'u.id_user')
      .select(
        'e.*',
        this.db.raw("CONCAT(u.first_name, ' ', u.last_name) as creator_name"),
      )
      .orderBy('e.created_at', 'desc');

    if (!['ADMIN', 'SUPER_ADMIN'].includes(role)) {
      query.where('e.created_by', userId);
    }
    return query;
  }

  async findById(id: number) {
    const [env] = await this.db('t_envelopes as e')
      .join('t_users as u', 'e.created_by', 'u.id_user')
      .where('e.id_envelope', id)
      .select(
        'e.*',
        this.db.raw("CONCAT(u.first_name, ' ', u.last_name) as creator_name"),
        'u.email as creator_email',
      );
    if (!env) throw new NotFoundException('Enveloppe non trouvée');

    const recipients = await this.db('t_recipients').where('id_envelope', id).orderBy('signing_order');
    const documents = await this.db('t_envelope_documents as ed')
      .join('t_documents as d', 'ed.id_document', 'd.id_document')
      .where('ed.id_envelope', id)
      .select('d.*');

    return { ...env, recipients, documents };
  }

  async create(dto: CreateEnvelopeDto, userId: number) {
    // Validate that all @cgrae.ci recipients only
    for (const r of dto.recipients) {
      if (!r.email.endsWith('@cgrae.ci')) {
        throw new BadRequestException(
          `L'email ${r.email} n'est pas un email @cgrae.ci valide`,
        );
      }
    }

    const expiresAt = this.normalizeExpirationInput(dto.expires_at);

    const trx = await this.db.transaction();
    try {
      const [envId] = await trx('t_envelopes').insert({
        title: dto.title,
        subject: dto.subject || null,
        message: dto.message || null,
        status: EnvelopeStatus.DRAFT,
        circuit_type: dto.circuit_type,
        created_by: userId,
        expires_at: expiresAt,
      });

      // Link documents
      for (const docId of dto.document_ids) {
        await trx('t_envelope_documents').insert({ id_envelope: envId, id_document: docId });
      }

      // Create recipients with tokens
      for (const r of dto.recipients) {
        const [existingUser] = await trx('t_users').where('email', r.email).select('id_user');
        await trx('t_recipients').insert({
          id_envelope: envId,
          id_user: existingUser?.id_user || null,
          email: r.email,
          first_name: r.first_name,
          last_name: r.last_name,
          role: r.role,
          signing_order: r.signing_order,
          status: RecipientStatus.PENDING,
          token: uuidv4(),
        });
      }

      await trx.commit();

      // Log audit
      await this.logAudit(envId, 'ENVELOPE_CREATED', userId, null, { title: dto.title });

      return this.findById(envId);
    } catch (e) {
      await trx.rollback();
      throw e;
    }
  }

  async send(id: number, userId: number) {
    const envelope = await this.findById(id);
    if (envelope.created_by !== userId) {
      throw new ForbiddenException("Vous n'êtes pas l'émetteur de cette enveloppe");
    }
    if (envelope.status !== EnvelopeStatus.DRAFT) {
      throw new BadRequestException('Cette enveloppe a déjà été envoyée');
    }

    await this.db('t_envelopes').where('id_envelope', id).update({ status: EnvelopeStatus.SENT });

    const sender = await this.db('t_users').where('id_user', userId).first();
    const senderName = `${sender.first_name} ${sender.last_name}`;

    // For sequential: only send to first recipient. For parallel: send to all.
    const recipients = envelope.recipients;
    const toNotify = envelope.circuit_type === 'SEQUENTIAL'
      ? recipients.filter((r) => r.signing_order === 1)
      : recipients;

    for (const r of toNotify) {
      await this.db('t_recipients')
        .where('id_recipient', r.id_recipient)
        .update({ status: RecipientStatus.SENT });

      await this.emailService.sendSignatureRequest(
        r.email,
        `${r.first_name} ${r.last_name}`,
        envelope.title,
        senderName,
        r.token,
        envelope.message,
      );

      // Notifier le destinataire s'il est un utilisateur CGRAE enregistré
      const [recipientUser] = await this.db('t_users').where('email', r.email).select('id_user');
      if (recipientUser) {
        await this.notificationsService.create(
          recipientUser.id_user,
          `Vous avez un document à signer : "${envelope.title}" (envoyé par ${senderName})`,
          envelope.id_envelope,
        );
      }
    }

    await this.db('t_envelopes').where('id_envelope', id).update({ status: EnvelopeStatus.IN_PROGRESS });
    await this.logAudit(id, 'ENVELOPE_SENT', userId, null, {});

    return this.findById(id);
  }

  async sign(
    token: string,
    ipAddress: string,
    signatureImage?: string,
    useSavedSignature?: boolean,
    comment?: string,
    signaturePosition?: { doc_id: number; x_ratio: number; y_ratio: number },
    useStamp?: boolean,
    stampImage?: string,
    stampPosition?: { doc_id: number; x_ratio: number; y_ratio: number },
  ) {
    const [recipient] = await this.db('t_recipients').where('token', token);
    if (!recipient) throw new NotFoundException('Lien de signature invalide');
    if (recipient.status === RecipientStatus.SIGNED) {
      throw new BadRequestException('Ce document a déjà été signé');
    }

    const [envelope] = await this.db('t_envelopes').where('id_envelope', recipient.id_envelope);
    if (!envelope) throw new NotFoundException('Enveloppe non trouvée');
    this.assertPublicEnvelopeAccessible(envelope, BadRequestException);

    let sigFile: string | undefined;
    if (signatureImage && signatureImage.startsWith('data:image/png;base64,')) {
      const sigDir = path.resolve(process.env.UPLOAD_DEST || './uploads', 'signatures');
      if (!fs.existsSync(sigDir)) fs.mkdirSync(sigDir, { recursive: true });
      sigFile = path.join(sigDir, `sig_${recipient.id_recipient}_${Date.now()}.png`);
      const base64Data = signatureImage.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(sigFile, base64Data, 'base64');
    } else if (useSavedSignature) {
      const [userRow] = recipient.id_user
        ? await this.db('t_users').where('id_user', recipient.id_user).select('id_user', 'signature_path')
        : await this.db('t_users').where('email', recipient.email).select('id_user', 'signature_path');

      if (userRow?.id_user && !recipient.id_user) {
        await this.db('t_recipients').where('id_recipient', recipient.id_recipient).update({ id_user: userRow.id_user });
      }

      if (!userRow?.signature_path || !fs.existsSync(userRow.signature_path)) {
        throw new BadRequestException('Aucune signature sauvegardée n\'est disponible dans votre profil');
      }

      sigFile = userRow.signature_path;
    }

    if (sigFile) {
      const targetDocId = signaturePosition?.doc_id
        || (await this.db('t_envelope_documents').where('id_envelope', envelope.id_envelope).first())?.id_document;
      if (targetDocId) {
        const xRatio = Math.min(Math.max(signaturePosition?.x_ratio ?? 0.82, 0), 1);
        const yRatio = Math.min(Math.max(signaturePosition?.y_ratio ?? 0.88, 0), 1);

        // Résoudre le chemin du cachet si demandé
        let resolvedStampPath: string | undefined;
        let stampX = 0.60;
        let stampY = 0.88;
        if (useStamp) {
          if (stampImage && stampImage.startsWith('data:image/')) {
            // Cachet fourni inline — sauvegarder comme cachet permanent de l'utilisateur
            const stampDir = path.resolve(process.env.UPLOAD_DEST || './uploads', 'stamps');
            if (!fs.existsSync(stampDir)) fs.mkdirSync(stampDir, { recursive: true });
            const isPng = stampImage.startsWith('data:image/png');
            const stampExt = isPng ? '.png' : '.jpg';
            const stampFile = path.join(stampDir, `stamp_${recipient.id_recipient}_${Date.now()}${stampExt}`);
            fs.writeFileSync(stampFile, Buffer.from(stampImage.replace(/^data:image\/(png|jpeg|jpg);base64,/, ''), 'base64'));
            resolvedStampPath = stampFile;
            // Sauvegarder aussi en tant que cachet permanent si l'utilisateur est connu
            if (recipient.id_user) {
              const permFile = path.join(stampDir, `stamp_${recipient.id_user}${stampExt}`);
              fs.copyFileSync(stampFile, permFile);
              await this.db('t_users').where('id_user', recipient.id_user).update({ stamp_path: permFile });
            }
          } else {
            // Résoudre via id_user, sinon fallback via email puis lier id_user dans t_recipients
            let ownerId = recipient.id_user as number | null;
            let userRow: any;
            if (ownerId) {
              [userRow] = await this.db('t_users').where('id_user', ownerId).select('id_user', 'stamp_path');
            } else {
              [userRow] = await this.db('t_users').where('email', recipient.email).select('id_user', 'stamp_path');
              if (userRow?.id_user) {
                ownerId = userRow.id_user;
                await this.db('t_recipients')
                  .where('id_recipient', recipient.id_recipient)
                  .update({ id_user: ownerId });
              }
            }
            if (userRow?.stamp_path && fs.existsSync(userRow.stamp_path)) resolvedStampPath = userRow.stamp_path;
          }
          if (stampPosition) {
            stampX = Math.min(Math.max(stampPosition.x_ratio, 0), 1);
            stampY = Math.min(Math.max(stampPosition.y_ratio, 0), 1);
          }
        }

        try {
          await this.applySignatureOnEnvelopeDocument(
            envelope.id_envelope,
            targetDocId,
            sigFile,
            xRatio,
            yRatio,
            resolvedStampPath,
            stampX,
            stampY,
          );
        } catch (error) {
          console.error('Signature/cachet application failed', error);
          throw new BadRequestException('Impossible d\'apposer la signature/cachet sur le document. Vérifiez les images puis réessayez.');
        }
      }

      await this.db('t_recipients').where('id_recipient', recipient.id_recipient).update({ signature_path: sigFile });
    }

    await this.db('t_recipients').where('id_recipient', recipient.id_recipient).update({
      status: RecipientStatus.SIGNED,
      signed_at: this.db.fn.now(),
      signing_comment: comment || null,
    });

    await this.logAudit(envelope.id_envelope, 'DOCUMENT_SIGNED', recipient.id_user, ipAddress, {
      recipient_email: recipient.email,
    });

    // Notify sender
    const [sender] = await this.db('t_users').where('id_user', envelope.created_by);
    await this.emailService.sendSignatureConfirmation(
      sender.email,
      `${sender.first_name} ${sender.last_name}`,
      envelope.title,
      `${recipient.first_name} ${recipient.last_name}`,
    );

    // Notifier l'émetteur dans l'application
    await this.notificationsService.create(
      envelope.created_by,
      `${recipient.first_name} ${recipient.last_name} a signé le document : "${envelope.title}"`,
      envelope.id_envelope,
    );

    // Check if all signed → complete or trigger next in sequence
    await this.checkAndAdvanceCircuit(envelope.id_envelope, sender);

    return { message: 'Document signé avec succès' };
  }

  private async applySignatureOnEnvelopeDocument(
    envelopeId: number,
    docId: number,
    signaturePath: string,
    xRatio: number,
    yRatio: number,
    stampPath?: string,
    stampXRatio?: number,
    stampYRatio?: number,
  ): Promise<void> {
    const [link] = await this.db('t_envelope_documents')
      .where('id_envelope', envelopeId)
      .where('id_document', docId);
    if (!link) return;

    const [doc] = await this.db('t_documents').where('id_document', docId);
    if (!doc || !fs.existsSync(doc.path)) return;

    const ext = path.extname(doc.path).toLowerCase();
    const signedDir = path.resolve(process.env.UPLOAD_DEST || './uploads', 'signed');
    if (!fs.existsSync(signedDir)) fs.mkdirSync(signedDir, { recursive: true });
    const stampedPath = path.join(signedDir, `signed_${Date.now()}_${path.basename(doc.path)}`);

    if (doc.mime_type === 'application/pdf' || ext === '.pdf') {
      const pdfBytes = fs.readFileSync(doc.path);
      const sigBytes = fs.readFileSync(signaturePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const sigImage = await pdfDoc.embedPng(sigBytes);
      const page = pdfDoc.getPages()[0];
      if (!page) return;

      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();
      const sigWidth = pageWidth * 0.22;
      const ratio = sigImage.height / sigImage.width;
      const sigHeight = sigWidth * ratio;
      const x = Math.min(Math.max((xRatio * pageWidth) - (sigWidth / 2), 0), pageWidth - sigWidth);
      const yTopBased = (yRatio * pageHeight) - (sigHeight / 2);
      const y = Math.min(Math.max(pageHeight - yTopBased - sigHeight, 0), pageHeight - sigHeight);

      page.drawImage(sigImage, { x, y, width: sigWidth, height: sigHeight, opacity: 0.95 });

      // Cachet (tampon officiel)
      if (stampPath && fs.existsSync(stampPath)) {
        const sx = stampXRatio ?? 0.60;
        const sy = stampYRatio ?? 0.88;
        let stampPngBytes: Buffer = fs.readFileSync(stampPath);
        if (stampPath.endsWith('.jpg') || stampPath.endsWith('.jpeg')) {
          stampPngBytes = await sharp(stampPath).png().toBuffer();
        }
        const stampImg = await pdfDoc.embedPng(stampPngBytes);
        const stampWidth = pageWidth * 0.20;
        const stampRatio = stampImg.height / stampImg.width;
        const stampHeight = stampWidth * stampRatio;
        const stX = Math.min(Math.max((sx * pageWidth) - (stampWidth / 2), 0), pageWidth - stampWidth);
        const stTopBased = (sy * pageHeight) - (stampHeight / 2);
        const stY = Math.min(Math.max(pageHeight - stTopBased - stampHeight, 0), pageHeight - stampHeight);
        page.drawImage(stampImg, { x: stX, y: stY, width: stampWidth, height: stampHeight, opacity: 0.88 });
      }

      const out = await pdfDoc.save();
      fs.writeFileSync(stampedPath, out);
    } else if ((doc.mime_type || '').startsWith('image/') || ['.png', '.jpg', '.jpeg'].includes(ext)) {
      const base = sharp(doc.path);
      const meta = await base.metadata();
      if (!meta.width || !meta.height) return;

      const sigTargetWidth = Math.round(meta.width * 0.22);
      const sigBuf = await sharp(signaturePath)
        .resize({ width: sigTargetWidth })
        .png()
        .toBuffer();
      const sigMeta = await sharp(sigBuf).metadata();
      const sigW = sigMeta.width || sigTargetWidth;
      const sigH = sigMeta.height || Math.round(sigTargetWidth * 0.35);

      const left = Math.min(Math.max(Math.round((xRatio * meta.width) - (sigW / 2)), 0), meta.width - sigW);
      const top = Math.min(Math.max(Math.round((yRatio * meta.height) - (sigH / 2)), 0), meta.height - sigH);

      const composites: sharp.OverlayOptions[] = [{ input: sigBuf, left, top }];

      // Cachet
      if (stampPath && fs.existsSync(stampPath)) {
        const sx = stampXRatio ?? 0.60;
        const sy = stampYRatio ?? 0.88;
        const stampW2 = Math.round(meta.width * 0.20);
        const stBuf = await sharp(stampPath).resize({ width: stampW2 }).png().toBuffer();
        const stMeta = await sharp(stBuf).metadata();
        const stW = stMeta.width || stampW2;
        const stH = stMeta.height || stampW2;
        const stL = Math.min(Math.max(Math.round((sx * meta.width) - (stW / 2)), 0), meta.width - stW);
        const stT = Math.min(Math.max(Math.round((sy * meta.height) - (stH / 2)), 0), meta.height - stH);
        composites.push({ input: stBuf, left: stL, top: stT });
      }

      await base.composite(composites).toFile(stampedPath);
    } else if (
      doc.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === '.docx'
    ) {
      await this.embedSignatureInDocx(doc.path, signaturePath, stampedPath, stampPath);
    } else {
      return;
    }

    const stat = fs.statSync(stampedPath);
    const [newDocId] = await this.db('t_documents').insert({
      name: path.basename(stampedPath),
      original_name: doc.original_name,
      path: stampedPath,
      mime_type: doc.mime_type,
      size: stat.size,
      version: Number(doc.version || 1) + 1,
      created_by: doc.created_by,
    });

    await this.db('t_envelope_documents')
      .where('id_envelope', envelopeId)
      .where('id_document', docId)
      .update({ id_document: newDocId });
  }

  private buildDocxImageParagraph(relId: string, mediaName: string, elementId: number, align: 'left' | 'right', cxEmu: number, cyEmu: number): string {
    return `
<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:pPr><w:jc w:val="${align}"/></w:pPr>
  <w:r><w:drawing>
    <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">
      <wp:extent cx="${cxEmu}" cy="${cyEmu}"/>
      <wp:docPr id="${elementId}" name="${mediaName}" descr="${mediaName}"/>
      <wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:nvPicPr><pic:cNvPr id="${elementId}" name="${mediaName}"/><pic:cNvPicPr/></pic:nvPicPr>
            <pic:blipFill>
              <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/>
              <a:stretch><a:fillRect/></a:stretch>
            </pic:blipFill>
            <pic:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cxEmu}" cy="${cyEmu}"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
            </pic:spPr>
          </pic:pic>
        </a:graphicData>
      </a:graphic>
    </wp:inline>
  </w:drawing></w:r>
</w:p>`;
  }

  private async embedSignatureInDocx(docxPath: string, sigPngPath: string, outputPath: string, stampPath?: string): Promise<void> {
    const docxBuf = fs.readFileSync(docxPath);
    const sigBuf  = fs.readFileSync(sigPngPath);
    const zip     = await JSZip.loadAsync(docxBuf);

    const relFile = zip.file('word/_rels/document.xml.rels');
    let relsXml = relFile ? await relFile.async('string') : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

    // 1. Signature
    const sigMediaName = 'signature_cgrae.png';
    const sigRelId = 'rIdCgraeSig';
    zip.file(`word/media/${sigMediaName}`, sigBuf);
    if (!relsXml.includes(sigRelId)) {
      relsXml = relsXml.replace('</Relationships>',
        `<Relationship Id="${sigRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${sigMediaName}"/></Relationships>`);
    }
    const sigParagraph = this.buildDocxImageParagraph(sigRelId, sigMediaName, 99, 'right', 2700000, 1350000);

    // 2. Cachet (optionnel)
    let stampParagraph = '';
    if (stampPath && fs.existsSync(stampPath)) {
      // Convertir en PNG si nécessaire
      let stBuf: Buffer = fs.readFileSync(stampPath);
      if (stampPath.endsWith('.jpg') || stampPath.endsWith('.jpeg')) {
        stBuf = await sharp(stampPath).png().toBuffer();
      }
      const stMediaName = 'cachet_cgrae.png';
      const stRelId = 'rIdCgraeCachet';
      zip.file(`word/media/${stMediaName}`, stBuf);
      if (!relsXml.includes(stRelId)) {
        relsXml = relsXml.replace('</Relationships>',
          `<Relationship Id="${stRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${stMediaName}"/></Relationships>`);
      }
      stampParagraph = this.buildDocxImageParagraph(stRelId, stMediaName, 100, 'left', 2400000, 2400000);
    }

    zip.file('word/_rels/document.xml.rels', relsXml);

    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('word/document.xml introuvable');
    let docXml = await docFile.async('string');
    const injection = stampParagraph + sigParagraph;
    docXml = docXml.replace('</w:body>', injection + '\n</w:body>');
    zip.file('word/document.xml', docXml);

    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(outputPath, out);
  }

  async reject(id: number, token: string, dto: RejectEnvelopeDto, ipAddress: string) {
    const [recipient] = await this.db('t_recipients').where('token', token);
    if (!recipient) throw new NotFoundException('Lien invalide');

    const [envelope] = await this.db('t_envelopes').where('id_envelope', id);
    if (!envelope) throw new NotFoundException('Enveloppe non trouvée');
    this.assertPublicEnvelopeAccessible(envelope);

    await this.db('t_recipients').where('id_recipient', recipient.id_recipient).update({
      status: RecipientStatus.REJECTED,
      rejection_reason: dto.reason,
    });

    await this.db('t_envelopes').where('id_envelope', id).update({ status: EnvelopeStatus.REJECTED });

    const [sender] = await this.db('t_users').where('id_user', envelope.created_by);

    await this.emailService.sendRejectionNotification(
      sender.email,
      `${sender.first_name} ${sender.last_name}`,
      envelope.title,
      `${recipient.first_name} ${recipient.last_name}`,
      dto.reason,
    );

    await this.notificationsService.create(
      sender.id_user,
      `${recipient.first_name} ${recipient.last_name} a rejeté le document : "${envelope.title}"`,
      id,
    );

    await this.logAudit(id, 'DOCUMENT_REJECTED', recipient.id_user, ipAddress, {
      reason: dto.reason,
    });

    return { message: 'Document rejeté' };
  }

  async delegate(token: string, dto: DelegateDto) {
    if (!dto.delegate_email.endsWith('@cgrae.ci')) {
      throw new BadRequestException('Le délégué doit avoir un email @cgrae.ci');
    }

    const [recipient] = await this.db('t_recipients').where('token', token);
    if (!recipient) throw new NotFoundException('Lien invalide');

    const [env] = await this.db('t_envelopes').where('id_envelope', recipient.id_envelope);
    if (!env) throw new NotFoundException('Enveloppe non trouvée');
    this.assertPublicEnvelopeAccessible(env);

    const newToken = uuidv4();
    await this.db('t_recipients').where('id_recipient', recipient.id_recipient).update({
      status: RecipientStatus.DELEGATED,
    });

    await this.db('t_recipients').insert({
      id_envelope: recipient.id_envelope,
      email: dto.delegate_email,
      first_name: dto.delegate_first_name,
      last_name: dto.delegate_last_name,
      role: recipient.role,
      signing_order: recipient.signing_order,
      status: RecipientStatus.SENT,
      token: newToken,
    });

    const [sender] = await this.db('t_users').where('id_user', env.created_by);

    await this.emailService.sendSignatureRequest(
      dto.delegate_email,
      `${dto.delegate_first_name} ${dto.delegate_last_name}`,
      env.title,
      `${sender.first_name} ${sender.last_name}`,
      newToken,
    );

    await this.logAudit(recipient.id_envelope, 'SIGNATURE_DELEGATED', null, null, {
      from: recipient.email,
      to: dto.delegate_email,
    });

    return { message: 'Signature déléguée avec succès' };
  }

  async returnForCorrection(token: string, reason: string, ipAddress: string) {
    const [recipient] = await this.db('t_recipients').where('token', token);
    if (!recipient) throw new NotFoundException('Lien de signature invalide');

    const [envelope] = await this.db('t_envelopes').where('id_envelope', recipient.id_envelope);
    if (!envelope) throw new NotFoundException('Enveloppe non trouvée');
    this.assertPublicEnvelopeAccessible(envelope);

    await this.db('t_recipients').where('id_recipient', recipient.id_recipient).update({
      status: RecipientStatus.RETURNED,
      rejection_reason: reason,
    });

    await this.db('t_envelopes').where('id_envelope', recipient.id_envelope).update({
      status: EnvelopeStatus.REVISION,
    });

    const [sender] = await this.db('t_users').where('id_user', envelope.created_by);

    await this.emailService.sendReturnForCorrections(
      sender.email,
      `${sender.first_name} ${sender.last_name}`,
      envelope.title,
      `${recipient.first_name} ${recipient.last_name}`,
      reason,
    );

    await this.notificationsService.create(
      envelope.created_by,
      `${recipient.first_name} ${recipient.last_name} a retourné "${envelope.title}" pour corrections.`,
      envelope.id_envelope,
    );

    await this.logAudit(envelope.id_envelope, 'DOCUMENT_RETURNED', recipient.id_user, ipAddress, {
      reason,
      recipient_email: recipient.email,
    });

    return { message: 'Document retourné pour corrections' };
  }

  async forwardAfterSign(token: string, dto: ForwardRecipientDto, ipAddress: string) {
    if (!dto.forward_email.endsWith('@cgrae.ci')) {
      throw new BadRequestException('Le destinataire doit avoir un email @cgrae.ci');
    }

    const [currentRecipient] = await this.db('t_recipients').where('token', token);
    if (!currentRecipient) throw new NotFoundException('Lien de signature invalide');
    if (![RecipientStatus.SIGNED, RecipientStatus.APPROVED].includes(currentRecipient.status)) {
      throw new BadRequestException('Le renvoi est possible uniquement après signature');
    }

    const [env] = await this.db('t_envelopes').where('id_envelope', currentRecipient.id_envelope);
    if (!env) throw new NotFoundException('Enveloppe non trouvée');
    this.assertPublicEnvelopeAccessible(env);

    const newToken = uuidv4();
    const nextOrder = Number(currentRecipient.signing_order || 0) + 1;

    await this.db('t_recipients').insert({
      id_envelope: currentRecipient.id_envelope,
      email: dto.forward_email,
      first_name: dto.forward_first_name,
      last_name: dto.forward_last_name,
      role: currentRecipient.role,
      signing_order: nextOrder,
      status: RecipientStatus.SENT,
      token: newToken,
    });

    await this.db('t_envelopes').where('id_envelope', currentRecipient.id_envelope).update({
      status: EnvelopeStatus.IN_PROGRESS,
      completed_at: null,
    });

    const [sender] = await this.db('t_users').where('id_user', env.created_by);
    await this.emailService.sendSignatureRequest(
      dto.forward_email,
      `${dto.forward_first_name} ${dto.forward_last_name}`,
      env.title,
      `${sender.first_name} ${sender.last_name}`,
      newToken,
      env.message,
    );

    const [nextUser] = await this.db('t_users').where('email', dto.forward_email).select('id_user');
    if (nextUser) {
      await this.notificationsService.create(
        nextUser.id_user,
        `Vous avez un document à signer : "${env.title}" (renvoyé par ${currentRecipient.first_name} ${currentRecipient.last_name})`,
        env.id_envelope,
      );
    }

    await this.notificationsService.create(
      env.created_by,
      `${currentRecipient.first_name} ${currentRecipient.last_name} a renvoyé le document "${env.title}" à ${dto.forward_first_name} ${dto.forward_last_name}.`,
      env.id_envelope,
    );

    await this.logAudit(env.id_envelope, 'DOCUMENT_FORWARDED', currentRecipient.id_user, ipAddress, {
      from: currentRecipient.email,
      to: dto.forward_email,
    });

    return { message: 'Document renvoyé au nouveau destinataire' };
  }

  async getPublicEnvelope(token: string) {
    const [recipient] = await this.db('t_recipients').where('token', token);
    if (!recipient) throw new NotFoundException('Lien invalide ou expiré');
    const envelope = await this.findById(recipient.id_envelope);
    this.assertPublicEnvelopeAccessible(envelope);
    // Indiquer si chaque destinataire possède un cachet
    for (const r of envelope.recipients ?? []) {
      const [u] = r.id_user
        ? await this.db('t_users').where('id_user', r.id_user).select('id_user', 'stamp_path', 'signature_path')
        : await this.db('t_users').where('email', r.email).select('id_user', 'stamp_path', 'signature_path');
      if (u?.id_user && !r.id_user) {
        await this.db('t_recipients').where('id_recipient', r.id_recipient).update({ id_user: u.id_user });
        r.id_user = u.id_user;
      }
      r.has_stamp = !!(u?.stamp_path && fs.existsSync(u.stamp_path));
      r.has_signature = !!(u?.signature_path && fs.existsSync(u.signature_path));
    }
    return envelope;
  }

  async servePublicStamp(token: string, res: any) {
    const [recipient] = await this.db('t_recipients').where('token', token);
    if (!recipient) throw new NotFoundException('Lien invalide ou expiré');
    const [envelope] = await this.db('t_envelopes').where('id_envelope', recipient.id_envelope);
    if (!envelope) throw new NotFoundException('Enveloppe non trouvée');
    this.assertPublicEnvelopeAccessible(envelope);
    const [u] = recipient.id_user
      ? await this.db('t_users').where('id_user', recipient.id_user).select('id_user', 'stamp_path')
      : await this.db('t_users').where('email', recipient.email).select('id_user', 'stamp_path');
    if (u?.id_user && !recipient.id_user) {
      await this.db('t_recipients').where('id_recipient', recipient.id_recipient).update({ id_user: u.id_user });
    }
    if (!u?.stamp_path || !fs.existsSync(u.stamp_path)) throw new NotFoundException('Aucun cachet enregistré');
    const mime = u.stamp_path.endsWith('.png') ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.resolve(u.stamp_path));
  }

  async servePublicSignature(token: string, res: any) {
    const [recipient] = await this.db('t_recipients').where('token', token);
    if (!recipient) throw new NotFoundException('Lien invalide ou expiré');
    const [envelope] = await this.db('t_envelopes').where('id_envelope', recipient.id_envelope);
    if (!envelope) throw new NotFoundException('Enveloppe non trouvée');
    this.assertPublicEnvelopeAccessible(envelope);
    const [u] = recipient.id_user
      ? await this.db('t_users').where('id_user', recipient.id_user).select('id_user', 'signature_path')
      : await this.db('t_users').where('email', recipient.email).select('id_user', 'signature_path');
    if (u?.id_user && !recipient.id_user) {
      await this.db('t_recipients').where('id_recipient', recipient.id_recipient).update({ id_user: u.id_user });
    }
    if (!u?.signature_path || !fs.existsSync(u.signature_path)) {
      throw new NotFoundException('Aucune signature enregistrée');
    }
    const mime = u.signature_path.endsWith('.png') ? 'image/png' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.resolve(u.signature_path));
  }

  async cancel(id: number, userId: number) {
    const [env] = await this.db('t_envelopes').where('id_envelope', id);
    if (!env) throw new NotFoundException('Enveloppe non trouvée');
    if (env.created_by !== userId) throw new ForbiddenException('Accès refusé');

    await this.db('t_envelopes').where('id_envelope', id).update({ status: EnvelopeStatus.CANCELLED });
    await this.logAudit(id, 'ENVELOPE_CANCELLED', userId, null, {});
    return { message: 'Enveloppe annulée' };
  }

  private async checkAndAdvanceCircuit(envelopeId: number, sender: any) {
    const allRecipients = await this.db('t_recipients')
      .where('id_envelope', envelopeId)
      .whereIn('role', ['SIGNATORY', 'APPROVER']);

    const [env] = await this.db('t_envelopes').where('id_envelope', envelopeId);
    const allDone = allRecipients.every(
      (r) => r.status === RecipientStatus.SIGNED || r.status === RecipientStatus.APPROVED || r.status === RecipientStatus.DELEGATED,
    );

    if (allDone) {
      await this.db('t_envelopes').where('id_envelope', envelopeId).update({
        status: EnvelopeStatus.COMPLETED,
        completed_at: this.db.fn.now(),
      });
      // Notify all
      for (const r of allRecipients) {
        await this.emailService.sendEnvelopeCompleted(r.email, `${r.first_name} ${r.last_name}`, env.title);
      }
      await this.emailService.sendEnvelopeCompleted(sender.email, `${sender.first_name} ${sender.last_name}`, env.title);
      await this.logAudit(envelopeId, 'ENVELOPE_COMPLETED', sender.id_user, null, {});
    } else if (env.circuit_type === 'SEQUENTIAL') {
      // Find next pending
      const maxSigned = Math.max(
        ...allRecipients
          .filter((r) => r.status === RecipientStatus.SIGNED || r.status === RecipientStatus.DELEGATED)
          .map((r) => r.signing_order),
        0,
      );
      const nextRecipients = allRecipients.filter(
        (r) => r.signing_order === maxSigned + 1 && r.status === RecipientStatus.PENDING,
      );
      for (const r of nextRecipients) {
        await this.db('t_recipients').where('id_recipient', r.id_recipient).update({ status: RecipientStatus.SENT });
        await this.emailService.sendSignatureRequest(
          r.email,
          `${r.first_name} ${r.last_name}`,
          env.title,
          `${sender.first_name} ${sender.last_name}`,
          r.token,
        );
        // Notifier le prochain signataire
        const [nextUser] = await this.db('t_users').where('email', r.email).select('id_user');
        if (nextUser) {
          await this.notificationsService.create(
            nextUser.id_user,
            `Vous avez un document à signer : "${env.title}" (envoyé par ${sender.first_name} ${sender.last_name})`,
            envelopeId,
          );
        }
      }
    }
  }

  async servePublicDocument(token: string, docId: number, res: any) {
    const [recipient] = await this.db('t_recipients').where('token', token);
    if (!recipient) throw new NotFoundException('Lien invalide');
    const [envelope] = await this.db('t_envelopes').where('id_envelope', recipient.id_envelope);
    if (!envelope) throw new NotFoundException('Enveloppe non trouvée');
    this.assertPublicEnvelopeAccessible(envelope);

    const [link] = await this.db('t_envelope_documents')
      .where('id_envelope', recipient.id_envelope)
      .where('id_document', docId);
    if (!link) throw new NotFoundException('Document non associé à cette enveloppe');

    const [doc] = await this.db('t_documents').where('id_document', docId);
    if (!doc) throw new NotFoundException('Document non trouvé');

    const absolutePath = path.resolve(doc.path);
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `inline; filename="${doc.original_name}"`);
    res.sendFile(absolutePath);
  }

  private normalizeExpirationInput(expiresAt?: string | null): string | null {
    if (!expiresAt) return null;
    if (!expiresAt.includes('T') && expiresAt.length === 10) {
      return `${expiresAt}T23:59:59`;
    }
    return expiresAt;
  }

  private getEffectiveExpirationDate(expiresAt?: string | Date | null): Date | null {
    if (!expiresAt) return null;

    const raw = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (Number.isNaN(raw.getTime())) return null;

    if (raw.getHours() === 0 && raw.getMinutes() === 0 && raw.getSeconds() === 0) {
      const endOfDay = new Date(raw);
      endOfDay.setHours(23, 59, 59, 999);
      return endOfDay;
    }

    return raw;
  }

  private assertPublicEnvelopeAccessible(
    envelope: { expires_at?: string | Date | null; status?: string },
    ExceptionType: typeof NotFoundException | typeof BadRequestException = NotFoundException,
  ) {
    const effectiveExpiration = this.getEffectiveExpirationDate(envelope.expires_at);
    if (effectiveExpiration && effectiveExpiration.getTime() < Date.now()) {
      throw new ExceptionType('Ce lien de signature a expiré');
    }

    if (envelope.status === EnvelopeStatus.EXPIRED || envelope.status === EnvelopeStatus.CANCELLED) {
      throw new ExceptionType('Cette enveloppe n\'est plus valide');
    }
  }

  private async logAudit(
    envelopeId: number, action: string, userId: number | null,
    ipAddress: string | null, details: object,
  ) {
    let userEmail: string | null = null;
    if (userId) {
      const [u] = await this.db('t_users').where('id_user', userId).select('email');
      userEmail = u?.email || null;
    }
    await this.db('t_audit_logs').insert({
      id_envelope: envelopeId,
      action,
      id_user: userId,
      user_email: userEmail,
      ip_address: ipAddress || '0.0.0.0',
      details: JSON.stringify(details),
    });
  }
}
