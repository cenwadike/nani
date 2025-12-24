import { Router, Request, Response } from "express";
import { checkAnalyticsAccess } from "../billing/analytics";
import storage from "../utils/storage";
import {
  getX402PaymentInfo,
  trackX402Usage,
  verifyX402Payment,
} from "../billing/x402";
import logger from "../utils/logger";
import { X402_CONFIG } from "../billing/x402";
import { paymentMiddleware } from "../billing/paymentMiddleware";

const router = Router();

// ————————————————————————————————
// GET /stats/basic - Basic Analytics (Free)
// ————————————————————————————————
router.get("/basic", async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || (req as any).tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Check access
    const access = await checkAnalyticsAccess(tenantId, "basic");
    if (!access.allowed) {
      return res.status(402).json({
        error: "Payment required",
        message: access.upgradeRequired,
        upgradeUrl: "https://nani.dev/upgrade",
      });
    }

    // Load and compute stats
    const logs = await storage.loadLogs(tenantId);
    const now = Date.now();
    const last24h = now - 24 * 60 * 60 * 1000;
    const last7d = now - 7 * 24 * 60 * 60 * 1000;

    const stats = {
      totalEvents: logs.length,
      last24Hours: logs.filter(
        (l: any) => new Date(l.timestamp).getTime() > last24h
      ).length,
      last7Days: logs.filter(
        (l: any) => new Date(l.timestamp).getTime() > last7d
      ).length,
      byChain: logs.reduce((acc: any, log: any) => {
        const chain = log.chain || "unknown";
        acc[chain] = (acc[chain] || 0) + 1;
        return acc;
      }, {}),
      byType: logs.reduce((acc: any, log: any) => {
        const type = log.type || "unknown";
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {}),
    };

    res.json({
      tier: access.tier,
      stats,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error(`Basic stats error: ${error.message}`);
    res.status(500).json({ error: "Failed to generate stats" });
  }
});

// ————————————————————————————————
// GET /stats/advanced - Advanced Analytics (Pro+)
// ————————————————————————————————
router.get("/advanced", async (req: Request, res: Response) => {
  try {
    const tenantId = (req as any).user?.tenantId || (req as any).tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const access = await checkAnalyticsAccess(tenantId, "advanced");
    if (!access.allowed) {
      return res.status(402).json({
        error: "Payment required",
        message: access.upgradeRequired,
        upgradeUrl: "https://nani.dev/upgrade",
      });
    }

    const logs = await storage.loadLogs(tenantId);

    // Advanced computations
    const stats = {
      totalEvents: logs.length,
      trends: calculateTrends(logs),
      comparisons: compareWithPreviousPeriod(logs),
      predictions: predictNextWeek(logs),
      anomalies: detectAnomalies(logs),
      topChains: getTopChains(logs, 5),
      peakTimes: findPeakTimes(logs),
    };

    res.json({
      tier: access.tier,
      stats,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error(`Advanced stats error: ${error.message}`);
    res.status(500).json({ error: "Failed to generate advanced stats" });
  }
});

// ————————————————————————————————
// POST /stats/ai - AI Analytics (Enterprise or X402)
// ————————————————————————————————

// TODO: I commented this implementation encase mine breaks 

// router.post(
//   "/ai",
//   async (req: Request, res: Response) => {
//     try {
//       const tenantId = (req as any).user?.tenantId || (req as any).tenantId;
//       const { query, paymentProof } = req.body;

//       if (!tenantId) {
//         return res.status(401).json({ error: "Unauthorized" });
//       }

//       if (!query) {
//         return res.status(400).json({ error: "Query required" });
//       }

//       const access = await checkAnalyticsAccess(tenantId, "ai");

//       let verification: any;

//       if (!access.allowed) {
//         if (!paymentProof) {
//           const x402Info = getX402PaymentInfo("aiAnalyticsQuery");

//           return res.status(402).json({
//             error: "Payment required",
//             options: {
//               subscription: {
//                 message:
//                   "Upgrade to Enterprise ($199.99/mo) for unlimited AI queries",
//                 url: "https://nani.dev/upgrade",
//               },
//               x402: {
//                 message: `Pay ${x402Info.amount} per query with crypto`,
//                 payment: x402Info,
//               },
//             },
//           });
//         }

//         verification = await verifyX402Payment(
//           paymentProof,
//           "aiAnalyticsQuery"
//         );

//         if (!verification.valid) {
//           return res.status(402).json({
//             error: "Invalid payment proof",
//             details: verification.error,
//           });
//         }

//         await trackX402Usage(
//           tenantId,
//           "aiAnalyticsQuery",
//           verification.amount!,
//           paymentProof.txHash
//         );
//       }

//       // Process AI query
//       const logs = await storage.loadLogs(tenantId);
//       const aiResponse = await processAIQuery(query, logs);

//       res.json({
//         insight: aiResponse,
//         paymentMethod: access.allowed ? "subscription" : "x402",
//         cost: access.allowed ? 0 : parseFloat(verification?.amount || "0"),
//         query,
//         generatedAt: new Date().toISOString(),
//       });
//     } catch (error: any) {
//       logger.error(`AI stats error: ${error.message}`);
//       res.status(500).json({ error: "Failed to generate AI insights" });
//     }
//   }
// );

// the post call will return a 402 response if no payment is made before posing the request, if the status is 200 == ok then the request will be processed
router.post(
  "/ai",
  paymentMiddleware(X402_CONFIG.pricing.aiAnalyticsQuery),
  async (req: Request, res: Response) => {
    try {
      const tenantId = (req as any).user?.tenantId || (req as any).tenantId;
      const { query, paymentProof } = req.body;

      if (!tenantId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!query) {
        return res.status(400).json({ error: "Query required" });
      }

      const access = await checkAnalyticsAccess(tenantId, "ai");

      let verification: any;

      if (!access.allowed) {
        // if (!paymentProof) {
        //   const x402Info = getX402PaymentInfo("aiAnalyticsQuery");

        //   return res.status(402).json({
        //     error: "Payment required",
        //     options: {
        //       subscription: {
        //         message:
        //           "Upgrade to Enterprise ($199.99/mo) for unlimited AI queries",
        //         url: "https://nani.dev/upgrade",
        //       },
        //       x402: {
        //         message: `Pay ${x402Info.amount} per query with crypto`,
        //         payment: x402Info,
        //       },
        //     },
        //   });
        // }

        // verification = await verifyX402Payment(
        //   paymentProof,
        //   "aiAnalyticsQuery"
        // );

        // if (!verification.valid) {
        //   return res.status(402).json({
        //     error: "Invalid payment proof",
        //     details: verification.error,
        //   });
        // }

        await trackX402Usage(
          tenantId,
          "aiAnalyticsQuery",
          verification.amount!,
          paymentProof.txHash
        );
      }

      // Process AI query
      const logs = await storage.loadLogs(tenantId);
      const aiResponse = await processAIQuery(query, logs);

      res.json({
        insight: aiResponse,
        paymentMethod: access.allowed ? "subscription" : "x402",
        cost: access.allowed ? 0 : parseFloat(verification?.amount || "0"),
        query,
        generatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      logger.error(`AI stats error: ${error.message}`);
      res.status(500).json({ error: "Failed to generate AI insights" });
    }
  }
);

// Helper functions for advanced analytics

function calculateTrends(logs: any[]) {
  if (logs.length === 0) return {};

  const dailyCounts: { [date: string]: number } = {};
  logs.forEach((log) => {
    const date = new Date(log.timestamp).toISOString().split("T")[0];
    dailyCounts[date] = (dailyCounts[date] || 0) + 1;
  });

  const dates = Object.keys(dailyCounts).sort();
  const counts = dates.map((d) => dailyCounts[d]);

  const averagePerDay =
    counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;

  return {
    dailyEvents: dates.map((date, i) => ({ date, events: counts[i] })),
    averagePerDay: Math.round(averagePerDay),
    growth:
      counts.length > 1
        ? (((counts[counts.length - 1] - counts[0]) / counts[0]) * 100).toFixed(
            1
          ) + "%"
        : "N/A",
  };
}

function compareWithPreviousPeriod(logs: any[]) {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  const currentCount = logs.filter(
    (l) => new Date(l.timestamp).getTime() > now - weekMs
  ).length;
  const previousCount = logs.filter(
    (l) =>
      new Date(l.timestamp).getTime() > now - 2 * weekMs &&
      new Date(l.timestamp).getTime() <= now - weekMs
  ).length;

  const percentChange =
    previousCount > 0
      ? (((currentCount - previousCount) / previousCount) * 100).toFixed(1)
      : currentCount > 0
      ? "∞"
      : "0";

  return {
    period: "Last 7 days vs previous 7 days",
    currentEvents: currentCount,
    previousEvents: previousCount,
    percentChange,
  };
}

function predictNextWeek(logs: any[]) {
  if (logs.length < 7) {
    return { predictedEvents: 0, note: "Insufficient data for prediction" };
  }

  // Simple linear extrapolation based on recent trend
  const recentLogs = logs.slice(-30); // last ~30 days
  const timestamps = recentLogs.map((l: any) =>
    new Date(l.timestamp).getTime()
  );
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  if (maxTime === minTime) {
    return { predictedEvents: logs.length, method: "No time variance" };
  }

  const slope = logs.length / (maxTime - minTime); // events per ms
  const nextWeekMs = 7 * 24 * 60 * 60 * 1000;
  const predicted = Math.round(slope * nextWeekMs);

  return {
    predictedEvents: Math.max(0, predicted),
    method: "Linear extrapolation from recent activity",
  };
}

function detectAnomalies(logs: any[]) {
  if (logs.length === 0) return [];

  const daily: { [date: string]: number } = {};
  logs.forEach((log) => {
    const date = new Date(log.timestamp).toISOString().split("T")[0];
    daily[date] = (daily[date] || 0) + 1;
  });

  const counts = Object.values(daily);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance =
    counts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / counts.length;
  const std = Math.sqrt(variance);

  const anomalies: any[] = [];
  Object.entries(daily).forEach(([date, count]) => {
    if (count > mean + 2 * std) {
      anomalies.push({
        date,
        events: count,
        deviation: ((count - mean) / std).toFixed(2) + "σ",
      });
    }
  });

  return anomalies.sort((a, b) => b.events - a.events);
}

function getTopChains(logs: any[], limit: number = 5) {
  const chainCounts: { [chain: string]: number } = {};
  logs.forEach((log) => {
    const chain = log.chain || "unknown";
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
    distribution: hourly.map((count, h) => ({ hourUTC: h, events: count })),
  };
}

// Mock AI processing (in real implementation, call an LLM API)
async function processAIQuery(query: string, logs: any[]) {
  // This is a placeholder – replace with actual LLM integration
  const total = logs.length;
  const topChain = Object.keys(getTopChains(logs, 1))[0] || "unknown";
  const trend = calculateTrends(logs);

  return {
    summary: `Based on your ${total} logged events, the most active chain is ${topChain}.`,
    answer: `AI response to "${query}": Activity shows an average of ${
      trend.averagePerDay || 0
    } events per day, with growth of ${trend.growth || "N/A"}.`,
    suggestions: [
      "Consider monitoring peak hour (UTC): " + findPeakTimes(logs).peakHourUTC,
      "Watch for anomalies: " +
        (detectAnomalies(logs).length > 0 ? "Detected" : "None"),
    ],
  };
}

export default router;
