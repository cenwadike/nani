// SPDX-License-Identifier: MIT
// This file is part of the Nani project, a Polkadot-based event streaming service.
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

import fs from 'fs';
import path from 'path';

// Root directory for storing log files
const LOG_ROOT = path.join(__dirname, '..', 'logs');

/**
 * @function ensureDir
 * @description Creates the log directory if it doesn't exist.
 * @param dir - Absolute path to the directory
 */
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * @function timestamp
 * @description Returns the current timestamp in ISO format.
 * @returns {string} ISO-formatted timestamp
 */
function timestamp(): string {
  return new Date().toISOString();
}

/**
 * @function writeLog
 * @description Writes a log entry to the appropriate daily file.
 *              Organizes logs into folders by month and files by day.
 * @param type - Log level (e.g., 'info', 'error', 'event')
 * @param message - Log message content
 */
function writeLog(type: string, message: string) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  const folder = path.join(LOG_ROOT, `${year}-${month}`);
  ensureDir(folder);

  const file = path.join(folder, `${day}.log`);
  const entry = `[${timestamp()}] [${type.toUpperCase()}] ${message}\n`;

  fs.appendFile(file, entry, (err) => {
    if (err) console.error('Failed to write log:', err.message);
  });
}

/**
 * @exports logger
 * @description Provides structured logging methods for different log levels.
 */
export default {
  /**
   * @function info
   * @description Logs an informational message.
   * @param msg - Message to log
   */
  info: (msg: string) => writeLog('info', msg),

  /**
   * @function error
   * @description Logs an error message.
   * @param msg - Message to log
   */
  error: (msg: string) => writeLog('error', msg),

  /**
   * @function event
   * @description Logs a blockchain or plugin event.
   * @param msg - Message to log
   */
  event: (msg: string) => writeLog('event', msg),
};
