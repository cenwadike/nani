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
 * @summary Express application bootstrapper for Nani – Real-Time Blockchain Event Notifications
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

import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { limiter, verifyToken } from './middlewares/auth';
import errorHandler from './middlewares/errorHandler';
import authRouter from './routes/auth';
import setupRouter from './routes/setup';
import statsRouter from './routes/stats';
import exportRouter from './routes/export';
import healthRouter from './routes/health';
import logger from './utils/logger';
import swaggerUi from 'swagger-ui-express';
import { loadSwaggerDocument } from './utils/swagger';
import path from 'path';

const app: Application = express();

// ————————————————————————————————
// SECURITY & MIDDLEWARE STACK
// ————————————————————————————————
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(limiter);

// ————————————————————————————————
// CLUSTER-AWARE REQUEST LOGGING
// ————————————————————————————————
logger.info(`Worker ${process.pid} initializing Express app...`);

app.use((req: Request, res: Response, next: Function) => {
  logger.info(`Worker ${process.pid} received ${req.method} ${req.url} from ${req.ip}`);
  next();
});

// ————————————————————————————————
// ROUTES — PUBLIC & PROTECTED
// ————————————————————————————————
app.use('/health', healthRouter);                    // Public: liveness/readiness probes
app.use('/auth', authRouter);                        // Public: login, register, token refresh
app.use('/setup', verifyToken, setupRouter);         // Protected: tenant configuration
app.use('/stats', verifyToken, statsRouter);         // Protected: analytics dashboard
app.use('/export', verifyToken, exportRouter);       // Protected: data export endpoints

// ————————————————————————————————
// SWAGGER UI — POLKADOT CLOUD THEMED
// ————————————————————————————————
const swaggerOptions = {
  customCss: `
    /* Hide default topbar */
    .swagger-ui .topbar { 
      display: none; 
    }

    /* Main container styling */
    .swagger-ui {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    /* Info section (title, description) */
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

    .swagger-ui .info .description {
      color: rgba(255, 255, 255, 0.95) !important;
      font-size: 1.1em;
      line-height: 1.6;
    }

    .swagger-ui .info .description p {
      color: rgba(255, 255, 255, 0.95) !important;
    }

    .swagger-ui .info .description a {
      color: white !important;
      text-decoration: underline;
      font-weight: 600;
    }

    /* Scheme container (server URLs) */
    .swagger-ui .scheme-container {
      background: linear-gradient(135deg, rgba(230, 0, 122, 0.1) 0%, rgba(85, 43, 191, 0.1) 100%);
      border: 2px solid #E6007A;
      border-radius: 8px;
      padding: 20px;
      margin: 30px 0;
    }

    .swagger-ui .scheme-container .schemes {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .swagger-ui .scheme-container select {
      background: white;
      border: 2px solid #E6007A;
      border-radius: 6px;
      padding: 8px 12px;
      font-weight: 600;
      color: #E6007A;
      cursor: pointer;
    }

    /* Operation blocks (endpoints) */
    .swagger-ui .opblock {
      border-radius: 8px;
      margin-bottom: 20px;
      border: 2px solid transparent;
      transition: all 0.3s ease;
    }

    .swagger-ui .opblock:hover {
      box-shadow: 0 4px 20px rgba(230, 0, 122, 0.15);
      transform: translateY(-2px);
    }

    /* POST endpoints (pink/primary) */
    .swagger-ui .opblock.opblock-post {
      border-color: #E6007A;
      background: rgba(230, 0, 122, 0.05);
    }

    .swagger-ui .opblock.opblock-post .opblock-summary {
      background: rgba(230, 0, 122, 0.1);
      border-color: #E6007A;
    }

    .swagger-ui .opblock.opblock-post .opblock-summary-method {
      background: #E6007A;
      color: white;
      font-weight: 700;
    }

    /* GET endpoints (purple/secondary) */
    .swagger-ui .opblock.opblock-get {
      border-color: #552BBF;
      background: rgba(85, 43, 191, 0.05);
    }

    .swagger-ui .opblock.opblock-get .opblock-summary {
      background: rgba(85, 43, 191, 0.1);
      border-color: #552BBF;
    }

    .swagger-ui .opblock.opblock-get .opblock-summary-method {
      background: #552BBF;
      color: white;
      font-weight: 700;
    }

    /* Tag sections (grouped endpoints) */
    .swagger-ui .opblock-tag {
      border-bottom: 3px solid #E6007A;
      padding: 15px 0;
      margin-bottom: 20px;
    }

    .swagger-ui .opblock-tag-section h3 {
      font-size: 1.8em;
      color: #E6007A;
      font-weight: 700;
    }

    /* Try it out button */
    .swagger-ui .btn.try-out__btn {
      background: linear-gradient(135deg, #E6007A 0%, #552BBF 100%);
      color: white;
      border: none;
      font-weight: 700;
      padding: 8px 20px;
      border-radius: 6px;
      transition: all 0.3s ease;
    }

    .swagger-ui .btn.try-out__btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 15px rgba(230, 0, 122, 0.3);
    }

    /* Execute button */
    .swagger-ui .btn.execute {
      background: #E6007A;
      color: white;
      border: none;
      font-weight: 700;
      padding: 10px 30px;
      border-radius: 6px;
      transition: all 0.3s ease;
    }

    .swagger-ui .btn.execute:hover {
      background: #552BBF;
      transform: translateY(-2px);
      box-shadow: 0 4px 15px rgba(230, 0, 122, 0.3);
    }

    /* Cancel button */
    .swagger-ui .btn.cancel {
      border: 2px solid #E6007A;
      color: #E6007A;
      font-weight: 600;
    }

    /* Authorization button */
    .swagger-ui .authorization__btn {
      background: transparent;
      border: 2px solid #E6007A;
      color: #E6007A;
      font-weight: 700;
      border-radius: 6px;
      padding: 8px 20px;
      transition: all 0.3s ease;
    }

    .swagger-ui .authorization__btn:hover {
      background: #E6007A;
      color: white;
    }

    .swagger-ui .authorization__btn.locked {
      background: #E6007A;
      color: white;
      border-color: #E6007A;
    }

    /* Authorize modal */
    .swagger-ui .modal-ux {
      border-radius: 12px;
      overflow: hidden;
    }

    .swagger-ui .modal-ux-header {
      background: linear-gradient(135deg, #E6007A 0%, #552BBF 100%);
      border-bottom: none;
      padding: 20px;
    }

    .swagger-ui .modal-ux-header h3 {
      color: white;
      font-weight: 700;
    }

    .swagger-ui .modal-ux-content {
      padding: 30px;
    }

    /* Response section */
    .swagger-ui .responses-wrapper {
      border-radius: 8px;
      overflow: hidden;
    }

    .swagger-ui .responses-inner h4,
    .swagger-ui .responses-inner h5 {
      color: #E6007A;
      font-weight: 700;
    }

    /* Code snippets */
    .swagger-ui .highlight-code {
      background: #1a1a2e !important;
      border-radius: 6px;
    }

    .swagger-ui .highlight-code pre {
      background: #1a1a2e !important;
      color: #fff;
    }

    /* Model section */
    .swagger-ui .model-box {
      background: rgba(230, 0, 122, 0.05);
      border-radius: 6px;
      border: 1px solid rgba(230, 0, 122, 0.2);
    }

    .swagger-ui .model-title {
      color: #E6007A;
      font-weight: 700;
    }

    /* Parameters table */
    .swagger-ui .parameters-col_description input[type=text],
    .swagger-ui .parameters-col_description select,
    .swagger-ui .parameters-col_description textarea {
      border: 2px solid #E6007A;
      border-radius: 6px;
      padding: 8px;
    }

    .swagger-ui .parameters-col_description input[type=text]:focus,
    .swagger-ui .parameters-col_description textarea:focus {
      border-color: #552BBF;
      outline: none;
      box-shadow: 0 0 0 3px rgba(230, 0, 122, 0.1);
    }

    /* Scrollbar styling */
    .swagger-ui ::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }

    .swagger-ui ::-webkit-scrollbar-track {
      background: rgba(230, 0, 122, 0.1);
      border-radius: 5px;
    }

    .swagger-ui ::-webkit-scrollbar-thumb {
      background: #E6007A;
      border-radius: 5px;
    }

    .swagger-ui ::-webkit-scrollbar-thumb:hover {
      background: #552BBF;
    }

    /* Polkadot watermark + badge */
    .swagger-ui .information-container::before {
      content: "⚡";
      font-size: 120px;
      position: absolute;
      right: 20px;
      top: 20px;
      opacity: 0.1;
      z-index: 0;
    }

    .swagger-ui .info .title::after {
      content: "Polkadot Cloud Hackathon 2025";
      display: block;
      font-size: 0.3em;
      margin-top: 15px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      padding: 10px 20px;
      border-radius: 25px;
      font-weight: 600;
      width: fit-content;
    }

    /* Links & tables */
    .swagger-ui a {
      color: #E6007A;
      font-weight: 600;
    }

    .swagger-ui a:hover {
      color: #552BBF;
      text-decoration: underline;
    }

    .swagger-ui table thead tr {
      background: rgba(230, 0, 122, 0.1);
      border-bottom: 2px solid #E6007A;
    }

    .swagger-ui table thead th {
      color: #E6007A;
      font-weight: 700;
    }

    /* Buttons */
    .swagger-ui .download-contents,
    .swagger-ui .copy-to-clipboard:hover {
      background: #E6007A;
      color: white;
    }

    .swagger-ui .download-contents:hover {
      background: #552BBF;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .swagger-ui .info .title {
        font-size: 2em;
      }
      .swagger-ui .opblock-tag-section h3 {
        font-size: 1.4em;
      }
    }
  `,
  customSiteTitle: "Nani API Docs - Real-Time Polkadot Event Notifications",
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    tryItOutEnabled: true,
    defaultModelsExpandDepth: 3,
    defaultModelExpandDepth: 3,
    displayOperationId: false,
    docExpansion: 'list',
    deepLinking: true,
    showExtensions: true,
    showCommonExtensions: true,
    syntaxHighlight: { activate: true, theme: 'monokai' },
    requestSnippetsEnabled: true,
    requestSnippets: {
      generators: {
        curl_bash: { title: "cURL (bash)", syntax: "bash" },
        curl_powershell: { title: "cURL (PowerShell)", syntax: "powershell" },
        curl_cmd: { title: "cURL (CMD)", syntax: "bash" }
      },
      defaultExpanded: true
    },
    validatorUrl: null,
  }
};

// ——————————————————————————————————————
// Swagger UI — Robust async loading with graceful degradation
// ——————————————————————————————————————
(async () => {
  const swaggerDoc = await loadSwaggerDocument();

  if (swaggerDoc) {
    // Interactive docs with full Polkadot Cloud branding
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc, swaggerOptions));
    app.get('/openapi.json', (_, res) => res.json(swaggerDoc));
    app.get('/openapi.yaml', (_, res) => res.sendFile(path.join(process.cwd(), 'swagger.yaml')));
    logger.info('Swagger UI mounted at /docs');
    logger.info('OpenAPI JSON: /openapi.json');
  } else {
    // Fallback when swagger.yaml is missing or invalid
    app.get('/docs', (_, res) => res.status(500).json({ error: 'API documentation unavailable' }));
    app.get('/openapi.json', (_, res) => res.status(500).json({ error: 'OpenAPI spec failed to load' }));
    logger.error('Swagger UI disabled — swagger.yaml not found or invalid');
  }
})();

// ——————————————————————————————————————
// Static files + public pages (landing & pitch)
// ——————————————————————————————————————
app.use(express.static('public'));

// Legacy fallback (kept for compatibility – primary route below is cleaner)
app.get('/openapi.json', (_, res) => {
  res.sendFile(path.join(process.cwd(), 'swagger.yaml'));
});

/**
 * Root route – serves the public landing page
 */
app.get('/', (_, res) => {
  const indexPath = path.join(process.cwd(), 'public', 'index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Index page not found');
  }
});

/**
 * Pitch deck route – dedicated page for pitch deck
 */
app.get('/pitch', (_, res) => {
  const indexPath = path.join(process.cwd(), 'public', 'pitch.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Pitch page not found');
  }
});

// ——————————————————————————————————————
// GLOBAL ERROR HANDLER (must be last)
// ——————————————————————————————————————
app.use(errorHandler);

export default app;