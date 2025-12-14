export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  services: {
    database: ServiceStatus;
    adapters: ServiceStatus;
    queue: ServiceStatus;
    stripe: ServiceStatus;
  };
  metrics: {
    memory: MemoryMetrics;
    cpu: CPUMetrics;
    eventQueue: QueueMetrics;
  };
  alerts: {
    unread: number;
    critical: number;
  };
}

export interface ServiceStatus {
  status: 'up' | 'down' | 'degraded';
  latency?: number;
  lastCheck: string;
  error?: string;
}

export interface MemoryMetrics {
  used: number;
  total: number;
  percentage: number;
}

export interface CPUMetrics {
  usage: number;
  cores: number;
}

export interface QueueMetrics {
  pending: number;
  processing: number;
  failed: number;
  deduplicated: number;
}
