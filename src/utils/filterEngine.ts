// SPDX-License-Identifier: MIT
// utils/filterEngine.ts

/**
 * @file utils/filterEngine.ts
 * @summary Safe, declarative filter system with NO code execution
 * @description Expression-based filters using declarative syntax
 *              100% safe - no eval(), no Function(), no arbitrary code
 *              Supports complex conditions via JSON expressions
 */

import logger from './logger';
import { ChainEvent } from '../types/adapterTypes';
import { TenantConfig } from './storage';

// ============================================================================
// SAFE FILTER TYPES - Declarative only, no code execution
// ============================================================================

export type FilterOperator = 
  | 'eq'      // equals
  | 'ne'      // not equals
  | 'gt'      // greater than
  | 'gte'     // greater than or equal
  | 'lt'      // less than
  | 'lte'     // less than or equal
  | 'in'      // value in array
  | 'notIn'   // value not in array
  | 'contains'// string contains
  | 'startsWith'
  | 'endsWith'
  | 'regex'   // regex match (safe - uses native RegExp)
  | 'between' // value between range
  | 'exists'  // field exists
  | 'and'     // logical AND
  | 'or'      // logical OR
  | 'not';    // logical NOT

export interface FilterExpression {
  op: FilterOperator;
  field?: string;           // Event field to extract
  value?: any;              // Value to compare
  values?: any[];           // Array of values (for 'in', 'between')
  conditions?: FilterExpression[]; // Nested conditions (for 'and', 'or', 'not')
  pattern?: string;         // Regex pattern (for 'regex')
  flags?: string;           // Regex flags
}

export interface FilterConfig {
  name: string;             // Filter name (e.g., "high-value-transfers")
  description?: string;
  enabled: boolean;
  expression: FilterExpression;
}

// ============================================================================
// FIELD EXTRACTORS - Safe access to event data
// ============================================================================

const FIELD_EXTRACTORS: Record<string, (event: ChainEvent, chainType: string) => any> = {
  'amount': (event, chainType) => extractAmount(event, chainType),
  'from': (event, chainType) => extractFrom(event, chainType),
  'to': (event, chainType) => extractTo(event, chainType),
  'contract': (event, chainType) => extractContract(event, chainType),
  'program': (event, chainType) => extractPrograms(event, chainType),
  'fee': (event, chainType) => extractFee(event, chainType),
  'timestamp': (event) => event.timestamp,
  'blockNumber': (event) => event.blockNumber,
  'section': (event) => event.section,
  'method': (event) => event.method,
  'eventName': (event) => event.eventName,
  'gasUsed': (event, chainType) => extractGasUsed(event, chainType),
  'success': (event, chainType) => extractSuccess(event, chainType),
  'accounts': (event, chainType) => extractAccounts(event, chainType),
};

// ============================================================================
// SAFE FILTER EVALUATION ENGINE
// ============================================================================

export async function evaluateFilter(
  expression: FilterExpression,
  event: ChainEvent,
  chainType: string,
  context: { address: string }
): Promise<boolean> {
  try {
    switch (expression.op) {
      // ──────────────────────────────────────────────────────────────────────
      // COMPARISON OPERATORS
      // ──────────────────────────────────────────────────────────────────────
      case 'eq': {
        const fieldValue = extractField(expression.field!, event, chainType, context);
        return fieldValue === expression.value;
      }

      case 'ne': {
        const fieldValue = extractField(expression.field!, event, chainType, context);
        return fieldValue !== expression.value;
      }

      case 'gt': {
        const fieldValue = extractField(expression.field!, event, chainType, context);
        return Number(fieldValue) > Number(expression.value);
      }

      case 'gte': {
        const fieldValue = extractField(expression.field!, event, chainType, context);
        return Number(fieldValue) >= Number(expression.value);
      }

      case 'lt': {
        const fieldValue = extractField(expression.field!, event, chainType, context);
        return Number(fieldValue) < Number(expression.value);
      }

      case 'lte': {
        const fieldValue = extractField(expression.field!, event, chainType, context);
        return Number(fieldValue) <= Number(expression.value);
      }

      // ──────────────────────────────────────────────────────────────────────
      // ARRAY OPERATORS
      // ──────────────────────────────────────────────────────────────────────
      case 'in': {
        const fieldValue = extractField(expression.field!, event, chainType, context);
        return expression.values?.includes(fieldValue) ?? false;
      }

      case 'notIn': {
        const fieldValue = extractField(expression.field!, event, chainType, context);
        return expression.values?.includes(fieldValue) ?? false;
      }

      case 'between': {
        const fieldValue = extractField(expression.field!, event, chainType, context);
        const [min, max] = expression.values || [0, Infinity];
        return Number(fieldValue) >= Number(min) && Number(fieldValue) <= Number(max);
      }

      // ──────────────────────────────────────────────────────────────────────
      // STRING OPERATORS
      // ──────────────────────────────────────────────────────────────────────
      case 'contains': {
        const fieldValue = String(extractField(expression.field!, event, chainType, context));
        return fieldValue.toLowerCase().includes(String(expression.value).toLowerCase());
      }

      case 'startsWith': {
        const fieldValue = String(extractField(expression.field!, event, chainType, context));
        return fieldValue.toLowerCase().startsWith(String(expression.value).toLowerCase());
      }

      case 'endsWith': {
        const fieldValue = String(extractField(expression.field!, event, chainType, context));
        return fieldValue.toLowerCase().endsWith(String(expression.value).toLowerCase());
      }

      case 'regex': {
        const fieldValue = String(extractField(expression.field!, event, chainType, context));
        const regex = new RegExp(expression.pattern!, expression.flags);
        return regex.test(fieldValue);
      }

      // ──────────────────────────────────────────────────────────────────────
      // EXISTENCE OPERATOR
      // ──────────────────────────────────────────────────────────────────────
      case 'exists': {
        const fieldValue = extractField(expression.field!, event, chainType, context);
        return fieldValue !== null && fieldValue !== undefined;
      }

      // ──────────────────────────────────────────────────────────────────────
      // LOGICAL OPERATORS
      // ──────────────────────────────────────────────────────────────────────
      case 'and': {
        if (!expression.conditions?.length) return true;
        const results = await Promise.all(
          expression.conditions.map(cond => evaluateFilter(cond, event, chainType, context))
        );
        return results.every(r => r === true);
      }

      case 'or': {
        if (!expression.conditions?.length) return false;
        const results = await Promise.all(
          expression.conditions.map(cond => evaluateFilter(cond, event, chainType, context))
        );
        return results.some(r => r === true);
      }

      case 'not': {
        if (!expression.conditions?.[0]) return false;
        return !(await evaluateFilter(expression.conditions[0], event, chainType, context));
      }

      default:
        logger.warn(`Unknown filter operator: ${expression.op}`);
        return false;
    }
  } catch (err: any) {
    logger.error(`Filter evaluation error: ${err.message}`);
    return false;
  }
}

// ============================================================================
// SAFE FIELD EXTRACTION
// ============================================================================

function extractField(
  field: string,
  event: ChainEvent,
  chainType: string,
  context: { address?: string }
): any {      
  // Special context fields
  if (field === 'user.address') return context.address;
  if (field === 'chainType') return chainType;

  // Use predefined extractors
  if (FIELD_EXTRACTORS[field]) {
    return FIELD_EXTRACTORS[field](event, chainType);
  }

  // Direct event property access (safe - no code execution)
  if (field.startsWith('data.')) {
    const index = parseInt(field.split('.')[1]);
    return event.data[index];
  }

  // Fallback to event properties
  return (event as any)[field];
}

// ============================================================================
// HELPER EXTRACTORS
// ============================================================================

function extractAmount(event: ChainEvent, chainType: string): number | null {
  try {
    switch (chainType) {
      case 'substrate':
        if (event.section === 'balances') return Number(event.data[2]) / 1e12;
        if (event.section === 'staking') return Number(event.data[1]) / 1e12;
        break;
      case 'evm':
        if (event.method === 'Transaction') return Number(BigInt(event.data[3])) / 1e18;
        break;
      case 'solana':
        if (event.method === 'Transaction') {
          const [, , , , preBalances, postBalances] = event.data;
          let totalChange = 0;
          for (let i = 0; i < preBalances.length; i++) {
            totalChange += Math.abs(postBalances[i] - preBalances[i]);
          }
          return totalChange / 1e9;
        }
        break;
      case 'cosmos':
        if (event.section === 'transfer') {
          const attrs = event.data as Array<[string, string]>;
          const amountStr = attrs.find(([k]) => k === 'amount')?.[1];
          const match = amountStr?.match(/^(\d+)/);
          return match ? parseInt(match[1]) / 1e6 : null;
        }
        break;
    }
  } catch {}
  return null;
}

function extractFrom(event: ChainEvent, chainType: string): string | null {
  try {
    if (chainType === 'substrate' && event.section === 'balances') return event.data[0];
    if (chainType === 'evm' && event.method === 'Transaction') return event.data[1];
    if (chainType === 'cosmos' && event.section === 'transfer') {
      const attrs = event.data as Array<[string, string]>;
      return attrs.find(([k]) => k === 'sender')?.[1] || null;
    }
  } catch {}
  return null;
}

function extractTo(event: ChainEvent, chainType: string): string | null {
  try {
    if (chainType === 'substrate' && event.section === 'balances') return event.data[1];
    if (chainType === 'evm' && event.method === 'Transaction') return event.data[2];
    if (chainType === 'cosmos' && event.section === 'transfer') {
      const attrs = event.data as Array<[string, string]>;
      return attrs.find(([k]) => k === 'recipient')?.[1] || null;
    }
  } catch {}
  return null;
}

function extractContract(event: ChainEvent, chainType: string): string | null {
  try {
    if (chainType === 'evm') {
      if (event.method === 'Log') return event.data[0];
      if (event.method === 'Transaction') return event.data[2];
    }
  } catch {}
  return null;
}

function extractPrograms(event: ChainEvent, chainType: string): string[] | null {
  try {
    if (chainType === 'solana' && event.method === 'Transaction') {
      return event.data[7];
    }
  } catch {}
  return null;
}

function extractFee(event: ChainEvent, chainType: string): number | null {
  try {
    if (chainType === 'evm' && event.method === 'Transaction') {
      const [, , , , , , , , , , , , , gasUsed, effectiveGasPrice] = event.data;
      if (gasUsed && effectiveGasPrice) {
        return Number(BigInt(gasUsed) * BigInt(effectiveGasPrice)) / 1e18;
      }
    }
    if (chainType === 'solana' && event.method === 'Transaction') {
      return event.data[3] / 1e9;
    }
  } catch {}
  return null;
}

function extractGasUsed(event: ChainEvent, chainType: string): number | null {
  try {
    if (chainType === 'evm' && event.method === 'Transaction') {
      return Number(event.data[13]);
    }
  } catch {}
  return null;
}

function extractSuccess(event: ChainEvent, chainType: string): boolean | null {
  try {
    if (chainType === 'evm' && event.method === 'Transaction') {
      return event.data[12] === 1;
    }
    if (chainType === 'solana' && event.method === 'Transaction') {
      return event.data[2] === null; // err field
    }
  } catch {}
  return null;
}

function extractAccounts(event: ChainEvent, chainType: string): string[] | null {
  try {
    if (chainType === 'solana' && event.method === 'Transaction') {
      return event.data[8];
    }
  } catch {}
  return null;
}

function getChainType(chainId: string): string {
  const evmChains = ['ethereum', 'polygon', 'bsc', 'avalanche', 'arbitrum', 'optimism'];
  const solanaChains = ['solana', 'solana-mainnet', 'solana-devnet'];
  const cosmosChains = ['cosmos', 'osmosis', 'juno', 'akash', 'secret'];

  if (evmChains.includes(chainId)) return 'evm';
  if (solanaChains.includes(chainId)) return 'solana';
  if (cosmosChains.includes(chainId)) return 'cosmos';
  return 'substrate';
}

// ============================================================================
// VALIDATION - Ensures filters are safe before use
// ============================================================================

export function validateFilter(expression: FilterExpression): { valid: boolean; error?: string } {
  try {
    // Check operator is valid
    const validOps: FilterOperator[] = [
      'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'notIn', 'contains',
      'startsWith', 'endsWith', 'regex', 'between', 'exists', 'and', 'or', 'not'
    ];

    if (!validOps.includes(expression.op)) {
      return { valid: false, error: `Invalid operator: ${expression.op}` };
    }

    // Validate field name (no special characters that could be exploited)
    if (expression.field && !/^[a-zA-Z0-9._]+$/.test(expression.field)) {
      return { valid: false, error: `Invalid field name: ${expression.field}` };
    }

    // Validate regex pattern (prevent ReDoS attacks)
    if (expression.op === 'regex') {
      if (!expression.pattern) {
        return { valid: false, error: 'Regex pattern required' };
      }
      // Check for catastrophic backtracking patterns
      if (/(\(.*\*.*\)\*|\(.*\+.*\)\+)/.test(expression.pattern)) {
        return { valid: false, error: 'Potentially unsafe regex pattern' };
      }
      try {
        new RegExp(expression.pattern, expression.flags);
      } catch {
        return { valid: false, error: 'Invalid regex pattern' };
      }
    }

    // Validate nested conditions recursively
    if (expression.conditions) {
      for (const cond of expression.conditions) {
        const result = validateFilter(cond);
        if (!result.valid) return result;
      }
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

export async function applyFilters(
  event: ChainEvent,
  chainId: string,
  tenantConfig: TenantConfig
): Promise<boolean> {
  const { addresses = [], monitoringMode = 'personal', filters = [] } = tenantConfig;
  const chainType = getChainType(chainId);

  // Context: use first address for {{user.address}}
  const context = addresses.length > 0 ? { address: addresses[0] } : { address: ''};

  // Auto address matching in personal mode
  if (monitoringMode === 'personal' && addresses.length > 0) {
    const from = extractFrom(event, chainType);
    const to = extractTo(event, chainType);

    if (from !== null || to !== null) {
      const involvesUser = 
        (from && addresses.includes(from)) ||
        (to && addresses.includes(to));

      if (!involvesUser) {
        logger.info(`[FILTER] Event skipped: does not involve any monitored address`);
        return false;
      }
    }
  }

  // User-defined filters
  for (const filter of filters) {
    if (!filter.enabled) continue;
    const passed = await evaluateFilter(filter.expression, event, chainType, context);
    if (!passed) {
      logger.info(`[FILTER] Event rejected by filter: ${filter.name}`);
      return false;
    }
  }

  return true;
}

export default {
  evaluateFilter,
  validateFilter,
  applyFilters,
};