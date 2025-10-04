
import { encodeAddress, isAddress, decodeAddress } from '@polkadot/util-crypto';
import { hexToU8a, isHex } from '@polkadot/util';

// Validate Polkadot addresses and return the Polkadot-formatted address
export function isValidPolkadotAddress(address: string): { isValid: boolean; polkadotAddress: string | null } {
  try {
    console.log('Validating address:', address);

    // Check if the address is valid (SS58 or hex)
    let publicKey: Uint8Array;
    if (isHex(address)) {
      console.log('Address is hex, converting to Uint8Array');
      publicKey = hexToU8a(address);
    } else if (isAddress(address)) {
      console.log('Address is valid SS58, decoding');
      publicKey = decodeAddress(address);
    } else {
      console.log('Address is neither valid SS58 nor hex');
      return { isValid: false, polkadotAddress: null };
    }

    // Encode to Polkadot's SS58 prefix (0)
    const polkadotAddress = encodeAddress(publicKey, 0);
    console.log('Re-encoded Polkadot address:', polkadotAddress);

    return { isValid: true, polkadotAddress };
  } catch (error: any) {
    console.error('Address validation error:', error.message, { address });
    return { isValid: false, polkadotAddress: null };
  }
}
