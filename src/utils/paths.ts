// SPDX-License-Identifier: MIT
// This file is part of the Nani project, a Polkadot-based event monitoring and notifications service.
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
 * @file utils/paths.ts
 * @summary Universal filesystem path resolver for Nani – zero-config across environments
 * @description Intelligent runtime detection of containerized vs local development environments.
 *              Automatically maps persistent volumes and ensures consistent paths for:
 *              • Encrypted tenant data (/app/data → /data)
 *              • Structured daily logs (/app/logs → /logs)
 *              • chains.json, swagger.yaml, public assets
 *              Works flawlessly on:
 *              - Railway (Docker)
 *              - Fly.io (firecracker VMs)
 *              - Render / Coolify / CapRover
 *              - Docker Compose / Kubernetes
 *              - Local dev (npm run dev)
 *
 * @author Kombi <cenwadike@gmail.com>
 * @license MIT – Full license in repository root (LICENSE)
 * @submission https://github.com/cenwadike/nani
 * @demo https://nani-production-c105.up.railway.app
 * @repo https://github.com/cenwadike/nani
 *
 * @features
 *   • Zero-config path resolution – just deploy
 *   • Automatic container detection via /.dockerenv + FLY_APP_NAME
 *   • PROJECT_ROOT = /app in prod, process.cwd() in dev
 *   • Persistent volume mapping (Docker/K8s ready)
 *   • DATA_ROOT → encrypted tenant configs + caches
 *   • LOG_ROOT → monthly/daily rotated logs (audit-ready)
 *   • Railway volume support out-of-the-box
 *   • No hardcoded paths – fully portable
 *   • Graceful fallback for edge cases
 *   • Used by logger.ts, storage.ts, config.ts, swagger loader
 */
import fs from 'fs';
import path from 'path';

// ——————————————————————————————————————
// RUNTIME ENVIRONMENT DETECTION
// ——————————————————————————————————————
/**
 * Detects if running inside a containerized environment
 * Supports: Docker, Fly.io, Railway, Render, Coolify, etc.
 */
const isContainer: boolean =
  fs.existsSync('/.dockerenv') ||               // Official Docker marker
  !!process.env.FLY_APP_NAME ||                 // Fly.io apps
  !!process.env.RAILWAY_ENVIRONMENT_NAME ||     // Railway.app
  !!process.env.RENDER_INSTANCE_ID ||           // Render.com
  !!process.env.HEROKU_DYNO ||                  // Heroku
  !!process.env.KUBERNETES_SERVICE_HOST;        // Kubernetes

// ——————————————————————————————————————
// PROJECT ROOT RESOLUTION — Universal base
// ——————————————————————————————————————
/**
 * Absolute project root:
 *   • /app     → inside Docker/Railway/Fly.io (standard)
 *   • cwd()    → local development (npm run dev)
 */
export const PROJECT_ROOT: string = isContainer
  ? '/app'
  : path.resolve(process.cwd());

// ——————————————————————————————————————
// PERSISTENT VOLUME PATHS — Production-ready
// ——————————————————————————————————————
/**
 * Encrypted tenant data + plugin caches
 * Mounted as persistent volume in production
 */
export const DATA_ROOT: string = path.join(PROJECT_ROOT, 'data');

/**
 * Structured log storage with daily rotation
 * Environment variable override for flexibility:
 *   LOG_ROOT=/custom/path npm start
 * 
 * Priority:
 * 1. LOG_ROOT env variable (explicit override)
 * 2. PaaS-specific paths (Railway, Render, Fly)
 * 3. Container: /app/logs
 * 4. Development: ./logs
 */
export const LOG_ROOT: string = (() => {
  // 1. Explicit override wins
  if (process.env.LOG_ROOT) {
    return process.env.LOG_ROOT;
  }

  // 2. PaaS environments often don't have writable /app/logs
  //    Use /tmp for ephemeral or check for volume mounts
  if (process.env.RAILWAY_ENVIRONMENT_NAME) {
    // Railway: use /tmp unless volume is mounted at /data
    return process.env.RAILWAY_VOLUME_MOUNT_PATH 
      ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'logs')
      : '/tmp/nani-logs';
  }

  if (process.env.RENDER_INSTANCE_ID) {
    // Render: use /opt/render/project/logs if writable
    const renderLogs = '/opt/render/project/logs';
    try {
      if (!fs.existsSync(renderLogs)) {
        fs.mkdirSync(renderLogs, { recursive: true });
      }
      fs.accessSync(renderLogs, fs.constants.W_OK);
      return renderLogs;
    } catch {
      return '/tmp/nani-logs';
    }
  }

  if (process.env.FLY_APP_NAME) {
    // Fly.io: use /data/logs if volume mounted, else /tmp
    return fs.existsSync('/data') ? '/data/logs' : '/tmp/nani-logs';
  }

  // 3. Container default: try /app/logs, fallback to /tmp
  if (isContainer) {
    const appLogs = path.join(PROJECT_ROOT, 'logs');
    try {
      if (!fs.existsSync(appLogs)) {
        fs.mkdirSync(appLogs, { recursive: true, mode: 0o755 });
      }
      fs.accessSync(appLogs, fs.constants.W_OK);
      return appLogs;
    } catch {
      return '/tmp/nani-logs';
    }
  }

  // 4. Development: project root
  return path.join(PROJECT_ROOT, 'logs');
})();
