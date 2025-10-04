import { Request } from 'express';

declare module 'express' {
  interface Request {
    tenantId?: string;
    email?: string;
  }
}
