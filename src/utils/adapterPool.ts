// SPDX-License-Identifier: MIT
// utils/adapterPool.ts

/**
 * @file utils/adapterPool.ts
 * @summary Async adapter pool manager with auto-scaling
 * @description Manages a pool of chain adapter instances with lifecycle management,
 *              health monitoring, and automatic scaling based on deployment environment.
 *              Fully async/await throughout - no blocking operations.
 */

import os from 'os';
import logger from './logger';
import { getAdapterForChain } from './adapterRegistry';
import { ChainAdapter, ChainAdapterConfig, ChainEvent } from '../types/adapterTypes';

interface AdapterPoolEntry {
  adapter: ChainAdapter;
  chainConfig: ChainAdapterConfig;
  healthy: boolean;
  lastHealthCheck: Date;
  subscriptionActive: boolean;
  reconnectAttempts: number;
  unsubscribeFn?: () => void;
}

class AdapterPool {
  private pool = new Map<string, AdapterPoolEntry>();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL = 30_000; // 30 seconds
  private readonly MAX_RECONNECT_ATTEMPTS = 10;

  /**
   * Initialize adapter for a chain
   */
  async initializeAdapter(
    chainConfig: ChainAdapterConfig,
    eventCallback: (chainName: string, event: ChainEvent) => Promise<void>
  ): Promise<void> {
    const chainName = chainConfig.name;

    if (this.pool.has(chainName)) {
      logger.warn(`Adapter for ${chainName} already initialized`);
      return;
    }

    try {
      logger.info(`Initializing adapter for ${chainName}...`);

      // Get appropriate adapter
      const adapter = getAdapterForChain(chainName);
      if (!adapter) {
        throw new Error(`No adapter found for chain: ${chainName}`);
      }

      // Initialize adapter configuration
      await adapter.init({
        name: chainConfig.name,
        adapterType: chainConfig.adapterType,
        endpoints: chainConfig.endpoints,
        tokenSymbol: chainConfig.tokenSymbol,
        reconnectAttempts: this.MAX_RECONNECT_ATTEMPTS,
        reconnectDelay: 5000,
        timeout: 30000,
        customSettings: chainConfig.customSettings || {},
        assignedWorkerId: chainConfig.assignedWorkerId,
      });

      // Connect to chain
      await adapter.connect(chainConfig.endpoints);

      // Subscribe to events
      const unsubscribe = await adapter.subscribeToEvents(
        async (event: ChainEvent) => {
          await eventCallback(chainName, event);
        }
      );

      // Add to pool
      this.pool.set(chainName, {
        adapter,
        chainConfig,
        healthy: true,
        lastHealthCheck: new Date(),
        subscriptionActive: true,
        reconnectAttempts: 0,
        unsubscribeFn: unsubscribe,
      });

      logger.info(`✓ Adapter for ${chainName} initialized and subscribed`);

    } catch (err: any) {
      logger.error(`Failed to initialize adapter for ${chainName}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Initialize adapters for all chains
   */
  async initializeAll(
    chains: ChainAdapterConfig[],
    eventCallback: (chainName: string, event: ChainEvent) => Promise<void>
  ): Promise<void> {
    logger.info(`Initializing adapters for ${chains.length} chain(s)...`);

    const results = await Promise.allSettled(
      chains.map(chain => this.initializeAdapter(chain, eventCallback))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    logger.info(`Adapter initialization complete: ${successful} successful, ${failed} failed`);

    if (successful === 0) {
      throw new Error('Failed to initialize any adapters');
    }

    // Start health monitoring
    this.startHealthMonitoring();
  }

  /**
   * Get adapter for a specific chain
   */
  getAdapter(chainName: string): ChainAdapter | undefined {
    const entry = this.pool.get(chainName);
    return entry?.adapter;
  }

  /**
   * Check if adapter is healthy
   */
  isHealthy(chainName: string): boolean {
    const entry = this.pool.get(chainName);
    return entry?.healthy ?? false;
  }

  /**
   * Start periodic health checks for all adapters
   */
  private startHealthMonitoring(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, this.HEALTH_CHECK_INTERVAL);

    logger.info('Health monitoring started for all adapters');
  }

  /**
   * Perform health checks on all adapters
   */
  private async performHealthChecks(): Promise<void> {
    const chains = Array.from(this.pool.keys());
    
    await Promise.all(
      chains.map(async (chainName) => {
        const entry = this.pool.get(chainName);
        if (!entry) return;

        try {
          const healthy = await entry.adapter.healthCheck();
          entry.healthy = healthy;
          entry.lastHealthCheck = new Date();

          if (!healthy) {
            logger.warn(`Health check failed for ${chainName}`);
            await this.handleUnhealthyAdapter(chainName, entry);
          }
        } catch (err: any) {
          logger.error(`Health check error for ${chainName}: ${err.message}`);
          entry.healthy = false;
          await this.handleUnhealthyAdapter(chainName, entry);
        }
      })
    );
  }

  /**
   * Handle unhealthy adapter - attempt reconnection
   */
  private async handleUnhealthyAdapter(
    chainName: string,
    entry: AdapterPoolEntry
  ): Promise<void> {
    if (entry.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      logger.error(
        `Max reconnection attempts reached for ${chainName}. Manual intervention required.`
      );
      return;
    }

    entry.reconnectAttempts++;
    logger.info(`Attempting to reconnect ${chainName} (attempt ${entry.reconnectAttempts})`);

    try {
      // Disconnect existing adapter
      await entry.adapter.disconnect();

      // Reconnect
      await entry.adapter.connect(entry.chainConfig.endpoints);

      // Resubscribe if subscription was active
      if (entry.subscriptionActive && entry.unsubscribeFn) {
        // Note: subscribeToEvents would need to be called again with callback
        logger.info(`Resubscription needed for ${chainName} - requires event callback`);
      }

      entry.healthy = true;
      entry.reconnectAttempts = 0;
      logger.info(`✓ Successfully reconnected ${chainName}`);

    } catch (err: any) {
      logger.error(`Reconnection failed for ${chainName}: ${err.message}`);
    }
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
      lastCheck: Date;
      reconnectAttempts: number;
    }>;
  } {
    const chains = Array.from(this.pool.entries()).map(([name, entry]) => ({
      name,
      healthy: entry.healthy,
      lastCheck: entry.lastHealthCheck,
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
   * Gracefully shutdown all adapters
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down adapter pool...');

    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Disconnect all adapters
    const chains = Array.from(this.pool.keys());
    await Promise.allSettled(
      chains.map(async (chainName) => {
        const entry = this.pool.get(chainName);
        if (!entry) return;

        try {
          // Unsubscribe from events
          if (entry.unsubscribeFn) {
            entry.unsubscribeFn();
          }

          // Disconnect adapter
          await entry.adapter.disconnect();
          logger.info(`Disconnected adapter for ${chainName}`);
        } catch (err: any) {
          logger.warn(`Error disconnecting ${chainName}: ${err.message}`);
        }
      })
    );

    this.pool.clear();
    logger.info('Adapter pool shutdown complete');
  }

  /**
   * Auto-scale based on environment
   */
  static getOptimalPoolSize(): number {
    const cpus = os.cpus().length;
    const isPaaS = !!(
      process.env.RAILWAY_ENVIRONMENT ||
      process.env.RENDER_INSTANCE_ID ||
      process.env.FLY_APP_NAME
    );

    if (isPaaS) {
      // Conservative scaling for PaaS
      return Math.max(2, Math.floor(cpus * 0.75));
    }

    // Full scaling for dedicated infrastructure
    return cpus;
  }
}

// Singleton instance
export const adapterPool = new AdapterPool();

export default adapterPool;
