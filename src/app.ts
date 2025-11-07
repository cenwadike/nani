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
import healthRouter from './routes/health';
import logger from './utils/logger';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';
import fs from 'fs';

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

app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/setup', verifyToken, setupRouter);
app.use('/stats', verifyToken, statsRouter);
app.use('/export', verifyToken, exportRouter);

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

    /* Highlight successful responses */
    .swagger-ui .response-col_status .response-col_links {
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

    /* Response status badges */
    .swagger-ui .response-col_status {
      font-weight: 700;
    }

    /* Success status (2xx) */
    .swagger-ui .response .response-col_status:contains("200"),
    .swagger-ui .response .response-col_status:contains("201") {
      color: #22c55e;
    }

    /* Error status (4xx, 5xx) */
    .swagger-ui .response .response-col_status:contains("400"),
    .swagger-ui .response .response-col_status:contains("401"),
    .swagger-ui .response .response-col_status:contains("404"),
    .swagger-ui .response .response-col_status:contains("500") {
      color: #ef4444;
    }

    /* Loading animation */
    .swagger-ui .loading-container {
      border-color: #E6007A;
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

    /* Add Polkadot logo watermark */
    .swagger-ui .information-container::before {
      content: "⚡";
      font-size: 120px;
      position: absolute;
      right: 20px;
      top: 20px;
      opacity: 0.1;
      z-index: 0;
    }

    /* Custom badge for hackathon */
    .swagger-ui .info .title::after {
      content: "🏆 Polkadot Cloud Hackathon 2025";
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

    /* Link styling */
    .swagger-ui a {
      color: #E6007A;
      font-weight: 600;
      transition: all 0.2s ease;
    }

    .swagger-ui a:hover {
      color: #552BBF;
      text-decoration: underline;
    }

    /* Table styling */
    .swagger-ui table {
      border-radius: 8px;
      overflow: hidden;
    }

    .swagger-ui table thead tr {
      background: rgba(230, 0, 122, 0.1);
      border-bottom: 2px solid #E6007A;
    }

    .swagger-ui table thead tr th {
      color: #E6007A;
      font-weight: 700;
    }

    /* Download button (for specs) */
    .swagger-ui .download-contents {
      background: #E6007A;
      color: white;
      font-weight: 700;
      border-radius: 6px;
      padding: 8px 20px;
    }

    .swagger-ui .download-contents:hover {
      background: #552BBF;
    }

    /* Example values highlighting */
    .swagger-ui .examples-select {
      border: 2px solid #E6007A;
      border-radius: 6px;
      font-weight: 600;
    }

    /* Clipboard button (copy curl) */
    .swagger-ui .copy-to-clipboard {
      background: transparent;
      border: 2px solid #E6007A;
      color: #E6007A;
      font-weight: 600;
      border-radius: 6px;
      transition: all 0.2s ease;
    }

    .swagger-ui .copy-to-clipboard:hover {
      background: #E6007A;
      color: white;
    }

    /* Request duration badge */
    .swagger-ui .response-control-media-type__title {
      color: #E6007A;
      font-weight: 700;
    }

    /* Responsive adjustments */
    @media (max-width: 768px) {
      .swagger-ui .info .title {
        font-size: 2em;
      }

      .swagger-ui .opblock-tag-section h3 {
        font-size: 1.4em;
      }
    }
  `,
  
  customSiteTitle: "Nani API Docs - Real-Time Polkadot Event Streaming",
  
  customfavIcon: "https://polkadot.network/favicon.ico",
  
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
    syntaxHighlight: {
      activate: true,
      theme: 'monokai',
    },
    requestSnippetsEnabled: true,
    requestSnippets: {
      generators: {
        curl_bash: {
          title: "cURL (bash)",
          syntax: "bash"
        },
        curl_powershell: {
          title: "cURL (PowerShell)",
          syntax: "powershell"
        },
        curl_cmd: {
          title: "cURL (CMD)",
          syntax: "bash"
        }
      },
      defaultExpanded: true,
      languages: null
    },
    validatorUrl: null,
  }
};

// CRITICAL FIX: Load swagger.yaml with proper error handling
let swaggerDocument: any = null;
const swaggerPath = path.join(__dirname, '../swagger.yaml');

const MAX_RETRIES = 10;
const BACKOFF_FACTOR = 1.5;
let delay = 1000;
let lastError: any = null;

(async () => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (!fs.existsSync(swaggerPath)) {
        throw new Error(`swagger.yaml not found at ${swaggerPath}`);
      }

      logger.info(`Attempt ${attempt}: Loading swagger.yaml from ${swaggerPath}`);
      const document = YAML.load(swaggerPath);

      if (!document || typeof document !== 'object') {
        throw new Error('Loaded swagger.yaml is empty or invalid');
      }

      logger.info(`swagger.yaml loaded successfully on attempt ${attempt}`);
      swaggerDocument = document;
      break;
    } catch (error: any) {
      lastError = error;
      logger.warn(`Attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);

      if (attempt < MAX_RETRIES) {
        logger.info(`Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * BACKOFF_FACTOR, 10000); // Cap at 10s
      }
    }
  }

  if (!swaggerDocument) {
    logger.error(`Failed to load swagger.yaml after ${MAX_RETRIES} attempts: ${(lastError as Error).message}`);
  }
})();

// Only mount docs if swagger loaded successfully
if (swaggerDocument) {
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOptions));
  logger.info('Swagger UI mounted at /docs');
} else {
  app.get('/docs', (req, res) => {
    res.status(500).json({ error: 'API documentation unavailable' });
  });
  logger.warn('Swagger UI not available - swagger.yaml failed to load');
}

app.use(express.static('public'));

app.get('/openapi.json', (req, res) => {
  const yamlPath = path.join(__dirname, '../swagger.yaml');
  if (fs.existsSync(yamlPath)) {
    res.sendFile(yamlPath);
  } else {
    res.status(404).json({ error: 'OpenAPI spec not found' });
  }
});

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, '../public/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Index page not found');
  }
});

app.use(errorHandler);

export default app;
