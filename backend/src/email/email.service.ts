import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(EmailService.name);

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.mailtrap.io',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });
  }

  async send(opts: EmailOptions): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || 'CGRAE Signature <noreply@cgrae.ci>',
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      });
      this.logger.log(`Email envoyé à ${opts.to} — ${opts.subject}`);
    } catch (err: unknown) {
      this.logger.warn(`SMTP indisponible — email simulé pour ${opts.to}`);
      this.logger.log(`\n${'='.repeat(60)}\n📧 EMAIL (DEV)\n  À      : ${opts.to}\n  Sujet  : ${opts.subject}\n${'='.repeat(60)}`);
    }
  }

  async sendSignatureRequest(
    recipientEmail: string,
    recipientName: string,
    envelopeTitle: string,
    senderName: string,
    signingToken: string,
    message?: string,
  ) {
    const signingLink = `${process.env.CORS_ORIGIN || 'http://localhost:4200'}/sign/${signingToken}`;
    await this.send({
      to: recipientEmail,
      subject: `[CGRAE Signature] Action requise : ${envelopeTitle}`,
      html: this.templateSignatureRequest(recipientName, envelopeTitle, senderName, signingLink, message),
    });
  }

  async sendSignatureConfirmation(
    senderEmail: string,
    senderName: string,
    envelopeTitle: string,
    signerName: string,
  ) {
    await this.send({
      to: senderEmail,
      subject: `[CGRAE Signature] Document signé : ${envelopeTitle}`,
      html: this.templateSignatureConfirmation(senderName, envelopeTitle, signerName),
    });
  }

  async sendRejectionNotification(
    senderEmail: string,
    senderName: string,
    envelopeTitle: string,
    signerName: string,
    reason?: string,
  ) {
    await this.send({
      to: senderEmail,
      subject: `[CGRAE Signature] Document rejeté : ${envelopeTitle}`,
      html: this.templateRejection(senderName, envelopeTitle, signerName, reason),
    });
  }

  async sendReturnForCorrections(
    senderEmail: string,
    senderName: string,
    envelopeTitle: string,
    recipientName: string,
    reason: string,
  ) {
    await this.send({
      to: senderEmail,
      subject: `[CGRAE Signature] Retour pour corrections : ${envelopeTitle}`,
      html: this.templateReturnForCorrections(senderName, envelopeTitle, recipientName, reason),
    });
  }

  async sendEnvelopeCompleted(
    recipientEmail: string,
    recipientName: string,
    envelopeTitle: string,
  ) {
    await this.send({
      to: recipientEmail,
      subject: `[CGRAE Signature] Processus terminé : ${envelopeTitle}`,
      html: this.templateCompleted(recipientName, envelopeTitle),
    });
  }

  async sendReminder(
    recipientEmail: string,
    recipientName: string,
    envelopeTitle: string,
    signingToken: string,
    expiresAt: Date,
  ) {
    const signingLink = `${process.env.CORS_ORIGIN || 'http://localhost:4200'}/sign/${signingToken}`;
    await this.send({
      to: recipientEmail,
      subject: `[CGRAE Signature] Rappel : ${envelopeTitle} expire bientôt`,
      html: this.templateReminder(recipientName, envelopeTitle, signingLink, expiresAt),
    });
  }

  private baseLayout(title: string, content: string): string {
    return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
        <!-- Header -->
        <tr>
          <td style="background:#0a7c4e;padding:28px 40px;text-align:center;">
            <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:bold;letter-spacing:1px;">
              CGRAE <span style="color:#ffffff;">Signature</span>
            </h1>
            <p style="color:#a8c4e0;margin:6px 0 0;font-size:13px;">Plateforme de Signature Électronique</p>
          </td>
        </tr>
        <!-- Body -->
        <tr><td style="padding:36px 40px;">${content}</td></tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fc;padding:20px 40px;text-align:center;border-top:1px solid #e8ecf0;">
            <p style="color:#8898aa;font-size:12px;margin:0;">
              Cet email a été envoyé automatiquement par CGRAE Signature.<br/>
              © ${new Date().getFullYear()} CGRAE – Caisse Générale de Retraite des Agents de l'État.<br/>
              Ne pas répondre à cet email.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private templateSignatureRequest(
    recipientName: string,
    envelopeTitle: string,
    senderName: string,
    signingLink: string,
    message?: string,
  ): string {
    const body = `
      <h2 style="color:#0a7c4e;margin-top:0;font-size:20px;">Action requise : Signature demandée</h2>
      <p style="color:#525f7f;line-height:1.6;">Bonjour <strong>${recipientName}</strong>,</p>
      <p style="color:#525f7f;line-height:1.6;">
        <strong>${senderName}</strong> vous invite à signer le document suivant :
      </p>
      <div style="background:#f0fff8;border-left:4px solid #0a7c4e;padding:16px 20px;border-radius:4px;margin:20px 0;">
        <strong style="color:#0a7c4e;font-size:15px;">📄 ${envelopeTitle}</strong>
      </div>
      ${message ? `<p style="color:#525f7f;font-style:italic;background:#fffbf0;padding:12px;border-radius:4px;">"${message}"</p>` : ''}
      <p style="text-align:center;margin:32px 0;">
        <a href="${signingLink}"
           style="background:#0a7c4e;color:#ffffff;padding:14px 36px;border-radius:6px;text-decoration:none;font-size:15px;font-weight:bold;display:inline-block;">
          ✍️ Signer le document
        </a>
      </p>
      <p style="color:#8898aa;font-size:12px;text-align:center;">
        Si le bouton ne fonctionne pas, copiez ce lien : <br/>
        <a href="${signingLink}" style="color:#0a7c4e;">${signingLink}</a>
      </p>`;
    return this.baseLayout('Signature requise', body);
  }

  private templateSignatureConfirmation(
    senderName: string,
    envelopeTitle: string,
    signerName: string,
  ): string {
    const body = `
      <h2 style="color:#1a7e4a;margin-top:0;font-size:20px;">✅ Document signé avec succès</h2>
      <p style="color:#525f7f;line-height:1.6;">Bonjour <strong>${senderName}</strong>,</p>
      <p style="color:#525f7f;line-height:1.6;">
        Excellente nouvelle ! <strong>${signerName}</strong> a signé votre document.
      </p>
      <div style="background:#f0fff4;border-left:4px solid #1a7e4a;padding:16px 20px;border-radius:4px;margin:20px 0;">
        <strong style="color:#1a7e4a;font-size:15px;">📄 ${envelopeTitle}</strong>
      </div>
      <p style="color:#525f7f;line-height:1.6;">
        Connectez-vous à la plateforme pour suivre l'avancement du circuit de validation.
      </p>`;
    return this.baseLayout('Document signé', body);
  }

  private templateRejection(
    senderName: string,
    envelopeTitle: string,
    signerName: string,
    reason?: string,
  ): string {
    const body = `
      <h2 style="color:#c0392b;margin-top:0;font-size:20px;">⚠️ Document rejeté</h2>
      <p style="color:#525f7f;line-height:1.6;">Bonjour <strong>${senderName}</strong>,</p>
      <p style="color:#525f7f;line-height:1.6;">
        <strong>${signerName}</strong> a rejeté votre document.
      </p>
      <div style="background:#fff5f5;border-left:4px solid #c0392b;padding:16px 20px;border-radius:4px;margin:20px 0;">
        <strong style="color:#c0392b;font-size:15px;">📄 ${envelopeTitle}</strong>
        ${reason ? `<p style="margin:8px 0 0;color:#525f7f;font-size:14px;">Motif : ${reason}</p>` : ''}
      </div>
      <p style="color:#525f7f;line-height:1.6;">Veuillez corriger le document et le renvoyer si nécessaire.</p>`;
    return this.baseLayout('Document rejeté', body);
  }

  private templateReturnForCorrections(
    senderName: string,
    envelopeTitle: string,
    recipientName: string,
    reason: string,
  ): string {
    const body = `
      <h2 style="color:#e67e22;margin-top:0;font-size:20px;">↩️ Retour pour corrections</h2>
      <p style="color:#525f7f;line-height:1.6;">Bonjour <strong>${senderName}</strong>,</p>
      <p style="color:#525f7f;line-height:1.6;">
        <strong>${recipientName}</strong> a retourné le document pour corrections avant de signer.
      </p>
      <div style="background:#fff9f0;border-left:4px solid #e67e22;padding:16px 20px;border-radius:4px;margin:20px 0;">
        <strong style="color:#e67e22;font-size:15px;">📄 ${envelopeTitle}</strong>
        <p style="margin:12px 0 0;color:#525f7f;font-size:14px;"><strong>Corrections demandées :</strong></p>
        <p style="margin:6px 0 0;color:#525f7f;font-size:14px;font-style:italic;">"${reason}"</p>
      </div>
      <p style="color:#525f7f;line-height:1.6;">
        Veuillez prendre en compte ces remarques, corriger le document et le renvoyer pour signature.
      </p>`;
    return this.baseLayout('Retour pour corrections', body);
  }

  private templateCompleted(recipientName: string, envelopeTitle: string): string {
    const body = `
      <h2 style="color:#1a7e4a;margin-top:0;font-size:20px;">🎉 Processus de signature terminé</h2>
      <p style="color:#525f7f;line-height:1.6;">Bonjour <strong>${recipientName}</strong>,</p>
      <p style="color:#525f7f;line-height:1.6;">
        Le circuit de validation a été complété. Tous les signataires ont apposé leur signature.
      </p>
      <div style="background:#f0fff4;border-left:4px solid #1a7e4a;padding:16px 20px;border-radius:4px;margin:20px 0;">
        <strong style="color:#1a7e4a;font-size:15px;">📄 ${envelopeTitle}</strong>
      </div>
      <p style="color:#525f7f;line-height:1.6;">
        Le document signé est disponible sur la plateforme CGRAE Signature.
      </p>`;
    return this.baseLayout('Processus terminé', body);
  }

  private templateReminder(
    recipientName: string,
    envelopeTitle: string,
    signingLink: string,
    expiresAt: Date,
  ): string {
    const body = `
      <h2 style="color:#e67e22;margin-top:0;font-size:20px;">⏰ Rappel : Signature en attente</h2>
      <p style="color:#525f7f;line-height:1.6;">Bonjour <strong>${recipientName}</strong>,</p>
      <p style="color:#525f7f;line-height:1.6;">
        Ce rappel vous informe qu'un document attend toujours votre signature.
      </p>
      <div style="background:#fff9f0;border-left:4px solid #e67e22;padding:16px 20px;border-radius:4px;margin:20px 0;">
        <strong style="color:#e67e22;font-size:15px;">📄 ${envelopeTitle}</strong>
        <p style="margin:8px 0 0;color:#525f7f;font-size:13px;">
          Expire le : <strong>${expiresAt.toLocaleDateString('fr-FR')}</strong>
        </p>
      </div>
      <p style="text-align:center;margin:32px 0;">
        <a href="${signingLink}"
           style="background:#e67e22;color:#ffffff;padding:14px 36px;border-radius:6px;text-decoration:none;font-size:15px;font-weight:bold;display:inline-block;">
          ✍️ Signer maintenant
        </a>
      </p>`;
    return this.baseLayout('Rappel de signature', body);
  }
}
