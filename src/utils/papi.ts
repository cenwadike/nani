import { ApiPromise, WsProvider } from '@polkadot/api';
import config from '../config';

let api: ApiPromise | null = null;
let isConnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_DELAY = 30000;

async function connect() {
  if (api && api.isConnected) return api;
  if (isConnecting) {
    // Wait for existing connection attempt
    while (isConnecting) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return api;
  }
  isConnecting = true;

  try {
    console.log('Connecting to Polkadot API...');
    const provider = new WsProvider(config.papiWs);
    api = await ApiPromise.create({ provider });

    console.log('Connected to Polkadot API');
    reconnectAttempts = 0;
    isConnecting = false;

    // Handle disconnection
    api.on('disconnected', () => {
      console.log('PAPI disconnected, attempting reconnect...');
      reconnect();
    });

    return api;
  } catch (error: any) {
    isConnecting = false;
    console.error('Failed to connect to PAPI:', error.message);
    throw error;
  }
}

async function reconnect() {
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);

  console.log(`Reconnect attempt ${reconnectAttempts}, waiting ${delay}ms...`);
  await new Promise((resolve) => setTimeout(resolve, delay));

  try {
    await connect();
  } catch (error: any) {
    console.error('Reconnect failed:', error.message);
    reconnect(); // Keep trying
  }
}

async function getApi() {
  if (!api || !api.isConnected) {
    await connect();
  }
  return api;
}

export { connect, getApi };
