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
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharpFn: typeof sharp = require('sharp');
import * as JSZip from 'jszip';
import { CreateEnvelopeDto, RejectEnvelopeDto, DelegateDto, ForwardRecipientDto } from './dto/envelope.dto';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EnvelopeStatus, RecipientRole, RecipientStatus } from '../common/enums';

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

    const attachments = await this.db('t_envelope_attachments as ea')
      .join('t_documents as d', 'ea.id_document', 'd.id_document')
      .where('ea.id_envelope', id)
      .select('d.*');

    return { ...env, recipients, documents, attachments };
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

      // Link optional non-signed attachments
      for (const attachmentId of dto.attachment_ids || []) {
        await trx('t_envelope_attachments').insert({ id_envelope: envId, id_document: attachmentId });
      }

      await this.ensureRecipientSignatureZonesTable(trx);

      const envelopeDocIds = new Set((dto.document_ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id)));

      // Create recipients with tokens
      for (const r of dto.recipients) {
        const [existingUser] = await trx('t_users').where('email', r.email).select('id_user');
        const [recipientId] = await trx('t_recipients').insert({
          id_envelope: envId,
          id_user: existingUser?.id_user || null,
          email: r.email,
          first_name: r.first_name,
          last_name: r.last_name,
          role: r.role,
          signing_order: r.signing_order,
          status: RecipientStatus.PENDING,
          token: uuidv4(),
          sig_x_ratio: r.signature_zone?.x_ratio ?? null,
          sig_y_ratio: r.signature_zone?.y_ratio ?? null,
          sig_doc_id:  r.signature_zone?.doc_id  ?? null,
        });

        if (r.role === RecipientRole.SIGNATORY) {
          const zonesInput = Array.isArray((r as any).signature_zones)
            ? (r as any).signature_zones
            : [];

          const preparedZones: Array<{ id_recipient: number; id_document: number; x_ratio: number; y_ratio: number; page_number: number }> = [];

          for (const zone of zonesInput) {
            const docId = Number(zone?.doc_id);
            if (!Number.isFinite(docId) || !envelopeDocIds.has(docId)) continue;

            const x = Math.min(Math.max(Number(zone?.x_ratio), 0), 1);
            const rawY = Number(zone?.y_ratio);
            const encodedPage = Number.isFinite(rawY) && rawY > 1 ? Math.floor(rawY) + 1 : 1;
            const decodedY = Number.isFinite(rawY) && rawY > 1 ? (rawY - Math.floor(rawY)) : rawY;
            const y = Math.min(Math.max(decodedY || 0.90, 0), 1);

            preparedZones.push({
              id_recipient: Number(recipientId),
              id_document: docId,
              x_ratio: x,
              y_ratio: y,
              page_number: Math.max(1, Math.floor(Number(encodedPage || 1))),
            });
          }

          const uniqueZones = new Map<string, { id_recipient: number; id_document: number; x_ratio: number; y_ratio: number; page_number: number }>();
          for (const zone of preparedZones) {
            uniqueZones.set(`${zone.id_recipient}:${zone.id_document}`, zone);
          }

          if (uniqueZones.size > 0) {
            await trx('t_recipient_signature_zones').insert([...uniqueZones.values()]);
          }
        }
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

  /** Créer + envoyer en une seule requête HTTP (évite le double aller-retour) */
  async createAndSend(dto: CreateEnvelopeDto, userId: number) {
    const envelope = await this.create(dto, userId);
    return this.send(envelope.id_envelope, userId);
  }

  async send(id: number, userId: number) {
    const envelope = await this.findById(id);
    if (envelope.created_by !== userId) {
      throw new ForbiddenException("Vous n'êtes pas l'émetteur de cette enveloppe");
    }
    if (![EnvelopeStatus.DRAFT, EnvelopeStatus.REVISION].includes(envelope.status)) {
      throw new BadRequestException('Cette enveloppe ne peut pas être envoyée dans son état actuel');
    }

    const effectiveExpiration = this.getEffectiveExpirationDate(envelope.expires_at);
    if (effectiveExpiration && effectiveExpiration.getTime() < Date.now()) {
      await this.db('t_envelopes').where('id_envelope', id).update({ status: EnvelopeStatus.EXPIRED });
      throw new BadRequestException('La date d\'expiration est dépassée. Modifiez la date limite pour remettre ce parapheur dans le circuit.');
    }

    await this.db('t_envelopes').where('id_envelope', id).update({
      status: EnvelopeStatus.SENT,
      completed_at: null,
    });

    const sender = await this.db('t_users').where('id_user', userId).first();
    const senderName = `${sender.first_name} ${sender.last_name}`;

    // For sequential: only send to the next recipient in order.
    // For revision, we resume from the recipient who returned the document.
    const recipients = envelope.recipients;
    const toNotify = envelope.circuit_type === 'SEQUENTIAL'
      ? (() => {
          const lastSignedOrder = Math.max(
            ...recipients
              .filter((r) => r.status === RecipientStatus.SIGNED || r.status === RecipientStatus.APPROVED || r.status === RecipientStatus.DELEGATED)
              .map((r) => r.signing_order),
            0,
          );
          return recipients.filter(
            (r) =>
              r.signing_order === lastSignedOrder + 1 &&
              (r.status === RecipientStatus.PENDING || r.status === RecipientStatus.RETURNED),
          );
        })()
      : recipients.filter((r) => r.status === RecipientStatus.PENDING || r.status === RecipientStatus.RETURNED);

    for (const r of toNotify) {
      await this.db('t_recipients')
        .where('id_recipient', r.id_recipient)
        .update({ status: RecipientStatus.SENT });

      // Fire-and-forget : ne pas bloquer la réponse HTTP sur l'envoi SMTP
      this.emailService.sendSignatureRequest(
        r.email,
        `${r.first_name} ${r.last_name}`,
        envelope.title,
        senderName,
        r.token,
        envelope.message,
      ).catch(err => console.error(`[Email] Échec envoi à ${r.email}:`, err));

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
    signaturePosition?: { doc_id: number; x_ratio: number; y_ratio: number; page_number?: number },
    useStamp?: boolean,
    stampImage?: string,
    stampPosition?: { doc_id: number; x_ratio: number; y_ratio: number; page_number?: number },
  ) {
    const [recipient] = await this.db('t_recipients').where('token', token);
    if (!recipient) throw new NotFoundException('Lien de signature invalide');
    if ([RecipientStatus.SIGNED, RecipientStatus.APPROVED, RecipientStatus.VIEWED].includes(recipient.status)) {
      throw new BadRequestException('Ce document a déjà été traité');
    }

    const isSignatory = recipient.role === 'SIGNATORY';
    const isApprover = recipient.role === 'APPROVER';
    const isViewer = recipient.role === 'VIEWER';
    if (!isSignatory && !isApprover && !isViewer) {
      throw new BadRequestException('Ce rôle ne peut pas traiter ce document dans cette étape');
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

    if (isSignatory && !sigFile) {
      throw new BadRequestException('Une signature est obligatoire pour un signataire');
    }

    let signedAttachment: { filename: string; path: string; contentType?: string } | undefined;

    if (sigFile && isSignatory) {
      // Zone prédéfinie par l'émetteur (si définie par document), sinon fallback legacy ou position fournie par le signataire.
      const envelopeDocRows = await this.db('t_envelope_documents')
        .where('id_envelope', envelope.id_envelope)
        .select('id_document');
      const allEnvelopeDocIds = envelopeDocRows.map((row) => Number(row.id_document)).filter((id) => Number.isFinite(id));
      const targetDocIds = allEnvelopeDocIds;

      const recipientZonesByDoc = new Map<number, { x_ratio: number; y_ratio: number; page_number: number }>();
      try {
        const zoneRows = await this.db('t_recipient_signature_zones')
          .where('id_recipient', recipient.id_recipient)
          .select('id_document', 'x_ratio', 'y_ratio', 'page_number');
        for (const row of zoneRows) {
          const docId = Number(row.id_document);
          if (!Number.isFinite(docId)) continue;
          recipientZonesByDoc.set(docId, {
            x_ratio: Math.min(Math.max(Number(row.x_ratio), 0), 1),
            y_ratio: Math.min(Math.max(Number(row.y_ratio), 0), 1),
            page_number: Math.max(1, Math.floor(Number(row.page_number || 1))),
          });
        }
      } catch {
        // Table absente sur ancienne base: on conserve le fallback legacy t_recipients.sig_*.
      }

      if (targetDocIds.length > 0) {
        // Résoudre le chemin du cachet si demandé
        let resolvedStampPath: string | undefined;
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
        }

        try {
          for (const targetDocId of targetDocIds) {
            const docZone = recipientZonesByDoc.get(targetDocId);
            const isLegacyPredefinedDoc =
              recipient.sig_doc_id != null
              && Number(recipient.sig_doc_id) === targetDocId
              && recipient.sig_x_ratio != null
              && recipient.sig_y_ratio != null;

            let signaturePage = Math.max(1, Math.floor(Number(signaturePosition?.page_number || 1)));
            let xRatio = Math.min(Math.max(signaturePosition?.x_ratio ?? 0.15, 0), 1);
            let yRatio = Math.min(Math.max(signaturePosition?.y_ratio ?? 0.90, 0), 1);

            if (docZone) {
              signaturePage = docZone.page_number;
              xRatio = docZone.x_ratio;
              yRatio = docZone.y_ratio;
            } else if (isLegacyPredefinedDoc) {
              // Backward-compatible legacy decoding: sig_y_ratio may encode page (page-1 + y).
              const rawPredefY = Number(recipient.sig_y_ratio);
              const encodedPage = Number.isFinite(rawPredefY) && rawPredefY > 1 ? Math.floor(rawPredefY) + 1 : 1;
              const decodedPredefY = Number.isFinite(rawPredefY) && rawPredefY > 1
                ? (rawPredefY - Math.floor(rawPredefY))
                : rawPredefY;
              signaturePage = Math.max(1, encodedPage || 1);
              xRatio = Math.min(Math.max(Number(recipient.sig_x_ratio), 0), 1);
              yRatio = Math.min(Math.max(decodedPredefY || 0.90, 0), 1);
            }

            let stampX = 0.50;
            let stampY = 0.90;
            let stampPage = Math.max(1, Math.floor(Number(stampPosition?.page_number || signaturePage || 1)));
            if (stampPosition) {
              stampX = Math.min(Math.max(stampPosition.x_ratio, 0), 1);
              stampY = Math.min(Math.max(stampPosition.y_ratio, 0), 1);
              stampPage = Math.max(1, Math.floor(Number(stampPosition.page_number || stampPage || 1)));
            }

            const signedDoc = await this.applySignatureOnEnvelopeDocument(
              envelope.id_envelope,
              targetDocId,
              sigFile,
              xRatio,
              yRatio,
              signaturePage,
              envelope.created_by,
              resolvedStampPath,
              stampX,
              stampY,
              stampPage,
            );
            if (signedDoc?.path && fs.existsSync(signedDoc.path)) {
              signedAttachment = {
                filename: signedDoc.original_name || signedDoc.name || 'document-signe',
                path: signedDoc.path,
                contentType: signedDoc.mime_type || undefined,
              };
            }
          }
        } catch (error) {
          console.error('Signature/cachet application failed', error);
          throw new BadRequestException('Impossible d\'apposer la signature/cachet sur le document. Vérifiez les images puis réessayez.');
        }
      }

      await this.db('t_recipients').where('id_recipient', recipient.id_recipient).update({ signature_path: sigFile });
    }

    await this.db('t_recipients').where('id_recipient', recipient.id_recipient).update({
      status: isApprover
        ? RecipientStatus.APPROVED
        : (isViewer ? RecipientStatus.VIEWED : RecipientStatus.SIGNED),
      signed_at: this.db.fn.now(),
      signing_comment: comment || null,
    });

    await this.logAudit(
      envelope.id_envelope,
      isApprover ? 'DOCUMENT_APPROVED' : (isViewer ? 'DOCUMENT_VIEWED' : 'DOCUMENT_SIGNED'),
      recipient.id_user,
      ipAddress,
      {
      recipient_email: recipient.email,
      },
    );

    // Notify sender
    const [sender] = await this.db('t_users').where('id_user', envelope.created_by);
    this.emailService.sendSignatureConfirmation(
      sender.email,
      `${sender.first_name} ${sender.last_name}`,
      envelope.title,
      `${recipient.first_name} ${recipient.last_name}`,
      signedAttachment,
    ).catch(err => console.error('[Email] sendSignatureConfirmation failed:', err));

    // Notifier l'émetteur dans l'application
    await this.notificationsService.create(
      envelope.created_by,
      isApprover
        ? `${recipient.first_name} ${recipient.last_name} a vérifié/validé le document : "${envelope.title}"`
        : (isViewer
            ? `${recipient.first_name} ${recipient.last_name} a consulté et transmis le document : "${envelope.title}"`
            : `${recipient.first_name} ${recipient.last_name} a signé le document : "${envelope.title}"`),
      envelope.id_envelope,
    );

    // Check if all signed → complete or trigger next in sequence
    await this.checkAndAdvanceCircuit(envelope.id_envelope, sender);

    return {
      message: isApprover
        ? 'Document vérifié avec succès'
        : (isViewer ? 'Document soumis et envoyé avec succès' : 'Document signé avec succès'),
    };
  }

  private async applySignatureOnEnvelopeDocument(
    envelopeId: number,
    docId: number,
    signaturePath: string,
    xRatio: number,
    yRatio: number,
    signaturePageNumber: number,
    ownerUserId: number,
    stampPath?: string,
    stampXRatio?: number,
    stampYRatio?: number,
    stampPageNumber?: number,
  ): Promise<{ id_document: number; name: string; original_name: string; path: string; mime_type: string } | null> {
    const [link] = await this.db('t_envelope_documents')
      .where('id_envelope', envelopeId)
      .where('id_document', docId);
    if (!link) return null;

    const [doc] = await this.db('t_documents').where('id_document', docId);
    if (!doc || !fs.existsSync(doc.path)) return null;

    const ext = path.extname(doc.path).toLowerCase();
    const signedDir = path.resolve(process.env.UPLOAD_DEST || './uploads', 'signed');
    if (!fs.existsSync(signedDir)) fs.mkdirSync(signedDir, { recursive: true });
    const stampedPath = path.join(signedDir, `signed_${Date.now()}_${path.basename(doc.path)}`);

    if (doc.mime_type === 'application/pdf' || ext === '.pdf') {
      const pdfBytes = fs.readFileSync(doc.path);
      const sigBytes = fs.readFileSync(signaturePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const sigImage = await pdfDoc.embedPng(sigBytes);
      const pages = pdfDoc.getPages();
      if (!pages.length) return null;
      const sigPageIndex = Math.min(Math.max(signaturePageNumber - 1, 0), pages.length - 1);
      const page = pages[sigPageIndex];
      if (!page) return null;

      const pageWidth = page.getWidth();
      const pageHeight = page.getHeight();
      const sigWidth = pageWidth * 0.22;
      const ratio = sigImage.height / sigImage.width;
      const sigHeight = sigWidth * ratio;
      // X position: centered at xRatio
      const x = Math.min(Math.max((xRatio * pageWidth) - (sigWidth / 2), 0), pageWidth - sigWidth);
      // Y position: convert from front-end coords (0=top, 1=bottom) to PDF coords (0=bottom, 1=top)
      // yRatio from frontend: 0=top, 1=bottom
      // Convert to PDF: yFromBottom = (1 - yRatio) * pageHeight, then center
      const yFromBottom = ((1 - yRatio) * pageHeight);
      const y = Math.min(Math.max(yFromBottom - (sigHeight / 2), 0), pageHeight - sigHeight);

      page.drawImage(sigImage, { x, y, width: sigWidth, height: sigHeight, opacity: 0.95 });

      // Cachet (tampon officiel)
      if (stampPath && fs.existsSync(stampPath)) {
        const sx = stampXRatio ?? 0.50;
        const sy = stampYRatio ?? 0.90;
        let stampPngBytes: Buffer = fs.readFileSync(stampPath);
        if (stampPath.endsWith('.jpg') || stampPath.endsWith('.jpeg')) {
          stampPngBytes = await sharpFn(stampPath).png().toBuffer();
        }
        const stampImg = await pdfDoc.embedPng(stampPngBytes);
        const stPageIndex = Math.min(Math.max((stampPageNumber || signaturePageNumber || 1) - 1, 0), pages.length - 1);
        const stampPage = pages[stPageIndex] || page;
        const stampPageWidth = stampPage.getWidth();
        const stampPageHeight = stampPage.getHeight();
        const stampWidth = stampPageWidth * 0.20;
        const stampRatio = stampImg.height / stampImg.width;
        const stampHeight = stampWidth * stampRatio;
        // X position: centered at sx
        const stX = Math.min(Math.max((sx * stampPageWidth) - (stampWidth / 2), 0), stampPageWidth - stampWidth);
        // Y position: convert from front-end coords (0=top, 1=bottom) to PDF coords (0=bottom, 1=top)
        const stFromBottom = ((1 - sy) * stampPageHeight);
        const stY = Math.min(Math.max(stFromBottom - (stampHeight / 2), 0), stampPageHeight - stampHeight);
        stampPage.drawImage(stampImg, { x: stX, y: stY, width: stampWidth, height: stampHeight, opacity: 0.88 });
      }

      const out = await pdfDoc.save();
      fs.writeFileSync(stampedPath, out);
    } else if ((doc.mime_type || '').startsWith('image/') || ['.png', '.jpg', '.jpeg'].includes(ext)) {
      const base = sharpFn(doc.path);
      const meta = await base.metadata();
      if (!meta.width || !meta.height) return;

      const sigTargetWidth = Math.round(meta.width * 0.22);
      const sigBuf = await sharpFn(signaturePath)
        .resize({ width: sigTargetWidth })
        .png()
        .toBuffer();
      const sigMeta = await sharpFn(sigBuf).metadata();
      const sigW = sigMeta.width || sigTargetWidth;
      const sigH = sigMeta.height || Math.round(sigTargetWidth * 0.35);

      const left = Math.min(Math.max(Math.round((xRatio * meta.width) - (sigW / 2)), 0), meta.width - sigW);
      const top = Math.min(Math.max(Math.round((yRatio * meta.height) - (sigH / 2)), 0), meta.height - sigH);

      const composites: sharp.OverlayOptions[] = [{ input: sigBuf, left, top }];

      // Cachet
      if (stampPath && fs.existsSync(stampPath)) {
        const sx = stampXRatio ?? 0.50;
        const sy = stampYRatio ?? 0.90;
        const stampW2 = Math.round(meta.width * 0.20);
        const stBuf = await sharpFn(stampPath).resize({ width: stampW2 }).png().toBuffer();
        const stMeta = await sharpFn(stBuf).metadata();
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
      return null;
    }

    const stat = fs.statSync(stampedPath);
    const [newDocId] = await this.db('t_documents').insert({
      name: path.basename(stampedPath),
      original_name: doc.original_name,
      path: stampedPath,
      mime_type: doc.mime_type,
      size: stat.size,
      version: Number(doc.version || 1) + 1,
      created_by: ownerUserId,
    });

    await this.db('t_envelope_documents')
      .where('id_envelope', envelopeId)
      .where('id_document', docId)
      .update({ id_document: newDocId });

    const [newDoc] = await this.db('t_documents')
      .where('id_document', newDocId)
      .select('id_document', 'name', 'original_name', 'path', 'mime_type');
    return newDoc || null;
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
        stBuf = await sharpFn(stampPath).png().toBuffer();
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

  async reject(token: string, dto: RejectEnvelopeDto, ipAddress: string) {
    const [recipient] = await this.db('t_recipients').where('token', token);
    if (!recipient) throw new NotFoundException('Lien invalide');

    const envelopeId = recipient.id_envelope;
    const [envelope] = await this.db('t_envelopes').where('id_envelope', envelopeId);
    if (!envelope) throw new NotFoundException('Enveloppe non trouvée');
    this.assertPublicEnvelopeAccessible(envelope);

    await this.db('t_recipients').where('id_recipient', recipient.id_recipient).update({
      status: RecipientStatus.REJECTED,
      rejection_reason: dto.reason,
    });

    await this.db('t_envelopes').where('id_envelope', envelopeId).update({ status: EnvelopeStatus.REJECTED });

    const [sender] = await this.db('t_users').where('id_user', envelope.created_by);

    this.emailService.sendRejectionNotification(
      sender.email,
      `${sender.first_name} ${sender.last_name}`,
      envelope.title,
      `${recipient.first_name} ${recipient.last_name}`,
      dto.reason,
    ).catch(err => console.error('[Email] sendRejectionNotification failed:', err));

    await this.notificationsService.create(
      sender.id_user,
      `${recipient.first_name} ${recipient.last_name} a rejeté le document : "${envelope.title}"`,
      envelopeId,
    );

    await this.logAudit(envelopeId, 'DOCUMENT_REJECTED', recipient.id_user, ipAddress, {
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

    this.emailService.sendSignatureRequest(
      dto.delegate_email,
      `${dto.delegate_first_name} ${dto.delegate_last_name}`,
      env.title,
      `${sender.first_name} ${sender.last_name}`,
      newToken,
    ).catch(err => console.error('[Email] sendSignatureRequest (delegate) failed:', err));

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

    this.emailService.sendReturnForCorrections(
      sender.email,
      `${sender.first_name} ${sender.last_name}`,
      envelope.title,
      `${recipient.first_name} ${recipient.last_name}`,
      reason,
    ).catch(err => console.error('[Email] sendReturnForCorrections failed:', err));

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
    this.emailService.sendSignatureRequest(
      dto.forward_email,
      `${dto.forward_first_name} ${dto.forward_last_name}`,
      env.title,
      `${sender.first_name} ${sender.last_name}`,
      newToken,
      env.message,
    ).catch(err => console.error('[Email] sendSignatureRequest (forward) failed:', err));

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

    const recipientIds = (envelope.recipients ?? [])
      .map((r: any) => Number(r.id_recipient))
      .filter((id: number) => Number.isFinite(id));
    const zonesByRecipient = new Map<number, Array<{ id_document: number; x_ratio: number; y_ratio: number; page_number: number }>>();

    if (recipientIds.length > 0) {
      try {
        const zoneRows = await this.db('t_recipient_signature_zones')
          .whereIn('id_recipient', recipientIds)
          .select('id_recipient', 'id_document', 'x_ratio', 'y_ratio', 'page_number');

        for (const row of zoneRows) {
          const idRecipient = Number(row.id_recipient);
          if (!Number.isFinite(idRecipient)) continue;
          const bucket = zonesByRecipient.get(idRecipient) || [];
          bucket.push({
            id_document: Number(row.id_document),
            x_ratio: Math.min(Math.max(Number(row.x_ratio), 0), 1),
            y_ratio: Math.min(Math.max(Number(row.y_ratio), 0), 1),
            page_number: Math.max(1, Math.floor(Number(row.page_number || 1))),
          });
          zonesByRecipient.set(idRecipient, bucket);
        }
      } catch {
        // Compatibilité ancienne base sans table t_recipient_signature_zones.
      }
    }

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
      r.predefined_signature_zones = zonesByRecipient.get(Number(r.id_recipient)) || [];
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

  async replaceDocuments(
    envelopeId: number,
    userId: number,
    documentIds: number[],
    attachmentIds?: number[],
    recipientZones?: Array<{ id_recipient: number; doc_index: number; x_ratio: number; y_ratio: number; page_number?: number }>,
  ) {
    const [env] = await this.db('t_envelopes').where('id_envelope', envelopeId);
    if (!env) throw new NotFoundException('Enveloppe non trouvée');
    if (env.created_by !== userId) throw new ForbiddenException('Accès refusé');
    if (![EnvelopeStatus.DRAFT, EnvelopeStatus.REVISION].includes(env.status)) {
      throw new BadRequestException('Les documents ne peuvent être remplacés que sur un brouillon ou une enveloppe en révision');
    }
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      throw new BadRequestException('Ajoutez au moins un document corrigé');
    }

    const trx = await this.db.transaction();
    try {
      await trx('t_envelope_documents').where('id_envelope', envelopeId).delete();
      for (const documentId of documentIds) {
        await trx('t_envelope_documents').insert({ id_envelope: envelopeId, id_document: documentId });
      }

      if (Array.isArray(attachmentIds)) {
        await trx('t_envelope_attachments').where('id_envelope', envelopeId).delete();
        for (const attachmentId of [...new Set(attachmentIds)]) {
          await trx('t_envelope_attachments').insert({ id_envelope: envelopeId, id_document: attachmentId });
        }
      }

      if (Array.isArray(recipientZones)) {
        await this.ensureRecipientSignatureZonesTable(trx);
        const signatoryRecipientIds = (await trx('t_recipients')
          .where('id_envelope', envelopeId)
          .where('role', 'SIGNATORY')
          .pluck('id_recipient')) as number[];

        if (signatoryRecipientIds.length > 0) {
          // Les nouvelles zones par document remplacent totalement les anciennes zones de l'enveloppe.
          await trx('t_recipient_signature_zones').whereIn('id_recipient', signatoryRecipientIds).delete();
          await trx('t_recipients')
            .where('id_envelope', envelopeId)
            .whereIn('id_recipient', signatoryRecipientIds)
            .update({ sig_doc_id: null, sig_x_ratio: null, sig_y_ratio: null });

          if (recipientZones.length > 0) {
            const signatorySet = new Set(signatoryRecipientIds.map((id) => Number(id)));
            const deduped = new Map<string, { id_recipient: number; id_document: number; x_ratio: number; y_ratio: number; page_number: number }>();

            for (const zone of recipientZones) {
              const recipientId = Number(zone.id_recipient);
              if (!Number.isFinite(recipientId) || !signatorySet.has(recipientId)) continue;

              const docId = Number(documentIds[Number(zone.doc_index)]);
              if (!Number.isFinite(docId)) continue;

              const x = Math.min(Math.max(Number(zone.x_ratio), 0), 1);
              const y = Math.min(Math.max(Number(zone.y_ratio), 0), 1);
              const page = Math.max(1, Math.floor(Number(zone.page_number || 1)));

              deduped.set(`${recipientId}:${docId}`, {
                id_recipient: recipientId,
                id_document: docId,
                x_ratio: x,
                y_ratio: y,
                page_number: page,
              });
            }

            if (deduped.size > 0) {
              await trx('t_recipient_signature_zones').insert([...deduped.values()]);
            }
          }
        }
      }

      if (env.status === EnvelopeStatus.REVISION) {
        await trx('t_recipients')
          .where('id_envelope', envelopeId)
          .whereIn('status', [RecipientStatus.RETURNED, RecipientStatus.REJECTED])
          .update({ status: RecipientStatus.PENDING, rejection_reason: null });
      }

      await trx.commit();
      await this.logAudit(envelopeId, 'DOCUMENTS_REPLACED', userId, null, {
        document_ids: documentIds,
        attachment_ids: Array.isArray(attachmentIds) ? attachmentIds : undefined,
        recipient_zones: Array.isArray(recipientZones) ? recipientZones.length : 0,
      });
      return this.findById(envelopeId);
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  }

  private async ensureRecipientSignatureZonesTable(trx: Knex.Transaction): Promise<void> {
    await trx.raw(`
      CREATE TABLE IF NOT EXISTS t_recipient_signature_zones (
        id_zone INT AUTO_INCREMENT PRIMARY KEY,
        id_recipient INT NOT NULL,
        id_document INT NOT NULL,
        x_ratio DECIMAL(5,4) NOT NULL,
        y_ratio DECIMAL(5,4) NOT NULL,
        page_number INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_recipient_document_zone (id_recipient, id_document),
        CONSTRAINT fk_recipient_signature_zone_recipient FOREIGN KEY (id_recipient) REFERENCES t_recipients(id_recipient) ON DELETE CASCADE,
        CONSTRAINT fk_recipient_signature_zone_document FOREIGN KEY (id_document) REFERENCES t_documents(id_document) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }

  async forwardByCreator(envelopeId: number, userId: number, dto: ForwardRecipientDto) {
    if (!dto.forward_email.endsWith('@cgrae.ci')) {
      throw new BadRequestException('Le destinataire doit avoir un email @cgrae.ci');
    }

    const [env] = await this.db('t_envelopes').where('id_envelope', envelopeId);
    if (!env) throw new NotFoundException('Enveloppe non trouvée');
    if (env.created_by !== userId) throw new ForbiddenException('Accès refusé');
    if (![EnvelopeStatus.REVISION, EnvelopeStatus.IN_PROGRESS, EnvelopeStatus.SENT].includes(env.status)) {
      throw new BadRequestException('Le renvoi vers un nouveau destinataire est disponible en révision ou en cours');
    }

    const recipients = await this.db('t_recipients').where('id_envelope', envelopeId);
    const maxOrder = Math.max(...recipients.map((r) => Number(r.signing_order || 0)), 0);
    const nextOrder = maxOrder + 1;
    const newToken = uuidv4();

    await this.db.transaction(async (trx) => {
      // Le créateur applique la correction et poursuit le circuit: on marque les retours comme traités.
      await trx('t_recipients')
        .where('id_envelope', envelopeId)
        .whereIn('status', [RecipientStatus.RETURNED, RecipientStatus.REJECTED])
        .update({ status: RecipientStatus.DELEGATED });

      await trx('t_recipients').insert({
        id_envelope: envelopeId,
        email: dto.forward_email,
        first_name: dto.forward_first_name,
        last_name: dto.forward_last_name,
        role: 'SIGNATORY',
        signing_order: nextOrder,
        status: RecipientStatus.SENT,
        token: newToken,
      });

      await trx('t_envelopes').where('id_envelope', envelopeId).update({
        status: EnvelopeStatus.IN_PROGRESS,
        completed_at: null,
      });
    });

    const [sender] = await this.db('t_users').where('id_user', userId);
    this.emailService.sendSignatureRequest(
      dto.forward_email,
      `${dto.forward_first_name} ${dto.forward_last_name}`,
      env.title,
      `${sender.first_name} ${sender.last_name}`,
      newToken,
      env.message,
    ).catch(err => console.error('[Email] sendSignatureRequest (creator-forward) failed:', err));

    const [nextUser] = await this.db('t_users').where('email', dto.forward_email).select('id_user');
    if (nextUser) {
      await this.notificationsService.create(
        nextUser.id_user,
        `Vous avez un document à analyser/signer : "${env.title}" (renvoyé par ${sender.first_name} ${sender.last_name})`,
        envelopeId,
      );
    }

    await this.logAudit(envelopeId, 'CIRCUIT_FORWARDED_BY_CREATOR', userId, null, {
      to: dto.forward_email,
      signing_order: nextOrder,
    });

    return this.findById(envelopeId);
  }

  async closeByCreator(envelopeId: number, userId: number) {
    const [env] = await this.db('t_envelopes').where('id_envelope', envelopeId);
    if (!env) throw new NotFoundException('Enveloppe non trouvée');
    if (env.created_by !== userId) throw new ForbiddenException('Accès refusé');
    if ([EnvelopeStatus.CANCELLED, EnvelopeStatus.EXPIRED].includes(env.status)) {
      throw new BadRequestException('Cette enveloppe ne peut pas être clôturée dans son état actuel');
    }

    await this.db('t_envelopes').where('id_envelope', envelopeId).update({
      status: EnvelopeStatus.COMPLETED,
      completed_at: this.db.fn.now(),
    });

    await this.archiveEnvelopeDocumentsForCreator(envelopeId, userId);
    await this.logAudit(envelopeId, 'ENVELOPE_CLOSED_BY_CREATOR', userId, null, {});

    return this.findById(envelopeId);
  }

  async reactivateByCreator(envelopeId: number, userId: number, expiresAt: string) {
    const [env] = await this.db('t_envelopes').where('id_envelope', envelopeId);
    if (!env) throw new NotFoundException('Enveloppe non trouvée');
    if (env.created_by !== userId) throw new ForbiddenException('Accès refusé');
    if (env.status !== EnvelopeStatus.EXPIRED) {
      throw new BadRequestException('Seule une enveloppe expirée peut être réactivée');
    }

    const normalizedExpiresAt = this.normalizeExpirationInput(expiresAt);
    if (!normalizedExpiresAt) {
      throw new BadRequestException('Une nouvelle date limite est obligatoire');
    }

    await this.db.transaction(async (trx) => {
      await trx('t_envelopes').where('id_envelope', envelopeId).update({
        status: EnvelopeStatus.REVISION,
        expires_at: normalizedExpiresAt,
      });

      await trx('t_recipients')
        .where('id_envelope', envelopeId)
        .whereIn('status', [RecipientStatus.SENT, RecipientStatus.PENDING, RecipientStatus.RETURNED])
        .update({ status: RecipientStatus.PENDING });
    });

    await this.logAudit(envelopeId, 'ENVELOPE_REACTIVATED', userId, null, { expires_at: normalizedExpiresAt });
    return this.send(envelopeId, userId);
  }

  private async checkAndAdvanceCircuit(envelopeId: number, sender: any) {
    const allRecipients = await this.db('t_recipients')
      .where('id_envelope', envelopeId)
      .whereIn('role', ['SIGNATORY', 'APPROVER', 'VIEWER']);

    const [env] = await this.db('t_envelopes').where('id_envelope', envelopeId);
    const effectiveExpiration = this.getEffectiveExpirationDate(env?.expires_at);
    if (effectiveExpiration && effectiveExpiration.getTime() < Date.now()) {
      await this.db('t_envelopes').where('id_envelope', envelopeId).update({ status: EnvelopeStatus.EXPIRED });
      return;
    }

    const allDone = allRecipients.every(
      (r) =>
        r.status === RecipientStatus.SIGNED
        || r.status === RecipientStatus.APPROVED
        || r.status === RecipientStatus.VIEWED
        || r.status === RecipientStatus.DELEGATED,
    );

    if (allDone) {
      await this.db('t_envelopes').where('id_envelope', envelopeId).update({
        status: EnvelopeStatus.COMPLETED,
        completed_at: this.db.fn.now(),
      });
      await this.archiveEnvelopeDocumentsForCreator(envelopeId, sender.id_user);
      // Notify all (fire-and-forget)
      for (const r of allRecipients) {
        this.emailService.sendEnvelopeCompleted(r.email, `${r.first_name} ${r.last_name}`, env.title)
          .catch(err => console.error('[Email] sendEnvelopeCompleted failed:', err));
      }
      this.emailService.sendEnvelopeCompleted(sender.email, `${sender.first_name} ${sender.last_name}`, env.title)
        .catch(err => console.error('[Email] sendEnvelopeCompleted (sender) failed:', err));
      await this.logAudit(envelopeId, 'ENVELOPE_COMPLETED', sender.id_user, null, {});
    } else if (env.circuit_type === 'SEQUENTIAL') {
      // Find next pending
      const maxSigned = Math.max(
        ...allRecipients
          .filter((r) =>
            r.status === RecipientStatus.SIGNED
            || r.status === RecipientStatus.APPROVED
            || r.status === RecipientStatus.VIEWED
            || r.status === RecipientStatus.DELEGATED,
          )
          .map((r) => r.signing_order),
        0,
      );
      const nextRecipients = allRecipients.filter(
        (r) => r.signing_order === maxSigned + 1 && r.status === RecipientStatus.PENDING,
      );
      for (const r of nextRecipients) {
        await this.db('t_recipients').where('id_recipient', r.id_recipient).update({ status: RecipientStatus.SENT });
        this.emailService.sendSignatureRequest(
          r.email,
          `${r.first_name} ${r.last_name}`,
          env.title,
          `${sender.first_name} ${sender.last_name}`,
          r.token,
        ).catch(err => console.error('[Email] sendSignatureRequest (circuit) failed:', err));
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

  private async archiveEnvelopeDocumentsForCreator(envelopeId: number, creatorId: number) {
    const documentRows = await this.db('t_envelope_documents')
      .where('id_envelope', envelopeId)
      .select('id_document');
    for (const row of documentRows) {
      await this.db('t_user_document_archives')
        .insert({
          id_user: creatorId,
          id_document: row.id_document,
          is_archived: true,
          archived_at: this.db.fn.now(),
        })
        .onConflict(['id_user', 'id_document'])
        .merge({
          is_archived: true,
          archived_at: this.db.fn.now(),
        });
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
