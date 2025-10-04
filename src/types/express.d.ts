// SPDX-License-Identifier: MIT
// This file is part of the Nani project, a Polkadot-based event streaming service.
//
// Copyright (c) 2025 Nani Contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * @file types/express.d.ts
 * @summary Extends the Express Request interface to include tenant-specific metadata.
 * @description Adds custom properties (`tenantId` and `email`) to the Express `Request` object
 *              for use in authentication and multi-tenant routing.
 */

import { Request } from 'express';

/**
 * @interface Request
 * @description Augments the Express Request object with optional tenant metadata.
 *              These properties are injected during JWT verification and used throughout the app.
 */
declare module 'express' {
  interface Request {
    /**
     * @property tenantId
     * @description Unique identifier for the authenticated tenant.
     */
    tenantId?: string;

    /**
     * @property email
     * @description Email address associated with the authenticated tenant.
     */
    email?: string;
  }
}
