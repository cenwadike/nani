// SPDX-License-Identifier: MIT
// adapters/sui.ts

/**
 * @file adapters/chains/sui.ts
 * @summary Sui blockchain adapter
 * @description Implements ChainAdapter interface for Sui blockchain
 *              using @mysten/sui.js SDK. Handles connection management,
 *              event subscriptions, and Sui-specific operations.
 */

import { SuiClient, SuiHTTPTransport } from '@mysten/sui/client';
import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils';
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

const POLLING_INTERVAL = 1_000; // Poll every 1 second (Sui has sub-second finality)
const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_DELAY = 1_000;

export class SuiAdapter implements ChainAdapter {
  name = 'sui';
  displayName = 'Sui';
  chainType = 'custom' as const;
  supportedChains = ['sui', 'sui-mainnet', 'sui-testnet', 'sui-devnet'];

  private client?: SuiClient;
  private config?: ChainAdapterConfig;
  private connectionStatus: ConnectionStatus = {
    connected: false,
    endpoint: '',
    reconnectAttempts: 0,
  };
  private currentEndpointIndex = 0;
  private pollingInterval?: NodeJS.Timeout;
  private lastProcessedCheckpoint = 0;
  private eventCallbacks: Array<(event: ChainEvent) => Promise<void>> = [];
  private reconnectTimeout?: NodeJS.Timeout;
  private subscribedPackages: Set<string> = new Set();

  async init(config: ChainAdapterConfig): Promise<void> {
    this.config = config;
    logger.info(`Initializing Sui adapter for ${config.name}`);
  }

  async connect(endpoints: string[]): Promise<void> {
    if (!this.config) {
      throw new Error('Adapter not initialized. Call init() first.');
    }

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[(this.currentEndpointIndex + i) % endpoints.length];

      try {
        logger.info(`Attempting connection to ${this.config.name} via ${endpoint}`);

        // Create Sui client
        this.client = new SuiClient({
          transport: new SuiHTTPTransport({
            url: endpoint,
          }),
        });

        // Test connection
        const chainId = await this.client.getChainIdentifier();
        const checkpoint = await this.client.getLatestCheckpointSequenceNumber();

        this.connectionStatus = {
          connected: true,
          endpoint,
          reconnectAttempts: 0,
          lastConnected: new Date(),
          blockHeight: Number(checkpoint),
        };

        this.currentEndpointIndex = (this.currentEndpointIndex + i) % endpoints.length;

        logger.info(
          `Connected to ${this.config.name} (chainId: ${chainId}, checkpoint: ${checkpoint})`
        );
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

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect(endpoints);
        logger.info(`Reconnected to ${this.config!.name}`);
        
        // Restart polling if there are active callbacks
        if (this.eventCallbacks.length > 0) {
          this.startCheckpointPolling();
        }
      } catch (err: any) {
        logger.error(`Reconnection failed: ${err.message}`);
        this.handleDisconnect(endpoints);
      }
    }, delay);
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting from ${this.config?.name}`);

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // Stop polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }

    this.eventCallbacks = [];
    this.subscribedPackages.clear();
    this.client = undefined;
    this.connectionStatus.connected = false;
  }

  getStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  async getMetadata(): Promise<ChainMetadata> {
    if (!this.client) throw new Error('Not connected');

    const chainId = await this.client.getChainIdentifier();
    
    return {
      name: this.config!.name,
      type: 'custom',
      tokenSymbol: this.config!.tokenSymbol || 'SUI',
      decimals: 9, // SUI uses 9 decimal places (MIST)
      chainId,
    };
  }

  async subscribeToEvents(
    callback: (event: ChainEvent) => Promise<void>,
    options?: SubscriptionOptions
  ): Promise<() => void> {
    if (!this.client) throw new Error('Not connected');

    logger.info(`Subscribing to events on ${this.config!.name}`);

    // Store callback
    this.eventCallbacks.push(callback);

    // Store package filters if provided
    if (options?.filters?.addresses) {
      options.filters.addresses.forEach(addr => this.subscribedPackages.add(addr));
    }

    // Get current checkpoint
    const currentCheckpoint = await this.client.getLatestCheckpointSequenceNumber();
    this.lastProcessedCheckpoint = options?.startBlock || Number(currentCheckpoint);

    // Start polling for new checkpoints
    this.startCheckpointPolling();

    // Return unsubscribe function
    const unsubscribe = () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index > -1) {
        this.eventCallbacks.splice(index, 1);
      }

      // Remove package filters for this callback if applicable
      if (options?.filters?.addresses) {
        options.filters.addresses.forEach(addr => this.subscribedPackages.delete(addr));
      }

      // Stop polling if no more callbacks
      if (this.eventCallbacks.length === 0 && this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = undefined;
      }
    };

    return unsubscribe;
  }

  private startCheckpointPolling(): void {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(async () => {
      try {
        await this.pollNewCheckpoints();
      } catch (err: any) {
        logger.error(`Checkpoint polling error: ${err.message}`);
      }
    }, POLLING_INTERVAL);
  }

  private async pollNewCheckpoints(): Promise<void> {
    if (!this.client) return;

    try {
      const currentCheckpoint = Number(await this.client.getLatestCheckpointSequenceNumber());

      if (currentCheckpoint <= this.lastProcessedCheckpoint) {
        return; // No new checkpoints
      }

      // Process all new checkpoints (limit to avoid overwhelming system)
      const maxCheckpointsToProcess = 5;
      const startCheckpoint = this.lastProcessedCheckpoint + 1;
      const endCheckpoint = Math.min(currentCheckpoint, startCheckpoint + maxCheckpointsToProcess - 1);

      for (let seqNum = startCheckpoint; seqNum <= endCheckpoint; seqNum++) {
        try {
          await this.processCheckpoint(seqNum);
          this.lastProcessedCheckpoint = seqNum;
        } catch (err: any) {
          logger.error(`Error processing checkpoint ${seqNum}: ${err.message}`);
          break; // Stop processing on error
        }
      }

      // Update connection status
      this.connectionStatus.blockHeight = this.lastProcessedCheckpoint;

    } catch (err: any) {
      logger.error(`Error polling checkpoints: ${err.message}`);
    }
  }

  private async processCheckpoint(sequenceNumber: number): Promise<void> {
    if (!this.client) return;

    // Get checkpoint details
    const checkpoint = await this.client.getCheckpoint({
      id: sequenceNumber.toString(),
    });

    // Emit checkpoint event
    await this.emitCheckpointEvent(checkpoint);

    // Get transactions in this checkpoint
    const transactions = checkpoint.transactions || [];

    for (const txDigest of transactions) {
      try {
        const txBlock = await this.client.getTransactionBlock({
          digest: txDigest,
          options: {
            showInput: true,
            showEffects: true,
            showEvents: true,
            showObjectChanges: true,
            showBalanceChanges: true,
          },
        });

        await this.emitTransactionEvent(txBlock, checkpoint);

        // Emit events from transaction
        if (txBlock.events) {
          for (const event of txBlock.events) {
            // Apply package filters if specified
            if (this.subscribedPackages.size > 0) {
              const packageId = event.packageId;
              if (!this.subscribedPackages.has(packageId)) {
                continue;
              }
            }

            await this.emitSuiEvent(event, checkpoint, txDigest);
          }
        }

      } catch (err: any) {
        logger.error(`Error processing transaction ${txDigest}: ${err.message}`);
      }
    }
  }

  private async emitCheckpointEvent(checkpoint: any): Promise<void> {
    const event: ChainEvent = {
      eventName: 'sui.NewCheckpoint',
      section: 'sui',
      method: 'NewCheckpoint',
      data: {
        sequenceNumber: checkpoint.sequenceNumber,
        digest: checkpoint.digest,
        epoch: checkpoint.epoch,
        epochRollingGasCostSummary: checkpoint.epochRollingGasCostSummary,
        networkTotalTransactions: checkpoint.networkTotalTransactions,
        previousDigest: checkpoint.previousDigest,
        timestampMs: checkpoint.timestampMs,
        transactionCount: checkpoint.transactions?.length || 0,
        validatorSignature: checkpoint.validatorSignature,
      },
      blockNumber: Number(checkpoint.sequenceNumber),
      blockHash: checkpoint.digest,
      timestamp: Number(checkpoint.timestampMs),
      raw: checkpoint,
    };

    await this.notifyCallbacks(event);
  }

  private async emitTransactionEvent(txBlock: any, checkpoint: any): Promise<void> {
    const effects = txBlock.effects;
    const sender = txBlock.transaction?.data?.sender;

    const event: ChainEvent = {
      eventName: 'sui.Transaction',
      section: 'sui',
      method: 'Transaction',
      data: {
        digest: txBlock.digest,
        sender,
        gasUsed: effects?.gasUsed,
        status: effects?.status?.status,
        executedEpoch: effects?.executedEpoch,
        transactionKind: txBlock.transaction?.data?.transaction?.kind,
        balanceChanges: txBlock.balanceChanges,
        objectChanges: txBlock.objectChanges,
        eventsCount: txBlock.events?.length || 0,
      },
      blockNumber: Number(checkpoint.sequenceNumber),
      blockHash: checkpoint.digest,
      extrinsicHash: txBlock.digest,
      timestamp: Number(checkpoint.timestampMs),
      raw: txBlock,
    };

    await this.notifyCallbacks(event);
  }

  private async emitSuiEvent(event: any, checkpoint: any, txDigest: string): Promise<void> {
    const chainEvent: ChainEvent = {
      eventName: `sui.${event.type}`,
      section: 'sui',
      method: 'Event',
      data: {
        packageId: event.packageId,
        transactionModule: event.transactionModule,
        sender: event.sender,
        type: event.type,
        parsedJson: event.parsedJson,
        bcs: event.bcs,
      },
      blockNumber: Number(checkpoint.sequenceNumber),
      blockHash: checkpoint.digest,
      extrinsicHash: txDigest,
      timestamp: Number(checkpoint.timestampMs),
      raw: event,
    };

    await this.notifyCallbacks(chainEvent);
  }

  private async notifyCallbacks(event: ChainEvent): Promise<void> {
    for (const callback of this.eventCallbacks) {
      try {
        await callback(event);
      } catch (err: any) {
        logger.error(`Event callback error: ${err.message}`);
      }
    }
  }

  async query(query: ChainQuery): Promise<any> {
    if (!this.client) throw new Error('Not connected');

    switch (query.type) {
      case 'balance': {
        const { address } = query.params;
        const balance = await this.client.getBalance({
          owner: address,
        });
        return balance;
      }

      case 'block': {
        const { blockNumber } = query.params;
        
        if (blockNumber !== undefined) {
          return await this.client.getCheckpoint({
            id: blockNumber.toString(),
          });
        } else {
          const seqNum = await this.client.getLatestCheckpointSequenceNumber();
          return await this.client.getCheckpoint({
            id: seqNum,
          });
        }
      }

      case 'transaction': {
        const { hash } = query.params;
        return await this.client.getTransactionBlock({
          digest: hash,
          options: {
            showInput: true,
            showEffects: true,
            showEvents: true,
            showObjectChanges: true,
            showBalanceChanges: true,
          },
        });
      }

      case 'storage': {
        // Query objects owned by address
        const { address, objectType } = query.params;
        return await this.client.getOwnedObjects({
          owner: address,
          filter: objectType ? { StructType: objectType } : undefined,
        });
      }

      case 'custom': {
        const { method, params = [] } = query.params;
        // Support arbitrary RPC calls
        return await (this.client as any)[method](...params);
      }

      default:
        throw new Error(`Unsupported query type: ${query.type}`);
    }
  }

  isValidAddress(address: string): boolean {
    return isValidSuiAddress(address);
  }

  formatAddress(address: string): string {
    try {
      return normalizeSuiAddress(address);
    } catch {
      return address;
    }
  }

  parseTransaction(data: any): ChainTransaction {
    const tx = data.transaction?.data || data;
    const effects = data.effects || {};

    // Calculate gas fees
    const gasUsed = effects.gasUsed;
    const totalGas = gasUsed ? 
      (BigInt(gasUsed.computationCost || 0) + 
       BigInt(gasUsed.storageCost || 0) - 
       BigInt(gasUsed.storageRebate || 0)).toString() 
      : undefined;

    return {
      hash: data.digest || tx.digest,
      from: tx.sender,
      success: effects.status?.status === 'success',
      blockNumber: data.checkpoint ? Number(data.checkpoint) : undefined,
      timestamp: data.timestampMs ? Number(data.timestampMs) : undefined,
      fee: totalGas,
      data: tx,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.client) return false;
      await this.client.getLatestCheckpointSequenceNumber();
      return true;
    } catch {
      return false;
    }
  }
}

// Factory function
export default function createSuiAdapter(): ChainAdapter {
  return new SuiAdapter();
}
 