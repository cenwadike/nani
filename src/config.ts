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
import fs from 'fs';
import path from 'path';
import logger from './utils/logger';

dotenv.config();

const int = (val: string | undefined, def: number): number =>
  val && !isNaN(parseInt(val, 10)) ? parseInt(val, 10) : def;

const bool = (val: string | undefined, def: boolean): boolean =>
  val === 'true' ? true : val === 'false' ? false : def;

const str = (val: string | undefined, def: string): string =>
  val && val.trim() ? val.trim() : def;

export interface ChainConfig {
  name: string;
  rpcUrls: string[];
  tokenSymbol: string;
  assignedWorkerId?: number;
}

// ──────────────────────────────────────────────────────────────────────
// Load Chains: chains.json → .env fallback
// ──────────────────────────────────────────────────────────────────────
let CHAINS: ChainConfig[] = [];

try {
  const chainsPath = path.join(process.cwd(), 'chains.json');
  if (fs.existsSync(chainsPath)) {
    const raw = fs.readFileSync(chainsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      CHAINS = parsed.map((c: any) => ({
        name: c.name,
        rpcUrls: Array.isArray(c.rpcUrls) ? c.rpcUrls : [],
        tokenSymbol: c.tokenSymbol || 'DOT',
      }));
      logger.info(`Loaded ${CHAINS.length} chains from chains.json`);
    }
  }
} catch (err) {
  logger.warn(`Failed to load chains.json: ${err}`);
}

// Fallback to .env
if (CHAINS.length === 0) {
  logger.info('No chains.json found. Using .env fallback');
  const westendUrls = str(process.env.WESTEND_RPC_URLS, '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const assetHubUrls = str(process.env.ASSETHUB_RPC_URLS, '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (westendUrls.length > 0) {
    CHAINS.push({ name: 'westend', rpcUrls: westendUrls, tokenSymbol: 'WND' });
  }
  if (assetHubUrls.length > 0) {
    CHAINS.push({ name: 'asset-hub-westend', rpcUrls: assetHubUrls, tokenSymbol: 'WND' });
  }
}

// Validate
if (CHAINS.length === 0) {
  logger.error('No chains configured in chains.json or .env');
  process.exit(1);
}

CHAINS.forEach(chain => {
  if (chain.rpcUrls.length === 0) {
    logger.error(`Chain ${chain.name} has no RPC URLs`);
    process.exit(1);
  }
  logger.info(`Chain: ${chain.name} → ${chain.rpcUrls.length} endpoints, token: ${chain.tokenSymbol}`);
});

// ──────────────────────────────────────────────────────────────────────
// Rest of Config
// ──────────────────────────────────────────────────────────────────────
const config = {
  port: int(process.env.PORT, 3000),
  jwtSecret: str(process.env.JWT_SECRET, 'dev-secret-change-me'),
  encryptionKey: Buffer.from(
    str(process.env.ENCRYPTION_KEY, 'default-32-char-key-change-me!'),
    'utf8'
  ).toString('base64'),
  twilio: {
    sid: str(process.env.TWILIO_SID, ''),
    token: str(process.env.TWILIO_TOKEN, ''),
    from: str(process.env.TWILIO_FROM, ''),
  },
  discord: {
    webhook: str(process.env.DISCORD_WEBHOOK, ''),
  },
  rateLimit: {
    windowMs: 60 * 1000,
    max: 10,
  },
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
// Validation
// ──────────────────────────────────────────────────────────────────────
const required = (key: string, value: any) => {
  if (!value) {
    logger.error(`Missing required config: ${key}`);
    process.exit(1);
  }
};

required('JWT_SECRET', config.jwtSecret);
required('ENCRYPTION_KEY', str(process.env.ENCRYPTION_KEY, ''));
required('TWILIO_SID', config.twilio.sid);
required('TWILIO_TOKEN', config.twilio.token);
required('TWILIO_FROM', config.twilio.from);
required('SMTP_USER', config.smtp.user);
required('SMTP_PASS', config.smtp.pass);

logger.info(`Config loaded: ${CHAINS.length} chains, ${CHAINS.flatMap(c => c.rpcUrls).length} total endpoints`);

export { CHAINS };
export default config;
