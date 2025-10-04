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
 * @summary Centralized configuration loader for environment variables.
 * @description Loads runtime configuration from `.env` using `dotenv` and exports
 *              a typed object for use across the Nani application.
 */

import dotenv from 'dotenv';
import logger from './utils/logger';

// Load environment variables from .env file into process.env
dotenv.config();
logger.info('Environment variables loaded from .env');

const config = {
  // Port on which the Express server will run
  port: parseInt(process.env.PORT || '3000', 10),

  // Secret key used for signing JWT tokens
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',

  // WebSocket endpoint for connecting to the Polkadot API (Westend testnet)
  papiWs: process.env.PAPI_WS || 'wss://westend-rpc.polkadot.io',

  // AES-256 encryption key for securing tenant logs
  encryptionKey: process.env.ENCRYPTION_KEY || 'default-32-char-key-change-me!',

  // Twilio credentials for SMS notification plugin
  twilio: {
    sid: process.env.TWILIO_SID,
    token: process.env.TWILIO_TOKEN,
    from: process.env.TWILIO_FROM,
  },

  // Discord webhook URL for Discord notification plugin
  discord: {
    webhook: process.env.DISCORD_WEBHOOK,
  },

  // Rate limiting configuration for API endpoints
  rateLimit: {
    windowMs: 60 * 1000, // Time window in milliseconds (1 minute)
    max: 10,             // Maximum number of requests per window per IP
  },
};

logger.info(`Configuration initialized: port=${config.port}, papiWs=${config.papiWs}`);
export default config;
