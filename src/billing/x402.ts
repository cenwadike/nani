import { ethers } from 'ethers';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import logger from '../utils/logger';
import storage from '../utils/storage';

// ——————————————————————————————————————
// X402 PAYMENT CONFIGURATION
// ——————————————————————————————————————

export interface X402Config {
  // EVM chains (Ethereum, Polygon, Base, etc.)
  evm: {
    enabled: boolean;
    chains: {
      ethereum: { chainId: number; usdcAddress: string; rpcUrl: string };
      polygon: { chainId: number; usdcAddress: string; rpcUrl: string };
      base: { chainId: number; usdcAddress: string; rpcUrl: string };
      arbitrum: { chainId: number; usdcAddress: string; rpcUrl: string };
      optimism: { chainId: number; usdcAddress: string; rpcUrl: string };
    };
    recipientAddress: string;
  };
  // Solana
  solana: {
    enabled: boolean;
    rpcUrl: string;
    usdcMint: string;
    recipientAddress: string;
  };
  // Pricing per feature (in USDC)
  pricing: {
    aiAnalyticsQuery: string; // $0.05
    advancedAnalyticsQuery: string; // $0.001
    dataExport: string; // $0.01
    customFilter: string; // $0.001
  };
}

export const X402_CONFIG: X402Config = {
  evm: {
    enabled: true,
    chains: {
      ethereum: {
        chainId: 1,
        usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com'
      },
      polygon: {
        chainId: 137,
        usdcAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com'
      },
      base: {
        chainId: 8453,
        usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org'
      },
      arbitrum: {
        chainId: 42161,
        usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
        rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'
      },
      optimism: {
        chainId: 10,
        usdcAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io'
      }
    },
    recipientAddress: process.env.X402_EVM_RECIPIENT || ''
  },
  solana: {
    enabled: true,
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    recipientAddress: process.env.X402_SOLANA_RECIPIENT || ''
  },
  pricing: {
    aiAnalyticsQuery: '0.05', // $0.05 per AI query
    advancedAnalyticsQuery: '0.001', // $0.001 per advanced query
    dataExport: '0.01', // $0.01 per export
    customFilter: '0.001' // $0.001 per custom filter execution
  }
};

// ——————————————————————————————————————
// PAYMENT PROOF INTERFACE
// ——————————————————————————————————————

export interface X402PaymentProof {
  chain: 'ethereum' | 'polygon' | 'base' | 'arbitrum' | 'optimism' | 'solana';
  txHash: string;
  from: string;
  to: string;
  amount: string;
  timestamp: number;
  feature: string;
  verified: boolean;
}

// ——————————————————————————————————————
// EVM PAYMENT VERIFICATION
// ——————————————————————————————————————

export async function verifyEvmPayment(
  proof: Omit<X402PaymentProof, 'verified'>,
  requiredAmount: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const chainConfig = X402_CONFIG.evm.chains[proof.chain as keyof typeof X402_CONFIG.evm.chains];
    if (!chainConfig) {
      return { valid: false, error: 'Unsupported EVM chain' };
    }

    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    
    // Get transaction receipt
    const receipt = await provider.getTransactionReceipt(proof.txHash);
    if (!receipt) {
      return { valid: false, error: 'Transaction not found' };
    }

    // Verify transaction success
    if (receipt.status !== 1) {
      return { valid: false, error: 'Transaction failed' };
    }

    // Verify transaction age (must be within last 5 minutes)
    const block = await provider.getBlock(receipt.blockNumber);
    if (!block) {
      return { valid: false, error: 'Block not found' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (now - block.timestamp > 300) {
      return { valid: false, error: 'Transaction too old (>5 minutes)' };
    }

    // Parse USDC transfer logs
    const usdcInterface = new ethers.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)'
    ]);

    let transferFound = false;
    let transferAmount = '0';

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== chainConfig.usdcAddress.toLowerCase()) {
        continue;
      }

      try {
        const parsed = usdcInterface.parseLog({
          topics: log.topics as string[],
          data: log.data
        });

        if (!parsed) continue;

        if (
          parsed.args.to.toLowerCase() === X402_CONFIG.evm.recipientAddress.toLowerCase() &&
          parsed.args.from.toLowerCase() === proof.from.toLowerCase()
        ) {
          transferFound = true;
          // USDC has 6 decimals
          transferAmount = ethers.formatUnits(parsed.args.value, 6);
          break;
        }
      } catch {
        continue;
      }
    }

    if (!transferFound) {
      return { valid: false, error: 'No valid USDC transfer found' };
    }

    // Verify amount (allow 1% tolerance for gas fluctuations)
    const required = parseFloat(requiredAmount);
    const actual = parseFloat(transferAmount);
    
    if (actual < required * 0.99) {
      return { 
        valid: false, 
        error: `Insufficient payment: ${actual} USDC (required: ${required} USDC)` 
      };
    }

    logger.event(`X402 EVM payment verified: ${proof.txHash} (${transferAmount} USDC)`);
    
    return { valid: true };

  } catch (error: any) {
    logger.error(`X402 EVM verification failed: ${error.message}`);
    return { valid: false, error: error.message };
  }
}

// ——————————————————————————————————————
// SOLANA PAYMENT VERIFICATION
// ——————————————————————————————————————

export async function verifySolanaPayment(
  proof: Omit<X402PaymentProof, 'verified'>,
  requiredAmount: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    const connection = new Connection(X402_CONFIG.solana.rpcUrl, 'confirmed');
    
    // Get transaction
    const tx = await connection.getTransaction(proof.txHash, {
      maxSupportedTransactionVersion: 0
    });

    if (!tx) {
      return { valid: false, error: 'Transaction not found' };
    }

    // Verify transaction success
    if (tx.meta?.err) {
      return { valid: false, error: 'Transaction failed' };
    }

    // Verify transaction age (must be within last 5 minutes)
    if (!tx.blockTime) {
      return { valid: false, error: 'Block time not available' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (now - tx.blockTime > 300) {
      return { valid: false, error: 'Transaction too old (>5 minutes)' };
    }

    // Parse token transfers from pre/post token balances
    const preBalances = tx.meta?.preTokenBalances || [];
    const postBalances = tx.meta?.postTokenBalances || [];

    let transferAmount = 0;
    let transferFound = false;

    // Find USDC transfers to recipient
    for (const postBalance of postBalances) {
      if (postBalance.mint !== X402_CONFIG.solana.usdcMint) continue;
      if (postBalance.owner !== X402_CONFIG.solana.recipientAddress) continue;

      const preBalance = preBalances.find(
        pb => pb.accountIndex === postBalance.accountIndex
      );

      const preAmount = parseFloat(preBalance?.uiTokenAmount.uiAmountString || '0');
      const postAmount = parseFloat(postBalance.uiTokenAmount.uiAmountString || '0');
      
      const difference = postAmount - preAmount;
      if (difference > 0) {
        transferAmount = difference;
        transferFound = true;
        break;
      }
    }

    if (!transferFound) {
      return { valid: false, error: 'No valid USDC transfer found' };
    }

    // Verify amount (allow 1% tolerance)
    const required = parseFloat(requiredAmount);
    
    if (transferAmount < required * 0.99) {
      return { 
        valid: false, 
        error: `Insufficient payment: ${transferAmount} USDC (required: ${required} USDC)` 
      };
    }

    logger.event(`X402 Solana payment verified: ${proof.txHash} (${transferAmount} USDC)`);
    
    return { valid: true };

  } catch (error: any) {
    logger.error(`X402 Solana verification failed: ${error.message}`);
    return { valid: false, error: error.message };
  }
}

// ——————————————————————————————————————
// UNIFIED PAYMENT VERIFICATION
// ——————————————————————————————————————

export async function verifyX402Payment(
  proof: Omit<X402PaymentProof, 'verified'>,
  feature: keyof X402Config['pricing']
): Promise<{ valid: boolean; error?: string; amount?: string }> {
  const requiredAmount = X402_CONFIG.pricing[feature];

  // Check if payment was already used
  const existingPayment = await storage.loadChainConfig(
    `x402_${proof.txHash}`,
    'payment'
  );

  if (existingPayment) {
    return { valid: false, error: 'Payment already used' };
  }

  // Verify based on chain
  let result;
  if (proof.chain === 'solana') {
    result = await verifySolanaPayment(proof, requiredAmount);
  } else {
    result = await verifyEvmPayment(proof, requiredAmount);
  }

  if (!result.valid) {
    return result;
  }

  // Store payment proof to prevent reuse
  await storage.saveChainConfig(
    `x402_${proof.txHash}`,
    'payment',
    {
      ...proof,
      verified: true,
      requiredAmount,
      verifiedAt: new Date().toISOString()
    } as any
  );

  logger.event(`X402 payment recorded: ${proof.txHash} for ${feature}`);

  return { valid: true, amount: requiredAmount };
}

// ——————————————————————————————————————
// PAYMENT INFO ENDPOINT DATA
// ——————————————————————————————————————

export function getX402PaymentInfo(feature: keyof X402Config['pricing']): {
  amount: string;
  evm: {
    chains: Array<{
      name: string;
      chainId: number;
      usdcAddress: string;
      recipient: string;
    }>;
  };
  solana: {
    usdcMint: string;
    recipient: string;
  };
  instructions: {
    evm: string;
    solana: string;
  };
} {
  const amount = X402_CONFIG.pricing[feature];

  return {
    amount,
    evm: {
      chains: Object.entries(X402_CONFIG.evm.chains).map(([name, config]) => ({
        name,
        chainId: config.chainId,
        usdcAddress: config.usdcAddress,
        recipient: X402_CONFIG.evm.recipientAddress
      }))
    },
    solana: {
      usdcMint: X402_CONFIG.solana.usdcMint,
      recipient: X402_CONFIG.solana.recipientAddress
    },
    instructions: {
      evm: `Transfer ${amount} USDC to ${X402_CONFIG.evm.recipientAddress} on any supported chain`,
      solana: `Transfer ${amount} USDC to ${X402_CONFIG.solana.recipientAddress} on Solana`
    }
  };
}

// ——————————————————————————————————————
// USAGE TRACKING
// ——————————————————————————————————————

export async function trackX402Usage(
  tenantId: string,
  feature: string,
  amount: string,
  txHash: string
): Promise<void> {
  const usageLog = {
    timestamp: new Date().toISOString(),
    tenantId,
    feature,
    amount,
    txHash,
    type: 'x402_payment'
  };

  await storage.appendLog(tenantId, usageLog);
  
  logger.event(`X402 usage tracked: ${tenantId} - ${feature} - ${amount} USDC`);
}

// ——————————————————————————————————————
// GET USER'S X402 USAGE STATS
// ——————————————————————————————————————

export async function getX402UsageStats(
  tenantId: string,
  startDate?: Date,
  endDate?: Date
): Promise<{
  totalSpent: number;
  transactionCount: number;
  byFeature: Record<string, { count: number; spent: number }>;
  transactions: Array<{
    timestamp: string;
    feature: string;
    amount: string;
    txHash: string;
  }>;
}> {
  const logs = await storage.loadLogs(tenantId);
  
  const x402Logs = logs.filter((log: any) => {
    if (log.type !== 'x402_payment') return false;
    
    if (startDate && new Date(log.timestamp) < startDate) return false;
    if (endDate && new Date(log.timestamp) > endDate) return false;
    
    return true;
  });

  const byFeature: Record<string, { count: number; spent: number }> = {};
  let totalSpent = 0;

  for (const log of x402Logs) {
    const amount = parseFloat(log.amount || '0');
    totalSpent += amount;

    if (!byFeature[log.feature]) {
      byFeature[log.feature] = { count: 0, spent: 0 };
    }

    byFeature[log.feature].count++;
    byFeature[log.feature].spent += amount;
  }

  return {
    totalSpent,
    transactionCount: x402Logs.length,
    byFeature,
    transactions: x402Logs.map((log: any) => ({
      timestamp: log.timestamp,
      feature: log.feature,
      amount: log.amount,
      txHash: log.txHash
    }))
  };
}

export default {
  X402_CONFIG,
  verifyX402Payment,
  getX402PaymentInfo,
  trackX402Usage,
  getX402UsageStats,
  verifyEvmPayment,
  verifySolanaPayment
};