// SPDX-License-Identifier: MIT
// adapters/bitcoin.ts

/**
 * @file adapters/chains/bitcoin.ts
 * @summary Bitcoin chain adapter implementation
 * @description Implements ChainAdapter interface for Bitcoin blockchain
 *              using Bitcoin RPC API. Handles connection management,
 *              block subscriptions, and Bitcoin-specific operations.
 */

import axios, { AxiosInstance } from 'axios';
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

const POLLING_INTERVAL = 10_000; // Poll every 10 seconds

interface BitcoinRpcConfig {
  url: string;
  username?: string;
  password?: string;
}

export class BitcoinAdapter implements ChainAdapter {
  name = 'bitcoin';
  displayName = 'Bitcoin';
  chainType = 'bitcoin' as const;
  supportedChains = ['bitcoin', 'bitcoin-testnet', 'bitcoin-regtest'];

  private rpcClient?: AxiosInstance;
  private config?: ChainAdapterConfig;
  private connectionStatus: ConnectionStatus = {
    connected: false,
    endpoint: '',
    reconnectAttempts: 0,
  };
  private unsubscribeFns: Array<() => void> = [];
  private currentEndpointIndex = 0;
  private pollingInterval?: NodeJS.Timeout;
  private lastProcessedBlock = 0;
  private eventCallbacks: Array<(event: ChainEvent) => Promise<void>> = [];

  async init(config: ChainAdapterConfig): Promise<void> {
    this.config = config;
    logger.info(`Initializing Bitcoin adapter for ${config.name}`);
  }

  async connect(endpoints: string[]): Promise<void> {
    if (!this.config) {
      throw new Error('Adapter not initialized. Call init() first.');
    }

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[(this.currentEndpointIndex + i) % endpoints.length];

      try {
        logger.info(`Attempting connection to ${this.config.name} via ${endpoint}`);

        // Parse endpoint and credentials
        const rpcConfig = this.parseEndpoint(endpoint);

        // Create axios instance for RPC calls
        this.rpcClient = axios.create({
          baseURL: rpcConfig.url,
          timeout: this.config.timeout || 30000,
          auth: rpcConfig.username && rpcConfig.password
            ? {
                username: rpcConfig.username,
                password: rpcConfig.password,
              }
            : undefined,
          headers: {
            'Content-Type': 'application/json',
          },
        });

        // Test connection with getblockchaininfo
        await this.rpcCall('getblockchaininfo');

        this.connectionStatus = {
          connected: true,
          endpoint,
          reconnectAttempts: 0,
          lastConnected: new Date(),
        };

        this.currentEndpointIndex = (this.currentEndpointIndex + i) % endpoints.length;

        logger.info(`Connected to ${this.config.name} via ${endpoint}`);
        return;

      } catch (err: any) {
        logger.error(`Connection failed for ${endpoint}: ${err.message}`);
        this.connectionStatus.lastError = err.message;
      }
    }

    throw new Error(`All endpoints failed for ${this.config.name}`);
  }

  private parseEndpoint(endpoint: string): BitcoinRpcConfig {
    try {
      const url = new URL(endpoint);
      return {
        url: `${url.protocol}//${url.host}${url.pathname}`,
        username: url.username || undefined,
        password: url.password || undefined,
      };
    } catch {
      return { url: endpoint };
    }
  }

  private async rpcCall(method: string, params: any[] = []): Promise<any> {
    if (!this.rpcClient) {
      throw new Error('Not connected');
    }

    try {
      const response = await this.rpcClient.post('', {
        jsonrpc: '1.0',
        id: Date.now(),
        method,
        params,
      });

      if (response.data.error) {
        throw new Error(response.data.error.message);
      }

      return response.data.result;
    } catch (err: any) {
      if (err.response?.data?.error) {
        throw new Error(err.response.data.error.message);
      }
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting from ${this.config?.name}`);

    // Stop polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }

    // Unsubscribe from all active subscriptions
    this.unsubscribeFns.forEach(unsub => unsub());
    this.unsubscribeFns = [];
    this.eventCallbacks = [];

    this.rpcClient = undefined;
    this.connectionStatus.connected = false;
  }

  getStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  async getMetadata(): Promise<ChainMetadata> {
    if (!this.rpcClient) throw new Error('Not connected');

    const info = await this.rpcCall('getblockchaininfo');

    return {
      name: this.config!.name,
      type: 'custom',
      tokenSymbol: this.config!.tokenSymbol || 'BTC',
      decimals: 8, // Bitcoin uses 8 decimal places (satoshis)
      chainId: info.chain, // mainnet, testnet, regtest
    };
  }

  async subscribeToEvents(
    callback: (event: ChainEvent) => Promise<void>,
    options?: SubscriptionOptions
  ): Promise<() => void> {
    if (!this.rpcClient) throw new Error('Not connected');

    logger.info(`Subscribing to events on ${this.config!.name}`);

    // Store callback
    this.eventCallbacks.push(callback);

    // Get current block height
    const blockCount = await this.rpcCall('getblockcount');
    this.lastProcessedBlock = options?.startBlock || blockCount;

    // Start polling for new blocks
    this.startBlockPolling();

    // Return unsubscribe function
    const unsubscribe = () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index > -1) {
        this.eventCallbacks.splice(index, 1);
      }

      // Stop polling if no more callbacks
      if (this.eventCallbacks.length === 0 && this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = undefined;
      }
    };

    this.unsubscribeFns.push(unsubscribe);
    return unsubscribe;
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
    const currentHeight = await this.rpcCall('getblockcount');

    if (currentHeight <= this.lastProcessedBlock) {
      return; // No new blocks
    }

    // Process all new blocks
    for (let height = this.lastProcessedBlock + 1; height <= currentHeight; height++) {
      try {
        const blockHash = await this.rpcCall('getblockhash', [height]);
        const block = await this.rpcCall('getblock', [blockHash, 2]); // Verbosity 2 includes tx details

        // Update status
        this.connectionStatus.blockHeight = height;

        // Emit block event
        await this.emitBlockEvent(block, height);

        // Emit transaction events
        if (block.tx && Array.isArray(block.tx)) {
          for (const tx of block.tx) {
            await this.emitTransactionEvent(tx, block, height);
          }
        }

        this.lastProcessedBlock = height;
      } catch (err: any) {
        logger.error(`Error processing block ${height}: ${err.message}`);
        break; // Stop processing on error
      }
    }
  }

  private async emitBlockEvent(block: any, height: number): Promise<void> {
    const event: ChainEvent = {
      eventName: 'bitcoin.NewBlock',
      section: 'bitcoin',
      method: 'NewBlock',
      data: {
        height,
        hash: block.hash,
        time: block.time,
        nTx: block.nTx,
        size: block.size,
        weight: block.weight,
      },
      blockNumber: height,
      blockHash: block.hash,
      timestamp: block.time,
      raw: block,
    };

    await this.notifyCallbacks(event);
  }

  private async emitTransactionEvent(tx: any, block: any, height: number): Promise<void> {
    const event: ChainEvent = {
      eventName: 'bitcoin.Transaction',
      section: 'bitcoin',
      method: 'Transaction',
      data: {
        txid: tx.txid,
        hash: tx.hash,
        size: tx.size,
        vsize: tx.vsize,
        weight: tx.weight,
        version: tx.version,
        locktime: tx.locktime,
        vin: tx.vin,
        vout: tx.vout,
      },
      blockNumber: height,
      blockHash: block.hash,
      extrinsicHash: tx.txid,
      timestamp: block.time,
      raw: tx,
    };

    await this.notifyCallbacks(event);
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
    if (!this.rpcClient) throw new Error('Not connected');

    switch (query.type) {
      case 'balance': {
        const { address } = query.params;
        // Note: Bitcoin Core doesn't have a direct "get balance by address" RPC
        // This would require using a block explorer API or indexing UTXOs
        throw new Error('Balance query not supported directly. Use listunspent or external indexer.');
      }

      case 'block': {
        const { blockNumber, blockHash } = query.params;
        
        if (blockHash) {
          return await this.rpcCall('getblock', [blockHash, 2]);
        } else if (blockNumber !== undefined) {
          const hash = await this.rpcCall('getblockhash', [blockNumber]);
          return await this.rpcCall('getblock', [hash, 2]);
        } else {
          const bestHash = await this.rpcCall('getbestblockhash');
          return await this.rpcCall('getblock', [bestHash, 2]);
        }
      }

      case 'transaction': {
        const { txid } = query.params;
        return await this.rpcCall('getrawtransaction', [txid, true]);
      }

      case 'custom': {
        const { method, params = [] } = query.params;
        return await this.rpcCall(method, params);
      }

      default:
        throw new Error(`Unsupported query type: ${query.type}`);
    }
  }

  isValidAddress(address: string): boolean {
    // Basic Bitcoin address validation
    // P2PKH: starts with 1
    // P2SH: starts with 3
    // Bech32: starts with bc1
    // Testnet: starts with m, n, or tb1
    const mainnetRegex = /^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,62}$/;
    const testnetRegex = /^(m|n|2|tb1)[a-zA-HJ-NP-Z0-9]{25,62}$/;
    
    return mainnetRegex.test(address) || testnetRegex.test(address);
  }

  formatAddress(address: string): string {
    // Bitcoin addresses don't need formatting
    return address;
  }

  parseTransaction(data: any): ChainTransaction {
    const tx = data.tx || data;

    // Calculate total input and output values
    let inputValue = 0;
    let outputValue = 0;

    if (tx.vin) {
      tx.vin.forEach((input: any) => {
        if (input.prevout && input.prevout.value) {
          inputValue += input.prevout.value;
        }
      });
    }

    if (tx.vout) {
      tx.vout.forEach((output: any) => {
        outputValue += output.value;
      });
    }

    const fee = inputValue > 0 ? (inputValue - outputValue).toString() : undefined;

    return {
      hash: tx.txid,
      from: tx.vin?.[0]?.prevout?.scriptPubKey?.address,
      to: tx.vout?.[0]?.scriptPubKey?.address,
      value: outputValue.toString(),
      fee,
      success: true, // Bitcoin doesn't have failed transactions in blocks
      blockNumber: data.blockNumber,
      timestamp: data.timestamp,
      data: tx,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.rpcClient) return false;
      await this.rpcCall('getblockchaininfo');
      return true;
    } catch {
      return false;
    }
  }
}

// Factory function
export default function createBitcoinAdapter(): ChainAdapter {
  return new BitcoinAdapter();
}
