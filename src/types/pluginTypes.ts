export interface ActivityPlugin {
  name: string;
  filter(record: any, address: string): Promise<boolean> | boolean;
  log(record: any, address: string): Promise<any> | any;
  formatMessage(logEntry: any, address: string): Promise<string> | string;
}

export interface NotificationPlugin {
  name: string;
  init(): void;
  execute(message: string, pluginConfig: any): Promise<void>;
  validateConfig(pluginConfig: any): boolean;
}

export interface StatsPlugin {
  name: string;
  compute(logs: any[]): any;
}
