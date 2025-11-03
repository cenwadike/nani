// SPDX-License-Identifier: MIT
// plugins/notifications/email.ts

/**
 * @file plugins/notifications/email.ts
 * @summary Notification plugin that sends email via SMTP using nodemailer.
 */

import nodemailer from 'nodemailer';
import config from '../../config';
import { NotificationPlugin } from '../../types/pluginTypes';
import logger from '../../utils/logger';

let transporter: any = null;

const email: NotificationPlugin = {
  name: 'email',

  /** Initialise nodemailer once */
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

  /** Send the email */
  async execute(message: string, pluginConfig: any): Promise<void> {
    if (!pluginConfig?.to) {
      throw new Error('Email plugin requires "to" address');
    }

    if (!transporter) this.init();

    const mailOptions = {
      from: config.smtp.from ?? `"Nani" <${config.smtp.user}>`,
      to: pluginConfig.to,
      subject: pluginConfig.subject ?? 'Nani Notification',
      text: message,
      html: pluginConfig.html ?? `<p>${message.replace(/\n/g, '<br>')}</p>`,
    };

    try {
      await transporter.sendMail(mailOptions);
      logger.info(`Email sent to ${pluginConfig.to}`);
    } catch (err: any) {
      logger.error(`Email failed to ${pluginConfig.to}: ${err.message}`);
      throw err;
    }
  },

  /** Validate config */
  validateConfig(pluginConfig: any): boolean {
    if (!pluginConfig?.to || !pluginConfig.to.includes('@')) {
      throw new Error('Valid "to" email address required');
    }
    return true;
  },
};

export default email;