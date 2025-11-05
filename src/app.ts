// SPDX-License-Identifier: MIT
// @file app.ts
// @summary Configures and exports the Express app without starting the server.

import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { limiter, verifyToken } from './middlewares/auth';
import errorHandler from './middlewares/errorHandler';
import authRouter from './routes/auth';
import setupRouter from './routes/setup';
import statsRouter from './routes/stats';
import exportRouter from './routes/export';
import logger from './utils/logger';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';

const swaggerDocument = YAML.load('./swagger.yaml');

const app: Application = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(limiter);

logger.info(`Worker ${process.pid} initializing Express app...`);

app.use((req: Request, res: Response, next: Function) => {
  logger.info(`Worker ${process.pid} received ${req.method} ${req.url} from ${req.ip}`);
  next();
});

app.use('/auth', authRouter);
app.use('/setup', verifyToken, setupRouter);
app.use('/stats', verifyToken, statsRouter);
app.use('/export', verifyToken, exportRouter);

/**
 * @route GET /health
 * @description Health check endpoint – returns status and current timestamp.
 *
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     description: Returns `status: "ok"` and current server time. Used for monitoring and load balancer checks.
 *     tags:
 *       - System
 *     responses:
 *       '200':
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 *             examples:
 *               healthy:
 *                 summary: Normal response
 *                 value:
 *                   status: ok
 *                   timestamp: "2025-11-05T14:30:22.123Z"
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const swaggerOptions = {
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info { margin: 50px 0 }
    .swagger-ui .info .title { 
      font-size: 2.5em;
      color: #E6007A;
    }
  `,
  customSiteTitle: "Nani API Docs - Polkadot Event Streaming and Notifications",
  customfavIcon: "https://polkadot.network/favicon.ico",
  swaggerOptions: {
    persistAuthorization: true, // Keep JWT token between page reloads
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    defaultModelsExpandDepth: 3,
    defaultModelExpandDepth: 3,
  }
};

/**
 * @route GET /docs
 * @description Interactive API documentation powered by Swagger UI.
 * @tags System
 *
 * @openapi
 * /docs:
 *   get:
 *     summary: API Documentation (Swagger UI)
 *     description: |
 *       Interactive documentation for all Nani API endpoints.
 *       - Auto-generated from JSDoc `@openapi` annotations
 *       - Try-it-out functionality
 *       - Custom styling: topbar hidden
 *     tags:
 *       - System
 *     responses:
 *       '200':
 *         description: Swagger UI HTML page
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *               format: binary
 *             example: |
 *               <!DOCTYPE html>
 *               <html>...<head><title>Nani API Docs</title>...</html>
 */
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOptions));

/**
 * @route GET /{filepath*}
 * @description Serves static assets from the `public/` directory.
 * @tags System
 *
 * @openapi
 * /{filepath*}:
 *   get:
 *     summary: Static Assets
 *     description: |
 *       Serves files from the `public/` directory:
 *       - `index.html` (root)
 *       - `favicon.ico`
 *       - `styles.css`, images, etc.
 *     tags:
 *       - System
 *     parameters:
 *       - in: path
 *         name: filepath
 *         schema:
 *           type: string
 *         required: true
 *         description: Path to static file (e.g. `index.html`, `logo.png`)
 *         example: index.html
 *     responses:
 *       '200':
 *         description: Static file served
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *               format: binary
 *       '404':
 *         description: File not found
 */
app.use(express.static('public'));

/**
 * @route GET /openapi.json
 * @description Raw OpenAPI 3.1 specification in JSON format.
 * @tags System
 *
 * @openapi
 * /openapi.json:
 *   get:
 *     summary: OpenAPI Specification (JSON)
 *     description: |
 *       Machine-readable OpenAPI 3.1 document.
 *       Used by:
 *       - Swagger UI
 *       - Codegen tools (TypeScript, Python, etc.)
 *       - API gateways
 *     tags:
 *       - System
 *     produces:
 *       - application/json
 *     responses:
 *       '200':
 *         description: OpenAPI 3.1 JSON document
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *             example:
 *               openapi: "3.1.0"
 *               info:
 *                 title: "Nani – Polkadot Event Streaming Service"
 *                 version: "1.0.0"
 *               paths:
 *                 /auth:
 *                   post: ...
 */
// Serve OpenAPI spec as JSON
app.get('/openapi.json', (req, res) => {
  res.sendFile(path.join(__dirname, '../swagger.yaml'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(errorHandler);

export default app;
