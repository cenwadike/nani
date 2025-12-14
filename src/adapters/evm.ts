// SPDX-License-Identifier: MIT
// adapters/evm.ts

/**
 * @file adapters/chains/evm.ts
 * @summary EVM-compatible chain adapter (Ethereum, Polygon, BSC, etc.)
 * @description Implements ChainAdapter interface for all EVM-compatible chains
 *              using ethers.js v6. Handles WebSocket connections, event subscriptions,
 *              and EVM-specific operations.
 */

import { ethers } from 'ethers';
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

export class EVMAdapter implements ChainAdapter {
  name = 'evm';
  displayName = 'EVM';
  chainType = 'evm' as const;
  supportedChains = [
    'ethereum',
    'polygon',
    'bsc',
    'avalanche',
    'arbitrum',
    'optimism',
    'base',
    'moonbeam',
    'moonriver',
  ];

  private provider?: ethers.WebSocketProvider;
  private config?: ChainAdapterConfig;
  private connectionStatus: ConnectionStatus = {
    connected: false,
    endpoint: '',
    reconnectAttempts: 0,
  };
  private currentEndpointIndex = 0;
  private eventCallbacks: Array<(event: ChainEvent) => Promise<void>> = [];
  private blockListener?: (blockNumber: number) => void;

  async init(config: ChainAdapterConfig): Promise<void> {
    this.config = config;
    logger.info(`Initializing EVM adapter for ${config.name}`);
  }

  async connect(endpoints: string[]): Promise<void> {
    if (!this.config) {
      throw new Error('Adapter not initialized. Call init() first.');
    }

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[(this.currentEndpointIndex + i) % endpoints.length];

      try {
        logger.info(`Attempting connection to ${this.config.name} via ${endpoint}`);

        // Convert HTTP to WebSocket if needed
        const wsEndpoint = endpoint
          .replace('https://', 'wss://')
          .replace('http://', 'ws://');

        this.provider = new ethers.WebSocketProvider(wsEndpoint);

        // Test connection
        const network = await this.provider.getNetwork();
        const blockNumber = await this.provider.getBlockNumber();

        this.connectionStatus = {
          connected: true,
          endpoint: wsEndpoint,
          reconnectAttempts: 0,
          lastConnected: new Date(),
          blockHeight: blockNumber,
        };

        this.currentEndpointIndex = (this.currentEndpointIndex + i) % endpoints.length;

        // Setup disconnect handler
        {
          const ws: any = this.provider.websocket;
          const handleClose = () => this.handleDisconnect(endpoints);
          const handleError = (event: any) => {
            const err = (event as any).error || event;
            logger.error(`WebSocket error on ${this.config!.name}: ${err?.message || err}`);
          };

          if (typeof ws.addEventListener === 'function') {
            ws.addEventListener('close', handleClose);
            ws.addEventListener('error', handleError);
          } else if (typeof ws.on === 'function') {
            ws.on('close', handleClose);
            ws.on('error', handleError);
          } else {
            // Fallback to assigning handlers
            ws.onclose = handleClose;
            ws.onerror = handleError;
          }
        }

        logger.info(`Connected to ${this.config.name} (chainId: ${network.chainId}, block: ${blockNumber})`);
        return;

      } catch (err: any) {
        logger.error(`Connection failed for ${endpoint}: ${err.message}`);
        this.connectionStatus.lastError = err.message;
        
        // Cleanup failed provider
        if (this.provider) {
          try {
            this.provider.destroy();
          } catch {}
          this.provider = undefined;
        }
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
        
        // Resubscribe to events
        await this.resubscribeAll();
      } catch (err: any) {
        logger.error(`Reconnection failed: ${err.message}`);
        this.handleDisconnect(endpoints);
      }
    }, delay);
  }

  private async resubscribeAll(): Promise<void> {
    if (this.blockListener && this.provider) {
      this.provider.on('block', this.blockListener);
      logger.info('Resubscribed to block events');
    }
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting from ${this.config?.name}`);

    if (this.provider) {
      this.provider.removeAllListeners();
      this.provider.destroy();
      this.provider = undefined;
    }

    this.eventCallbacks = [];
    this.blockListener = undefined;
    this.connectionStatus.connected = false;
  }

  getStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  async getMetadata(): Promise<ChainMetadata> {
    if (!this.provider) throw new Error('Not connected');

    const network = await this.provider.getNetwork();

    return {
      name: this.config!.name,
      type: 'evm',
      tokenSymbol: this.config!.tokenSymbol,
      decimals: 18, // Standard for most EVM chains
      chainId: network.chainId.toString(),
    };
  }

  async subscribeToEvents(
    callback: (event: ChainEvent) => Promise<void>,
    options?: SubscriptionOptions
  ): Promise<() => void> {
    if (!this.provider) throw new Error('Not connected');

    logger.info(`Subscribing to events on ${this.config!.name}`);

    this.eventCallbacks.push(callback);

    // Subscribe to new blocks
    this.blockListener = async (blockNumber: number) => {
      try {
        const block = await this.provider!.getBlock(blockNumber, true);
        
        if (!block) return;

        this.connectionStatus.blockHeight = blockNumber;

        // Emit block event
        const blockEvent: ChainEvent = {
          eventName: 'NewBlock',
          section: 'evm',
          method: 'NewBlock',
          data: {
            number: block.number,
            hash: block.hash,
            parentHash: block.parentHash,
            timestamp: block.timestamp,
            miner: block.miner,
            gasUsed: block.gasUsed.toString(),
            gasLimit: block.gasLimit.toString(),
            baseFeePerGas: block.baseFeePerGas?.toString(),
            transactionCount: block.transactions.length,
          },
          blockNumber: block.number,
          blockHash: block.hash || undefined,
          timestamp: block.timestamp * 1000,
          raw: block,
        };

        await this.notifyEventCallbacks(blockEvent);

        // Process transactions if they were fetched
        if (block.prefetchedTransactions) {
          for (const tx of block.prefetchedTransactions) {
            await this.processTransaction(tx, block);
          }
        }

      } catch (err: any) {
        logger.error(`Error processing block ${blockNumber}: ${err.message}`);
      }
    };

    this.provider.on('block', this.blockListener);

    // Subscribe to specific contract events if addresses provided
    if (options?.filters?.addresses) {
      for (const address of options.filters.addresses) {
        const filter = {
          address: address,
        };

        this.provider.on(filter, async (log) => {
          const chainEvent = this.normalizeLog(log);
          await this.notifyEventCallbacks(chainEvent);
        });

        logger.info(`Subscribed to events for contract ${address}`);
      }
    }

    // Return unsubscribe function
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index > -1) {
        this.eventCallbacks.splice(index, 1);
      }

      if (this.eventCallbacks.length === 0 && this.provider && this.blockListener) {
        this.provider.off('block', this.blockListener);
      }
    };
  }

  private async processTransaction(
    tx: ethers.TransactionResponse,
    block: ethers.Block
  ): Promise<void> {
    try {
      // Get transaction receipt for logs and status
      const receipt = await this.provider!.getTransactionReceipt(tx.hash);

      const chainEvent: ChainEvent = {
        eventName: 'Transaction',
        section: 'evm',
        method: 'Transaction',
        data: {
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: tx.value.toString(),
          gasLimit: tx.gasLimit.toString(),
          gasPrice: tx.gasPrice?.toString(),
          maxFeePerGas: tx.maxFeePerGas?.toString(),
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas?.toString(),
          nonce: tx.nonce,
          data: tx.data,
          chainId: tx.chainId.toString(),
          type: tx.type,
          status: receipt?.status,
          gasUsed: receipt?.gasUsed.toString(),
          effectiveGasPrice: receipt?.gasPrice?.toString(),
          contractAddress: receipt?.contractAddress,
          logsCount: receipt?.logs.length || 0,
        },
        blockNumber: block.number,
        blockHash: block.hash || undefined,
        extrinsicHash: tx.hash,
        timestamp: block.timestamp * 1000,
        raw: { tx, receipt },
      };

      await this.notifyEventCallbacks(chainEvent);

      // Process logs from receipt
      if (receipt?.logs) {
        for (const log of receipt.logs) {
          const logEvent = this.normalizeLog(log);
          await this.notifyEventCallbacks(logEvent);
        }
      }

    } catch (err: any) {
      logger.error(`Error processing transaction ${tx.hash}: ${err.message}`);
    }
  }

  private normalizeLog(log: ethers.Log | ethers.EventLog): ChainEvent {
    return {
      eventName: 'Log',
      section: 'evm',
      method: 'Log',
      data: {
        address: log.address,
        topics: log.topics,
        data: log.data,
        logIndex: log.index,
        transactionHash: log.transactionHash,
      },
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      extrinsicHash: log.transactionHash,
      raw: log,
    };
  }

  private async notifyEventCallbacks(event: ChainEvent): Promise<void> {
    await Promise.allSettled(
      this.eventCallbacks.map(callback => callback(event))
    );
  }

  async query(query: ChainQuery): Promise<any> {
    if (!this.provider) throw new Error('Not connected');

    switch (query.type) {
      case 'balance': {
        const { address } = query.params;
        const balance = await this.provider.getBalance(address);
        return { balance: balance.toString() };
      }

      case 'block': {
        const { blockNumber } = query.params;
        const block = blockNumber !== undefined
          ? await this.provider.getBlock(blockNumber, true)
          : await this.provider.getBlock('latest', true);
        return block;
      }

      case 'transaction': {
        const { hash } = query.params;
        const tx = await this.provider.getTransaction(hash);
        const receipt = await this.provider.getTransactionReceipt(hash);
        return { transaction: tx, receipt };
      }

      case 'storage': {
        const { address, position } = query.params;
        const value = await this.provider.getStorage(address, position);
        return { value };
      }

      case 'custom': {
        const { method, params = [] } = query.params;
        // Support arbitrary RPC calls
        return await this.provider.send(method, params);
      }

      default:
        throw new Error(`Unsupported query type: ${query.type}`);
    }
  }

  isValidAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  formatAddress(address: string): string {
    try {
      return ethers.getAddress(address); // Checksummed address
    } catch {
      return address;
    }
  }

  parseTransaction(data: any): ChainTransaction {
    const tx = data.transaction || data.tx || data;
    const receipt = data.receipt;

    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value?.toString(),
      fee: receipt ? 
        (BigInt(receipt.gasUsed) * BigInt(receipt.gasPrice || receipt.effectiveGasPrice || 0)).toString() 
        : undefined,
      success: receipt ? receipt.status === 1 : true,
      blockNumber: tx.blockNumber,
      timestamp: data.timestamp,
      data: tx.data,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.provider) return false;
      await this.provider.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }
}

// Factory function
export default function createEVMAdapter(): ChainAdapter {
  return new EVMAdapter();
}