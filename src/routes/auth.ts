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
 * @summary Handles tenant authentication and token issuance.
 * @description This route accepts an email address, generates a tenant ID,
 *              issues a JWT token, and stores minimal tenant metadata.
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../config';
import storage from '../utils/storage';

const router = Router();

/**
 * @route POST /auth
 * @description Authenticates a tenant using their email address.
 *              Generates a tenant ID and returns a signed JWT token.
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    // Validate email format
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    // Generate a deterministic tenant ID using SHA-256 hash of the email
    const tenantId = crypto.createHash('sha256').update(email).digest('hex').substring(0, 16);

    // Create a JWT token with tenant metadata
    const token = jwt.sign(
      { tenantId, email },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    // Persist minimal tenant data if not already stored
    const existingConfig = storage.loadConfig(tenantId);
    if (!existingConfig) {
      storage.saveConfig(tenantId, { email, createdAt: new Date().toISOString() });
    }

    // Return token and tenant ID to client
    res.json({ token, tenantId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
