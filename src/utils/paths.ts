// src/utils/paths.ts
import fs from 'fs';
import path from 'path';

// Detect if we're inside Docker or Fly.io
const isContainer = fs.existsSync('/.dockerenv') || !!process.env.FLY_APP_NAME;

// PROJECT_ROOT is /app in container, current dir in dev
export const PROJECT_ROOT = isContainer
  ? '/app'
  : path.resolve(process.cwd());

export const DATA_ROOT = path.join(PROJECT_ROOT, 'data');
export const LOG_ROOT  = path.join(PROJECT_ROOT, 'logs');
