import axios from 'axios';
import { NotificationPlugin } from '../../types/pluginTypes';

const discord: NotificationPlugin = {
  name: 'discord',

  init(): void {
    // No initialization needed
  },

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

