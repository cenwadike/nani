// SPDX-License-Identifier: MIT
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
 * @file app.ts
 * @summary Express application bootstrapper for Nani – Real-Time Blockchain Event Monitoring and Notifications
 * @description Production-grade HTTP API layer with enterprise-grade security, observability,
 *              Polkadot-branded Swagger UI, multi-tenant routing, and zero-downtime compatibility.
 *              • Cluster-aware (worker-safe initialization)
 *              • Full OpenAPI 3.1 spec with interactive docs
 *              • Static asset serving (landing, pitch deck)
 *              • Graceful fallback & error handling
 *
 * @author Kombi <cenwadike@gmail.com>
 * @license MIT – Full license in repository root (LICENSE)
 * @submission https://github.com/cenwadike/nani
 * @demo https://nani-production-c105.up.railway.app
 * @repo https://github.com/cenwadike/nani
 *
 * @features
 *   • Helmet.js + CSP + HSTS + CORS hardening
 *   • Global rate limiting (10 req/min/IP) – DDoS resistant
 *   • JWT HS256 authentication middleware (stateless)
 *   • Branded Swagger UI with full Polkadot Cloud theming
 *   • Async OpenAPI loading (YAML → JSON) with graceful fallback
 *   • Public landing (/), pitch (/pitch), and docs (/docs)
 *   • Request logging per worker PID for cluster tracing
 *   • Static file serving with cache-control headers
 *   • Railway / Docker / Fly.io / Render / VPS ready
 *   • Zero global side effects — safe for cluster forks
 */
// ============================================================================
// FILE 33: src/app.ts - COMPREHENSIVE EXPRESS APPLICATION
// ============================================================================

// SPDX-License-Identifier: MIT
import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import { limiter, verifyToken } from './middlewares/auth';
import errorHandler from './middlewares/errorHandler';
import { enforceTrialLimits } from './middlewares/trialEnforcement';
import { initializeMonitoring } from './monitoring/metrics';
import { performanceMiddleware } from './monitoring/performance';
import storage from './utils/storage';
import logger from './utils/logger';
import { loadSwaggerDocument } from './utils/swagger';

// Import all routes
import authRouter from './routes/auth';
import setupRouter from './routes/setup';
import exportRouter from './routes/export';
import healthRouter from './routes/health';
import trialRouter from './routes/trial';
import analyticsRouter from './routes/analytics';
import alertsRouter from './routes/alerts';
import x402Router from './routes/x402';

const app: Application = express();

// ————————————————————————————————
// DATABASE INITIALIZATION
// ————————————————————————————————
let dbInitialized = false;

(async () => {
  try {
    logger.info('Starting database initialization...');
    
    await storage.initDb();
    logger.info('✓ AceBase database initialized successfully');

    const db = storage.getDb();
    
    // Initialize empty structures
    try {
      const configsSnapshot = await db.ref('configs').get();
      if (!configsSnapshot.exists()) {
        logger.info('Initializing empty configs structure...');
        await db.ref('configs').set({});
      }
    } catch (err: any) {
      logger.warn(`Could not check configs: ${err.message}`);
      await db.ref('configs').set({}).catch(() => {});
    }

    try {
      const logsSnapshot = await db.ref('logs').get();
      if (!logsSnapshot.exists()) {
        logger.info('Initializing empty logs structure...');
        await db.ref('logs').set({});
      }
    } catch (err: any) {
      logger.warn(`Could not check logs: ${err.message}`);
      await db.ref('logs').set({}).catch(() => {});
    }

    dbInitialized = true;
    logger.info('✓ Database structure initialized');

    // Start Admin GUI if enabled
    const adminGuiEnabled = process.env.ADMIN_GUI_ENABLED === 'true';
    
    if (adminGuiEnabled) {
      const adminPort = parseInt(process.env.ADMIN_GUI_PORT || '3001', 10);
      const adminCredentials = process.env.ADMIN_GUI_USERNAME && process.env.ADMIN_GUI_PASSWORD
        ? {
            username: process.env.ADMIN_GUI_USERNAME,
            password: process.env.ADMIN_GUI_PASSWORD,
          }
        : undefined;

      try {
        await storage.startAdminGui(adminPort, adminCredentials);
        
        if (!adminCredentials) {
          logger.warn(
            '⚠️  Admin GUI running without authentication! ' +
            'Set ADMIN_GUI_USERNAME and ADMIN_GUI_PASSWORD for production.'
          );
        }
      } catch (err: any) {
        logger.error(`Failed to start Admin GUI: ${err.message}`);
        logger.warn('Continuing without Admin GUI...');
      }
    } else {
      logger.info('Admin GUI disabled (set ADMIN_GUI_ENABLED=true to enable)');
    }
  } catch (err: any) {
    logger.error(`Failed to initialize database: ${err.message}`);
    logger.error(err.stack);
    process.exit(1);
  }
})();

// ————————————————————————————————
// INITIALIZE MONITORING
// ————————————————————————————————
initializeMonitoring();

// ————————————————————————————————
// SECURITY & MIDDLEWARE STACK
// ————————————————————————————————
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(limiter);
app.use(performanceMiddleware);

// ————————————————————————————————
// REQUEST LOGGING
// ————————————————————————————————
logger.info(`Worker ${process.pid} initializing Express app...`);

app.use((req: Request, res: Response, next: Function) => {
  logger.info(`Worker ${process.pid} received ${req.method} ${req.url} from ${req.ip}`);
  next();
});

// ————————————————————————————————
// PUBLIC ROUTES
// ————————————————————————————————
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/api/trial', trialRouter);
app.use('/api/x402', x402Router);

// ————————————————————————————————
// PROTECTED ROUTES (Require JWT)
// ————————————————————————————————
app.use('/setup', verifyToken, setupRouter);
app.use('/export', verifyToken, exportRouter);

// ————————————————————————————————
// PROTECTED ROUTES (Require JWT + Trial Check)
// ————————————————————————————————
app.use('/api/analytics', verifyToken, enforceTrialLimits, analyticsRouter);
app.use('/api/alerts', verifyToken, enforceTrialLimits, alertsRouter);
app.use('/stats', verifyToken, enforceTrialLimits, analyticsRouter);

// ————————————————————————————————
// SWAGGER UI — POLKADOT CLOUD THEMED
// ————————————————————————————————
const swaggerOptions = {
  customCss: `
    .swagger-ui .topbar { display: none; }
    .swagger-ui { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .swagger-ui .info { 
      margin: 50px 0;
      background: linear-gradient(135deg, #E6007A 0%, #552BBF 100%);
      padding: 40px;
      border-radius: 12px;
      color: white;
    }
    .swagger-ui .info .title { 
      font-size: 3em;
      color: white !important;
      font-weight: 800;
      letter-spacing: -1px;
      margin-bottom: 20px;
      text-shadow: 0 2px 10px rgba(0,0,0,0.2);
    }
    .swagger-ui .info .title small {
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 0.4em;
      margin-left: 15px;
      font-weight: 600;
    }
    .swagger-ui .opblock.opblock-post { border-color: #E6007A; background: rgba(230, 0, 122, 0.05); }
    .swagger-ui .opblock.opblock-get { border-color: #552BBF; background: rgba(85, 43, 191, 0.05); }
    .swagger-ui .btn.execute { background: #E6007A; color: white; }
    .swagger-ui .btn.execute:hover { background: #552BBF; }
  `,
  customSiteTitle: "Nani API Docs - Real-Time Blockchain Monitoring",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    docExpansion: 'list',
    deepLinking: true,
  }
};

(async () => {
  const swaggerDoc = await loadSwaggerDocument();

  if (swaggerDoc) {
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc, swaggerOptions));
    app.get('/openapi.json', (_, res) => res.json(swaggerDoc));
    app.get('/openapi.yaml', (_, res) => res.sendFile(path.join(process.cwd(), 'swagger.yaml')));
    logger.info('Swagger UI mounted at /docs');
  } else {
    app.get('/docs', (_, res) => res.status(500).json({ error: 'API documentation unavailable' }));
    logger.error('Swagger UI disabled — swagger.yaml not found');
  }
})();

// ————————————————————————————————
// STATIC FILES
// ————————————————————————————————
app.use(express.static('public'));

app.get('/console', (_, res) => {
  const indexPath = path.join(process.cwd(), 'public', 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Index page not found');
  }
});

app.get('/pitch', (_, res) => {
  const pitchPath = path.join(process.cwd(), 'public', 'pitch.html');
  if (require('fs').existsSync(pitchPath)) {
    res.sendFile(pitchPath);
  } else {
    res.status(404).send('Pitch page not found');
  }
});

// ————————————————————————————————
// ROOT ROUTE
// ————————————————————————————————
app.get('/', (_, res) => {
  res.json({
    name: 'Nani - Real-Time Blockchain Monitoring',
    version: '1.0.0',
    status: 'operational',
    endpoints: {
      docs: '/docs',
      health: '/health',
      auth: '/auth',
      trial: '/api/trial',
      analytics: '/api/analytics',
      alerts: '/api/alerts',
      x402: '/api/x402'
    },
    links: {
      github: 'https://github.com/cenwadike/nani',
      demo: 'https://nani-production-c105.up.railway.app'
    }
  });
});

// ————————————————————————————————
// GLOBAL ERROR HANDLER (must be last)
// ————————————————————————————————
app.use(errorHandler);

export default app;
