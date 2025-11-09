// SPDX-License-Identifier: MIT
// This file is part of the Nani project, a Polkadot-based event notifications service.
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
 * @file logger.ts
 * @summary Local file-based logger for Nani observability.
 * @description Captures structured log entries and stores them in daily log files
 *              organized by month. Supports info, error, and event-level logging.
 */
// src/utils/logger.ts
import fs from 'fs';
import path from 'path';
import { LOG_ROOT } from './paths';

const FALLBACK = '/tmp/nani-logs';

function getLogRoot() {
  try {
    fs.accessSync(LOG_ROOT, fs.constants.W_OK);
    return LOG_ROOT;
  } catch {
    fs.mkdirSync(FALLBACK, { recursive: true });
    console.warn(`[logger] No write access to ${LOG_ROOT}, using ${FALLBACK}`);
    return FALLBACK;
  }
}

function ensure(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  }
}

function timestamp() {
  return new Date().toISOString();
}

function writeLog(level: string, message: string) {
  const root = getLogRoot();
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const day = String(now.getDate()).padStart(2, '0');

  const dir = path.join(root, month);
  ensure(dir);

  const file = path.join(dir, `${day}.log`);
  const line = `[${timestamp()}] [${level.toUpperCase()}] ${message}\n`;

  try {
    fs.appendFileSync(file, line);
  } catch (err) {
    console.error('[logger] FATAL - could not write log:', err);
  }
}

export default {
  info: (msg: string) => writeLog('info', msg),
  warn: (msg: string) => writeLog('warn', msg),
  error: (msg: string) => writeLog('error', msg),
  event: (msg: string) => writeLog('event', msg),
};
