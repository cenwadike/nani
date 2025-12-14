import logger from '../utils/logger'; 

export class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();
  private readonly maxSamples = 100;

  track(operation: string, duration: number): void {
    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }
    
    const samples = this.metrics.get(operation)!;
    samples.push(duration);
    
    if (samples.length > this.maxSamples) {
      samples.shift();
    }
  }

  getStats(operation: string): { 
    p50: number; 
    p95: number; 
    p99: number; 
    avg: number;
    count: number;
  } | null {
    const values = this.metrics.get(operation);
    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;

    return {
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      avg,
      count: sorted.length
    };
  }

  getAllStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    for (const [operation] of this.metrics) {
      stats[operation] = this.getStats(operation);
    }
    return stats;
  }

  clear(): void {
    this.metrics.clear();
  }
}

export const performanceMonitor = new PerformanceMonitor();

// Middleware to track API latency
export function performanceMiddleware(req: any, res: any, next: any): void {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const operation = `${req.method} ${req.path}`;
    performanceMonitor.track(operation, duration);

    if (duration > 1000) {
      logger.warn(`Slow request: ${operation} took ${duration}ms`);
    }
  });

  next();
}
