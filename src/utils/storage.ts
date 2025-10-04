import fs from 'fs';
import path from 'path';
import CryptoJS from 'crypto-js';
import config from '../config';
import { promises as fsPromises } from 'fs';

const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getTenantDir(tenantId: string) {
  const dir = path.join(DATA_DIR, tenantId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function encrypt(data: any) {
  return CryptoJS.AES.encrypt(JSON.stringify(data), config.encryptionKey).toString();
}

function decrypt(encrypted: string) {
  const bytes = CryptoJS.AES.decrypt(encrypted, config.encryptionKey);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}

async function saveConfig(tenantId: string, configData: any) {
  const dir = getTenantDir(tenantId);
  const filePath = path.join(dir, 'config.json');
  const encrypted = encrypt(configData);
  await fsPromises.writeFile(filePath, encrypted, 'utf8');
}

async function loadConfig(tenantId: string) {
  const filePath = path.join(getTenantDir(tenantId), 'config.json');
  try {
    const encrypted = await fsPromises.readFile(filePath, 'utf8');
    return decrypt(encrypted);
  } catch {
    return null;
  }
}

async function saveLogs(tenantId: string, logs: any[]) {
  const dir = getTenantDir(tenantId);
  const filePath = path.join(dir, 'logs.json');
  const encrypted = encrypt(logs);
  await fsPromises.writeFile(filePath, encrypted, 'utf8');
}

async function loadLogs(tenantId: string): Promise<any[]> {
  const filePath = path.join(getTenantDir(tenantId), 'logs.json');
  if (!fs.existsSync(filePath)) return [];
  const encrypted = await fsPromises.readFile(filePath, 'utf8');
  return decrypt(encrypted);
}

async function appendLog(tenantId: string, logEntry: any) {
  const logs = await loadLogs(tenantId);
  logs.push(logEntry);
  await saveLogs(tenantId, logs);
}

async function getAllTenants(): Promise<string[]> {
  if (!fs.existsSync(DATA_DIR)) return [];
  const files = await fsPromises.readdir(DATA_DIR);
  const tenantIds = await Promise.all(
    files.map(async (file) => {
      const stat = await fsPromises.stat(path.join(DATA_DIR, file));
      return stat.isDirectory() ? file : null;
    })
  );
  return tenantIds.filter(Boolean) as string[];
}

export default {
  saveConfig,
  loadConfig,
  saveLogs,
  loadLogs,
  appendLog,
  getAllTenants,
};
