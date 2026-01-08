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
 * @file routes/adminAuth.ts
 * @summary Secure admin authentication endpoint
 * @description Admin login system with:
 *              • Email + password authentication
 *              • Bcrypt password hashing
 *              • Separate admin JWT tokens (8h expiry)
 *              • Rate limiting (5 attempts per 15 min)
 *              • Account lockout after failed attempts
 *              • Full audit trail
 *
 * @author Kombi <cenwadike@gmail.com>
 * @license MIT – Full license in repository root (LICENSE)
 * @submission https://github.com/cenwadike/nani
 * @demo https://nani-production-c105.up.railway.app
 * @repo https://github.com/cenwadike/nani
 *
 * @features
 *   • Secure password verification with bcrypt
 *   • Separate JWT secret from user tokens
 *   • 8-hour admin session (shorter than user 30d)
 *   • Failed login tracking and lockout
 *   • Admin credentials stored in encrypted storage
 *   • IP-based rate limiting (stricter than user auth)
 *   • Create new admin accounts
 *   • List admins (masked sensitive data)
 *   • Remove/disable admins (protect last superadmin)
 *  • Role assignment: 'admin' | 'superadmin'
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';
import logger from '../utils/logger';
import { AdminAccount, listAllAdmins, loadAdminAccount, saveAdminAccount } from '../utils/storage';
import { requireSuperAdmin, verifyAdminToken } from '../middlewares/admin.auth';

const router = Router();

// ————————————————————————————————
// ADMIN LOGIN RATE LIMITER
// ————————————————————————————————
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Only 5 login attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many admin login attempts. Please try again later.',
    retryAfter: 900,
  },
});

// ————————————————————————————————
// POST /admin/auth - Admin Login
// ————————————————————————————————
/**
 * @route POST /admin/auth
 * @description Admin authentication endpoint
 * @body { email: string, password: string }
 *
 * @openapi
 * /admin/auth:
 *   post:
 *     summary: Admin login with email and password
 *     tags: [Admin Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@nani.dev
 *               password:
 *                 type: string
 *                 format: password
 *                 example: secure_admin_password
 *     responses:
 *       '200':
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: Admin JWT token (8h expiry)
 *                 adminId:
 *                   type: string
 *                 role:
 *                   type: string
 *                   enum: [admin, superadmin]
 *                 expiresIn:
 *                   type: string
 *                   example: 8h
 *       '401':
 *         description: Invalid credentials
 *       '403':
 *         description: Account locked due to failed attempts
 *       '429':
 *         description: Too many login attempts
 */
router.post('/', adminLoginLimiter, async (req: Request, res: Response) => {
  const { email, password } = req.body;

  try {
    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password required',
      });
    }

    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        error: 'Invalid credentials format',
      });
    }

    // Find admin account
    const admin = await loadAdminAccount(email);
    if (!admin) {
      logger.warn(`Login failed: Unknown admin ${email} from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if account is locked
    if (admin.lockedUntil && admin.lockedUntil > Date.now()) {
      const remainingMinutes = Math.ceil((admin.lockedUntil - Date.now()) / 60000);
      logger.warn(`Admin login failed: Account locked for ${email} from ${req.ip}`);
      return res.status(403).json({
        error: 'Account temporarily locked',
        message: `Too many failed attempts. Try again in ${remainingMinutes} minutes.`,
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, admin.passwordHash);

    if (!isValidPassword) {
      // Increment failed attempts
      admin.failedAttempts++;
      
      // Lock account after 5 failed attempts for 30 minutes
      if (admin.failedAttempts >= 5) {
        admin.lockedUntil = Date.now() + (30 * 60 * 1000);
        logger.warn(`Admin account locked: ${email} after ${admin.failedAttempts} failed attempts`);
        return res.status(403).json({
          error: 'Account locked',
          message: 'Too many failed login attempts. Account locked for 30 minutes.',
        });
      }

      logger.warn(`Admin login failed: Invalid password for ${email} from ${req.ip} (attempt ${admin.failedAttempts}/5)`);
      return res.status(401).json({
        error: 'Invalid credentials',
        attemptsRemaining: 5 - admin.failedAttempts,
      });
    }

    // Reset failed attempts on successful login
    admin.failedAttempts = 0;
    admin.lockedUntil = undefined;
    admin.lastLogin = new Date().toISOString();

    // Generate admin JWT (8h expiry - shorter than user tokens)
    const adminSecret = config.adminJwtSecret || config.jwtSecret + '_admin';
    const token = jwt.sign(
      {
        adminId: admin.id,
        email: admin.email,
        role: admin.role,
      },
      adminSecret,
      { expiresIn: '8h' }
    );

    logger.event(`Admin login success: ${email} (${admin.role}) from ${req.ip}`);

    return res.json({
      token,
      adminId: admin.id,
      role: admin.role,
      email: admin.email,
      expiresIn: '8h',
    });

  } catch (error: any) {
    logger.error(`Admin auth endpoint error: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// ————————————————————————————————
// POST /admin/auth/change-password
// ————————————————————————————————
/**
 * @route POST /admin/auth/change-password
 * @description Change admin password (requires current password)
 * @security adminBearerAuth
 */
router.post('/change-password', verifyAdminToken, async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  const adminEmail = req.adminEmail as string;

  try {
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both current and new password required' });
    }

    if (newPassword.length < 12) {
      return res.status(400).json({ error: 'New password must be at least 12 characters' });
    }

    if (newPassword.toLowerCase().includes('password')) {
      return res.status(400).json({ error: 'New password cannot contain "password"' });
    }

    const account = await loadAdminAccount(adminEmail);
    if (!account) {
      return res.status(404).json({ error: 'Admin account not found' });
    }

    const currentValid = await bcrypt.compare(currentPassword, account.passwordHash);
    if (!currentValid) {
      logger.warn(`Password change failed: wrong current password for ${adminEmail}`);
      return res.status(401).json({ error: 'Current password incorrect' });
    }

    const sameAsCurrent = await bcrypt.compare(newPassword, account.passwordHash);
    if (sameAsCurrent) {
      return res.status(400).json({ error: 'New password must be different' });
    }

    account.passwordHash = bcrypt.hashSync(newPassword, 12);
    await saveAdminAccount(account);

    logger.event(`Admin password changed: ${adminEmail}`);

    return res.json({ success: true, message: 'Password updated successfully' });
  } catch (err: any) {
    logger.error(`Password change error: ${err.message}`);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ————————————————————————————————
// GET /admin/management/list
// List all admins (masked sensitive fields)
// ————————————————————————————————
router.get('/list', verifyAdminToken, requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const admins = await listAllAdmins();

    const maskedAdmins = admins.map((admin: AdminAccount) => ({
      id: admin.id,
      email: admin.email,
      role: admin.role,
      createdAt: admin.createdAt,
      lastLogin: admin.lastLogin || null,
      failedAttempts: admin.failedAttempts,
      lockedUntil: admin.lockedUntil || null,
    }));

    return res.json({
      admins: maskedAdmins,
      total: admins.length,
    });
  } catch (error: any) {
    logger.error(`Admin list error: ${error.message}`);
    return res.status(500).json({ error: 'Failed to list admins' });
  }
});

// ————————————————————————————————
// POST /admin/management/add
// Create new admin account
// ————————————————————————————————
router.post('/add', verifyAdminToken, requireSuperAdmin, async (req: Request, res: Response) => {
  const { email, password, role = 'admin' } = req.body;

  try {
    // Validation
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (password.length < 12) {
      return res.status(400).json({ error: 'Password must be at least 12 characters' });
    }

    if (!['admin', 'superadmin'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "admin" or "superadmin"' });
    }

    // Check if admin already exists
    const existing = await loadAdminAccount(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'Admin with this email already exists' });
    }

    // Create new admin
    const passwordHash = bcrypt.hashSync(password, 12);
    const newAdmin: AdminAccount = {
      id: uuidv4(),
      email: normalizedEmail,
      passwordHash,
      role: role as 'admin' | 'superadmin',
      createdAt: new Date().toISOString(),
      failedAttempts: 0,
    };

    await saveAdminAccount(newAdmin);

    logger.event(`New admin created: ${normalizedEmail} (${role}) by superadmin ${(req as any).adminEmail}`);

    return res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      admin: {
        id: newAdmin.id,
        email: newAdmin.email,
        role: newAdmin.role,
        createdAt: newAdmin.createdAt,
      },
    });
  } catch (error: any) {
    logger.error(`Add admin error: ${error.message}`);
    return res.status(500).json({ error: 'Failed to create admin' });
  }
});

// ————————————————————————————————
// DELETE /admin/management/remove/:adminId
// Remove (delete) an admin account
// Protects against removing the last superadmin
// ————————————————————————————————
router.delete('/remove/:adminId', verifyAdminToken, requireSuperAdmin, async (req: Request, res: Response) => {
  const { adminId } = req.params;
  const currentAdminId = (req as any).adminId;
  const currentAdminEmail = (req as any).adminEmail;

  try {
    if (!adminId) {
      return res.status(400).json({ error: 'Admin ID is required' });
    }

    if (adminId === currentAdminId) {
      return res.status(400).json({ error: 'You cannot remove your own account' });
    }

    const allAdmins = await listAllAdmins();
    const targetAdmin = allAdmins.find(a => a.id === adminId);

    if (!targetAdmin) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    // Prevent removing the last superadmin
    const superadmins = allAdmins.filter(a => a.role === 'superadmin');
    if (targetAdmin.role === 'superadmin' && superadmins.length === 1) {
      return res.status(403).json({ error: 'Cannot remove the last superadmin account' });
    }

    // Delete from database
    const db = (await import('../utils/storage')).getDb();
    const normalizedEmail = targetAdmin.email.toLowerCase().trim();
    
    await db.collection('admins').deleteOne({ email: normalizedEmail });

    logger.event(`Admin removed: ${targetAdmin.email} (${targetAdmin.role}) by superadmin ${currentAdminEmail}`);

    return res.json({
      success: true,
      message: `Admin ${targetAdmin.email} removed successfully`,
    });
  } catch (error: any) {
    logger.error(`Remove admin error: ${error.message}`);
    return res.status(500).json({ error: 'Failed to remove admin' });
  }
});

export default router;