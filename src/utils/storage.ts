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

// ──────────────────────────────────────────────────────────────────────
//  DATA ROOT
// ──────────────────────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const DATA_ROOT = path.join(PROJECT_ROOT, 'src', 'data');

if (!fs.existsSync(DATA_ROOT)) {
  fs.mkdirSync(DATA_ROOT, { recursive: true });
  logger.info(`Created data root: ${DATA_ROOT}`);
}

// ──────────────────────────────────────────────────────────────────────
//  ENCRYPTION
// ──────────────────────────────────────────────────────────────────────
const encrypt = (data: any): string =>
  CryptoJS.AES.encrypt(JSON.stringify(data), config.encryptionKey).toString();

const decrypt = (encrypted: string): any => {
  const bytes = CryptoJS.AES.decrypt(encrypted, config.encryptionKey);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
};

// ──────────────────────────────────────────────────────────────────────
//  TENANT + CHAIN DIRECTORY
// ──────────────────────────────────────────────────────────────────────
const getChainDir = (tenantId: string, chainId: string): string => {
  const dir = path.join(DATA_ROOT, tenantId, chainId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`Created chain dir: ${dir}`);
  }
  return dir;
};

const getTenantDir = (tenantId: string): string => {
  const dir = path.join(DATA_ROOT, tenantId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`Created tenant dir: ${dir}`);
  }
  return dir;
};

// ──────────────────────────────────────────────────────────────────────
//  PER-CHAIN CONFIG (ONLY)
// ──────────────────────────────────────────────────────────────────────
export const saveChainConfig = async (
  tenantId: string,
  chainId: string,
  cfg: any
): Promise<void> => {
  const file = path.join(getChainDir(tenantId, chainId), 'config.json');
  await fsPromises.writeFile(file, encrypt(cfg), 'utf8');
  logger.info(`Config saved → ${file}`);
};

export const loadChainConfig = async (
  tenantId: string,
  chainId: string
): Promise<any | null> => {
  const file = path.join(DATA_ROOT, tenantId, chainId, 'config.json');
  if (!fs.existsSync(file)) return null;
  const data = await fsPromises.readFile(file, 'utf8');
  return decrypt(data);
};

export const getChainIdsForTenant = async (tenantId: string): Promise<string[]> => {
  const tenantDir = getTenantDir(tenantId);
  const entries = await fsPromises.readdir(tenantDir);
  const chainIds: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(tenantDir, entry);
    const stat = await fsPromises.stat(fullPath);
    if (stat.isDirectory() && entry !== 'logs') {
      chainIds.push(entry);
    }
  }

  logger.info(`Found ${chainIds.length} chain(s) for tenant ${tenantId}: [${chainIds.join(', ')}]`);
  return chainIds;
};

// ──────────────────────────────────────────────────────────────────────
//  LOGS – Per-tenant, encrypted per line
// ──────────────────────────────────────────────────────────────────────
export const getLogFilePath = (tenantId: string, date: Date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  const monthDir = path.join(getTenantDir(tenantId), 'logs', `${year}-${month}`);
  if (!fs.existsSync(monthDir)) {
    fs.mkdirSync(monthDir, { recursive: true });
  }

  return path.join(monthDir, `${day}.jsonl`);
};

export const appendLog = async (tenantId: string, entry: any): Promise<void> => {
  const file = getLogFilePath(tenantId);
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...entry,
  }) + '\n';

  const encryptedLine = encrypt(line);
  await fsPromises.appendFile(file, encryptedLine + '\n');
  logger.event(`Log appended → ${file}`);
};

export const loadLogs = async (tenantId: string): Promise<any[]> => {
  const logsDir = path.join(getTenantDir(tenantId), 'logs');
  if (!fs.existsSync(logsDir)) return [];

  const months = await fsPromises.readdir(logsDir);
  const all: any[] = [];

  for (const month of months) {
    const monthPath = path.join(logsDir, month);
    const days = await fsPromises.readdir(monthPath);

    for (const day of days) {
      const file = path.join(monthPath, day);
      const content = await fsPromises.readFile(file, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);

      for (const enc of lines) {
        try {
          const decrypted = decrypt(enc);
          all.push(JSON.parse(decrypted));
        } catch (e) {
          logger.error(`Failed to decrypt log line in ${file}`);
        }
      }
    }
  }

  return all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
};

// ──────────────────────────────────────────────────────────────────────
//  TENANTS
// ──────────────────────────────────────────────────────────────────────
export const getAllTenants = async (): Promise<string[]> => {
  if (!fs.existsSync(DATA_ROOT)) return [];
  const entries = await fsPromises.readdir(DATA_ROOT);
  const tenants = (
    await Promise.all(
      entries.map(async (e) => {
        const stat = await fsPromises.stat(path.join(DATA_ROOT, e));
        return stat.isDirectory() ? e : null;
      })
    )
  ).filter(Boolean) as string[];
  logger.info(`Found ${tenants.length} tenants`);
  return tenants;
};

// ──────────────────────────────────────────────────────────────────────
//  EXPORT (ONLY PER-CHAIN + LOGS)
// ──────────────────────────────────────────────────────────────────────
export default {
  saveChainConfig,
  loadChainConfig,
  getChainIdsForTenant,
  getLogFilePath,
  
  decrypt,

  appendLog,
  loadLogs,

  getAllTenants,
  getTenantDir,
};