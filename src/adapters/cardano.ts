// SPDX-License-Identifier: MIT
// adapters/cardano.ts

/**
 * @file adapters/chains/cardano.ts
 * @summary Cardano blockchain adapter using UTxORPC and Blockfrost
 * @description Implements ChainAdapter interface for Cardano blockchain
 *              using UTxORPC gRPC protocol for real-time events and
 *              Blockfrost REST API for historical queries and indexing.
 */

import {
  CardanoSyncClient,
  CardanoQueryClient,
  CardanoWatchClient,
} from '@utxorpc/sdk';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';
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
import config from '../config';

const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_DELAY = 1_000;
const CONNECTION_TIMEOUT = 60_000;

export class CardanoAdapter implements ChainAdapter {
  name = 'cardano';
  displayName = 'Cardano';
  chainType = 'utxo' as const;
  supportedChains = ['cardano', 'cardano-mainnet', 'cardano-preprod', 'cardano-preview', 'vector'];

  private syncClient?: CardanoSyncClient;
  private queryClient?: CardanoQueryClient;
  private watchClient?: CardanoWatchClient;
  private blockfrostClient?: BlockFrostAPI;
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
    logger.info(`Initializing Cardano adapter for ${config.name}`);

    // Initialize UTxORPC headers
    if (config.customSettings?.apiKey) {
      this.headers = { 'dmtr-api-key': config.customSettings.apiKey };
    }

    // Initialize Blockfrost client for indexing and historical queries
    this.initializeBlockfrost();
  }

  private initializeBlockfrost(): void {
    const blockfrostConfig = config.blockfrostConfig;
    
    if (!blockfrostConfig) {
      logger.warn('No Blockfrost configuration found, some query features will be limited');
      return;
    }

    try {
      this.blockfrostClient = new BlockFrostAPI({
        customBackend: blockfrostConfig.customBackend,
        network: blockfrostConfig.network as any,
        gotOptions: blockfrostConfig.gotOptions,
      });
      logger.info('Blockfrost indexer initialized successfully');
    } catch (err: any) {
      logger.error(`Failed to initialize Blockfrost: ${err.message}`);
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
        this.watchClient = new CardanoWatchClient(clientConfig);

        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection timeout')), CONNECTION_TIMEOUT)
        );

        await Promise.race([
          this.queryClient.readParams(),
          timeoutPromise
        ]);

        const tip = await this.syncClient.readTip();
        const blockHeight = typeof tip.slot === 'string' ? parseInt(tip.slot) : tip.slot;

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

        // Verify Blockfrost connection if configured
        if (this.blockfrostClient) {
          await this.verifyBlockfrostConnection();
        }

        return;

      } catch (err: any) {
        logger.error(`Connection failed for ${endpoint}: ${err.message}`);
        this.connectionStatus.lastError = err.message;
        
        this.syncClient = undefined;
        this.queryClient = undefined;
        this.watchClient = undefined;
      }
    }

    throw new Error(`All endpoints failed for ${this.config.name}`);
  }

  private async verifyBlockfrostConnection(): Promise<void> {
    try {
      if (!this.blockfrostClient) return;
      
      const health = await this.blockfrostClient.health();
      logger.info(`Blockfrost health check: ${health.is_healthy ? 'healthy' : 'unhealthy'}`);
    } catch (err: any) {
      logger.warn(`Blockfrost health check failed: ${err.message}`);
    }
  }

  private handleDisconnect(endpoints: string[]): void {
    if (this.isReconnecting) {
      return;
    }

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
    logger.info('Resubscribing to Cardano events after reconnection');
    
    if (this.eventCallbacks.length === 0) {
      return;
    }

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
      tokenSymbol: this.config!.tokenSymbol || 'ADA',
      decimals: 6,
      chainId: this.config!.name,
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
        if (signal.aborted) {
          break;
        }

        if (event.action === 'apply' && event.block) {
          const block = event.block;
          const slot = typeof block.header?.slot === 'string' 
            ? parseInt(block.header.slot) 
            : (block.header?.slot || 0);

          this.connectionStatus.blockHeight = slot;

          const chainEvent: ChainEvent = {
            eventName: 'NewBlock',
            section: 'cardano',
            method: 'NewBlock',
            data: {
              slot,
              hash: block.header?.hash?.toString('hex'),
              height: block.header?.height || 0,
              prevHash: block.header?.prevHash?.toString('hex'),
              issuerVkey: block.header?.issuerVkey?.toString('hex'),
              txCount: block.body?.tx?.length || 0,
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
            : event.block?.header?.slot;
          logger.warn(`Block rollback detected at slot ${slot}`);
          
          const chainEvent: ChainEvent = {
            eventName: 'Rollback',
            section: 'cardano',
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
        if (signal.aborted) {
          break;
        }

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

      const chainEvent: ChainEvent = {
        eventName: 'Transaction',
        section: 'cardano',
        method: 'Transaction',
        data: {
          hash: txHash,
          inputs: tx.inputs?.length || 0,
          outputs: tx.outputs?.length || 0,
          fee: tx.fee?.toString() || '0',
          ttl: tx.ttl,
          withdrawals: tx.withdrawals?.length || 0,
          certificates: tx.certificates?.length || 0,
          mint: tx.mint ? Object.keys(tx.mint).length : 0,
          scriptDataHash: tx.scriptDataHash?.toString('hex'),
          watchedAddress,
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

      case 'block': {
        return await this.queryBlock(query.params);
      }

      case 'transaction': {
        return await this.queryTransaction(query.params);
      }

      case 'custom': {
        return await this.queryCustom(query.params);
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

    // Try UTxORPC first for real-time data
    try {
      const addressBytes = this.addressToBytes(address);
      const utxos = await this.queryClient!.searchUtxosByAddress(addressBytes);
      
      let totalLovelace = BigInt(0);
      const utxoList = [];

      for (const utxo of utxos) {
        if (utxo.parsedValued) {
          const output = utxo.parsedValued as any;
          if (output.amount?.coin) {
            const coinValue = BigInt(output.amount.coin);
            totalLovelace += coinValue;
          }
          utxoList.push({
            txHash: utxo.txoRef?.hash.toString(),      
            outputIndex: utxo.txoRef?.index,
            value: output.amount?.coin?.toString(),
            address: output.address,
            datum: output.datum,
            assets: output.amount?.multiasset,
          });
        }
      }

      return { 
        balance: totalLovelace.toString(), 
        utxos: utxoList,
        utxoCount: utxoList.length 
      };
    } catch (err: any) {
      // Fallback to Blockfrost if UTxORPC fails
      if (this.blockfrostClient) {
        logger.warn('UTxORPC balance query failed, falling back to Blockfrost');
        return await this.queryBalanceBlockfrost(address);
      }
      throw err;
    }
  }

  private async queryBalanceBlockfrost(address: string): Promise<any> {
    if (!this.blockfrostClient) {
      throw new Error('Blockfrost not configured');
    }

    const addressInfo = await this.blockfrostClient.addresses(address);
    const utxos = await this.blockfrostClient.addressesUtxos(address);

    return {
      balance: addressInfo.amount.find((a: any) => a.unit === 'lovelace')?.quantity || '0',
      utxos: utxos.map((utxo: any) => ({
        txHash: utxo.tx_hash,
        outputIndex: utxo.output_index,
        value: utxo.amount.find((a: any) => a.unit === 'lovelace')?.quantity || '0',
        address: utxo.address,
        assets: utxo.amount.filter((a: any) => a.unit !== 'lovelace'),
      })),
      utxoCount: utxos.length,
      stakeAddress: addressInfo.stake_address,
    };
  }

  private async queryBlock(params: any): Promise<any> {
    const { blockNumber, blockHash } = params;
    
    if (!this.blockfrostClient) {
      throw new Error('Block queries require Blockfrost indexer configuration');
    }

    const identifier = blockHash || blockNumber;
    if (!identifier) {
      throw new Error('Either blockNumber or blockHash is required');
    }

    const block = await this.blockfrostClient.blocks(identifier);
    const blockTxs = await this.blockfrostClient.blocksTxs(identifier);

    return {
      hash: block.hash,
      height: block.height,
      slot: block.slot,
      epoch: block.epoch,
      epochSlot: block.epoch_slot,
      slotLeader: block.slot_leader,
      size: block.size,
      txCount: block.tx_count,
      time: block.time,
      previousBlock: block.previous_block,
      nextBlock: block.next_block,
      confirmations: block.confirmations,
      transactions: blockTxs,
    };
  }

  private async queryTransaction(params: any): Promise<any> {
    const { hash } = params;
    
    if (!hash) {
      throw new Error('Transaction hash is required');
    }

    if (!this.blockfrostClient) {
      throw new Error('Transaction queries require Blockfrost indexer configuration');
    }

    const tx = await this.blockfrostClient.txs(hash);
    const txUtxos = await this.blockfrostClient.txsUtxos(hash);
    
    let txMetadata: Array<{ label: string; json_metadata: any }> = []; 

    try {
        txMetadata = await this.blockfrostClient.txsMetadata(hash);
    } catch {
        txMetadata = [];  
    }

    return {
      hash: tx.hash,
      block: tx.block,
      blockHeight: tx.block_height,
      slot: tx.slot,
      index: tx.index,
      fees: tx.fees,
      size: tx.size,
      invalidBefore: tx.invalid_before,
      invalidHereafter: tx.invalid_hereafter,
      validContract: tx.valid_contract,
      inputs: txUtxos.inputs.map((input: any) => ({
        address: input.address,
        amount: input.amount,
        txHash: input.tx_hash,
        outputIndex: input.output_index,
      })),
      outputs: txUtxos.outputs.map((output: any) => ({
        address: output.address,
        amount: output.amount,
        outputIndex: output.output_index,
      })),
      metadata: txMetadata,
    };
  }

  private async queryCustom(params: any): Promise<any> {
    const { method, params: methodParams = [] } = params;
    if (!method) {
      throw new Error('Method is required for custom query');
    }

    // Check if it's a Blockfrost method
    if (method.startsWith('blockfrost.')) {
      if (!this.blockfrostClient) {
        throw new Error('Blockfrost not configured');
      }

      const methodName = method.replace('blockfrost.', '');
      if (typeof (this.blockfrostClient as any)[methodName] !== 'function') {
        throw new Error(`Blockfrost method ${methodName} not available`);
      }

      return await (this.blockfrostClient as any)[methodName](...methodParams);
    }

    // Otherwise assume it's a UTxORPC method
    if (typeof (this.queryClient as any)[method] !== 'function') {
      throw new Error(`Method ${method} not available on query client`);
    }

    return await (this.queryClient as any)[method](...methodParams);
  }

  private addressToBytes(address: string): Uint8Array<ArrayBuffer> {
    try {
      if (!address || typeof address !== 'string') {
        throw new Error('Invalid address format');
      }

      if (address.startsWith('addr') || address.startsWith('stake')) {
        const decoded = bech32.bech32.decode(address, 1000);
        const words = decoded.words;
        const bytes = bech32.bech32.fromWords(words);
        
        const arrayBuffer = new ArrayBuffer(bytes.length);
        const uint8Array = new Uint8Array(arrayBuffer);
        uint8Array.set(bytes);
        return uint8Array;
      }

      if (/^[0-9a-fA-F]+$/.test(address)) {
        const buffer = Buffer.from(address, 'hex');
        const arrayBuffer = new ArrayBuffer(buffer.length);
        const uint8Array = new Uint8Array(arrayBuffer);
        uint8Array.set(buffer);
        return uint8Array;
      }

      throw new Error('Address must be bech32 encoded or hex string');
    } catch (err: any) {
      throw new Error(`Invalid Cardano address: ${err.message}`);
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
      // Check UTxORPC connection
      if (!this.queryClient || !this.syncClient) {
        return false;
      }

      await this.queryClient.readParams();
      await this.syncClient.readTip();

      // Check Blockfrost if configured
      if (this.blockfrostClient) {
        const health = await this.blockfrostClient.health();
        if (!health.is_healthy) {
          logger.warn('Blockfrost health check failed');
        }
      }

      return true;
    } catch (err: any) {
      logger.warn(`Health check failed: ${err.message}`);
      return false;
    }
  }
}

export default function createCardanoAdapter(): ChainAdapter {
  return new CardanoAdapter();
}