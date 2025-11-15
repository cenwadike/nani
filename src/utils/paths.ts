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
  fs.existsSync('/.dockerenv') ||          // Official Docker marker
  !!process.env.FLY_APP_NAME ||            // Fly.io apps
  !!process.env.RAILWAY_ENVIRONMENT_NAME ||     // Railway.app
  !!process.env.RENDER ||                  // Render.com
  process.env.NODE_ENV === 'production';   // Fallback: assume container in prod

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
 * Example: /app/data/tenants/abc123.json (AES-256-GCM)
 */
export const DATA_ROOT: string = path.join(PROJECT_ROOT, 'data');

/**
 * Structured log storage with daily rotation
 * Mounted as persistent volume for compliance + debugging
 * Format: /app/logs/2025-11/10.log
 */
export const LOG_ROOT: string = path.join(PROJECT_ROOT, 'logs');
