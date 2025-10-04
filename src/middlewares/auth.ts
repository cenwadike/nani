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
 * @file middleware/auth.ts
 * @summary Middleware for rate limiting and JWT-based tenant authentication.
 * @description Provides Express middleware to throttle requests and verify JWT tokens.
 *              Injects `tenantId` and `email` into the request object for downstream use.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import config from '../config';

/**
 * @constant limiter
 * @description Express middleware that limits incoming requests per IP.
 *              Prevents abuse by enforcing a fixed request rate per time window.
 */
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs, // Time window in milliseconds
  max: config.rateLimit.max,          // Max requests per window per IP
  message: { error: 'Too many requests, please try again later.' },
});

/**
 * @function verifyToken
 * @description Middleware that verifies JWT token from the Authorization header.
 *              On success, attaches `tenantId` and `email` to the request object.
 * @param req - Incoming Express request
 * @param res - Express response object
 * @param next - Callback to pass control to the next middleware
 */
function verifyToken(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { tenantId: string; email: string };
    req.tenantId = decoded.tenantId;
    req.email = decoded.email;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export { limiter, verifyToken };
