// SPDX-License-Identifier: MIT
// adapters/solana.ts

/**
 * @file adapters/chains/solana.ts
 * @summary Solana blockchain adapter
 * @description Fully async adapter for Solana using @solana/web3.js
 *              Normalizes Solana transactions and account updates to ChainEvent format
 */

import {
  Connection,
  PublicKey,
  Commitment,
  Context,
  AccountInfo,
} from '@solana/web3.js';
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

export class SolanaAdapter implements ChainAdapter {
  name = 'solana';
  displayName = 'Solana';
  chainType = 'solana' as const;
  supportedChains = ['solana', 'solana-mainnet', 'solana-devnet', 'solana-testnet'];

  private connection?: Connection;
  private config?: ChainAdapterConfig;
  private connectionStatus: ConnectionStatus = {
    connected: false,
    endpoint: '',
    reconnectAttempts: 0,
  };
  private currentEndpointIndex = 0;
  private subscriptionIds: number[] = [];
  private eventCallbacks: Array<(event: ChainEvent) => Promise<void>> = [];
  private reconnectTimeout?: NodeJS.Timeout;
  private slotUpdateSubscription?: number;

  async init(config: ChainAdapterConfig): Promise<void> {
    this.config = config;
    logger.info(`Initializing Solana adapter for ${config.name}`);
  }

  async connect(endpoints: string[]): Promise<void> {
    if (!this.config) {
      throw new Error('Adapter not initialized. Call init() first.');
    }

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[(this.currentEndpointIndex + i) % endpoints.length];

      try {
        logger.info(`Attempting connection to ${this.config.name} via ${endpoint}`);

        const commitment: Commitment = 'confirmed';
        
        // Create WebSocket endpoint
        const wsEndpoint = endpoint
          .replace('https://', 'wss://')
          .replace('http://', 'ws://');

        this.connection = new Connection(endpoint, {
          commitment,
          wsEndpoint,
        });

        // Test connection with getVersion
        const version = await this.connection.getVersion();
        logger.info(`Connected to Solana cluster version: ${version['solana-core']}`);

        // Get current slot to verify connection
        const slot = await this.connection.getSlot();

        this.connectionStatus = {
          connected: true,
          endpoint,
          reconnectAttempts: 0,
          lastConnected: new Date(),
          blockHeight: slot,
        };

        this.currentEndpointIndex = (this.currentEndpointIndex + i) % endpoints.length;

        logger.info(`Connected to ${this.config.name} via ${endpoint} (slot: ${slot})`);
        return;

      } catch (err: any) {
        logger.error(`Connection failed for ${endpoint}: ${err.message}`);
        this.connectionStatus.lastError = err.message;
      }
    }

    throw new Error(`All endpoints failed for ${this.config.name}`);
  }

  private handleDisconnect(endpoints: string[]): void {
    this.connectionStatus.connected = false;
    this.connectionStatus.reconnectAttempts++;

    if (!this.config) return;

    const delay = Math.min(
      INITIAL_DELAY * Math.pow(2, this.connectionStatus.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY
    );

    logger.info(
      `Reconnecting ${this.config.name} in ${delay}ms (attempt ${this.connectionStatus.reconnectAttempts})`
    );

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect(endpoints);
        logger.info(`Reconnected to ${this.config?.name}`);
        
        // Resubscribe
        await this.resubscribeAll();
      } catch (err: any) {
        logger.error(`Reconnection failed: ${err.message}`);
        this.handleDisconnect(endpoints);
      }
    }, delay);
  }

  private async resubscribeAll(): Promise<void> {
    // Note: Actual resubscription would require storing subscription parameters
    logger.info('Resubscription placeholder - implement based on stored subscription params');
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting from ${this.config?.name}`);

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    // Remove all subscriptions
    if (this.connection) {
      for (const id of this.subscriptionIds) {
        try {
          await this.connection.removeAccountChangeListener(id);
        } catch (err) {
          // Ignore errors during cleanup
        }
      }

      if (this.slotUpdateSubscription) {
        try {
          await this.connection.removeSlotUpdateListener(this.slotUpdateSubscription);
        } catch (err) {
          // Ignore
        }
      }
    }

    this.subscriptionIds = [];
    this.eventCallbacks = [];
    this.connection = undefined;
    this.connectionStatus.connected = false;
  }

  getStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  async getMetadata(): Promise<ChainMetadata> {
    if (!this.connection) throw new Error('Not connected');

    return {
      name: this.config!.name,
      type: 'solana',
      tokenSymbol: this.config!.tokenSymbol,
      decimals: 9, // SOL has 9 decimals (lamports)
      chainId: this.config!.name,
    };
  }

  async subscribeToEvents(
    callback: (event: ChainEvent) => Promise<void>,
    options?: SubscriptionOptions
  ): Promise<() => void> {
    if (!this.connection) throw new Error('Not connected');

    logger.info(`Subscribing to events on ${this.config!.name}`);

    this.eventCallbacks.push(callback);

    // Subscribe to slot updates (new blocks)
    this.slotUpdateSubscription = this.connection.onSlotUpdate(async (slotInfo) => {
      try {
        this.connectionStatus.blockHeight = slotInfo.slot;

        // Get block for the slot
        const block = await this.connection!.getBlock(slotInfo.slot, {
          maxSupportedTransactionVersion: 0,
        });

        if (!block) return;

        // Emit block event
        const parent = (slotInfo as any).parent ?? null;
        const root = (slotInfo as any).root ?? null;

        const blockEvent: ChainEvent = {
            eventName: 'NewBlock',
            section: 'solana',
            method: 'NewBlock',
            data: {
            slot: slotInfo.slot,
            parent,
            root,
            blockhash: block.blockhash,
            previousBlockhash: block.previousBlockhash,
            blockTime: block.blockTime,
            transactionCount: block.transactions.length,
            },
            blockNumber: slotInfo.slot,
            blockHash: block.blockhash,
            timestamp: block.blockTime ? block.blockTime * 1000 : Date.now(),
            raw: { slotInfo, block },
        };

        await this.notifyEventCallbacks(blockEvent);

        // Process each transaction in the block
        for (const tx of block.transactions) {
          try {
            const chainEvent = await this.normalizeTransaction(
              tx,
              slotInfo.slot,
              block.blockTime
            );

            // Apply filters if specified
            if (options?.filters?.addresses) {
              const hasMatchingAddress = this.checkTransactionAddresses(
                tx,
                options.filters.addresses
              );
              if (!hasMatchingAddress) continue;
            }

            await this.notifyEventCallbacks(chainEvent);
          } catch (err: any) {
            logger.error(`Error processing transaction: ${err.message}`);
          }
        }
      } catch (err: any) {
        logger.error(`Error processing slot ${slotInfo.slot}: ${err.message}`);
      }
    });

    // If specific addresses are provided, subscribe to account changes
    if (options?.filters?.addresses) {
      for (const address of options.filters.addresses) {
        try {
          const pubkey = new PublicKey(address);
          const subscriptionId = this.connection.onAccountChange(
            pubkey,
            async (accountInfo: AccountInfo<Buffer>, context: Context) => {
              const chainEvent: ChainEvent = {
                eventName: 'AccountChange',
                section: 'solana',
                method: 'AccountUpdate',
                data: {
                  address,
                  lamports: accountInfo.lamports,
                  owner: accountInfo.owner.toBase58(),
                  executable: accountInfo.executable,
                  rentEpoch: accountInfo.rentEpoch,
                },
                blockNumber: context.slot,
                timestamp: Date.now(),
                raw: { accountInfo, context },
              };

              await this.notifyEventCallbacks(chainEvent);
            },
            'confirmed'
          );

          this.subscriptionIds.push(subscriptionId);
          logger.info(`Subscribed to account changes for ${address}`);
        } catch (err: any) {
          logger.error(`Failed to subscribe to account ${address}: ${err.message}`);
        }
      }
    }

    // Return unsubscribe function
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index > -1) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  private async normalizeTransaction(
    tx: any,
    slot: number,
    blockTime: number | null
  ): Promise<ChainEvent> {
    const signature = tx.transaction.signatures[0];
    const message = tx.transaction.message;
    const instructions = message.compiledInstructions || [];

    // Extract program IDs and accounts
    const accountKeys = message.staticAccountKeys || message.accountKeys || [];
    const programIds = instructions.map((ix: any) => {
      const programIdIndex = ix.programIdIndex;
      return accountKeys[programIdIndex]?.toBase58();
    }).filter(Boolean);

    const accounts = accountKeys.map((key: PublicKey) => key.toBase58());

    return {
      eventName: 'Transaction',
      section: 'solana',
      method: 'Transaction',
      data: {
        signature,
        slot,
        err: tx.meta?.err || null,
        fee: tx.meta?.fee || 0,
        preBalances: tx.meta?.preBalances || [],
        postBalances: tx.meta?.postBalances || [],
        logMessages: tx.meta?.logMessages || [],
        programIds,
        accounts,
        instructions: instructions.length,
      },
      blockNumber: slot,
      extrinsicHash: signature,
      timestamp: blockTime ? blockTime * 1000 : Date.now(),
      raw: tx,
    };
  }

  private checkTransactionAddresses(tx: any, addresses: string[]): boolean {
    const message = tx.transaction.message;
    const accountKeys = message.staticAccountKeys || message.accountKeys || [];
    const txAccounts = accountKeys.map((key: PublicKey) => key.toBase58());

    return addresses.some(addr => txAccounts.includes(addr));
  }

  private async notifyEventCallbacks(event: ChainEvent): Promise<void> {
    await Promise.allSettled(
      this.eventCallbacks.map(callback => callback(event))
    );
  }

  async query(query: ChainQuery): Promise<any> {
    if (!this.connection) throw new Error('Not connected');

    switch (query.type) {
      case 'balance': {
        const { address } = query.params;
        const pubkey = new PublicKey(address);
        const balance = await this.connection.getBalance(pubkey);
        return { balance };
      }

      case 'block': {
        const slot = query.params.blockNumber || await this.connection.getSlot();
        const block = await this.connection.getBlock(slot, {
          maxSupportedTransactionVersion: 0,
        });
        return block;
      }

      case 'transaction': {
        const { hash } = query.params;
        const tx = await this.connection.getTransaction(hash, {
          maxSupportedTransactionVersion: 0,
        });
        return tx;
      }

      case 'custom': {
        const { method, params = [] } = query.params;
        // Support arbitrary RPC calls
        return await (this.connection as any)[method](...params);
      }

      default:
        throw new Error(`Unsupported query type: ${query.type}`);
    }
  }

  isValidAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  formatAddress(address: string): string {
    try {
      return new PublicKey(address).toBase58();
    } catch {
      return address;
    }
  }

  parseTransaction(data: any): ChainTransaction {
    const tx = data.transaction || data;
    const meta = data.meta || {};

    return {
      hash: tx.signatures?.[0] || '',
      from: tx.message?.accountKeys?.[0]?.toBase58(),
      success: meta.err === null,
      blockNumber: data.slot,
      timestamp: data.blockTime ? data.blockTime * 1000 : undefined,
      fee: meta.fee?.toString() || '0',
      data: tx,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.connection) return false;
      await this.connection.getSlot();
      return true;
    } catch {
      return false;
    }
  }
}

// Factory function
export default function createSolanaAdapter(): ChainAdapter {
  return new SolanaAdapter();
}
