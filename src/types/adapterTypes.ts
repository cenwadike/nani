// SPDX-License-Identifier: MIT
// types/chainAdapterTypes.ts

/**
 * @file types/adapterTypes.ts
 * @summary Chain adapter interface definitions for multi-chain support
 * @description Defines the contract for chain-specific adapters that handle
 *              connection management, event subscriptions, and chain-specific logic.
 */

export interface ChainEvent {
  eventName: string;
  section: string;
  method: string;
  data: any;
  blockNumber?: number;
  blockHash?: string;
  extrinsicHash?: string;
  timestamp?: number;
  raw: any; // Chain-specific raw event data
}

export interface ChainMetadata {
  name: string;
  type: 'substrate' | 'evm' | 'cosmos' | 'solana' | 'custom';
  tokenSymbol: string;
  decimals: number;
  ss58Format?: number;
  chainId?: string;
}

export interface SubscriptionOptions {
  startBlock?: number;
  endBlock?: number;
  filters?: {
    sections?: string[];
    methods?: string[];
    addresses?: string[];
  };
}

export interface ConnectionStatus {
  connected: boolean;
  endpoint: string;
  blockHeight?: number;
  reconnectAttempts: number;
  lastConnected?: Date;
  lastError?: string;
}

/**
 * Base interface that all chain adapters must implement
 */
export interface ChainAdapter {
  /** Unique identifier for this adapter */
  name: string;

  /** Human-readable adapter name */
  displayName: string;

  /** Chain type this adapter supports */
  chainType: 'bitcoin' | 'substrate' | 'evm' | 'cosmos' | 'solana' | 'custom';

  /** Supported chain identifiers (e.g., ['polkadot', 'kusama']) */
  supportedChains: string[];

  /**
   * Initialize the adapter with configuration
   * @param config Chain-specific configuration
   */
  init(config: ChainAdapterConfig): Promise<void>;

  /**
   * Connect to the chain using provided endpoints
   * @param endpoints Array of RPC endpoints with failover support
   */
  connect(endpoints: string[]): Promise<void>;

  /**
   * Disconnect from the chain and cleanup resources
   */
  disconnect(): Promise<void>;

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus;

  /**
   * Get chain metadata
   */
  getMetadata(): Promise<ChainMetadata>;

  /**
   * Subscribe to chain events with optional filtering
   * @param callback Function called for each new event
   * @param options Subscription configuration
   */
  subscribeToEvents(
    callback: (event: ChainEvent) => Promise<void>,
    options?: SubscriptionOptions
  ): Promise<() => void>; // Returns unsubscribe function

  /**
   * Query specific on-chain data (balance, storage, etc.)
   * @param query Query parameters
   */
  query(query: ChainQuery): Promise<any>;

  /**
   * Validate if an address is valid for this chain
   * @param address Address to validate
   */
  isValidAddress(address: string): boolean;

  /**
   * Format address according to chain-specific rules
   * @param address Raw address
   */
  formatAddress(address: string): string;

  /**
   * Parse chain-specific transaction/extrinsic data
   * @param data Raw transaction data
   */
  parseTransaction(data: any): ChainTransaction;

  /**
   * Health check - verify connection is alive
   */
  healthCheck(): Promise<boolean>;
}

export interface ChainAdapterConfig {
  name: string;
  adapterType: 'substrate' | 'evm' | 'cosmos' | 'solana' | 'custom';
  endpoints: string[];
  tokenSymbol: string;
  reconnectAttempts?: number;
  reconnectDelay?: number;
  timeout?: number;
  customSettings?: Record<string, any>;
  assignedWorkerId?: number;
  hrp?: string; // For Cosmos chains
}

export interface ChainQuery {
  type: 'balance' | 'storage' | 'block' | 'transaction' | 'custom';
  params: Record<string, any>;
}

export interface ChainTransaction {
  hash: string;
  from?: string;
  to?: string;
  value?: string;
  fee?: string;
  success: boolean;
  blockNumber?: number;
  timestamp?: number;
  data?: any;
}

/**
 * Factory function type for creating chain adapters
 */
export type ChainAdapterFactory = () => ChainAdapter;

/**
 * Registry entry for chain adapters
 */
export interface ChainAdapterRegistryEntry {
  adapter: ChainAdapter;
  factory: ChainAdapterFactory;
  metadata: {
    version: string;
    author?: string;
    description?: string;
  };
}
