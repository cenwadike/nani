// SPDX-License-Identifier: MIT
// adapters/cosmos.ts

/**
 * @file adapters/chains/cosmos.ts
 * @summary Cosmos SDK chain adapter (Osmosis, Juno, Cosmos Hub, etc.)
 * @description Fully async adapter for Cosmos ecosystem chains using WebSocket subscriptions
 *              Normalizes Cosmos events to ChainEvent format for universal plugin support
 */

import WebSocket from 'ws';
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

const MAX_RECONNECT_DELAY = 30_000;
const INITIAL_DELAY = 1_000;

export class CosmosAdapter implements ChainAdapter {
  name = 'cosmos';
  displayName = 'Cosmos SDK';
  chainType = 'cosmos' as const;
  supportedChains = [
    'cosmos',
    'cosmoshub',
    'cosmos-hub',
    'osmosis',
    'juno',
    'akash',
    'secret',
    'stargaze',
    'evmos',
    'injective',
    'celestia',
  ];

  private ws?: WebSocket;
  private httpClient?: AxiosInstance;
  private config?: ChainAdapterConfig;
  private connectionStatus: ConnectionStatus = {
    connected: false,
    endpoint: '',
    reconnectAttempts: 0,
  };
  private currentEndpointIndex = 0;
  private eventCallbacks: Array<(event: ChainEvent) => Promise<void>> = [];
  private reconnectTimeout?: NodeJS.Timeout;
  private subscriptionId?: string;
  private messageHandlers = new Map<string, (result: any) => void>();

  async init(config: ChainAdapterConfig): Promise<void> {
    this.config = config;
    logger.info(`Initializing Cosmos adapter for ${config.name}`);
  }

  async connect(endpoints: string[]): Promise<void> {
    if (!this.config) {
      throw new Error('Adapter not initialized. Call init() first.');
    }

    for (let i = 0; i < endpoints.length; i++) {
      const endpoint = endpoints[(this.currentEndpointIndex + i) % endpoints.length];

      try {
        logger.info(`Attempting connection to ${this.config.name} via ${endpoint}`);

        // Setup HTTP client for queries
        this.httpClient = axios.create({
          baseURL: endpoint,
          timeout: 30000,
        });

        // Test HTTP connection
        const nodeInfo = await this.httpClient.get('/node_info');
        logger.info(`Connected to ${nodeInfo.data.node_info.network}`);

        // Convert HTTP/HTTPS to WebSocket
        const wsEndpoint = endpoint
          .replace('https://', 'wss://')
          .replace('http://', 'ws://')
          .replace(/\/$/, '') + '/websocket';

        await this.connectWebSocket(wsEndpoint);

        this.connectionStatus = {
          connected: true,
          endpoint: wsEndpoint,
          reconnectAttempts: 0,
          lastConnected: new Date(),
        };

        this.currentEndpointIndex = (this.currentEndpointIndex + i) % endpoints.length;

        logger.info(`Connected to ${this.config.name} via ${wsEndpoint}`);
        return;

      } catch (err: any) {
        logger.error(`Connection failed for ${endpoint}: ${err.message}`);
        this.connectionStatus.lastError = err.message;
      }
    }

    throw new Error(`All endpoints failed for ${this.config.name}`);
  }

  private async connectWebSocket(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(endpoint);

      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
        this.ws?.close();
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        logger.info(`WebSocket connected: ${endpoint}`);
        this.setupEventHandlers();
        resolve();
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private setupEventHandlers(): void {
    if (!this.ws) return;

    this.ws.on('message', async (data: WebSocket.Data) => {
      try {
        const message = JSON.parse(data.toString());
        await this.handleMessage(message);
      } catch (err: any) {
        logger.error(`Error parsing Cosmos message: ${err.message}`);
      }
    });

    this.ws.on('close', () => {
      logger.warn(`WebSocket closed for ${this.config!.name}`);
      this.handleDisconnect();
    });

    this.ws.on('error', (error) => {
      logger.error(`WebSocket error for ${this.config!.name}: ${error.message}`);
    });
  }

  private async handleMessage(message: any): Promise<void> {
    // Handle query responses
    if (message.id && this.messageHandlers.has(message.id)) {
      const handler = this.messageHandlers.get(message.id);
      this.messageHandlers.delete(message.id);
      handler!(message.result);
      return;
    }

    // Handle subscription confirmation
    if (message.id === 'subscribe') {
      this.subscriptionId = message.result?.subscription;
      logger.info(`Subscribed to events with ID: ${this.subscriptionId}`);
      return;
    }

    // Handle events
    if (message.result?.data) {
      const eventType = message.result.data.type;

      if (eventType === 'tendermint/event/NewBlock') {
        const blockData = message.result.data.value;
        await this.processBlock(blockData);
      } else if (eventType === 'tendermint/event/Tx') {
        const txData = message.result.data.value;
        await this.processTransaction(txData);
      }
    }
  }

  private async processBlock(blockData: any): Promise<void> {
    const block = blockData.block;
    const blockHeight = parseInt(block.header.height);

    this.connectionStatus.blockHeight = blockHeight;

    // Emit block event
    const blockEvent: ChainEvent = {
      eventName: 'NewBlock',
      section: 'cosmos',
      method: 'NewBlock',
      data: {
        height: blockHeight,
        hash: blockData.block_id?.hash,
        time: block.header.time,
        proposer: block.header.proposer_address,
        chainId: block.header.chain_id,
        numTxs: block.data?.txs?.length || 0,
      },
      blockNumber: blockHeight,
      blockHash: blockData.block_id?.hash,
      timestamp: new Date(block.header.time).getTime(),
      raw: blockData,
    };

    await this.notifyEventCallbacks(blockEvent);

    // Extract events from block results
    const beginBlockEvents = blockData.result_begin_block?.events || [];
    const endBlockEvents = blockData.result_end_block?.events || [];

    for (const event of [...beginBlockEvents, ...endBlockEvents]) {
      const chainEvent = this.normalizeCosmosEvent(event, blockHeight);
      await this.notifyEventCallbacks(chainEvent);
    }
  }

  private async processTransaction(txData: any): Promise<void> {
    const txResult = txData.TxResult;
    const events = txResult.result?.events || [];
    const height = parseInt(txResult.height);
    const txHash = Buffer.from(txResult.tx).toString('hex').toUpperCase();

    // Emit transaction event
    const txEvent: ChainEvent = {
      eventName: 'Transaction',
      section: 'cosmos',
      method: 'Transaction',
      data: {
        hash: txHash,
        height,
        index: txResult.index,
        code: txResult.result?.code,
        gasWanted: txResult.result?.gas_wanted,
        gasUsed: txResult.result?.gas_used,
        log: txResult.result?.log,
      },
      blockNumber: height,
      extrinsicHash: txHash,
      timestamp: Date.now(),
      raw: txData,
    };

    await this.notifyEventCallbacks(txEvent);

    // Process individual events within the transaction
    for (const event of events) {
      const chainEvent = this.normalizeCosmosEvent(event, height, txHash);
      await this.notifyEventCallbacks(chainEvent);
    }
  }

  private normalizeCosmosEvent(
    event: any,
    blockHeight: number,
    txHash?: string
  ): ChainEvent {
    // Extract attributes into key-value object
    const data: Record<string, any> = {};
    if (event.attributes) {
      for (const attr of event.attributes) {
        try {
          const key = Buffer.from(attr.key, 'base64').toString('utf8');
          const value = Buffer.from(attr.value, 'base64').toString('utf8');
          data[key] = value;
        } catch {
          // If base64 decode fails, use raw values
          data[attr.key] = attr.value;
        }
      }
    }

    // Parse event type (e.g., "transfer" from "cosmos.bank.v1beta1.EventTransfer")
    const eventTypeParts = event.type.split('.');
    const section = eventTypeParts[0] || 'cosmos';
    const method = eventTypeParts[eventTypeParts.length - 1] || event.type;

    return {
      eventName: event.type,
      section,
      method,
      data,
      blockNumber: blockHeight,
      extrinsicHash: txHash,
      timestamp: Date.now(),
      raw: event,
    };
  }

  private async notifyEventCallbacks(event: ChainEvent): Promise<void> {
    await Promise.allSettled(
      this.eventCallbacks.map(callback => callback(event))
    );
  }

  private handleDisconnect(): void {
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
        await this.connect(this.config!.endpoints);
        logger.info(`Reconnected to ${this.config!.name}`);

        // Resubscribe to events
        await this.resubscribe();
      } catch (err: any) {
        logger.error(`Reconnection failed: ${err.message}`);
      }
    }, delay);
  }

  private async resubscribe(): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Subscribe to new blocks and transactions
    const subscribeMessage = {
      jsonrpc: '2.0',
      method: 'subscribe',
      id: 'subscribe',
      params: {
        query: "tm.event='NewBlock' OR tm.event='Tx'",
      },
    };

    this.ws.send(JSON.stringify(subscribeMessage));
    logger.info('Resubscribed to Cosmos events');
  }

  async disconnect(): Promise<void> {
    logger.info(`Disconnecting from ${this.config?.name}`);

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }

    this.httpClient = undefined;
    this.eventCallbacks = [];
    this.messageHandlers.clear();
    this.connectionStatus.connected = false;
  }

  getStatus(): ConnectionStatus {
    return { ...this.connectionStatus };
  }

  async getMetadata(): Promise<ChainMetadata> {
    if (!this.httpClient) {
      throw new Error('Not connected');
    }

    const nodeInfo = await this.httpClient.get('/node_info');

    return {
      name: this.config!.name,
      type: 'cosmos',
      tokenSymbol: this.config!.tokenSymbol,
      decimals: 6, // Standard for most Cosmos chains (uatom, uosmo, etc.)
      chainId: nodeInfo.data.node_info.network,
    };
  }

  async subscribeToEvents(
    callback: (event: ChainEvent) => Promise<void>,
    options?: SubscriptionOptions
  ): Promise<() => void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    logger.info(`Subscribing to events on ${this.config!.name}`);

    this.eventCallbacks.push(callback);

    // Subscribe to Tendermint events
    await this.resubscribe();

    // Return unsubscribe function
    return () => {
      const index = this.eventCallbacks.indexOf(callback);
      if (index > -1) {
        this.eventCallbacks.splice(index, 1);
      }
    };
  }

  async query(query: ChainQuery): Promise<any> {
    if (!this.httpClient) throw new Error('Not connected');

    switch (query.type) {
      case 'balance': {
        const { address } = query.params;
        const response = await this.httpClient.get(
          `/cosmos/bank/v1beta1/balances/${address}`
        );
        return response.data;
      }

      case 'block': {
        const height = query.params.blockNumber || 'latest';
        const response = await this.httpClient.get(`/block?height=${height}`);
        return response.data;
      }

      case 'transaction': {
        const { hash } = query.params;
        const response = await this.httpClient.get(`/tx?hash=0x${hash}`);
        return response.data;
      }

      case 'custom': {
        const { method, params = [] } = query.params;
        
        // Support WebSocket RPC calls
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          return new Promise((resolve, reject) => {
            const id = `query-${Date.now()}`;
            
            const timeout = setTimeout(() => {
              this.messageHandlers.delete(id);
              reject(new Error('Query timeout'));
            }, 10000);

            this.messageHandlers.set(id, (result) => {
              clearTimeout(timeout);
              resolve(result);
            });

            this.ws!.send(JSON.stringify({
              jsonrpc: '2.0',
              method,
              params,
              id,
            }));
          });
        }
        
        throw new Error('WebSocket not connected for custom queries');
      }

      default:
        throw new Error(`Unsupported query type: ${query.type}`);
    }
  }

  isValidAddress(address: string): boolean {
    // Cosmos addresses: prefix (3-5 chars) + '1' + bech32 encoded (38 chars)
    // Examples: cosmos1..., osmo1..., juno1...
    return /^[a-z]{2,5}1[a-z0-9]{38,59}$/.test(address);
  }

  formatAddress(address: string): string {
    return address; // Cosmos addresses don't need formatting
  }

  parseTransaction(data: any): ChainTransaction {
    const txResult = data.TxResult || data.tx_result || data;
    
    return {
      hash: data.hash || Buffer.from(txResult.tx).toString('hex'),
      from: data.tx?.auth_info?.signer_infos?.[0]?.public_key?.key,
      success: txResult.result?.code === 0,
      blockNumber: parseInt(data.height || txResult.height || '0'),
      timestamp: data.timestamp,
      fee: data.tx?.auth_info?.fee?.amount?.[0]?.amount,
      data: data.tx || txResult.tx,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (!this.httpClient) return false;
      await this.httpClient.get('/health');
      return true;
    } catch {
      // Try alternative health check
      try {
        if (!this.httpClient) return false;
        await this.httpClient.get('/node_info');
        return true;
      } catch {
        return false;
      }
    }
  }
}

// Factory function
export default function createCosmosAdapter(): ChainAdapter {
  return new CosmosAdapter();
}
