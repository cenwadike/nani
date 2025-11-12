// SPDX-License-Identifier: MIT
// plugins/notifications/email.ts

/**
 * @file plugins/notifications/email.ts
 * @summary Notification plugin that sends email via SMTP using nodemailer.
 *          Features a sleek, professional dark-themed HTML template matching the Nani brand.
 */

import nodemailer from 'nodemailer';
import config from '../../config';
import { NotificationPlugin } from '../../types/pluginTypes';
import logger from '../../utils/logger';

let transporter: nodemailer.Transporter | null = null;

/** Helper – inline CSS for email compatibility */
const inlineStyles = (html: string) => html;

/** 
 * Sleek Professional HTML Email Template 
 * Dark-themed design with gradient accents matching Nani brand
 */
const buildHtmlTemplate = (
  message: string,
  subject: string,
  brandName = 'Nani',
  logoUrl = '',
  recipientName?: string
): string => {
  const escapedMessage = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Split message into paragraphs for nicer rendering
  const paragraphs = escapedMessage
    .split('\n')
    .filter((p) => p.trim())
    .map((p) => `<p style="margin:0 0 1rem 0; line-height:1.8; color:#cbd5e1;">${p}</p>`)
    .join('');

  const greeting = recipientName ? `Hey ${recipientName} 👋` : 'Hey 👋';

  return inlineStyles(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${subject}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    /* Dark mode support for email clients */
    @media (prefers-color-scheme: dark) {
      .bg-light { background-color: #0a0a0a !important; }
      .text-light { color: #e5e7eb !important; }
      .card-bg { background-color: #1a1a2e !important; }
    }

    body {
      margin: 0;
      padding: 0;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      color: #e5e7eb;
      line-height: 1.6;
    }

    /* Responsive */
    @media (max-width: 600px) {
      .container {
        border-radius: 12px !important;
        margin: 10px !important;
      }
      .header {
        padding: 25px 15px !important;
      }
      .content {
        padding: 25px 15px !important;
      }
      .subject {
        font-size: 20px !important;
      }
      .body-text {
        font-size: 13px !important;
      }
      .btn-primary {
        padding: 10px 24px !important;
        font-size: 13px !important;
      }
    }
  </style>
</head>
<body>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%); padding:20px;">
    <tr>
      <td align="center">
        <!-- Main Container -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background:#0f0f1e; border-radius:16px; overflow:hidden; box-shadow:0 20px 60px rgba(230, 0, 122, 0.15); border:1px solid rgba(230, 0, 122, 0.2);">
          
          <!-- Header with Gradient -->
          <tr>
            <td style="background:linear-gradient(135deg, #E6007A 0%, #552BBF 100%); padding:30px 20px; text-align:center; position:relative;">
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding:30px 20px; color:#e5e7eb;">
              <div style="font-size:13px; color:#a0aec0; margin-bottom:15px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">
                ${greeting}
              </div>

              <div style="font-size:14px; line-height:1.7; margin-bottom:15px;">
                ${paragraphs}
              </div>

              <!-- Optional CTA Placeholder -->
              {{#if cta}}
              <div style="text-align:center; margin:25px 0;">
                <a href="{{cta.url}}" target="_blank" style="display:inline-block; padding:12px 32px; background:linear-gradient(135deg, #E6007A, #552BBF); color:#ffffff; text-decoration:none; font-weight:700; border-radius:50px; font-size:14px; box-shadow:0 10px 30px rgba(230, 0, 122, 0.4); letter-spacing:0.5px;">
                  {{cta.text}}
                </a>
              </div>
              {{/if}}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:rgba(26, 26, 46, 0.6); padding:20px; text-align:center; border-top:1px solid rgba(230, 0, 122, 0.1);">
              <div style="font-size:12px; color:#94a3b8; margin-bottom:10px;">
                © {{year}} <strong style="color:#cbd5e1;">${brandName}</strong>
              </div>
              
              <div style="font-size:11px; color:#64748b; margin-bottom:10px;">
                <a href="https://nani-production-c105.up.railway.app/" style="color:#E6007A; text-decoration:none; font-weight:600; margin:0 6px;">Preferences</a> •
                <a href="https://nani-production-c105.up.railway.app/" style="color:#E6007A; text-decoration:none; font-weight:600; margin:0 6px;">Privacy</a>
              </div>
              
              <div style="font-size:10px; color:#475569; margin-top:10px; padding-top:10px; border-top:1px solid rgba(230, 0, 122, 0.1);">
                Sent with <strong>${brandName}</strong>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim());
};

const email: NotificationPlugin = {
  name: 'email',

  /** Initialize nodemailer transporter */
  init(): void {
    if (!config.smtp?.host) {
      throw new Error('SMTP config missing (host, port, user, pass, from)');
    }
    if (transporter) return;

    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure ?? false,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
    logger.info('Email transporter initialized');
  },

  /** Send the email with professional template */
  async execute(message: string, pluginConfig: any): Promise<void> {
    if (!pluginConfig?.to) {
      throw new Error('Email plugin requires "to" address');
    }

    if (!transporter) this.init();

    const subject = pluginConfig.subject ?? 'Notification from Nani';
    const html = buildHtmlTemplate(
      message,
      subject,
      pluginConfig.brandName ?? 'Nani',
      pluginConfig.logoUrl,
      pluginConfig.recipientName
    );

    // Simple Handlebars-style placeholder replacement for optional CTA
    let finalHtml = html;
    if (pluginConfig.cta?.url && pluginConfig.cta?.text) {
      finalHtml = finalHtml
        .replace('{{#if cta}}', '')
        .replace('{{/if}}', '')
        .replace('{{cta.url}}', pluginConfig.cta.url)
        .replace('{{cta.text}}', pluginConfig.cta.text);
    } else {
      finalHtml = finalHtml.replace(/{{#if cta}}[\s\S]*?{{\/if}}/g, '');
    }
    finalHtml = finalHtml.replace('{{year}}', new Date().getFullYear().toString());

    const mailOptions = {
      from: config.smtp.from ?? `"${pluginConfig.brandName ?? 'Nani'}" <${config.smtp.user}>`,
      to: pluginConfig.to,
      subject,
      text: message,
      html: finalHtml,
    };

    try {
      await transporter!.sendMail(mailOptions);
      logger.info(`Email sent to ${pluginConfig.to}`);
    } catch (err: any) {
      logger.error(`Email failed to ${pluginConfig.to}: ${err.message}`);
      throw err;
    }
  },

  /** Validate plugin configuration */
  validateConfig(pluginConfig: any): boolean {
    if (!pluginConfig?.to || !pluginConfig.to.includes('@')) {
      throw new Error('Valid "to" email address required');
    }
    return true;
  },
};

export default email;
