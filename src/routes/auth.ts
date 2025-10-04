import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import config from '../config';
import storage from '../utils/storage';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    // Generate tenant ID from email
    const tenantId = crypto.createHash('sha256').update(email).digest('hex').substring(0, 16);

    // Create JWT
    const token = jwt.sign(
      { tenantId, email },
      config.jwtSecret,
      { expiresIn: '30d' }
    );

    // Save minimal user data
    const existingConfig = storage.loadConfig(tenantId);
    if (!existingConfig) {
      storage.saveConfig(tenantId, { email, createdAt: new Date().toISOString() });
    }

    res.json({ token, tenantId });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
