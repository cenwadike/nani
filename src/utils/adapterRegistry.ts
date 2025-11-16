// SPDX-License-Identifier: MIT
// utils/adapterRegistry.ts

/**
 * @file utils/adapterRegistry.ts
 * @summary Chain adapter registry and factory manager
 * @description Manages registration, discovery, and instantiation of chain adapters.
 *              Supports hot-reloading and automatic adapter discovery.
 */

import fs from 'fs';
import path from 'path';
import logger from './logger';
import {
  ChainAdapter,
  ChainAdapterFactory,
  ChainAdapterRegistryEntry,
} from '../types/adapterTypes';

// ——————————————————————————————————————
// ADAPTER REGISTRY — Central store
// ——————————————————————————————————————
const adapterRegistry = new Map<string, ChainAdapterRegistryEntry>();
let adaptersLoaded = false;

/**
 * Load all chain adapters from /adapters directory
 */
export function loadAdapters(): void {
  if (adaptersLoaded) {
    logger.info('Adapters already loaded → skipping redundant scan');
    return;
  }

  const adaptersDir = path.join(__dirname, '../adapters');
  logger.info(`Scanning adapter directory: ${adaptersDir}`);

  if (!fs.existsSync(adaptersDir)) {
    logger.warn(`Adapter directory missing: ${adaptersDir}`);
    return;
  }

  const files = fs.readdirSync(adaptersDir)
    .filter(f => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts'));

  logger.info(`Found ${files.length} adapter file(s)`);

  files.forEach((file) => {
    const adapterPath = path.join(adaptersDir, file);
    const adapterKey = file.replace(/\.(ts|js)$/, '');

    try {
      // Force fresh require
      delete require.cache[require.resolve(adapterPath)];
      
      const adapterModule = require(adapterPath);
      const factory: ChainAdapterFactory = adapterModule.default || adapterModule;

      if (typeof factory !== 'function') {
        logger.error(`Invalid adapter export in ${file} → must export factory function`);
        return;
      }

      // Create instance to validate interface
      const adapter = factory();

      if (!adapter.name || typeof adapter.connect !== 'function') {
        logger.error(`Adapter ${file} does not implement ChainAdapter interface`);
        return;
      }

      // Register adapter
      adapterRegistry.set(adapter.name, {
        adapter,
        factory,
        metadata: {
          version: '1.0.0',
          description: `${adapter.displayName} chain adapter`,
        },
      });

      logger.event(`Registered adapter: ${adapter.name} (${adapter.displayName})`);
      logger.info(`  → Supports: ${adapter.supportedChains.join(', ')}`);

    } catch (err: any) {
      logger.error(`Failed to load adapter ${file}: ${err.message}`);
      logger.error(`Stack: ${err.stack}`);
    }
  });

  adaptersLoaded = true;
  logger.info(`Adapter registry initialized with ${adapterRegistry.size} adapter(s)`);
}

/**
 * Ensure adapters are loaded
 */
export function ensureAdaptersLoaded(): void {
  if (!adaptersLoaded) {
    logger.info('ensureAdaptersLoaded() triggered → loading now');
    loadAdapters();
  }
}

/**
 * Get adapter by name
 */
export function getAdapter(name: string): ChainAdapter | undefined {
  ensureAdaptersLoaded();
  
  const entry = adapterRegistry.get(name);
  if (!entry) {
    const available = Array.from(adapterRegistry.keys()).join(', ') || 'none';
    logger.warn(`Adapter not found: ${name} → Available: ${available}`);
    return undefined;
  }

  // Return fresh instance from factory
  return entry.factory();
}

/**
 * Get adapter for a specific chain
 * Automatically detects the correct adapter based on chain name
 */
export function getAdapterForChain(chainName: string): ChainAdapter | undefined {
  ensureAdaptersLoaded();

  for (const [name, entry] of adapterRegistry) {
    if (entry.adapter.supportedChains.includes(chainName.toLowerCase())) {
      logger.info(`Found adapter '${name}' for chain '${chainName}'`);
      return entry.factory();
    }
  }

  logger.warn(`No adapter found for chain: ${chainName}`);
  return undefined;
}

/**
 * List all registered adapters
 */
export function listAdapters(): Array<{
  name: string;
  displayName: string;
  chainType: string;
  supportedChains: string[];
}> {
  ensureAdaptersLoaded();

  return Array.from(adapterRegistry.values()).map(entry => ({
    name: entry.adapter.name,
    displayName: entry.adapter.displayName,
    chainType: entry.adapter.chainType,
    supportedChains: entry.adapter.supportedChains,
  }));
}

/**
 * Reload all adapters (hot-reload support)
 */
export function reloadAdapters(): void {
  logger.warn('Reloading ALL adapters (hot-reload triggered)');
  adaptersLoaded = false;
  adapterRegistry.clear();
  loadAdapters();
}

/**
 * Check if adapters are loaded
 */
export function areAdaptersLoaded(): boolean {
  return adaptersLoaded;
}

export { adapterRegistry };
