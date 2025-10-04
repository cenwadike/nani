import twilio from 'twilio';
import config from '../../config';
import { NotificationPlugin } from '../../types/pluginTypes';

let client: any = null;

const sms: NotificationPlugin = {
  name: 'sms',

  init(): void {
    if (!config.twilio.sid || !config.twilio.token) {
      throw new Error('Twilio credentials not configured');
    }
    if (!client) {
      client = twilio(config.twilio.sid, config.twilio.token);
    }
  },

  async execute(message: string, pluginConfig: any): Promise<void> {
    if (!pluginConfig?.phone) {
      throw new Error('SMS plugin requires phone number');
    }

    if (!client) {
      this.init();
    }

    try {
      await client.messages.create({
        body: message,
        from: config.twilio.from,
        to: pluginConfig.phone,
      });
      console.log(`SMS sent to ${pluginConfig.phone}`);
    } catch (error: any) {
      console.error(`SMS error for ${pluginConfig.phone}:`, error.message);
      throw error;
    }
  },

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
