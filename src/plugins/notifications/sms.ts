// SPDX-License-Identifier: MIT
// This file is part of the Nani project, a Polkadot-based event streaming service.
//
// Copyright (c) 2025 Nani Contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * @file plugins/activities/sms.ts
 * @summary Notification plugin for sending SMS messages via Twilio.
 * @description Implements the NotificationPlugin interface to deliver messages
 *              to a configured phone number using Twilio's messaging API.
 */

import twilio from 'twilio';
import config from '../../config';
import { NotificationPlugin } from '../../types/pluginTypes';
import logger from '../../utils/logger';

// Twilio client instance (lazy-initialized)
let client: any = null;

const sms: NotificationPlugin = {
  name: 'sms',

  /**
   * @function init
   * @description Initializes the Twilio client using credentials from config.
   *              Throws an error if credentials are missing.
   */
  init(): void {
    if (!config.twilio.sid || !config.twilio.token) {
      throw new Error('Twilio credentials not configured');
    }
    if (!client) {
      client = twilio(config.twilio.sid, config.twilio.token);
    }
  },

  /**
   * @function execute
   * @description Sends an SMS message to the configured phone number.
   * @param message - The message content to send
   * @param pluginConfig - Configuration object containing the recipient phone number
   * @throws Error if phone number is missing or message fails to send
   */
  async execute(message: string, pluginConfig: any): Promise<void> {
    if (!pluginConfig?.phone) {
      throw new Error('SMS plugin requires phone number');
    }

    // Ensure Twilio client is initialized
    if (!client) {
      this.init();
    }

    try {
      await client.messages.create({
        body: message,
        from: config.twilio.from,
        to: pluginConfig.phone,
      });
      logger.info(`SMS sent to ${pluginConfig.phone}`);
    } catch (error: any) {
      logger.error(`SMS error for ${pluginConfig.phone}: ${error.message}`);
      throw error;
    }
  },

  /**
   * @function validateConfig
   * @description Validates the plugin configuration for SMS delivery.
   * @param pluginConfig - Configuration object containing the recipient phone number
   * @returns True if valid, otherwise throws an error
   */
  validateConfig(pluginConfig: any): boolean {
    if (!pluginConfig.phone) {
      throw new Error('SMS plugin requires phone number');
    }
    if (!pluginConfig.phone.startsWith('+')) {
      throw new Error('Phone number must include country code (e.g., +1234567890)');
    }
    return true;
  },
};

export default sms;
