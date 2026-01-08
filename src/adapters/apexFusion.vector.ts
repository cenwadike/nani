// SPDX-License-Identifier: MIT
// adapters/apexVector.ts

/**
 * @file adapters/chains/apexVector.ts
 * @summary Apex Fusion Vector (Layer 2) blockchain adapter using UTxORPC
 * @description Production-ready ChainAdapter implementation for Apex Fusion Vector L2.
 *              Fully aligned with ApexPrimeAdapter in robustness, reconnection, stream handling,
 *              error resilience, and event fidelity. Supports real-time block/tip following,
 *              address transaction watching, balance queries, and rollback detection.
 */

import {
  CardanoSyncClient,
  CardanoQueryClient,
  CardanoSubmitClient,
  CardanoWatchClient,
} from '@utxorpc/sdk';
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
import * as bech32 from 'bech32';

const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_DELAY = 1_000;
const CONNECTION_TIMEOUT = 60_000;

export class ApexVectorAdapter implements ChainAdapter {
  name = 'apex-vector';
  displayName = 'Apex Fusion Vector';
  chainType = 'utxo' as const;
  supportedChains = ['apex-vector', 'apex-fusion-vector', 'vector-mainnet', 'vector-testnet'];

  private syncClient?: CardanoSyncClient;
  private queryClient?: CardanoQueryClient;
  private submitClient?: CardanoSubmitClient;
  private watchClient?: CardanoWatchClient;
  private config?: ChainAdapterConfig;
  private connectionStatus: ConnectionStatus = {
    connected: false,
    endpoint: '',
    reconnectAttempts: 0,
  };
  private currentEndpointIndex = 0;
  private eventCallbacks: Array<(event: ChainEvent) => Promise<void>> = [];
  private activeStreams: Array<{ stream: AsyncIterable<any>; controller: AbortController }> = [];
  private reconnectTimeout?: NodeJS.Timeout;
  private headers?: { [key: string]: string };
  private isReconnecting = false;

  async init(config: ChainAdapterConfig): Promise<void> {
    this.config = config;
    logger.info(`Initializing Apex Fusion Vector adapter for ${config.name}`);

    if (config.customSettings?.apiKey) {
      this.headers = { 'dmtr-api-key': config.customSettings.apiKey };
    }
  }

  async connect(endpoints: string[]): Promise<void> {
    if (!this.config) {
      throw new Error('Adapter not initialized. Call init() first.');
    }

    if (endpoints.length === 0) {
      throw new Error('No endpoints provided for connection');
    }

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[(this.currentEndpointIndex + i) % endpoints.length];

      try {
        logger.info(`Attempting connection to ${this.config.name} via ${endpoint}`);

        const clientConfig = {
          uri: endpoint,
          headers: this.headers,
        };

        this.syncClient = new CardanoSyncClient(clientConfig);
        this.queryClient = new CardanoQueryClient(clientConfig);
        this.submitClient = new CardanoSubmitClient(clientConfig);
        this.watchClient = new CardanoWatchClient(clientConfig);

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), CONNECTION_TIMEOUT)
        );

        await Promise.race([
          this.queryClient.readParams(),
          timeoutPromise,
        ]);

        const tip = await this.syncClient.readTip();
        const blockHeight = typeof tip.slot === 'string' ? parseInt(tip.slot) : tip.slot || 0;

        this.connectionStatus = {
          connected: true,
          endpoint,
          reconnectAttempts: 0,
          lastConnected: new Date(),
          blockHeight,
        };

        this.currentEndpointIndex = (this.currentEndpointIndex + i) % endpoints.length;

        logger.info(`Connected to ${this.config.name} via ${endpoint}`);
        logger.info(`Network parameters loaded, current slot: ${blockHeight}`);

        return;
      } catch (err: any) {
        logger.error(`Connection failed for ${endpoint}: ${err.message}`);
        this.connectionStatus.lastError = err.message;

        this.syncClient = undefined;
        this.queryClient = undefined;
        this.submitClient = undefined;
        this.watchClient = undefined;
      }
    }

    throw new Error(`All endpoints failed for ${this.config.name}`);
  }

  private handleDisconnect(endpoints: string[]): void {
    if (this.isReconnecting) return;

    this.isReconnecting = true;
    logger.warn(`Lost connection to ${this.config!.name}`);
    this.connectionStatus.connected = false;
    this.connectionStatus.reconnectAttempts++;

    const delay = Math.min(
      INITIAL_DELAY * Math.pow(2, this.connectionStatus.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY
    );

    logger.info(`Attempting reconnection in ${delay}ms (attempt ${this.connectionStatus.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect(endpoints);
        logger.info(`Reconnected to ${this.config!.name}`);
        this.isReconnecting = false;
        await this.resubscribeAll();
      } catch (err: any) {
        logger.error(`Reconnection failed: ${err.message}`);
        this.isReconnecting = false;
        this.handleDisconnect(endpoints);
      }
    }, delay);
  }

  private async resubscribeAll(): Promise<void> {
    logger.info('Resubscribing to Apex Vector events after reconnection');
    logger.warn('Event resubscription requires caller to re-establish subscriptions');
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting from ${this.config?.name}`);

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    for (const { stream, controller } of this.activeStreams) {
      try {
        controller.abort();
        const iterator = stream[Symbol.asyncIterator]();
        if (iterator.return) {
          await iterator.return();
        }
      } catch (err: any) {
        logger.warn(`Stream cleanup error: ${err.message}`);
      }
    }

    this.activeStreams = [];
    this.eventCallbacks = [];
    this.syncClient = undefined;
    this.queryClient = undefined;
    this.submitClient = undefined;
    this.watchClient = undefined;
    this.connectionStatus.connected = false;
    this.isReconnecting = false;
  }

  getStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  async getMetadata(): Promise<ChainMetadata> {
    if (!this.queryClient) {
      throw new Error('Not connected');
    }

    return {
      name: this.config!.name,
      type: 'utxo',
      tokenSymbol: this.config!.tokenSymbol || 'AP3X',
      decimals: 6,
      chainId: 'apex-vector',
    };
  }

  async subscribeToEvents(
    callback: (event: ChainEvent) => Promise<void>,
    options?: SubscriptionOptions
  ): Promise<() => void> {
    if (!this.syncClient || !this.watchClient) {
      throw new Error('Not connected');
    }

    logger.info(`Subscribing to events on ${this.config!.name}`);
    this.eventCallbacks.push(callback);

    const startPoint = options?.startBlock
      ? [{ slot: options.startBlock, hash: '' }]
      : undefined;

    const tipController = new AbortController();
    const tipStream = this.syncClient.followTip(startPoint);
    this.activeStreams.push({ stream: tipStream, controller: tipController });

    this.processTipStream(tipStream, tipController.signal).catch(err => {
      if (!tipController.signal.aborted) {
        logger.error(`Tip stream error: ${err.message}`);
        this.handleDisconnect(this.config!.endpoints || []);
      }
    });

    if (options?.filters?.addresses) {
      for (const address of options.filters.addresses) {
        try {
          const addressBytes = this.addressToBytes(address);

          const txController = new AbortController();
          const txStream = this.watchClient.watchTxForAddress(addressBytes);
          this.activeStreams.push({ stream: txStream, controller: txController });

          this.processTxStream(txStream, address, txController.signal).catch(err => {
            if (!txController.signal.aborted) {
              logger.error(`Transaction stream error for ${address}: ${err.message}`);
            }
          });

          logger.info(`Watching transactions for address: ${address}`);
        } catch (err: any) {
          logger.error(`Failed to watch address ${address}: ${err.message}`);
        }
      }
    }

    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index > -1) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  private async processTipStream(stream: AsyncIterable<any>, signal: AbortSignal): Promise<void> {
    try {
      for await (const event of stream) {
        if (signal.aborted) break;

        if (event.action === 'apply' && event.block) {
          const block = event.block;
          const slot = typeof block.header?.slot === 'string'
            ? parseInt(block.header.slot)
            : (block.header?.slot || 0);

          this.connectionStatus.blockHeight = slot;

          const chainEvent: ChainEvent = {
            eventName: 'NewBlock',
            section: 'apex-vector',
            method: 'NewBlock',
            data: {
              slot,
              hash: block.header?.hash?.toString('hex'),
              height: block.header?.height || 0,
              prevHash: block.header?.prevHash?.toString('hex'),
              issuerVkey: block.header?.issuerVkey?.toString('hex'),
              txCount: block.body?.tx?.length || 0,
              layer: 2,
              parentChain: 'apex-prime',
            },
            blockNumber: slot,
            blockHash: block.header?.hash?.toString('hex'),
            timestamp: Date.now(),
            raw: block,
          };

          await this.notifyEventCallbacks(chainEvent);

          if (block.body?.tx) {
            for (const tx of block.body.tx) {
              if (signal.aborted) break;
              await this.processTx(tx, slot);
            }
          }
        } else if (event.action === 'undo') {
          const slot = typeof event.block?.header?.slot === 'string'
            ? parseInt(event.block.header.slot)
            : event.block?.header?.slot || 0;

          logger.warn(`Block rollback detected at slot ${slot}`);

          const chainEvent: ChainEvent = {
            eventName: 'Rollback',
            section: 'apex-vector',
            method: 'Rollback',
            data: {
              slot,
              hash: event.block?.header?.hash?.toString('hex'),
            },
            blockNumber: slot,
            blockHash: event.block?.header?.hash?.toString('hex'),
            timestamp: Date.now(),
            raw: event.block,
          };

          await this.notifyEventCallbacks(chainEvent);
        }
      }
    } catch (err: any) {
      if (!signal.aborted) {
        logger.error(`Tip stream processing error: ${err.message}`);
        throw err;
      }
    }
  }

  private async processTxStream(stream: AsyncIterable<any>, address: string, signal: AbortSignal): Promise<void> {
    try {
      for await (const event of stream) {
        if (signal.aborted) break;

        if (event.action === 'apply' && event.Tx) {
          await this.processTx(event.Tx, 0, address);
        }
      }
    } catch (err: any) {
      if (!signal.aborted) {
        logger.error(`Transaction stream processing error: ${err.message}`);
        throw err;
      }
    }
  }

  private async processTx(tx: any, slot: number, watchedAddress?: string): Promise<void> {
    try {
      const txHash = tx.hash?.toString('hex') || '';
      const hasSmartContract = tx.scriptDataHash !== undefined;

      const chainEvent: ChainEvent = {
        eventName: hasSmartContract ? 'SmartContractTransaction' : 'Transaction',
        section: 'apex-vector',
        method: hasSmartContract ? 'SmartContractTransaction' : 'Transaction',
        data: {
          hash: txHash,
          inputs: tx.inputs?.length || 0,
          outputs: tx.outputs?.length || 0,
          fee: tx.fee?.toString() || '0',
          ttl: tx.ttl,
          withdrawals: tx.withdrawals?.length || 0,
          certificates: tx.certificates?.length || 0,
          certificateTypes: tx.certificates?.map((cert: any) => cert.type || 'unknown') || [],
          mint: tx.mint ? Object.keys(tx.mint).length : 0,
          scriptDataHash: tx.scriptDataHash?.toString('hex'),
          watchedAddress,
          hasSmartContract,
          layer: 2,
        },
        blockNumber: slot,
        extrinsicHash: txHash,
        timestamp: Date.now(),
        raw: tx,
      };

      await this.notifyEventCallbacks(chainEvent);
    } catch (err: any) {
      logger.error(`Error processing transaction: ${err.message}`);
    }
  }

  private async notifyEventCallbacks(event: ChainEvent): Promise<void> {
    const results = await Promise.allSettled(
      this.eventCallbacks.map(callback => callback(event))
    );

    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.error(`Event callback ${index} failed: ${result.reason}`);
      }
    });
  }

  async query(query: ChainQuery): Promise<any> {
    if (!this.queryClient) {
      throw new Error('Not connected');
    }

    switch (query.type) {
      case 'balance': {
        return await this.queryBalance(query.params);
      }

      case 'custom': {
        const { method, params = [] } = query.params;
        if (typeof (this.queryClient as any)[method] !== 'function') {
          throw new Error(`Method ${method} not available on query client`);
        }
        return await (this.queryClient as any)[method](...params);
      }

      default:
        throw new Error(`Unsupported query type: ${query.type}`);
    }
  }

  private async queryBalance(params: any): Promise<any> {
    const { address } = params;
    if (!address) {
      throw new Error('Address parameter is required for balance query');
    }

    try {
      const addressBytes = this.addressToBytes(address);
      const utxos = await this.queryClient!.searchUtxosByAddress(addressBytes);

      let totalAP3X = BigInt(0);
      const utxoList: any[] = [];

      for (const utxo of utxos) {
        if (utxo.parsedValued) {
          const output = utxo.parsedValued as any;

          if (output.amount?.coin) {
            totalAP3X += BigInt(output.amount.coin);
          }

          utxoList.push({
            txHash: utxo.txoRef?.hash ? Buffer.from(utxo.txoRef.hash).toString('hex') : '',
            outputIndex: utxo.txoRef?.index ?? 0,
            value: output.amount?.coin?.toString() ?? '0',
            address: output.address ?? '',
            datum: output.datum,
            assets: output.amount?.multiasset,
          });
        }
      }

      return {
        balance: totalAP3X.toString(),
        utxos: utxoList,
        utxoCount: utxoList.length,
      };
    } catch (err: any) {
      throw new Error(`Balance query failed: ${err.message}`);
    }
  }

    private addressToBytes(address: string): Uint8Array<ArrayBuffer> {
        try {
            if (!address || typeof address !== 'string') {
                throw new Error('Invalid address format');
            }

            let bytes: number[] = [];

            if (address.startsWith('addr') || address.startsWith('stake')) {
                const decoded = bech32.bech32.decode(address, 1000);
                bytes = bech32.bech32.fromWords(decoded.words);
            } else if (/^[0-9a-fA-F]+$/.test(address)) {
                const buffer = Buffer.from(address, 'hex');
                bytes = Array.from(buffer);
            } else {
                throw new Error('Address must be Bech32 encoded or hex string');
            }

            // Force strict ArrayBuffer (copies data – safe and fixes type error)
            const arrayBuffer = new ArrayBuffer(bytes.length);
            const uint8Array = new Uint8Array(arrayBuffer);
            uint8Array.set(bytes);
            return uint8Array;

        } catch (err: any) {
            throw new Error(`Invalid Apex Prime address: ${err.message}`);
        }
    }

  isValidAddress(address: string): boolean {
    if (!address || typeof address !== 'string') {
      return false;
    }

    return /^(addr|addr_test|stake|stake_test)1[a-z0-9]{53,}$/.test(address);
  }

  formatAddress(address: string): string {
    return address;
  }

  parseTransaction(data: any): ChainTransaction {
    const tx = data.Tx || data.transaction || data;

    const inputAddress = tx.inputs?.[0]?.address;
    const outputAddress = tx.outputs?.[0]?.address;
    const outputValue = tx.outputs?.[0]?.amount?.coin?.toString() || '0';

    return {
      hash: tx.hash?.toString('hex') || '',
      from: inputAddress,
      to: outputAddress,
      value: outputValue,
      fee: tx.fee?.toString() || '0',
      success: true,
      blockNumber: data.slot,
      timestamp: data.timestamp,
      data: tx,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.queryClient || !this.syncClient) {
        return false;
      }

      await this.queryClient.readParams();
      await this.syncClient.readTip();

      return true;
    } catch (err: any) {
      logger.warn(`Health check failed: ${err.message}`);
      return false;
    }
  }
}

export default function createApexVectorAdapter(): ChainAdapter {
  return new ApexVectorAdapter();
}