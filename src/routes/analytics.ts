import { Router, Request, Response } from 'express';
import { checkAnalyticsAccess } from '../billing/analytics';
import storage from '../utils/storage';
import { getX402PaymentInfo, trackX402Usage, verifyX402Payment } from '../billing/x402';
import logger from '../utils/logger';
import { InferenceClient } from '@huggingface/inference';
import config from '../config';
import { DirectedGraph } from 'graphology';
import { connectedComponents } from 'graphology-components';

const router = Router();

// Singleton client
const hf = new InferenceClient(config.hfToken || process.env.HF_TOKEN);

// ————————————————————————————————
// GET /stats/basic - Basic Analytics (Free)
// ————————————————————————————————
router.get('/basic', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || (req as any).tenantId;
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Check access
    const access = await checkAnalyticsAccess(tenantId, 'basic');
    if (!access.allowed) {
      return res.status(402).json({ 
        error: 'Payment required',
        message: access.upgradeRequired,
        upgradeUrl: 'https://nani.dev/upgrade'
      });
    }

    // Load and compute stats
    const logs = await storage.loadLogs(tenantId);
    const now = Date.now();
    const last24h = now - (24 * 60 * 60 * 1000);
    const last7d = now - (7 * 24 * 60 * 60 * 1000);

    const stats = {
      totalEvents: logs.length,
      last24Hours: logs.filter((l: any) => 
        new Date(l.timestamp).getTime() > last24h
      ).length,
      last7Days: logs.filter((l: any) => 
        new Date(l.timestamp).getTime() > last7d
      ).length,
      byChain: logs.reduce((acc: any, log: any) => {
        const chain = log.chainId || 'unknown';
        acc[chain] = (acc[chain] || 0) + 1;
        return acc;
      }, {}),
      byType: logs.reduce((acc: any, log: any) => {
        const type = log.event || 'unknown';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {})
    };

    res.json({
      tier: access.tier,
      stats,
      generatedAt: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error(`Basic stats error: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate stats' });
  }
});

// ————————————————————————————————
// GET /stats/advanced - Advanced Analytics (Pro+)
// ————————————————————————————————
router.get('/advanced', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || (req as any).tenantId;
    
    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const access = await checkAnalyticsAccess(tenantId, 'advanced');
    if (!access.allowed) {
      return res.status(402).json({ 
        error: 'Payment required',
        message: access.upgradeRequired,
        upgradeUrl: 'https://nani.dev/upgrade'
      });
    }

    const logs = await storage.loadLogs(tenantId);
    
    // Advanced computations with blockchain focus
    const stats = {
      totalEvents: logs.length,
      trends: calculateTrends(logs),
      comparisons: compareWithPreviousPeriod(logs),
      predictions: predictNextWeek(logs),
      anomalies: detectAnomalies(logs),
      topChains: getTopChains(logs, 5),
      peakTimes: findPeakTimes(logs),
      behaviorPatterns: detectBehaviorPatterns(logs),
      graphStats: analyzeTransactionGraph(logs)
    };

    res.json({
      tier: access.tier,
      stats,
      generatedAt: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error(`Advanced stats error: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate advanced stats' });
  }
});

// ————————————————————————————————
// POST /stats/ai - AI Analytics (Enterprise or X402)
// ————————————————————————————————
router.post('/ai', async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || (req as any).tenantId;
    const { query, paymentProof } = req.body;

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!query) {
      return res.status(400).json({ error: 'Query required' });
    }

    const access = await checkAnalyticsAccess(tenantId, 'ai');
    
    let verification: any;

    if (!access.allowed) {
      if (!paymentProof) {
        const x402Info = getX402PaymentInfo('aiAnalyticsQuery');
        
        return res.status(402).json({ 
          error: 'Payment required',
          options: {
            subscription: {
              message: 'Upgrade to Enterprise ($199.99/mo) for unlimited AI queries',
              url: 'https://nani.dev/upgrade'
            },
            x402: {
              message: `Pay ${x402Info.amount} per query with crypto`,
              payment: x402Info
            }
          }
        });
      }

      verification = await verifyX402Payment(paymentProof, 'aiAnalyticsQuery');
      
      if (!verification.valid) {
        return res.status(402).json({
          error: 'Invalid payment proof',
          details: verification.error
        });
      }

      await trackX402Usage(
        tenantId,
        'aiAnalyticsQuery',
        verification.amount!,
        paymentProof.txHash
      );
    }

    // Process AI query with advanced blockchain analysis
    const logs = await storage.loadLogs(tenantId);
    const aiResponse = await processAIQuery(query, logs);

    res.json({ 
      insight: aiResponse,
      paymentMethod: access.allowed ? 'subscription' : 'x402',
      cost: access.allowed ? 0 : parseFloat(verification?.amount || '0'),
      query,
      generatedAt: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error(`AI stats error: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate AI insights' });
  }
});

// Helper functions for advanced analytics

function calculateTrends(logs: any[]) {
  if (logs.length === 0) return {};

  const dailyCounts: { [date: string]: number } = {};
  logs.forEach((log) => {
    const date = new Date(log.timestamp).toISOString().split('T')[0];
    dailyCounts[date] = (dailyCounts[date] || 0) + 1;
  });

  const dates = Object.keys(dailyCounts).sort();
  const counts = dates.map((d) => dailyCounts[d]);

  const averagePerDay = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;

  return {
    dailyEvents: dates.map((date, i) => ({ date, events: counts[i] })),
    averagePerDay: Math.round(averagePerDay),
    growth: counts.length > 1 
      ? ((counts[counts.length - 1] - counts[0]) / counts[0] * 100).toFixed(1) + '%'
      : 'N/A'
  };
}

function compareWithPreviousPeriod(logs: any[]) {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  const currentCount = logs.filter((l) => new Date(l.timestamp).getTime() > now - weekMs).length;
  const previousCount = logs.filter((l) => 
    new Date(l.timestamp).getTime() > now - 2 * weekMs && 
    new Date(l.timestamp).getTime() <= now - weekMs
  ).length;

  const percentChange = previousCount > 0 
    ? ((currentCount - previousCount) / previousCount * 100).toFixed(1)
    : currentCount > 0 ? '∞' : '0';

  return {
    period: 'Last 7 days vs previous 7 days',
    currentEvents: currentCount,
    previousEvents: previousCount,
    percentChange
  };
}

function predictNextWeek(logs: any[]) {
  if (logs.length < 7) {
    return { predictedEvents: 0, note: 'Insufficient data for prediction' };
  }

  // Simple linear extrapolation based on recent trend
  const recentLogs = logs.slice(-30); // last ~30 days
  const timestamps = recentLogs.map((l: any) => new Date(l.timestamp).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  if (maxTime === minTime) {
    return { predictedEvents: logs.length, method: 'No time variance' };
  }

  const slope = logs.length / (maxTime - minTime); // events per ms
  const nextWeekMs = 7 * 24 * 60 * 60 * 1000;
  const predicted = Math.round(slope * nextWeekMs);

  return {
    predictedEvents: Math.max(0, predicted),
    method: 'Linear extrapolation from recent activity'
  };
}

function detectAnomalies(logs: any[]) {
  if (logs.length === 0) return [];

  const daily: { [date: string]: number } = {};
  logs.forEach((log) => {
    const date = new Date(log.timestamp).toISOString().split('T')[0];
    daily[date] = (daily[date] || 0) + 1;
  });

  const counts = Object.values(daily);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / counts.length;
  const std = Math.sqrt(variance);

  const anomalies: any[] = [];
  Object.entries(daily).forEach(([date, count]) => {
    if (count > mean + 2 * std) {
      anomalies.push({
        date,
        events: count,
        deviation: ((count - mean) / std).toFixed(2) + 'σ'
      });
    }
  });

  return anomalies.sort((a, b) => b.events - a.events);
}

function getTopChains(logs: any[], limit: number = 5) {
  const chainCounts: { [chain: string]: number } = {};
  logs.forEach((log) => {
    const chain = log.chainId || 'unknown';
    chainCounts[chain] = (chainCounts[chain] || 0) + 1;
  });

  return Object.entries(chainCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .reduce((acc, [chain, count]) => ({ ...acc, [chain]: count }), {});
}

function findPeakTimes(logs: any[]) {
  const hourly: number[] = new Array(24).fill(0);
  logs.forEach((log) => {
    const hour = new Date(log.timestamp).getUTCHours();
    hourly[hour]++;
  });

  let peakHour = 0;
  let maxEvents = 0;
  hourly.forEach((count, hour) => {
    if (count > maxEvents) {
      maxEvents = count;
      peakHour = hour;
    }
  });

  return {
    peakHourUTC: peakHour,
    eventsAtPeakHour: maxEvents,
    distribution: hourly.map((count, h) => ({ hourUTC: h, events: count }))
  };
}

function detectBehaviorPatterns(logs: any[]) {
  // Simple pattern detection: frequent senders/receivers, repeated events
  const senderFreq = logs.reduce((acc: any, log: any) => {
    if (log.data?.from) {
      acc[log.data.from] = (acc[log.data.from] || 0) + 1;
    }
    return acc;
  }, {});

  const receiverFreq = logs.reduce((acc: any, log: any) => {
    if (log.data?.to) {
      acc[log.data.to] = (acc[log.data.to] || 0) + 1;
    }
    return acc;
  }, {});

  const patterns = {
    topSenders: Object.entries(senderFreq).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 5),
    topReceivers: Object.entries(receiverFreq).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 5),
    repeatedEvents: logs.reduce((acc: any, log: any) => {
      const key = `${log.event}-${log.data?.from || ''}-${log.data?.to || ''}`;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {})
  };

  return patterns;
}

/**
 * Analyzes transaction logs to build a directed graph of fund flows
 * Returns rich network metrics for blockchain intelligence
 */
function analyzeTransactionGraph(logs: any[]) {
  const graph = new DirectedGraph();

  let validTxCount = 0;

  for (const log of logs) {
    const { from, to, value, txHash } = log.data || {};
    const { chainId, timestamp } = log;

    // Only process valid transfers
    if (!from || !to || from === to) continue;

    // Add nodes with attributes
    if (!graph.hasNode(from)) {
      graph.addNode(from, {
        type: 'address',
        firstSeen: timestamp,
        chain: chainId || 'unknown',
        txCount: 0,
        inflow: 0,
        outflow: 0
      });
    }

    if (!graph.hasNode(to)) {
      graph.addNode(to, {
        type: 'address',
        firstSeen: timestamp,
        chain: chainId || 'unknown',
        txCount: 0,
        inflow: 0,
        outflow: 0
      });
    }

    // Add directed edge (source → target = funds moving from → to)
    graph.addDirectedEdgeWithKey?.(`${from}-${to}-${txHash || Date.now()}`, from, to, {
      value: Number(value || 0),
      txHash: txHash || null,
      timestamp,
      chain: chainId || 'unknown'
    }) || graph.addDirectedEdge(from, to, {
      value: Number(value || 0),
      txHash: txHash || null,
      timestamp,
      chain: chainId || 'unknown'
    });

    // Update node counters
    graph.updateNodeAttributes(from, attrs => ({
      ...attrs,
      txCount: (attrs.txCount || 0) + 1,
      outflow: (attrs.outflow || 0) + Number(value || 0)
    }));

    graph.updateNodeAttributes(to, attrs => ({
      ...attrs,
      txCount: (attrs.txCount || 0) + 1,
      inflow: (attrs.inflow || 0) + Number(value || 0)
    }));

    validTxCount++;
  }

  // Compute network metrics
  const nodes = graph.order;
  const edges = graph.directedSize;

  const degrees = graph.nodes().map(node => ({
    node,
    inDegree: graph.inDegree(node),
    outDegree: graph.outDegree(node),
    degree: graph.degree(node)
  }));

  const avgInDegree = nodes > 0 
    ? degrees.reduce((sum, d) => sum + d.inDegree, 0) / nodes 
    : 0;
  const avgOutDegree = nodes > 0 
    ? degrees.reduce((sum, d) => sum + d.outDegree, 0) / nodes 
    : 0;

  // Find hubs (high degree nodes)
  const topSenders = degrees
    .sort((a, b) => b.outDegree - a.outDegree)
    .slice(0, 10)
    .map(d => ({
      address: d.node,
      outDegree: d.outDegree,
      outflow: graph.getNodeAttribute(d.node, 'outflow') || 0
    }));

  const topReceivers = degrees
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, 10)
    .map(d => ({
      address: d.node,
      inDegree: d.inDegree,
      inflow: graph.getNodeAttribute(d.node, 'inflow') || 0
    }));

  return {
    summary: {
      nodes,
      edges,
      validTransactions: validTxCount,
      density: nodes > 1 ? Number((edges / (nodes * (nodes - 1))).toFixed(6)) : 0,
      averageInDegree: Number(avgInDegree.toFixed(2)),
      averageOutDegree: Number(avgOutDegree.toFixed(2)),
      connectedComponents: connectedComponents(graph).length
    },
    hubs: {
      topSenders,
      topReceivers
    },
    riskIndicators: {
      highConcentration: topSenders[0]?.outDegree / edges > 0.3,
      centralReceiver: topReceivers[0]?.inDegree / edges > 0.3,
      potentialMixer: topSenders.some(s => s.outDegree > 50 && topReceivers.some(r => r.address === s.address))
    }
  };
}

async function traceAccount(logs: any[], address: string) {
  const relatedTx = logs.filter(log => 
    (log.data?.from === address || log.data?.to === address)
  );

  const inflows = relatedTx.filter(log => log.data?.to === address).reduce((sum, log) => sum + (log.data.value || 0), 0);
  const outflows = relatedTx.filter(log => log.data?.from === address).reduce((sum, log) => sum + (log.data.value || 0), 0);

  return {
    transactions: relatedTx.length,
    netFlow: inflows - outflows,
    counterparts: [...new Set(relatedTx.map(log => log.data.from === address ? log.data.to : log.data.from).filter(Boolean))]
  };
}

// AI processing using remote HF Inference API
async function processAIQuery(query: string, logs: any[]) {
  // Precompute deep blockchain insights
  const summary = summarizeLogs(logs);
  const patterns = detectBehaviorPatterns(logs);
  const graphStats = analyzeTransactionGraph(logs);

  // Optional: account tracing if query mentions an address
  let traceInfo = {};
  const addressMatch = query.match(/(0x[a-fA-F0-9]{40})/i);
  if (addressMatch) {
    traceInfo = traceAccount(logs, addressMatch[0]);
  }

  // Expert-level prompt for deep insights
  const prompt = `You are a senior blockchain analytics and intelligence expert.
User query: "${query}"

Critical on-chain data summary:
- Total events: ${summary.totalEvents}
- Active chains: ${JSON.stringify(summary.topChains)}
- Daily avg: ${summary.averagePerDay} events, growth: ${summary.growth}
- Anomalies detected: ${summary.anomalies.length > 0 ? 'YES (' + summary.anomalies.length + ')' : 'None'}
- Peak activity hour (UTC): ${summary.peakHourUTC}
- Top sending addresses: ${JSON.stringify(patterns.topSenders.slice(0,5))}
- Top receiving addresses: ${JSON.stringify(patterns.topReceivers.slice(0,5))}
- Network graph: ${graphStats.summary.nodes} unique addresses, ${graphStats.summary.edges} transactions
- Account trace (if requested): ${JSON.stringify(traceInfo)}

Provide:
• Deep behavioral analysis and patterns
• Predictive trends for next 7–30 days
• Risk flags (e.g., concentration, unusual flows)
• Account tracing and fund flow insights
• Actionable recommendations

Be precise, evidence-based, and professional.`;

  const response = await hf.textGeneration({
    model: 'mistralai/Mistral-7B-Instruct-v0.3', // Excellent for analytics
    inputs: prompt,
    parameters: {
      max_new_tokens: 1000,
      temperature: 0.6,
      top_p: 0.9,
      return_full_text: false,
    },
  });

  return {
    aiInsights: response.generated_text.trim(),
    model: 'Mistral-7B-Instruct-v0.3 (Hugging Face Inference API)',
    usageNote: 'Free tier: ~1000 requests/day. Upgrade for more.',
    metadata: {
      predictions: predictNextWeek(logs),
      graph: graphStats,
      patterns
    }
  };
}

// Summarize for prompt
function summarizeLogs(logs: any[]) {
  const trends = calculateTrends(logs);
  const anomalies = detectAnomalies(logs);
  const topChains = getTopChains(logs);
  const peakTimes = findPeakTimes(logs);

  return {
    totalEvents: logs.length,
    topChains,
    averagePerDay: trends.averagePerDay || 0,
    growth: trends.growth || 'N/A',
    anomalies,
    peakHourUTC: peakTimes.peakHourUTC
  };
}

export default router;