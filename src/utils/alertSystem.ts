// ============================================================================
// src/utils/alertSystem.ts
// ============================================================================

// SPDX-License-Identifier: MIT
// utils/alertSystem.ts

/**
 * @file utils/alertSystem.ts
 * @summary User-friendly alert system separate from technical logs
 * @description Provides context-aware, actionable alerts for users
 *              Different from logs which are for debugging/stats
 * 
 * @author Kombi <cenwadike@gmail.com>
 * @license MIT
 * 
 * @features
 *   • Real-time alerts via EventEmitter
 *   • Categorized alerts (Transfer, Stake, Governance, Security, etc.)
 *   • Alert levels (Info, Success, Warning, Critical)
 *   • Template-based alert creation
 *   • Alert history management (1000 max)
 *   • Read/dismiss tracking
 *   • Statistics aggregation
 */

import logger from './logger';
import EventEmitter from 'events';

// ============================================================================
// ALERT TYPES & LEVELS
// ============================================================================

export enum AlertLevel {
  INFO = 'info',        // General information (e.g., "Transfer completed")
  SUCCESS = 'success',  // Positive action (e.g., "Stake successful")
  WARNING = 'warning',  // Attention needed (e.g., "Large transfer detected")
  CRITICAL = 'critical' // Urgent action required (e.g., "Unusual activity")
}

export enum AlertCategory {
  TRANSFER = 'transfer',
  STAKE = 'stake',
  GOVERNANCE = 'governance',
  SECURITY = 'security',
  DEFI = 'defi',
  SYSTEM = 'system',
}

export interface Alert {
  id: string;                    // Unique alert ID
  level: AlertLevel;
  category: AlertCategory;
  title: string;                 // Short, clear title
  message: string;               // User-friendly description
  timestamp: number;
  chainId: string;
  metadata?: {
    amount?: string;
    from?: string;
    to?: string;
    txHash?: string;
    blockNumber?: number;
    actionUrl?: string;          // Link to block explorer
    suggestedAction?: string;    // What user should do
    email?: string;              // For user-specific alerts
    riskScore?: number;          // For security alerts
    ip?: string;                 // For security alerts
  };
  read: boolean;                 // User has acknowledged
  dismissed: boolean;
}

// ============================================================================
// ALERT TEMPLATES
// ============================================================================

const ALERT_TEMPLATES = {
  // ──────────────────────────────────────────────────────────────────────
  // TRANSFER ALERTS
  // ──────────────────────────────────────────────────────────────────────
  TRANSFER_RECEIVED: {
    level: AlertLevel.SUCCESS,
    category: AlertCategory.TRANSFER,
    title: (amount: string, token: string) => `Received ${amount} ${token}`,
    message: (amount: string, token: string, from: string, chain: string) =>
      `You received ${amount} ${token} from ${formatAddress(from)} on ${chain}`,
  },

  TRANSFER_SENT: {
    level: AlertLevel.INFO,
    category: AlertCategory.TRANSFER,
    title: (amount: string, token: string) => `Sent ${amount} ${token}`,
    message: (amount: string, token: string, to: string, chain: string) =>
      `You sent ${amount} ${token} to ${formatAddress(to)} on ${chain}`,
  },

  LARGE_TRANSFER: {
    level: AlertLevel.WARNING,
    category: AlertCategory.SECURITY,
    title: (amount: string, token: string) => `Large Transfer: ${amount} ${token}`,
    message: (amount: string, token: string, direction: string, chain: string) =>
      `A large transfer of ${amount} ${token} was ${direction} your wallet on ${chain}. If this wasn't you, check your wallet security immediately.`,
    suggestedAction: 'Review transaction details and verify this was intentional',
  },

  // ──────────────────────────────────────────────────────────────────────
  // STAKING ALERTS
  // ──────────────────────────────────────────────────────────────────────
  STAKE_SUCCESS: {
    level: AlertLevel.SUCCESS,
    category: AlertCategory.STAKE,
    title: (amount: string, token: string) => `Staked ${amount} ${token}`,
    message: (amount: string, token: string, validator: string, chain: string) =>
      `Successfully staked ${amount} ${token} with validator ${validator} on ${chain}`,
  },

  UNSTAKE_INITIATED: {
    level: AlertLevel.INFO,
    category: AlertCategory.STAKE,
    title: (amount: string, token: string) => `Unstake Initiated: ${amount} ${token}`,
    message: (amount: string, token: string, unlockDate: string, chain: string) =>
      `Unstaking ${amount} ${token} on ${chain}. Funds will be available on ${unlockDate}`,
  },

  STAKING_REWARD: {
    level: AlertLevel.SUCCESS,
    category: AlertCategory.STAKE,
    title: (amount: string, token: string) => `Reward Earned: ${amount} ${token}`,
    message: (amount: string, token: string, chain: string) =>
      `You earned ${amount} ${token} in staking rewards on ${chain}`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // GOVERNANCE ALERTS
  // ──────────────────────────────────────────────────────────────────────
  VOTE_RECORDED: {
    level: AlertLevel.INFO,
    category: AlertCategory.GOVERNANCE,
    title: (proposalId: string) => `Vote Recorded on Proposal #${proposalId}`,
    message: (proposalId: string, vote: string, chain: string) =>
      `Your vote (${vote}) has been recorded for proposal #${proposalId} on ${chain}`,
  },

  PROPOSAL_PASSED: {
    level: AlertLevel.INFO,
    category: AlertCategory.GOVERNANCE,
    title: (proposalId: string) => `Proposal #${proposalId} Passed`,
    message: (proposalId: string, chain: string) =>
      `A proposal you voted on (#${proposalId}) has been approved on ${chain}`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // SECURITY ALERTS
  // ──────────────────────────────────────────────────────────────────────
  UNUSUAL_ACTIVITY: {
    level: AlertLevel.CRITICAL,
    category: AlertCategory.SECURITY,
    title: () => 'Unusual Activity Detected',
    message: (details: string, chain: string) =>
      `Unusual activity detected on your ${chain} wallet: ${details}. Please review immediately.`,
    suggestedAction: 'Check your wallet activity and consider securing your private keys',
  },

  SLASH_DETECTED: {
    level: AlertLevel.CRITICAL,
    category: AlertCategory.SECURITY,
    title: (amount: string, token: string) => `Slashing Event: ${amount} ${token}`,
    message: (amount: string, token: string, reason: string, chain: string) =>
      `Your validator was slashed ${amount} ${token} on ${chain}. Reason: ${reason}`,
    suggestedAction: 'Contact your validator operator immediately',
  },

  // ──────────────────────────────────────────────────────────────────────
  // DEFI ALERTS
  // ──────────────────────────────────────────────────────────────────────
  SWAP_COMPLETED: {
    level: AlertLevel.SUCCESS,
    category: AlertCategory.DEFI,
    title: () => 'Swap Completed',
    message: (tokenIn: string, tokenOut: string, amountIn: string, amountOut: string, chain: string) =>
      `Swapped ${amountIn} ${tokenIn} for ${amountOut} ${tokenOut} on ${chain}`,
  },

  // ──────────────────────────────────────────────────────────────────────
  // SYSTEM ALERTS
  // ──────────────────────────────────────────────────────────────────────
  CHAIN_CONNECTED: {
    level: AlertLevel.INFO,
    category: AlertCategory.SYSTEM,
    title: (chain: string) => `Connected to ${chain}`,
    message: (chain: string) =>
      `Monitoring started for ${chain}. You'll receive alerts for configured activities.`,
  },

  CHAIN_DISCONNECTED: {
    level: AlertLevel.WARNING,
    category: AlertCategory.SYSTEM,
    title: (chain: string) => `Connection Lost: ${chain}`,
    message: (chain: string) =>
      `Lost connection to ${chain}. Attempting to reconnect automatically.`,
  },

  TRIAL_STARTED: {
    level: AlertLevel.SUCCESS,
    category: AlertCategory.SYSTEM,
    title: (tier: string) => `${tier.toUpperCase()} Trial Started`,
    message: (tier: string, endDate: string) =>
      `Your 7-day ${tier} trial is now active! Full access until ${endDate}.`,
    suggestedAction: 'Complete setup by configuring your first chain monitoring',
  },

  TRIAL_EXPIRING: {
    level: AlertLevel.WARNING,
    category: AlertCategory.SYSTEM,
    title: (daysLeft: number) => `Trial Expires in ${daysLeft} Days`,
    message: (daysLeft: number) =>
      `Your trial ends in ${daysLeft} days. Upgrade now to keep your configuration and data.`,
    suggestedAction: 'Upgrade with code TRIAL20 for 20% off',
  },

  TRIAL_EXPIRED: {
    level: AlertLevel.WARNING,
    category: AlertCategory.SYSTEM,
    title: () => 'Trial Expired',
    message: () =>
      'Your 7-day trial has ended. Upgrade to continue using Nani.',
    suggestedAction: 'Upgrade now with code COMEBACK50 for 50% off',
  },

  SUBSCRIPTION_ACTIVATED: {
    level: AlertLevel.SUCCESS,
    category: AlertCategory.SYSTEM,
    title: (tier: string) => `${tier.toUpperCase()} Subscription Activated`,
    message: (tier: string) =>
      `Welcome to Nani ${tier}! Your subscription is now active with unlimited access.`,
  },

  FRAUD_BLOCKED: {
    level: AlertLevel.WARNING,
    category: AlertCategory.SECURITY,
    title: () => 'Suspicious Activity Blocked',
    message: (reason: string) =>
      `A suspicious signup attempt was blocked: ${reason}`,
  },
};

// ============================================================================
// ALERT MANAGER
// ============================================================================

class AlertManager extends EventEmitter {
  private alerts: Map<string, Alert> = new Map();
  private alertHistory: Alert[] = [];
  private readonly MAX_HISTORY = 1000;

  /**
   * Create a new alert
   */
  async createAlert(params: {
    level: AlertLevel;
    category: AlertCategory;
    title: string;
    message: string;
    chainId: string;
    metadata?: Alert['metadata'];
  }): Promise<Alert> {
    const alert: Alert = {
      id: this.generateAlertId(),
      level: params.level,
      category: params.category,
      title: params.title,
      message: params.message,
      timestamp: Date.now(),
      chainId: params.chainId,
      metadata: params.metadata,
      read: false,
      dismissed: false,
    };

    this.alerts.set(alert.id, alert);
    this.alertHistory.unshift(alert);

    // Trim history
    if (this.alertHistory.length > this.MAX_HISTORY) {
      this.alertHistory = this.alertHistory.slice(0, this.MAX_HISTORY);
    }

    // Emit event for real-time updates
    this.emit('alert', alert);

    // Log for debugging (separate from user alerts)
    logger.info(`[ALERT] ${alert.level.toUpperCase()} - ${alert.title}`);

    return alert;
  }

  /**
   * Create alert from template
   */
  async createFromTemplate(
    templateName: keyof typeof ALERT_TEMPLATES,
    chainId: string,
    ...args: any[]
  ): Promise<Alert> {
    const template = ALERT_TEMPLATES[templateName];
    if (!template) {
      throw new Error(`Unknown alert template: ${templateName}`);
    }

    const title = typeof template.title === 'function' 
      ? (template.title as any)(...args)
      : template.title;

    const message = typeof template.message === 'function'
      ? (template.message as any)(...args)
      : template.message;

    return this.createAlert({
      level: template.level,
      category: template.category,
      title,
      message,
      chainId,
      metadata: {
        suggestedAction: (template as any).suggestedAction,
      },
    });
  }

  /**
   * Mark alert as read
   */
  markAsRead(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.read = true;
      this.emit('alertRead', alert);
      return true;
    }
    return false;
  }

  /**
   * Dismiss alert
   */
  dismiss(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.dismissed = true;
      this.emit('alertDismissed', alert);
      return true;
    }
    return false;
  }

  /**
   * Get unread alerts
   */
  getUnreadAlerts(userId?: string): Alert[] {
    return this.alertHistory.filter(a => !a.read && !a.dismissed);
  }

  /**
   * Get alerts by level
   */
  getAlertsByLevel(level: AlertLevel): Alert[] {
    return this.alertHistory.filter(a => a.level === level && !a.dismissed);
  }

  /**
   * Get alerts by category
   */
  getAlertsByCategory(category: AlertCategory): Alert[] {
    return this.alertHistory.filter(a => a.category === category && !a.dismissed);
  }

  /**
   * Get alerts by chain
   */
  getAlertsByChain(chainId: string): Alert[] {
    return this.alertHistory.filter(a => a.chainId === chainId && !a.dismissed);
  }

  /**
   * Get alert stats
   */
  getStats(): {
    total: number;
    unread: number;
    byLevel: Record<AlertLevel, number>;
    byCategory: Record<AlertCategory, number>;
  } {
    const unread = this.alertHistory.filter(a => !a.read && !a.dismissed);
    
    const byLevel = {
      [AlertLevel.INFO]: 0,
      [AlertLevel.SUCCESS]: 0,
      [AlertLevel.WARNING]: 0,
      [AlertLevel.CRITICAL]: 0,
    };

    const byCategory = {
      [AlertCategory.TRANSFER]: 0,
      [AlertCategory.STAKE]: 0,
      [AlertCategory.GOVERNANCE]: 0,
      [AlertCategory.SECURITY]: 0,
      [AlertCategory.DEFI]: 0,
      [AlertCategory.SYSTEM]: 0,
    };

    for (const alert of this.alertHistory) {
      if (!alert.dismissed) {
        byLevel[alert.level]++;
        byCategory[alert.category]++;
      }
    }

    return {
      total: this.alertHistory.filter(a => !a.dismissed).length,
      unread: unread.length,
      byLevel,
      byCategory,
    };
  }

  /**
   * Clear all dismissed alerts
   */
  clearDismissed(): void {
    this.alertHistory = this.alertHistory.filter(a => !a.dismissed);
    this.alerts.forEach((alert, id) => {
      if (alert.dismissed) {
        this.alerts.delete(id);
      }
    });
  }

  /**
   * Get all alerts (for admin/debugging)
   */
  getAllAlerts(): Alert[] {
    return [...this.alertHistory];
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatAddress(address: string): string {
  if (!address) return 'unknown';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const alertManager = new AlertManager();

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

export async function alertTransferReceived(
  amount: string,
  token: string,
  from: string,
  chainId: string,
  metadata?: Alert['metadata']
): Promise<Alert> {
  return alertManager.createFromTemplate(
    'TRANSFER_RECEIVED',
    chainId,
    amount,
    token,
    from,
    chainId
  );
}

export async function alertTransferSent(
  amount: string,
  token: string,
  to: string,
  chainId: string,
  metadata?: Alert['metadata']
): Promise<Alert> {
  return alertManager.createFromTemplate(
    'TRANSFER_SENT',
    chainId,
    amount,
    token,
    to,
    chainId
  );
}

export async function alertLargeTransfer(
  amount: string,
  token: string,
  direction: 'from' | 'to',
  chainId: string,
  metadata?: Alert['metadata']
): Promise<Alert> {
  return alertManager.createFromTemplate(
    'LARGE_TRANSFER',
    chainId,
    amount,
    token,
    direction,
    chainId
  );
}

export async function alertStakeSuccess(
  amount: string,
  token: string,
  validator: string,
  chainId: string
): Promise<Alert> {
  return alertManager.createFromTemplate(
    'STAKE_SUCCESS',
    chainId,
    amount,
    token,
    validator,
    chainId
  );
}

export async function alertStakingReward(
  amount: string,
  token: string,
  chainId: string
): Promise<Alert> {
  return alertManager.createFromTemplate(
    'STAKING_REWARD',
    chainId,
    amount,
    token,
    chainId
  );
}

export async function alertVoteRecorded(
  proposalId: string,
  vote: string,
  chainId: string
): Promise<Alert> {
  return alertManager.createFromTemplate(
    'VOTE_RECORDED',
    chainId,
    proposalId,
    vote,
    chainId
  );
}

export async function alertUnusualActivity(
  details: string,
  chainId: string
): Promise<Alert> {
  return alertManager.createFromTemplate(
    'UNUSUAL_ACTIVITY',
    chainId,
    details,
    chainId
  );
}

export async function alertChainConnected(chainId: string): Promise<Alert> {
  return alertManager.createFromTemplate(
    'CHAIN_CONNECTED',
    chainId,
    chainId
  );
}

export async function alertChainDisconnected(chainId: string): Promise<Alert> {
  return alertManager.createFromTemplate(
    'CHAIN_DISCONNECTED',
    chainId,
    chainId
  );
}

export async function alertTrialStarted(
  tier: string,
  endDate: string,
  chainId: string = 'system'
): Promise<Alert> {
  return alertManager.createFromTemplate(
    'TRIAL_STARTED',
    chainId,
    tier,
    endDate
  );
}

export async function alertTrialExpiring(
  daysLeft: number,
  chainId: string = 'system'
): Promise<Alert> {
  return alertManager.createFromTemplate(
    'TRIAL_EXPIRING',
    chainId,
    daysLeft
  );
}

export async function alertTrialExpired(
  chainId: string = 'system'
): Promise<Alert> {
  return alertManager.createFromTemplate(
    'TRIAL_EXPIRED',
    chainId
  );
}

export async function alertSubscriptionActivated(
  tier: string,
  chainId: string = 'system'
): Promise<Alert> {
  return alertManager.createFromTemplate(
    'SUBSCRIPTION_ACTIVATED',
    chainId,
    tier
  );
}

export async function alertFraudBlocked(
  reason: string,
  chainId: string = 'system'
): Promise<Alert> {
  return alertManager.createFromTemplate(
    'FRAUD_BLOCKED',
    chainId,
    reason
  );
}

export default alertManager;