// SPDX-License-Identifier: MIT
// This file is part of the Nani Plus project.
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
 * @file middleware/admin.auth.ts
 * @summary Admin authentication and authorization middleware
 * @description Separate authentication system for admin access with:
 *              • Different JWT secret from user auth
 *              • Admin role verification
 *              • IP whitelisting support
 *              • Rate limiting (stricter than user routes)
 *              • Audit logging for all admin actions
 *
 * @author Kombi <cenwadike@gmail.com>
 * @license MIT - Full license in repository root (LICENSE)
 * @submission https://github.com/cenwadike/nani
 * @demo https://nani-production-c105.up.railway.app
 * @repo https://github.com/cenwadike/nani
 *
 * @features
 *   • Separate admin JWT with dedicated secret
 *   • Role-based access control (admin role required)
 *   • Optional IP whitelist enforcement
 *   • Stricter rate limiting (30 req / 15 min)
 *   • Full audit trail for compliance
 *   • Request context injection (adminId, role)
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import config from '../config';
import logger from '../utils/logger';

// ————————————————————————————————
// TYPE AUGMENTATION — ADMIN REQUEST
// ————————————————————————————————
declare global {
  namespace Express {
    interface Request {
      adminId?: string;
      adminEmail?: string;
      adminRole?: string;
    }
  }
}

// ————————————————————————————————
// ADMIN RATE LIMITER — STRICTER
// ————————————————————————————————
/**
 * @constant adminLimiter
 * @description Stricter rate limiting for admin routes
 *              30 requests per 15 minutes per IP
 */
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many admin requests from this IP. Please try again later.',
    retryAfter: 900, // 15 minutes in seconds
  },
  skip: (req) => {
    // Never skip for admin routes
    return false;
  },
});

// ————————————————————————————————
// ADMIN JWT VERIFICATION
// ————————————————————————————————
/**
 * @function verifyAdminToken
 * @description Verifies admin Bearer JWT and injects admin context.
 *              Uses separate admin JWT secret for security isolation.
 *
 * @security adminBearerAuth
 *
 * @param req - Express request (augmented with adminId/adminEmail/adminRole on success)
 * @param res - Express response
 * @param next - Next middleware
 *
 * @throws 401 Unauthorized — No token / Invalid token / Expired
 * @throws 403 Forbidden — Valid token but insufficient permissions
 */
export function verifyAdminToken(req: Request, res: Response, next: NextFunction): Response | void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn(`Admin auth failed: No credentials from ${req.ip}`);
    return res.status(401).json({
      error: 'Access denied: Admin credentials required',
      hint: 'Include header: Authorization: Bearer <admin-jwt>',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Use separate admin JWT secret
    const adminSecret = config.adminJwtSecret || config.jwtSecret + '_admin';
    
    const payload = jwt.verify(token, adminSecret, {
      algorithms: ['HS256'],
      clockTolerance: 10,
    }) as { 
      adminId: string; 
      email: string; 
      role: string;
      iat?: number; 
      exp?: number;
    };

    // Verify admin role
    if (payload.role !== 'admin' && payload.role !== 'superadmin') {
      logger.warn(`Admin auth failed: Invalid role '${payload.role}' from ${req.ip}`);
      return res.status(403).json({
        error: 'Access denied: Admin privileges required',
        details: 'Your account does not have administrative access',
      });
    }

    // Optional: IP whitelist check
    if (config.adminIpWhitelist && config.adminIpWhitelist.length > 0) {
      const clientIp = req.ip || req.socket.remoteAddress || '';
      const isWhitelisted = config.adminIpWhitelist.some(ip => clientIp.includes(ip));
      
      if (!isWhitelisted) {
        logger.warn(`Admin auth failed: IP ${clientIp} not whitelisted`);
        return res.status(403).json({
          error: 'Access denied: IP not authorized',
          details: 'Your IP address is not in the admin whitelist',
        });
      }
    }

    // Inject verified admin context
    req.adminId = payload.adminId;
    req.adminEmail = payload.email;
    req.adminRole = payload.role;

    // Audit log all admin access
    logger.event(`Admin access: ${payload.email} (${payload.role}) → ${req.method} ${req.path} from ${req.ip}`);

    next();
  } catch (err: any) {
    const message =
      err.name === 'TokenExpiredError'
        ? 'Admin token expired — please log in again'
        : err.name === 'JsonWebTokenError'
        ? 'Invalid admin token signature'
        : 'Malformed or tampered admin token';

    logger.warn(`Admin auth failed: ${message} from ${req.ip}`);

    return res.status(401).json({
      error: 'Admin authentication failed',
      details: message,
    });
  }
}

// Helper middleware: Require superadmin role
export function requireSuperAdmin(req: Request, res: Response, next: Function) {
  if (req.adminRole !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required' });
  }
  next();
};

// ————————————————————————————————
// OPENAPI SECURITY SCHEME
// ————————————————————————————————
/**
 * @openapi
 * components:
 *   securitySchemes:
 *     adminBearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: |
 *         Admin JWT issued on admin login. Valid for 8h.
 *         Requires admin or superadmin role.
 *         Example: `Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6...`
 */

export default { adminLimiter, verifyAdminToken, requireSuperAdmin };