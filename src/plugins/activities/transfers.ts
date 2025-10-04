import { ActivityPlugin } from '../../types/pluginTypes';

const transfers: ActivityPlugin = {
  name: 'transfers',

  async filter(record: any, address: string): Promise<boolean> {
    const event = record.event;
    if (!event || event.section !== 'balances') return false;
    if (event.method !== 'Transfer') return false;

    const data = event.data.toJSON();
    const from = data[0] || data.from;
    const to = data[1] || data.to;

    return from === address || to === address;
  },

  async log(record: any, address: string): Promise<any> {
    const event = record.event;
    const data = event.data.toJSON();
    const from = data[0] || data.from;
    const to = data[1] || data.to;
    const amount = data[2] || data.amount;

    return {
      timestamp: new Date().toISOString(),
      type: 'transfer',
      from,
      to,
      amount,
      blockNumber: record.phase?.asApplyExtrinsic || 'unknown',
      direction: from === address ? 'outgoing' : 'incoming',
    };
  },

  async formatMessage(logEntry: any, address: string): Promise<string> {
    const direction = logEntry.direction;
    const other = direction === 'outgoing' ? logEntry.to : logEntry.from;
    const amountFormatted = (logEntry.amount / 1e12).toFixed(4);

    return `${direction.toUpperCase()} Transfer: ${amountFormatted} WND ${direction === 'outgoing' ? 'to' : 'from'} ${other.substring(0, 10)}...`;
  },
};

export default transfers;