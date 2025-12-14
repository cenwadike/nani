// SPDX-License-Identifier: MIT
// adapters/near.ts

import { connect, ConnectConfig, keyStores, Near } from 'near-api-js';
import { JsonRpcProvider, Provider } from 'near-api-js/lib/providers';
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

const POLLING_INTERVAL = 2_000;
const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_DELAY = 1_000;

export class NEARAdapter implements ChainAdapter {
  name = 'near';
  displayName = 'NEAR Protocol';
  chainType = 'custom' as const;
  supportedChains = ['near', 'near-mainnet', 'near-testnet'];

  private connection?: Near;
  private config?: ChainAdapterConfig;
  private connectionStatus: ConnectionStatus = {
    connected: false,
    endpoint: '',
    reconnectAttempts: 0,
  };
  private currentEndpointIndex = 0;
  private pollingInterval?: NodeJS.Timeout;
  private lastProcessedBlock = 0;
  private eventCallbacks: Array<(event: ChainEvent) => Promise<void>> = [];
  private reconnectTimeout?: NodeJS.Timeout;

  // Clean abstracted RPC provider
  private get rpc(): Provider {
    if (!this.connection) throw new Error('NEAR not connected');
    return this.connection.connection.provider;
  }

  async init(config: ChainAdapterConfig): Promise<void> {
    this.config = config;
    logger.info(`Initializing NEAR adapter for ${config.name}`);
  }

  async connect(endpoints: string[]): Promise<void> {
    if (!this.config) throw new Error('Adapter not initialized');

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[(this.currentEndpointIndex + i) % endpoints.length];
      const networkId = this.getNetworkId(this.config.name, endpoint);

      try {
        logger.info(`Connecting to ${this.config.name} via ${endpoint}`);

        const connectConfig: ConnectConfig = {
          networkId,
          keyStore: new keyStores.InMemoryKeyStore(),
          nodeUrl: endpoint,
        };

        this.connection = await connect(connectConfig);

        // Test connection
        const status = await this.rpc.status();
        const blockHeight = status.sync_info.latest_block_height;

        this.connectionStatus = {
          connected: true,
          endpoint,
          reconnectAttempts: 0,
          lastConnected: new Date(),
          blockHeight,
        };

        this.currentEndpointIndex = (this.currentEndpointIndex + i) % endpoints.length;
        logger.info(`Connected to ${this.config.name} at block ${blockHeight}`);
        return;
      } catch (err: any) {
        logger.error(`Failed ${endpoint}: ${err.message}`);
        this.connectionStatus.lastError = err.message;
      }
    }

    throw new Error(`All endpoints failed for ${this.config.name}`);
  }

  private getNetworkId(chainName: string, endpoint: string): string {
    if (chainName.includes('testnet') || endpoint.includes('testnet')) {
      return 'testnet';
    }
    return 'mainnet';
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
        if (this.eventCallbacks.length > 0) this.startBlockPolling();
      } catch (err: any) {
        logger.error(`Reconnection failed: ${err.message}`);
        this.handleDisconnect(endpoints);
      }
    }, delay);
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting from ${this.config?.name}`);

    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    if (this.pollingInterval) clearInterval(this.pollingInterval);

    this.eventCallbacks = [];
    this.connection = undefined;
    this.pollingInterval = undefined;
    this.reconnectTimeout = undefined;
    this.connectionStatus.connected = false;
  }

  getStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  async getMetadata(): Promise<ChainMetadata> {
    const status = await this.rpc.status();
    return {
        name: this.config!.name,
        type: 'custom',
        tokenSymbol: this.config!.tokenSymbol || 'NEAR',
        decimals: 24,
        chainId: status.chain_id, // This is reliable and always present
    };
  }

  async subscribeToEvents(
    callback: (event: ChainEvent) => Promise<void>,
    options?: SubscriptionOptions
  ): Promise<() => void> { 
    logger.info(`Subscribing to events on ${this.config!.name}`);
    this.eventCallbacks.push(callback);

    const status = await this.rpc.status();
    this.lastProcessedBlock = options?.startBlock ?? status.sync_info.latest_block_height;

    this.startBlockPolling();

    return () => {
      const idx = this.eventCallbacks.indexOf(callback);
      if (idx > -1) this.eventCallbacks.splice(idx, 1);
      if (this.eventCallbacks.length === 0 && this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = undefined;
      }
    };
  }

  private startBlockPolling(): void {
    if (this.pollingInterval) return;
    this.pollingInterval = setInterval(async () => {
      try {
        await this.pollNewBlocks();
      } catch (err: any) {
        logger.error(`Block polling error: ${err.message}`);
      }
    }, POLLING_INTERVAL);
  }

  private async pollNewBlocks(): Promise<void> {
    try {
      const status = await this.rpc.status();
      const currentHeight = status.sync_info.latest_block_height;

      if (currentHeight <= this.lastProcessedBlock) return;

      const maxBlocksToProcess = 10;
      const startBlock = this.lastProcessedBlock + 1;
      const endBlock = Math.min(currentHeight, startBlock + maxBlocksToProcess - 1);

      for (let height = startBlock; height <= endBlock; height++) {
        try {
          await this.processBlock(height);
          this.lastProcessedBlock = height;
        } catch (err: any) {
          logger.error(`Error processing block ${height}: ${err.message}`);
          break;
        }
      }

      this.connectionStatus.blockHeight = this.lastProcessedBlock;
    } catch (err: any) {
      logger.error(`Error polling blocks: ${err.message}`);
    }
  }

  private async processBlock(blockHeight: number): Promise<void> {
    const block = await this.rpc.block({ blockId: blockHeight });
    
    // Fetch chunks
    const chunks = await Promise.all(
      block.chunks.map((c: any) =>
        this.rpc.chunk(c.chunk_hash).catch(() => null)
      )
    );

    await this.emitBlockEvent(block);

    for (const chunk of chunks) {
      if (!chunk?.transactions) continue;

      for (const tx of chunk.transactions) {
        try {
          const txResult = await this.rpc.txStatus(tx.hash, tx.signer_id, "FINAL");
          await this.emitTransactionEvent(txResult, block);

          if (txResult.receipts_outcome) {
            for (const receipt of txResult.receipts_outcome) {
              await this.emitReceiptEvent(receipt, block);
            }
          }
        } catch (err: any) {
          logger.info(`Tx ${tx.hash} not ready yet: ${err.message}`);
        }
      }
    }
  }

  private async emitBlockEvent(block: any): Promise<void> {
    const event: ChainEvent = {
      eventName: 'near.NewBlock',
      section: 'near',
      method: 'NewBlock',
      data: {
        height: block.header.height,
        hash: block.header.hash,
        prevHash: block.header.prev_hash,
        timestamp: block.header.timestamp,
        timestampNanosec: block.header.timestamp_nanosec,
        totalSupply: block.header.total_supply,
        gasPrice: block.header.gas_price,
        chunksIncluded: block.header.chunks_included,
        validatorProposals: block.header.validator_proposals,
      },
      blockNumber: block.header.height,
      blockHash: block.header.hash,
      timestamp: Math.floor(block.header.timestamp_nanosec / 1_000_000),
      raw: block,
    };
    await this.notifyCallbacks(event);
  }

  private async emitTransactionEvent(txResult: any, block: any): Promise<void> {
    const tx = txResult.transaction;
    const outcome = txResult.transaction_outcome;

    const event: ChainEvent = {
      eventName: 'near.Transaction',
      section: 'near',
      method: 'Transaction',
      data: {
        hash: tx.hash,
        signerId: tx.signer_id,
        receiverId: tx.receiver_id,
        actions: tx.actions,
        nonce: tx.nonce,
        publicKey: tx.public_key,
        signature: tx.signature,
        status: outcome.outcome.status,
        gasUsed: outcome.outcome.gas_burnt,
        tokensUsed: outcome.outcome.tokens_burnt,
        logs: outcome.outcome.logs,
      },
      blockNumber: block.header.height,
      blockHash: outcome.block_hash,
      extrinsicHash: tx.hash,
      timestamp: Math.floor(block.header.timestamp_nanosec / 1_000_000),
      raw: txResult,
    };
    await this.notifyCallbacks(event);
  }

  private async emitReceiptEvent(receipt: any, block: any): Promise<void> {
    const event: ChainEvent = {
      eventName: 'near.Receipt',
      section: 'near',
      method: 'Receipt',
      data: {
        receiptId: receipt.id,
        executorId: receipt.outcome.executor_id,
        gasUsed: receipt.outcome.gas_burnt,
        tokensUsed: receipt.outcome.tokens_burnt,
        status: receipt.outcome.status,
        logs: receipt.outcome.logs,
        receiptIds: receipt.outcome.receipt_ids,
      },
      blockNumber: block.header.height,
      blockHash: receipt.block_hash,
      timestamp: Math.floor(block.header.timestamp_nanosec / 1_000_000),
      raw: receipt,
    };
    await this.notifyCallbacks(event);
  }

  private async notifyCallbacks(event: ChainEvent): Promise<void> {
    for (const cb of this.eventCallbacks) {
      try {
        await cb(event);
      } catch (err: any) {
        logger.error(`Callback error: ${err.message}`);
      }
    }
  }

  async query(query: ChainQuery): Promise<any> {
    switch (query.type) {
      case 'balance': {
        const { address } = query.params;
        const account = await this.connection!.account(address);
        return await account.getAccountBalance();
      }

      case 'block': {
        const { blockNumber, blockHash } = query.params;
        if (blockHash) return await this.rpc.block({ blockId: blockHash });
        if (blockNumber !== undefined) return await this.rpc.block({ blockId: blockNumber });
        return await this.rpc.block({ finality: 'final' });
      }

      case 'transaction': {
        const { hash, accountId } = query.params;
        if (!accountId) throw new Error('accountId required for NEAR tx query');
        return await this.rpc.txStatus(hash, accountId, "FINAL");
      }

      case 'storage': {
        const { accountId, prefix } = query.params;
        const account = await this.connection!.account(accountId);
        return await account.viewState(prefix || '');
      }

      case 'custom': {
        const { method, params = {} } = query.params;
        return await (this.rpc as any).sendJsonRpc(method, params);
      }

      default:
        throw new Error(`Unsupported query type: ${query.type}`);
    }
  }

  isValidAddress(address: string): boolean {
    const implicit = /^[a-f0-9]{64}$/;
    const named = /^[a-z0-9_.-]{1,64}$/;
    return implicit.test(address) || (named.test(address) && address.endsWith('.near') === false || address.includes('.'));
  }

  formatAddress(address: string): string {
    return address.toLowerCase();
  }

  parseTransaction(data: any): ChainTransaction {
    const tx = data.transaction || data;
    const outcome = data.transaction_outcome || {};

    return {
      hash: tx.hash,
      from: tx.signer_id,
      to: tx.receiver_id,
      success:
        outcome.outcome?.status?.SuccessValue !== undefined ||
        outcome.outcome?.status?.SuccessReceiptId !== undefined,
      blockNumber: data.block_height,
      timestamp: data.block_timestamp ? Math.floor(data.block_timestamp / 1_000_000) : undefined,
      fee: outcome.outcome?.tokens_burnt,
      data: tx.actions,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.rpc.status();
      return true;
    } catch {
      return false;
    }
  }
}

export default function createNEARAdapter(): ChainAdapter {
  return new NEARAdapter();
}