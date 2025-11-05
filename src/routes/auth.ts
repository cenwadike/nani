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
 */// SPDX-License-Identifier: MIT
// routes/auth.ts

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { decodeAddress, signatureVerify } from '@polkadot/util-crypto';
import { u8aToHex } from '@polkadot/util';
import config from '../config';
import logger from '../utils/logger';
import path from 'path';
import { promises as fsPromises } from 'fs';

const router = Router();

// ──────────────────────────────────────────────────────────────────────
// TENANT METADATA (async)
// ──────────────────────────────────────────────────────────────────────
const getTenantMetadataPath = (tenantId: string): string => {
  const PROJECT_ROOT = path.resolve(__dirname, '../../..');
  const DATA_ROOT = path.join(PROJECT_ROOT, 'src', 'data');
  return path.join(DATA_ROOT, tenantId, 'tenant.json');
};

const saveTenantMetadata = async (tenantId: string, data: any): Promise<void> => {
  const file = getTenantMetadataPath(tenantId);
  const dir = path.dirname(file);
  await fsPromises.mkdir(dir, { recursive: true });
  await fsPromises.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
  logger.info(`Tenant metadata saved → ${file}`);
};

const loadTenantMetadata = async (tenantId: string): Promise<any | null> => {
  const file = getTenantMetadataPath(tenantId);
  try {
    const raw = await fsPromises.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch (err: any) {
    if (err.code === 'ENOENT') return null;
    logger.error(`Failed to read tenant metadata: ${err.message}`);
    throw err;
  }
};

/**
 * @route POST /auth
 * @body { email?: string } OR { address: string, signature: string, message: string }
 *
 * @openapi
 * /auth:
 *   post:
 *     summary: Generate JWT token via email or wallet signature
 *     tags:
 *       - Authentication
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - $ref: '#/components/schemas/AuthEmailRequest'
 *               - $ref: '#/components/schemas/AuthWalletRequest'
 *           examples:
 *             email:
 *               summary: Email-based login
 *               value:
 *                 email: alice@example.com
 *             wallet:
 *               summary: Wallet-signed login
 *               value:
 *                 address: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
 *                 signature: 0x8f5a4c2e1b...
 *                 message: |
 *                   Sign this message to authenticate with Nani.
 *                   Timestamp: 2025-11-05T12:34:56.789Z
 *     responses:
 *       '200':
 *         description: JWT generated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthSuccessResponse'
 *             examples:
 *               email:
 *                 value:
 *                   token: eyJhbGciOiJIUzI1NiIs...
 *                   tenantId: a1b2c3d4e5f6g7h8
 *                   method: email
 *               wallet:
 *                 value:
 *                   token: eyJhbGciOiJIUzI1NiIs...
 *                   tenantId: 9f86d081884c7d65
 *                   method: wallet
 *                   address: 5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY
 *       '400':
 *         description: Invalid input
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *             example:
 *               error: Provide either { email } or { address, signature, message }
 *       '401':
 *         description: Invalid wallet signature
 *         content:
 *           application/json:
 *             example:
 *               error: Invalid signature
 *       '500':
 *         description: Server error
 */
router.post('/', async (req: Request, res: Response) => {
  const { email, address, signature, message } = req.body;

  try {
    // ──────────────────────────────────────────────────────────────
    // 1. EMAIL AUTH
    // ──────────────────────────────────────────────────────────────
    if (email) {
      if (typeof email !== 'string' || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email required' });
      }

      const tenantId = crypto.createHash('sha256').update(email).digest('hex').slice(0, 16);
      const token = jwt.sign({ tenantId, email, method: 'email' }, config.jwtSecret, {
        expiresIn: '30d',
      });

      const existing = await loadTenantMetadata(tenantId);
      if (!existing) {
        await saveTenantMetadata(tenantId, {
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
      // Validate address
      let publicKey: Uint8Array;
      try {
        publicKey = decodeAddress(address);
      } catch {
        return res.status(400).json({ error: 'Invalid Polkadot address' });
      }

      // Verify signature
      const { isValid } = signatureVerify(message, signature, u8aToHex(publicKey));
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Extract timestamp from message
      const match = message.match(/Timestamp: ([\d\-T:.Z]+)/);
      if (!match) {
        return res.status(400).json({ error: 'Invalid message format: missing timestamp' });
      }
      const timestamp = new Date(match[1]);
      const now = new Date();
      const diffMs = Math.abs(now.getTime() - timestamp.getTime());
      if (isNaN(timestamp.getTime()) || diffMs > 5 * 60 * 1000) {
        return res.status(400).json({ error: 'Message expired (must be < 5 min)' });
      }

      const tenantId = crypto.createHash('sha256').update(address).digest('hex').slice(0, 16);
      const token = jwt.sign({ tenantId, address, method: 'wallet' }, config.jwtSecret, {
        expiresIn: '30d',
      });

      const existing = await loadTenantMetadata(tenantId);
      if (!existing) {
        await saveTenantMetadata(tenantId, {
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
  } catch (error: any) {
    logger.error(`Auth error: ${error.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
