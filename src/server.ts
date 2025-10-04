import { loadPlugins } from './utils/pluginRegistry';
loadPlugins();

import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import config from './config';
import { limiter, verifyToken } from './middlewares/auth';
import errorHandler from './middlewares/errorHandler';
import { getApi } from './utils/papi';
import storage from './utils/storage';
import authRouter from './routes/auth';
import setupRouter from './routes/setup';
import statsRouter from './routes/stats';
import exportRouter from './routes/export';
import workerpool from 'workerpool';
import os from 'os';


const numCores = os.cpus().length;
const pool = workerpool.pool(__dirname + '/utils/pluginWorker.ts', {
  maxWorkers: numCores
});

const app: Application = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(limiter);

app.use((req: Request, res: Response, next: Function) => {
  console.log(`Worker ${process.pid} received request`);
  next();
});

app.use('/auth', authRouter);
app.use('/setup', verifyToken, setupRouter);
app.use('/stats', verifyToken, statsRouter);
app.use('/export', verifyToken, exportRouter);

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

const port = config.port;
app.listen(port, () => {
  console.log(`Worker ${process.pid} running on port ${port}`);
});

// IPC listener for monitoring trigger
process.on('message', (msg: any) => {
  if (msg?.type === 'start-monitoring') {
    startMonitoring();
  }
});

let isMonitoring = false;

async function startMonitoring() {
  if (isMonitoring) return;
  isMonitoring = true;

  try {
    console.log(`Worker ${process.pid} starting event monitoring...`);
    const api = await getApi();
    if (!api) throw new Error('Failed to connect to Polkadot API');

    api.query.system.events(async (events: any[]) => {
      console.log('Processing events for all tenants...');
      const tenantIds = await storage.getAllTenants();

      const tenantConfigs = await Promise.all(
        tenantIds.map(async (tenantId) => {
          const config = await storage.loadConfig(tenantId);
          return config ? { tenantId, config } : null;
        })
      );

      const tasks: Promise<any>[] = [];

      for (const record of events) {
        for (const tenant of tenantConfigs.filter(Boolean)) {
          tasks.push(
            pool.exec('processPluginTask', [
              {
                record,
                tenantId: tenant!.tenantId,
                config: tenant!.config
              }
            ])
          );
        }
      }

      await Promise.allSettled(tasks);
    });

    console.log('Event monitoring started');
  } catch (error) {
    console.error('Failed to start monitoring:', error);
    isMonitoring = false;
  }
}
