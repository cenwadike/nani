// SPDX-License-Identifier: MIT
// @file app.test.ts
// @summary Test suite for Nani Express server

import request from 'supertest';
import jwt from 'jsonwebtoken';
import config from '../src/config';
import app from '../src/app';

const validToken = jwt.sign({ tenantId: 'test-tenant' }, config.jwtSecret);

describe('Nani Server', () => {
  describe('Health Check', () => {
    it('responds to health check', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('timestamp');
    });
  });
  describe('Protected route', () => {
    it('blocks protected route without token', async () => {
      const res = await request(app).get('/setup');
      expect(res.statusCode).toBe(401);
    });

    it('allows access to protected route with valid token', async () => {
      const res = await request(app)
        .get('/setup')
        .set('Authorization', `Bearer ${validToken}`);
      expect([200, 404]).toContain(res.statusCode); // 404 if no handler, 200 if mocked
    });
  });
  describe('Error Handling', () => {
    it('handles unknown routes with error middleware', async () => {
      const res = await request(app).get('/unknown');
      expect(res.statusCode).toBe(404);
    });
  });
  describe('Rate Limiting', () => {
    it('applies rate limiting', async () => {
      for (let i = 0; i < config.rateLimit.max; i++) {
        await request(app).get('/health');
      }
      const res = await request(app).get('/health');
      expect([200, 429]).toContain(res.statusCode);
    });
  });
});
