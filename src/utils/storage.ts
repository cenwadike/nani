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
 * @file utils/storage.ts
 * @summary Handles encrypted tenant-specific storage for configuration and event logs.
 * @description Provides filesystem-based persistence for tenant data using AES encryption.
 *              Supports saving, loading, and appending logs and configuration files.
 */

import fs from 'fs';
import path from 'path';
import CryptoJS from 'crypto-js';
import config from '../config';
import logger from './logger';
import { promises as fsPromises } from 'fs';

// Root directory for storing tenant data
const DATA_DIR = path.join(__dirname, '../data');

// Ensure the data directory exists at startup
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  logger.info(`Created data directory: ${DATA_DIR}`);
}

/**
 * @function getTenantDir
 * @description Returns the directory path for a given tenant, creating it if necessary.
 * @param tenantId - Unique identifier for the tenant
 * @returns Absolute path to the tenant's data directory
 */
function getTenantDir(tenantId: string): string {
  const dir = path.join(DATA_DIR, tenantId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`Created tenant directory: ${dir}`);
  }
  return dir;
}

/**
 * @function encrypt
 * @description Encrypts data using AES and the configured encryption key.
 * @param data - Arbitrary JSON-serializable data
 * @returns Encrypted string
 */
function encrypt(data: any): string {
  logger.event('Encrypting data for storage');
  return CryptoJS.AES.encrypt(JSON.stringify(data), config.encryptionKey).toString();
}

/**
 * @function decrypt
 * @description Decrypts AES-encrypted string back into JSON.
 * @param encrypted - Encrypted string
 * @returns Parsed JSON object
 */
function decrypt(encrypted: string): any {
  logger.event('Decrypting data from storage');
  const bytes = CryptoJS.AES.decrypt(encrypted, config.encryptionKey);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}

/**
 * @function saveConfig
 * @description Saves encrypted tenant configuration to disk.
 * @param tenantId - Tenant identifier
 * @param configData - Configuration object to persist
 */
async function saveConfig(tenantId: string, configData: any): Promise<void> {
  const dir = getTenantDir(tenantId);
  const filePath = path.join(dir, 'config.json');
  const encrypted = encrypt(configData);
  await fsPromises.writeFile(filePath, encrypted, 'utf8');
  logger.info(`Saved config for tenant ${tenantId}`);
}

/**
 * @function loadConfig
 * @description Loads and decrypts tenant configuration from disk.
 * @param tenantId - Tenant identifier
 * @returns Configuration object or null if not found
 */
async function loadConfig(tenantId: string): Promise<any | null> {
  const filePath = path.join(getTenantDir(tenantId), 'config.json');
  try {
    const encrypted = await fsPromises.readFile(filePath, 'utf8');
    logger.info(`Loaded config for tenant ${tenantId}`);
    return decrypt(encrypted);
  } catch {
    logger.error(`Config not found for tenant ${tenantId}`);
    return null;
  }
}

/**
 * @function saveLogs
 * @description Saves encrypted event logs for a tenant.
 * @param tenantId - Tenant identifier
 * @param logs - Array of log entries
 */
async function saveLogs(tenantId: string, logs: any[]): Promise<void> {
  const dir = getTenantDir(tenantId);
  const filePath = path.join(dir, 'logs.json');
  const encrypted = encrypt(logs);
  await fsPromises.writeFile(filePath, encrypted, 'utf8');
  logger.info(`Saved ${logs.length} logs for tenant ${tenantId}`);
}

/**
 * @function loadLogs
 * @description Loads and decrypts event logs for a tenant.
 * @param tenantId - Tenant identifier
 * @returns Array of log entries
 */
async function loadLogs(tenantId: string): Promise<any[]> {
  const filePath = path.join(getTenantDir(tenantId), 'logs.json');
  if (!fs.existsSync(filePath)) {
    logger.info(`No logs found for tenant ${tenantId}`);
    return [];
  }
  const encrypted = await fsPromises.readFile(filePath, 'utf8');
  logger.info(`Loaded logs for tenant ${tenantId}`);
  return decrypt(encrypted);
}

/**
 * @function appendLog
 * @description Appends a single log entry to the tenant's log file.
 * @param tenantId - Tenant identifier
 * @param logEntry - Log entry object
 */
async function appendLog(tenantId: string, logEntry: any): Promise<void> {
  const logs = await loadLogs(tenantId);
  logs.push(logEntry);
  await saveLogs(tenantId, logs);
  logger.event(`Appended log entry for tenant ${tenantId}`);
}

/**
 * @function getAllTenants
 * @description Lists all tenant directories in the data folder.
 * @returns Array of tenant IDs
 */
async function getAllTenants(): Promise<string[]> {
  if (!fs.existsSync(DATA_DIR)) return [];
  const files = await fsPromises.readdir(DATA_DIR);
  const tenantIds = await Promise.all(
    files.map(async (file) => {
      const stat = await fsPromises.stat(path.join(DATA_DIR, file));
      return stat.isDirectory() ? file : null;
    })
  );
  const validTenants = tenantIds.filter(Boolean) as string[];
  logger.info(`Discovered ${validTenants.length} tenants`);
  return validTenants;
}

export default {
  saveConfig,
  loadConfig,
  saveLogs,
  loadLogs,
  appendLog,
  getAllTenants,
};
