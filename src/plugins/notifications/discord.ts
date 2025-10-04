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
 * @file plugins/activities/discord.ts
 * @summary Notification plugin for sending messages to Discord via webhook.
 * @description Implements the NotificationPlugin interface to deliver formatted messages
 *              to a Discord channel using a configured webhook URL.
 */

import axios from 'axios';
import { NotificationPlugin } from '../../types/pluginTypes';

const discord: NotificationPlugin = {
  name: 'discord',

  /**
   * @function init
   * @description Initializes the plugin. No setup required for Discord.
   */
  init(): void {
    // No initialization needed
  },

  /**
   * @function execute
   * @description Sends a message to the configured Discord webhook.
   * @param message - The message content to send
   * @param pluginConfig - Configuration object containing the webhook URL
   * @throws Error if webhook is missing or request fails
   */
  async execute(message: string, pluginConfig: any): Promise<void> {
    if (!pluginConfig?.webhook) {
      throw new Error('Discord webhook URL is missing');
    }

    try {
      await axios.post(pluginConfig.webhook, {
        content: message,
        username: 'Nani Bot',
      });
      console.log(`Discord notification sent to ${pluginConfig.webhook}`);
    } catch (error: any) {
      console.error(`Discord error for ${pluginConfig.webhook}:`, error.message);
      throw error;
    }
  },

  /**
   * @function validateConfig
   * @description Validates the webhook URL format for Discord.
   * @param pluginConfig - Configuration object containing the webhook URL
   * @returns True if valid, otherwise throws an error
   */
  validateConfig(pluginConfig: any): boolean {
    if (!pluginConfig.webhook) {
      throw new Error('Discord plugin requires webhook URL');
    }
    if (!pluginConfig.webhook.includes('discord.com/api/webhooks/')) {
      throw new Error('Invalid Discord webhook URL');
    }
    return true;
  },
};

export default discord;
