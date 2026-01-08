// SPDX-License-Identifier: MIT
// utils/adapterPool.ts

/**
 * @file utils/adapterPool.ts
 * @summary Async adapter pool manager with auto-scaling
 * @description Manages a pool of chain adapter instances with lifecycle management,
 *              health monitoring, and automatic scaling based on deployment environment.
 *              Fully async/await throughout - no blocking operations.
 */

import logger from './logger';
import { getAdapterForChain } from './adapterRegistry';
import { ChainAdapter, ChainAdapterConfig, ChainEvent } from '../types/adapterTypes';

interface AdapterPoolEntry {
  adapter: ChainAdapter;
  chainConfig: ChainAdapterConfig;
  eventCallback: (chainName: string, event: ChainEvent) => Promise<void>;
  healthy: boolean;
  lastHealthCheck: Date;
  subscriptionActive: boolean;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  currentUnsubscribe?: () => void;
}

class AdapterPool {
  private pool = new Map<string, AdapterPoolEntry>();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL = 30_000; // 30s
  private readonly BASE_RECONNECT_DELAY = 5000; // 5s base

  /**
   * Initialize or re-initialize adapter for a chain
   */
  private async setupAdapter(
    chainConfig: ChainAdapterConfig,
    eventCallback: (chainName: string, event: ChainEvent) => Promise<void>
  ): Promise<void> {
    const chainName = chainConfig.name;
    let entry = this.pool.get(chainName);

    // Always disconnect first if exists
    if (entry) {
      await this.cleanupAdapter(chainName);
    }

    try {
      logger.info(`Setting up adapter for ${chainName}...`);

      const adapter = getAdapterForChain(chainName);
      if (!adapter) {
        throw new Error(`No adapter registered for chain: ${chainName}`);
      }

      // Initialize adapter
      await adapter.init({
        name: chainConfig.name,
        adapterType: chainConfig.adapterType,
        endpoints: chainConfig.endpoints,
        tokenSymbol: chainConfig.tokenSymbol,
        reconnectAttempts: 0, // We manage reconnects at pool level
        reconnectDelay: 0,
        timeout: 30000,
        customSettings: chainConfig.customSettings || {},
        assignedWorkerId: chainConfig.assignedWorkerId,
      });

      // Connect
      await adapter.connect(chainConfig.endpoints);

      // Subscribe
      const unsubscribe = await adapter.subscribeToEvents(
        async (event: ChainEvent) => {
          try {
            await eventCallback(chainName, event);
          } catch (err: any) {
            logger.error(`Error in event callback for ${chainName}: ${err.message}`);
          }
        }
      );

      // Store fresh entry
      this.pool.set(chainName, {
        adapter,
        chainConfig,
        eventCallback,
        healthy: true,
        lastHealthCheck: new Date(),
        subscriptionActive: true,
        reconnectAttempts: 0,
        maxReconnectAttempts: 15,
        currentUnsubscribe: unsubscribe,
      });

      logger.info(`✓ Adapter for ${chainName} fully connected and subscribed`);

    } catch (err: any) {
      logger.error(`Failed to setup adapter for ${chainName}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Initialize all adapters
   */
  async initializeAll(
    chains: ChainAdapterConfig[],
    eventCallback: (chainName: string, event: ChainEvent) => Promise<void>
  ): Promise<void> {
    logger.info(`Initializing ${chains.length} chain adapter(s)...`);

    const results = await Promise.allSettled(
      chains.map(chain => this.setupAdapter(chain, eventCallback))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];

    logger.info(`Adapter init complete: ${successful} OK, ${failed.length} failed`);

    failed.forEach((result, i) => {
      logger.error(`Failed chain: ${chains[i].name} → ${result.reason}`);
    });

    if (successful === 0) {
      throw new Error('No adapters initialized successfully');
    }

    this.startHealthMonitoring();
  }

  /**
   * Perform health checks and auto-reconnect if needed
   */
  private async performHealthChecks(): Promise<void> {
    const checks = Array.from(this.pool.entries()).map(async ([chainName, entry]) => {
      let healthy = false;
      try {
        healthy = await entry.adapter.healthCheck();
      } catch (err: any) {
        logger.error(`Health check threw for ${chainName}: ${err.message}`);
        healthy = false;
      }

      entry.healthy = healthy;
      entry.lastHealthCheck = new Date();

      if (!healthy) {
        logger.warn(`Adapter ${chainName} unhealthy → initiating reconnect (attempt ${entry.reconnectAttempts + 1})`);
        await this.reconnectAdapter(chainName);
      } else if (entry.reconnectAttempts > 0) {
        entry.reconnectAttempts = 0; // Reset on success
      }
    });

    await Promise.all(checks);
  }

  /**
   * Reconnect a single adapter with exponential backoff
   */
  private async reconnectAdapter(chainName: string): Promise<void> {
    const entry = this.pool.get(chainName);
    if (!entry) return;

    if (entry.reconnectAttempts >= entry.maxReconnectAttempts) {
      logger.error(`Max reconnect attempts (${entry.maxReconnectAttempts}) reached for ${chainName}. Giving up.`);
      entry.healthy = false;
      return;
    }

    entry.reconnectAttempts++;

    const delay = this.BASE_RECONNECT_DELAY * Math.pow(2, entry.reconnectAttempts - 1);
    logger.info(`Reconnecting ${chainName} in ${delay / 1000}s (attempt ${entry.reconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.setupAdapter(entry.chainConfig, entry.eventCallback);
        logger.info(`✓ Successfully reconnected and resubscribed ${chainName}`);
      } catch (err: any) {
        logger.error(`Reconnect failed for ${chainName}: ${err.message}`);
        // Next health check will retry
      }
    }, delay);
  }

  /**
   * Clean up adapter resources
   */
  private async cleanupAdapter(chainName: string): Promise<void> {
    const entry = this.pool.get(chainName);
    if (!entry) return;

    try {
      if (entry.currentUnsubscribe) {
        entry.currentUnsubscribe();
      }
      await entry.adapter.disconnect();
      logger.info(`Cleaned up adapter for ${chainName}`);
    } catch (err: any) {
      logger.warn(`Error during cleanup of ${chainName}: ${err.message}`);
    }
  }

  /**
   * Check if adapter is healthy
   */
  async isHealthy(chainName: string): Promise<boolean> {
    const entry = this.pool.get(chainName);
    if (!entry) return false;
    
    const isHealthy = entry?.healthy ?? false;

    if (!isHealthy) {
      logger.warn(`Adapter for ${chainName} is currently unhealthy. Restarting adapter`);
      logger.warn(`Adapter ${chainName} unhealthy → initiating reconnect (attempt ${entry.reconnectAttempts + 1})`);
      await this.reconnectAdapter(chainName);
    } else if (entry.reconnectAttempts > 0) {
      entry.reconnectAttempts = 0; // Reset on success
    }

    return isHealthy;
  }
  
  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks().catch(err => {
        logger.error(`Health check cycle error: ${err.message}`);
      });
    }, this.HEALTH_CHECK_INTERVAL);

    logger.info('Adapter health monitoring started');
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    total: number;
    healthy: number;
    unhealthy: number;
    chains: Array<{
      name: string;
      healthy: boolean;
      lastCheck: string;
      reconnectAttempts: number;
    }>;
  } {
    const chains = Array.from(this.pool.entries()).map(([name, entry]) => ({
      name,
      healthy: entry.healthy,
      lastCheck: entry.lastHealthCheck.toISOString(),
      reconnectAttempts: entry.reconnectAttempts,
    }));

    return {
      total: chains.length,
      healthy: chains.filter(c => c.healthy).length,
      unhealthy: chains.filter(c => !c.healthy).length,
      chains,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down adapter pool...');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    const cleanups = Array.from(this.pool.keys()).map(chain => this.cleanupAdapter(chain));
    await Promise.allSettled(cleanups);

    this.pool.clear();
    logger.info('Adapter pool fully shut down');
  }
}

export const adapterPool = new AdapterPool();
export default adapterPool;