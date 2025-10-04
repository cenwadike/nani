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
 * @file utils/validate.ts
 * @summary Validates and normalizes Polkadot addresses.
 * @description This utility checks whether a given address is valid (SS58 or hex format),
 *              decodes it to a public key, and re-encodes it using Polkadot's SS58 prefix (0).
 */

import { encodeAddress, isAddress, decodeAddress } from '@polkadot/util-crypto';
import { hexToU8a, isHex } from '@polkadot/util';
import logger from './logger';

/**
 * @function isValidPolkadotAddress
 * @description Validates a given address and returns its Polkadot-formatted SS58 version.
 *              Supports both hexadecimal and SS58 input formats.
 * @param address - The input address string to validate
 * @returns An object containing:
 *          - `isValid`: whether the address is valid
 *          - `polkadotAddress`: the normalized SS58 address or null if invalid
 */
export function isValidPolkadotAddress(address: string): { isValid: boolean; polkadotAddress: string | null } {
  logger.info(`Validating address: ${address}`);

  try {
    let publicKey: Uint8Array;

    if (isHex(address)) {
      logger.event('Address format detected: hex');
      publicKey = hexToU8a(address);
    } else if (isAddress(address)) {
      logger.event('Address format detected: SS58');
      publicKey = decodeAddress(address);
    } else {
      logger.error('Address format invalid: not hex or SS58');
      return { isValid: false, polkadotAddress: null };
    }

    const polkadotAddress = encodeAddress(publicKey, 0);
    logger.info(`Normalized Polkadot address: ${polkadotAddress}`);

    return { isValid: true, polkadotAddress };
  } catch (error: any) {
    logger.error(`Address validation failed: ${error.message}, ${address}`);
    return { isValid: false, polkadotAddress: null };
  }
}
