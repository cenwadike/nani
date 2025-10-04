import dotenv from 'dotenv';

dotenv.config();

export default {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  papiWs: process.env.PAPI_WS || 'wss://westend-rpc.polkadot.io',
  encryptionKey: process.env.ENCRYPTION_KEY || 'default-32-char-key-change-me!',
  twilio: {
    sid: process.env.TWILIO_SID,
    token: process.env.TWILIO_TOKEN,
    from: process.env.TWILIO_FROM,
  },
  discord: {
    webhook: process.env.DISCORD_WEBHOOK,
  },
  rateLimit: {
    windowMs: 60 * 1000, // 1 minute
    max: 10,
  },
};
