// SPDX-License-Identifier: MIT
// adapters/substrate.ts

/**
 * @file adapters/chains/substrate.ts
 * @summary Substrate-based chain adapter (Polkadot, Kusama, Westend, etc.)
 * @description Implements ChainAdapter interface for all Substrate-based chains
 *              using Polkadot.js API (PAPI). Handles connection management,
 *              event subscriptions, and Substrate-specific operations.
 */

import { ApiPromise, WsProvider } from '@polkadot/api';
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import {
  ChainAdapter,
  ChainAdapterConfig,
  ChainEvent,
  ChainMetadata,
  ChainQuery,
  ChainTransaction,
  ConnectionStatus,
  SubscriptionOptions,
} from '../types/adapterTypes';
import logger from '../utils/logger';

const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_DELAY = 1_000;

export class SubstrateAdapter implements ChainAdapter {
  name = 'substrate';
  displayName = 'Substrate';
  chainType = 'substrate' as const;
  supportedChains = ['polkadot', 'kusama', 'westend', 'rococo', 'asset-hub-westend', 'asset-hub-polkadot'];

  private api?: ApiPromise;
  private provider?: WsProvider;
  private config?: ChainAdapterConfig;
  private connectionStatus: ConnectionStatus = {
    connected: false,
    endpoint: '',
    reconnectAttempts: 0,
  };
  private unsubscribeFns: Array<() => void> = [];
  private currentEndpointIndex = 0;

  async init(config: ChainAdapterConfig): Promise<void> {
    this.config = config;
    logger.info(`Initializing Substrate adapter for ${config.name}`);
  }

  async connect(endpoints: string[]): Promise<void> {
    if (!this.config) {
      throw new Error('Adapter not initialized. Call init() first.');
    }

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[(this.currentEndpointIndex + i) % endpoints.length];
      
      try {
        logger.info(`Attempting connection to ${this.config.name} via ${endpoint}`);

        this.provider = new WsProvider(endpoint, 5_000, {}, 60_000);
        this.api = await ApiPromise.create({ provider: this.provider });
        await this.api.isReady;

        this.connectionStatus = {
          connected: true,
          endpoint,
          reconnectAttempts: 0,
          lastConnected: new Date(),
        };

        this.currentEndpointIndex = (this.currentEndpointIndex + i) % endpoints.length;

        // Setup disconnect handler
        this.provider.on('disconnected', () => this.handleDisconnect(endpoints));
        this.provider.on('error', (err) => {
          logger.error(`Provider error on ${this.config!.name}: ${err.message}`);
        });

        logger.info(`Connected to ${this.config.name} via ${endpoint}`);
        return;

      } catch (err: any) {
        logger.error(`Connection failed for ${endpoint}: ${err.message}`);
        this.connectionStatus.lastError = err.message;
      }
    }

    throw new Error(`All endpoints failed for ${this.config.name}`);
  }

  private handleDisconnect(endpoints: string[]): void {
    logger.warn(`Lost connection to ${this.config!.name}`);
    this.connectionStatus.connected = false;
    this.connectionStatus.reconnectAttempts++;

    const delay = Math.min(
      INITIAL_DELAY * Math.pow(2, this.connectionStatus.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY
    );

    setTimeout(async () => {
      try {
        await this.connect(endpoints);
        logger.info(`Reconnected to ${this.config!.name}`);
      } catch (err: any) {
        logger.error(`Reconnection failed: ${err.message}`);
        this.handleDisconnect(endpoints);
      }
    }, delay);
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting from ${this.config?.name}`);

    // Unsubscribe from all active subscriptions
    this.unsubscribeFns.forEach(unsub => unsub());
    this.unsubscribeFns = [];

    if (this.api) {
      await this.api.disconnect();
      this.api = undefined;
    }

    this.provider = undefined;
    this.connectionStatus.connected = false;
  }

  getStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  async getMetadata(): Promise<ChainMetadata> {
    if (!this.api) throw new Error('Not connected');

    const chain = await this.api.rpc.system.chain();
    const properties = await this.api.rpc.system.properties();

    const tokenSymbol = properties.tokenSymbol.unwrapOr([this.config!.tokenSymbol])[0].toString();

    const decimalsVal = properties.tokenDecimals.unwrapOr([12])[0];
    const decimals = typeof decimalsVal === 'number' ? decimalsVal : (decimalsVal as any).toNumber();

    const ss58Val = properties.ss58Format.unwrapOr(42);
    const ss58Format = typeof ss58Val === 'number' ? ss58Val : (ss58Val as any).toNumber();

    return {
      name: this.config!.name,
      type: 'substrate',
      tokenSymbol,
      decimals,
      ss58Format,
    };
  }

  async subscribeToEvents(
    callback: (event: ChainEvent) => Promise<void>,
    options?: SubscriptionOptions
    ): Promise<() => void> {
    if (!this.api) throw new Error('Not connected');

    logger.info(`Subscribing to events on ${this.config!.name}`);

    // Subscribe to **new heads** to get the latest block number/hash
    let latestHeader: any = null;
    const headerUnsub = await this.api.rpc.chain.subscribeNewHeads((header) => {
        latestHeader = header;
    });

    // Subscribe to system events
    const eventsUnsub = (await this.api.query.system.events(async (records: any[]) => {
        // Use the *latest* header we received (always in sync with the events)
        const blockNumber = latestHeader?.number?.toNumber();
        const blockHash = latestHeader?.hash?.toString();

        for (const record of records) {
        try {
            const { event } = record;

            // Apply filters
            if (options?.filters) {
            const { sections, methods } = options.filters;
            if (sections && !sections.includes(event.section)) continue;
            if (methods && !methods.includes(event.method)) continue;
            }

            const chainEvent: ChainEvent = {
            eventName: `${event.section}.${event.method}`,
            section: event.section,
            method: event.method,
            data: event.data,
            raw: record.toJSON(),
            blockNumber,
            blockHash,
            };

            await callback(chainEvent);
        } catch (err: any) {
            logger.error(`Event processing error: ${err.message}`);
        }
        }
    })) as unknown as (() => void);

    // Return a combined unsubscribe
    const combinedUnsub = () => {
        headerUnsub();
        eventsUnsub();
    };
    this.unsubscribeFns.push(combinedUnsub);
    return combinedUnsub;
    }

  async query(query: ChainQuery): Promise<any> {
    if (!this.api) throw new Error('Not connected');

    switch (query.type) {
      case 'balance': {
        const { address } = query.params;
        const account = await this.api.query.system.account(address);
        return account;
      }

      case 'block': {
        const { blockNumber } = query.params;
        const hash = blockNumber 
          ? await this.api.rpc.chain.getBlockHash(blockNumber)
          : await this.api.rpc.chain.getBlockHash();
        const block = await this.api.rpc.chain.getBlock(hash);
        return block.toJSON();
      }

      case 'storage': {
        const { module, method, args = [] } = query.params;
        const result = await (this.api.query as any)[module][method](...args);
        return result.toJSON();
      }

      case 'custom': {
        // Allow custom RPC calls
        const { method, params = [] } = query.params;
        const [module, rpcMethod] = method.split('.');
        const result = await (this.api.rpc as any)[module][rpcMethod](...params);
        return result.toJSON();
      }

      default:
        throw new Error(`Unsupported query type: ${query.type}`);
    }
  }

  isValidAddress(address: string): boolean {
    try {
      decodeAddress(address);
      return true;
    } catch {
      return false;
    }
  }

  formatAddress(address: string): string {
    try {
      const ss58Format = this.config?.customSettings?.ss58Format || 42;
      return encodeAddress(decodeAddress(address), ss58Format);
    } catch {
      return address;
    }
  }

  parseTransaction(data: any): ChainTransaction {
    const extrinsic = data.extrinsic || data;
    
    return {
      hash: extrinsic.hash?.toString() || '',
      from: extrinsic.signer?.toString(),
      success: extrinsic.success || false,
      blockNumber: data.blockNumber,
      timestamp: data.timestamp,
      fee: extrinsic.fee?.toString(),
      data: extrinsic.method,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.api?.isConnected) return false;
      await this.api.rpc.system.chain();
      return true;
    } catch {
      return false;
    }
  }
}

// Factory function
export default function createSubstrateAdapter(): ChainAdapter {
  return new SubstrateAdapter();
}
