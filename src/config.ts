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
 * @file config.ts
 * @summary validated configuration loader.
 */

import dotenv from 'dotenv';
import logger from './utils/logger';

// Load .env
dotenv.config();
logger.info('Environment variables loaded from .env');

/**
 * Helper: safe integer parse
 */
const int = (val: string | undefined, def: number): number =>
  val && !isNaN(parseInt(val, 10)) ? parseInt(val, 10) : def;

/**
 * Helper: boolean parse
 */
const bool = (val: string | undefined, def: boolean): boolean =>
  val === 'true' ? true : val === 'false' ? false : def;

/**
 * Helper: non-empty string
 */
const str = (val: string | undefined, def: string): string =>
  val && val.trim() ? val.trim() : def;

// ──────────────────────────────────────────────────────────────────────
// Configuration Object
// ──────────────────────────────────────────────────────────────────────

const config = {
  // ── Server
  port: int(process.env.PORT, 3000),

  // ── Auth
  jwtSecret: str(process.env.JWT_SECRET, 'dev-secret-change-me'),

  // ── Polkadot API
  papiWs: str(process.env.PAPI_WS, 'wss://westend-rpc.polkadot.io'),
  backupPapiWs: (process.env.BACKUP_PAPI_WS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // ── Encryption
  encryptionKey: str(
    process.env.ENCRYPTION_KEY,
    'default-32-char-key-change-me!'
  ),

  // ── Twilio
  twilio: {
    sid: str(process.env.TWILIO_SID, ''),
    token: str(process.env.TWILIO_TOKEN, ''),
    from: str(process.env.TWILIO_FROM, ''),
  },

  // ── Discord
  discord: {
    webhook: str(process.env.DISCORD_WEBHOOK, ''),
  },

  // ── Rate Limiting
  rateLimit: {
    windowMs: 60 * 1000,
    max: 10,
  },

  // ── SMTP (Fixed!)
  smtp: {
    host: str(process.env.SMTP_HOST, 'localhost'),
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: str(process.env.SMTP_USER, ''),
    pass: str(process.env.SMTP_PASS, ''),
    from: str(process.env.SMTP_FROM, '"Nani" <noreply@nani.com>'),
  },
};

// ──────────────────────────────────────────────────────────────────────
// Validation & Logging
// ──────────────────────────────────────────────────────────────────────

const required = (key: string, value: any) => {
  if (!value) {
    logger.error(`Missing required config: ${key}`);
    process.exit(1);
  }
};

required('JWT_SECRET', config.jwtSecret);
required('ENCRYPTION_KEY', config.encryptionKey);
required('TWILIO_SID', config.twilio.sid);
required('TWILIO_TOKEN', config.twilio.token);
required('TWILIO_FROM', config.twilio.from);
required('SMTP_USER', config.smtp.user);
required('SMTP_PASS', config.smtp.pass);

logger.info(
  `Config loaded: port=${config.port}, papiWs=${config.papiWs}, backups=${config.backupPapiWs.length}`
);

export default config;
