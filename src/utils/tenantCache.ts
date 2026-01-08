// utils/tenantCache.ts - NEW FILE
import { CHAINS } from '../config';
import logger from './logger';
import storage, { TenantConfig } from './storage';

interface TenantChainConfig {
  tenantId: string;
  address: string;
  config: TenantConfig;
}

class TenantCache {
  private cache: Map<string, Map<string, TenantChainConfig>> = new Map(); // chainName → tenantId → config
  private initialized = false;

  async initialize() {
    if (this.initialized) return;
    logger.info('Initializing tenant config cache...');

    const tenantIds = await storage.getAllTenants();
    logger.info(`Loading configs for ${tenantIds.length} tenants...`);

    for (const tenantId of tenantIds) {
      for (const chain of CHAINS) {
        const cfg = await storage.loadChainConfig(tenantId, chain.name);
        if (cfg) {
          this.set(chain.name, tenantId, cfg);
        }
      }
    }

    this.initialized = true;
    logger.info(`Tenant cache initialized with ${this.size()} entries`);
  }

  get(chainName: string, tenantId: string): TenantChainConfig | null {
    return this.cache.get(chainName)?.get(tenantId) || null;
  }

  getAllForChain(chainName: string): TenantChainConfig[] {
    const map = this.cache.get(chainName);
    return map ? Array.from(map.values()) : [];
  }

  set(chainName: string, tenantId: string, config: any) {
    if (!this.cache.has(chainName)) {
      this.cache.set(chainName, new Map());
    }
    this.cache.get(chainName)!.set(tenantId, {
      tenantId,
      address: config.address,
      config,
    });
  }

  delete(chainName: string, tenantId: string) {
    this.cache.get(chainName)?.delete(tenantId);
  }

  clear() {
    this.cache.clear();
  }

  size(): number {
    let total = 0;
    for (const map of this.cache.values()) {
      total += map.size;
    }
    return total;
  }

  // Call this after any config save/delete
  async refreshTenantChain(tenantId: string, chainName: string) {
    const cfg = await storage.loadChainConfig(tenantId, chainName);
    if (cfg) {
      this.set(chainName, tenantId, cfg);
    } else {
      this.delete(chainName, tenantId);
    }
  }
}

export const tenantCache = new TenantCache();
export default tenantCache;