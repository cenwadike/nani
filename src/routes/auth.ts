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
 * @file routes/auth.ts
 * @summary Single adaptive /auth endpoint
 * @description Accepts EITHER:
 *   • { email } → email-based JWT
 *   • { address, signature, message } → wallet-signed JWT
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { decodeAddress, signatureVerify } from '@polkadot/util-crypto';
import { u8aToHex } from '@polkadot/util';
import config from '../config';
import storage from '../utils/storage';
import logger from '../utils/logger';

const router = Router();

/**
 * @route POST /auth
 * @body { email?: string } OR { address: string, signature: string, message: string }
 */
router.post('/', async (req: Request, res: Response) => {
  const { email, address, signature, message } = req.body;

  // ──────────────────────────────────────────────────────────────
  // 1. EMAIL AUTH
  // ──────────────────────────────────────────────────────────────
  if (email) {
    if (!email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const tenantId = crypto.createHash('sha256').update(email).digest('hex').slice(0, 16);
    const token = jwt.sign({ tenantId, email, method: 'email' }, config.jwtSecret, {
      expiresIn: '30d',
    });

    // Ensure tenant exists
    if (!(await storage.loadConfig(tenantId))) {
      await storage.saveConfig(tenantId, {
        email,
        createdAt: new Date().toISOString(),
        authMethod: 'email',
      });
    }

    logger.event(`Email auth: ${email} → ${tenantId}`);
    return res.json({ token, tenantId, method: 'email' });
  }

  // ──────────────────────────────────────────────────────────────
  // 2. WALLET SIGNING AUTH
  // ──────────────────────────────────────────────────────────────
  if (address && signature && message) {
    let publicKey: Uint8Array;
    try {
      publicKey = decodeAddress(address);
    } catch {
      return res.status(400).json({ error: 'Invalid Polkadot address' });
    }

    const { isValid } = signatureVerify(message, signature, u8aToHex(publicKey));
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Prevent replay attacks
    const match = message.match(/Timestamp: ([\d\-T:.Z]+)/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid message format' });
    }
    const timestamp = match ? new Date(match[1]) : new Date();
    const now = new Date();
    const diffMs = Math.abs(now.getTime() - timestamp.getTime());
    if (isNaN(timestamp.getTime()) || diffMs > 5 * 60 * 1000) {
      return res.status(400).json({ error: 'Message expired or malformed' });
    }

    const tenantId = crypto.createHash('sha256').update(address).digest('hex').slice(0, 16);
    const token = jwt.sign({ tenantId, address, method: 'wallet' }, config.jwtSecret, {
      expiresIn: '30d',
    });

    if (!(await storage.loadConfig(tenantId))) {
      await storage.saveConfig(tenantId, {
        address,
        createdAt: new Date().toISOString(),
        authMethod: 'wallet',
      });
    }

    logger.event(`Wallet auth: ${address} → ${tenantId}`);
    return res.json({ token, tenantId, method: 'wallet', address });
  }

  // ──────────────────────────────────────────────────────────────
  // 3. INVALID INPUT
  // ──────────────────────────────────────────────────────────────
  return res.status(400).json({
    error: 'Provide either { email } or { address, signature, message }',
  });
});

export default router;
