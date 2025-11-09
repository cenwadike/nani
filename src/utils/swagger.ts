// src/utils/swagger.ts
import logger from './logger';
import YAML from 'yamljs';
import path from 'path';
import fs from 'fs';

let swaggerDocument: any = null;
let loadingPromise: Promise<any> | null = null;

// Works in: dev, dist/, Docker, PaaS
const getSwaggerPath = (): string => {
  const candidates = [
    path.join(process.cwd(), 'swagger.yaml'),                    // root (dev + Docker after copy)
    path.join(process.cwd(), 'dist', 'swagger.yaml'),            // safety
    path.join(__dirname, '../../swagger.yaml'),                  // dist/src/utils
    path.join(__dirname, '../../../swagger.yaml'),               // fallback
    path.join(__dirname, '../../../../swagger.yaml'),            // deep fallback
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  throw new Error(
    `swagger.yaml NOT FOUND!\nTried:\n${candidates.map(p => `  - ${p}`).join('\n')}\n\n` +
    `FIX: Add to Dockerfile:\n` +
    `  COPY swagger.yaml dist/swagger.yaml\n` +
    `Or to package.json:\n` +
    `  "build": "tsc && cp swagger.yaml dist/swagger.yaml"`
  );
};

export async function loadSwaggerDocument(): Promise<any> {
  if (swaggerDocument) return swaggerDocument;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const swaggerPath = getSwaggerPath();
      logger.info(`Loading swagger.yaml → ${swaggerPath}`);
      const doc = YAML.load(swaggerPath);
      if (!doc || typeof doc !== 'object') throw new Error('Invalid swagger.yaml');
      swaggerDocument = doc;
      logger.info('swagger.yaml loaded');
      return doc;
    } catch (err: any) {
      logger.error(`Swagger load failed: ${err.message}`);
      return null;
    }
  })();

  return loadingPromise;
}
