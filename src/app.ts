// SPDX-License-Identifier: MIT
// @file app.ts
// @summary Configures and exports the Express app without starting the server.

import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { limiter, verifyToken } from './middlewares/auth';
import errorHandler from './middlewares/errorHandler';
import authRouter from './routes/auth';
import setupRouter from './routes/setup';
import statsRouter from './routes/stats';
import exportRouter from './routes/export';
import logger from './utils/logger';

const app: Application = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(limiter);

logger.info(`Worker ${process.pid} initializing Express app...`);

app.use((req: Request, res: Response, next: Function) => {
  logger.info(`Worker ${process.pid} received ${req.method} ${req.url} from ${req.ip}`);
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

export default app;
