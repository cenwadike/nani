# nani: event streaming and notification service using PAPI

> **Stream blockchain events in real-time. Built for wallets, portfolio trackers, analytics platforms, and notification services on Polkadot.**

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Polkadot](https://img.shields.io/badge/Polkadot-E6007A?style=flat&logo=polkadot&logoColor=white)](https://polkadot.network/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Built for Polkadot Africa Mentorship | October 2025**

## Overview

**Nani** is a multi-tenant event streaming service built on the Polkadot API (PAPI). It listens to real-time events from the Westend testnet, filters them per user, logs them securely, and dispatches instant notifications through pluggable channels like SMS and Discord.

This project demonstrates how to build scalable, secure, and extensible blockchain infrastructure using PAPI.

### **Perfect For Building**

| Use Case | What Nani Provides |
| --- | --- |
| 💼 **Portfolio Trackers** | Real-time balance updates, transaction history, PnL calculations |
| 👛 **Wallet Backends** | Account monitoring, push notifications, transaction feeds |
| 📊 **Analytics Dashboards** | Aggregated stats, export capabilities, custom metrics |
| 🔔 **Alert Services** | Instant notifications via SMS/Discord/Email for on-chain events |
| 🤖 **Trading Bots** | Real-time event triggers for automated trading strategies |
| 📱 **Mobile Apps** | Lightweight REST API for iOS/Android wallet applications |

### **🚀 Key Features**

**Core Capabilities**

- 🌐 **Single WebSocket, Infinite Users** - One PAPI connection serves all tenants
- 🔐 **Bank-Grade Security** - JWT authentication + AES-256 encrypted storage
- ⚡ **Sub-Second Latency** - Events processed within milliseconds of block finalization
- 🔌 **Plug-and-Play Extensions** - Add features by dropping files, no recompilation

**Event Processing**

- 📝 **Activity Logging** - capture of transfer events (staking and governance)
- 📊 **Real-Time Analytics** - Compute statistics without external databases
- 🎯 **Smart Filtering** - Per-user event filtering with configurable rules
- 💾 **Data Export** - CSV/JSON export for external analysis

**Notifications**

- 📱 **Multi-Channel Alerts** - SMS (Twilio), Discord webhooks
- 🔄 **Fault-Tolerant** - Parallel dispatch with automatic retries
- ⚙️ **Configurable** - Per-user notification preferences
- 🌍 **Rate-Limited** - Built-in protection against spam

**Developer Experience**

- 🎨 **REST API** - Clean, documented endpoints with cURL examples
- 📘 **TypeScript** - Full type safety and IDE autocomplete
- 📦 **Lightweight** - <500MB memory, <1000 LOC

## **🏗️ Architecture**

Nani implements an event-driven architecture optimized for multi-tenant blockchain monitoring:

```bash
┌───────────────────────────────────────────────────────────┐
│                    Westend RPC Node                       │
│              wss://westend-rpc.polkadot.io                │
└────────────────────────┬──────────────────────────────────┘
                         │ Single WebSocket
                         ▼
┌───────────────────────────────────────────────────────────┐
│                  PAPI ApiPromise                          │
│            api.query.system.events()                      │
│  - Auto-reconnect with exponential backoff                │
│  - Heartbeat pings every 30                               │
└────────────────────────┬──────────────────────────────────┘
                         │ Event Stream
                         ▼
┌───────────────────────────────────────────────────────────┐
│              Event Processing Loop                        │
│  - Per-block event iteration                              │
│  - Multi-tenant filtering                                 │
│  - Parallel plugin execution                              │
└────────────-────────────────-──────────────-──────────────┘
        │                │              │
        ▼                ▼              ▼
┌────────────┐   ┌────────────┐   ┌────────────┐
│ Activity   │   │ Storage    │   │Notification│
│ Plugins    │   │ Layer      │   │ Plugins    │
│            │   │            │   │            │
│ • Transfer │   │ • Encrypt  │   │ • SMS      │
│ • Staking  │   │ • Compress │   │ • Discord  │
│ • Govern.  │   │ • Archive  │   │ • Email    │
└────────────┘   └──────-─────┘   └──────-─────┘
        │           
        ▼           
┌────────────────┐  
│ Encrypted JSON │  
│ File Storage   │  
└────────┬───────┘  
         │
         ▼
┌─────────────────┐
│   Stats Engine  │
│  • Aggregations │
│  • Analytics    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   REST API      │
│  • /auth        │
│  • /setup       │
│  • /stats       │
│  • /export      │
└─────────────────┘
```

### **Data Flow**

1. **Connection**: PAPI establishes a WebSocket to Westend RPC
2. **Subscription**: Single `system.events` Subscription captures all on-chain events
3. **Distribution**: Each event is checked against all tenant configurations
4. **Filtering**: Activity plugins determine relevance per tenant
5. **Logging**: Matched events are encrypted and appended to tenant storage
6. **Notification**: Parallel dispatch to configured channels (non-blocking)
7. **Aggregation**: Stats computed on-demand from encrypted logs
8. **API**: RESTful endpoints expose data to client applications

## **📂 Project Structure**

```bash
nani/
├── 🔏cluster.ts# Entry point for REST API workers and event streamer
├── 📄 server.ts# Express server + PAPI subscription loop
├── ⚙️ config.ts# Environment variable configuration
│
├── 🔐 middlewares/
│   ├── auth.ts# JWT verification middleware + API rate limiting(10 req/min)
│   └── errorHandler.ts# Global error handler
│
├── 🔌 plugins/
│   ├── activities/
│   │   ├── transfers.ts# Balance transfer logger
│   │   └── [staking.ts]# [Example extension]
│   ├── notifications/
│   │   ├── sms.ts# Twilio SMS integration
│   │   ├── discord.ts# Discord webhook sender
│   │   └── [email.ts]# [Example extension]
│   └── stats/
│       └── basic.ts# Transfer statistics computer
│
├── 🛣️  routes/
│   ├── auth.ts# POST /auth - JWT generation
│   ├── setup.ts# POST /setup - Account configuration
│   ├── stats.ts# GET /stats - Query analytics
│   └── export.ts# GET /export - Download logs
│
├── 🛠️  utils/
│   ├── pluginRegistry.ts# Dynamic plugin loader
│   ├── papi.ts# PAPI connection manager
│   └── storage.ts# Encrypted file storage
│   └── ...# other core utilities
│
├── 📘 types/
│   └── pluginTypes.ts# TypeScript interfaces
│
├── 📦 package.json# Dependencies & scripts
├── 🔧 tsconfig.json# TypeScript configuration
├── 📝 .env.example# Environment template
└── 📖 README.md# This file
```

## **🧩 Plugin System**

Nani's extensibility comes from its dynamic plugin system. Plugins are automatically discovered and loaded at startup.

### **Plugin Interfaces**

```tsx
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
```

### **🔹 Activity Plugins**

- `transfers`: Detects balance transfers involving the tenant’s address.

### **🔹 Notification Plugins**

- `sms`: Sends SMS via Twilio
- `discord`: Posts to Discord channels

Each plugin is dynamically loaded from the `/plugins` directory, no hardcoding required.

## **📦 Setup & Usage**

### **Prerequisites**

- **Node.js** v18 or higher ([Download](https://nodejs.org/))
- **Westend Account** with WND tokens

### **1. Clone & Install**

```bash
git clone https://github.com/cenwadike/nani

cd nani

npm install
```

### **2. Configure .env**

```bash
# Server Configuration
PORT=3000
NODE_ENV=development

# Polkadot API Connection
PAPI_WS=wss://westend-rpc.polkadot.io

# Security Keys (generate strong random values)
# Generate JWT secret: openssl rand -base64 32
JWT_SECRET=your-super-secret-jwt-key-min-32-characters
# Generate encryption key: openssl rand -base64 32
ENCRYPTION_KEY=your-256-bit-encryption-key-for-storage

# Twilio SMS Notifications (optional)
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-twilio-auth-token-here
TWILIO_FROM_NUMBER=+1234567890

# Discord Webhook (optional)
DISCORD_WEBHOOK=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
```

### **3. Build & Run**

```bash
npm run build

npm start
```

### **4. API Endpoints**

| **Method** | **Endpoint** | **Description** |
| --- | --- | --- |
| POST | /auth | Register tenant |
| POST | /setup | Configure address + plugins |
| GET | /stats | View aggregated stats |
| GET | /export | Download logs |
| GET | /health | Check server status |

### **Running the Service**

- Development Mode (with hot reload):

```bash
npm run dev
```

- Production Build:

```bash
npm run build
npm start
```

- Verify Installation

```bash
# Check health endpoint
curl http://localhost:3000/health

```

**Expected Response**:

```json
{
  "status": "ok",
  "papi": "connected",
  "uptime": 123,
  "timestamp": "2025-10-03T12:00:00.000Z"
}
```

## **📊 Back of the envelope performance**

- 16GB RAM, 1TB storage, 2.5 GHz octacore CPU, 1 Gbps internet
- **100,000+** tenants
- **3,000+ notifications/sec** on 8-core machine
- **<100ms latency** for most events
- **Multi-process clustering** ensures scalability
- **Async plugin execution**
  
## **🧠 Developer Insights**

### **🔹 Why PAPI?**

PAPI provides a robust WebSocket interface to subscribe to on-chain events. It abstracts away node synchronization, websocket complexity, and event decoding, and lets developers focus on business logic.

### **🔹 Lessons Learned**

- **Clustering is essential** for scaling Node.js apps.
- **Plugin architecture** makes the system extensible and maintainable.
- **Event filtering** must be precise to avoid noisy logs and false alerts.

### **🔹 Challenges**

- Understanding and handling Polkadot’s complex event structure
- Ensuring plugin isolation and fault tolerance
- Managing tenant-specific configurations securely

## **📚 References**

- PAPI Documentation
- Polkadot API Resources
- Polkadot API Github

## **✅ Conclusion**

Nani showcases how to build a real-time blockchain event engine using PAPI. It’s scalable, secure, and developer-friendly, ready to power wallets, bots, and dashboards across the Polkadot ecosystem.

Feel free to fork, extend, or deploy your own version. Contributions welcome!
