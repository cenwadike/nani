import { StatsPlugin } from '../../types/pluginTypes';

const basic: StatsPlugin = {
  name: 'basic',

  compute(logs: any[]) {
    const stats = {
      totalEvents: logs.length,
      incoming: 0,
      outgoing: 0,
      totalAmountIn: 0,
      totalAmountOut: 0,
      firstEvent: null,
      lastEvent: null,
    };

    if (logs.length === 0) return stats;

    logs.forEach((log: any) => {
      if (log.direction === 'incoming') {
        stats.incoming++;
        stats.totalAmountIn += log.amount;
      } else if (log.direction === 'outgoing') {
        stats.outgoing++;
        stats.totalAmountOut += log.amount;
      }
    });

    stats.firstEvent = logs[0].timestamp;
    stats.lastEvent = logs[logs.length - 1].timestamp;

    // Convert from planck to WND
    stats.totalAmountIn = (stats.totalAmountIn / 1e12).toFixed(4) as any as number;
    stats.totalAmountOut = (stats.totalAmountOut / 1e12).toFixed(4) as any as number;

    return stats;
  },
};

export default basic;
