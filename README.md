# nani: event streaming and notification service using PAPI

> **Stream blockchain events in real-time. Built for wallets, portfolio trackers, analytics platforms, and notification services on Polkadot.**

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Polkadot](https://img.shields.io/badge/Polkadot-E6007A?style=flat&logo=polkadot&logoColor=white)](https://polkadot.network/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Built for Polkadot**

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
# Server
PORT=3000
NODE_ENV=development

# Auth
JWT_SECRET=your-super-secret-jwt-key-here

# Endpoints
WESTEND_RPC_URLS=wss://westend-rpc.polkadot.io,wss://westend-rpc.dwellir.com
ASSETHUB_RPC_URLS=wss://westend-asset-hub-rpc.polkadot.io

# Encryption
ENCRYPTION_KEY=32-character-aes-key-1234567890

# Twilio
TWILIO_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_TOKEN=your_twilio_auth_token
TWILIO_FROM=+15551234567

# SMTP (Gmail example)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM="Nani Alerts" <you@gmail.com>

# Rate limiting
# (defaults are fine)
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

- Production Build:

```bash
npm run build
npm start
```

- Verify Installation

```bash
  # Check health endpoint
  curl -X GET http://localhost:3000/health                                                                      
```

**Expected Response**:

```json
{
  "status":"ok",
  "timestamp":"2025-11-06T21:04:27.548Z","
  papi":{
      "westend":"connected",
      "asset-hub-westend":"connected"
  },
  "stats":{
    "activeTenants":1,
    "eventsProcessed24h":0,
    "notificationsSent24h":0,
    "uptimeHours":0.05
  },"
  system":{
    "memoryUsageMB":214,
    "cpuPercent":13.7
  },
  "cluster":{
    "workerId":6,
    "pid":23024,
    "role":"rest"
  }
}
```

 **Authentication**(email)

```bash
 curl -X POST http://localhost:3000/auth -H "Content-Type: application/json"  -d '{"email": "cenwadike@gmail.com"}'
 ```

 **Authentication**(wallet)

 ```bash
  curl -X POST http://localhost:3000/auth \
    -H "Content-Type: application/json" \
    -d '{
      "address": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
      "signature": "0x...",
      "message": "Sign in to Nani at 2025-11-04T12:00:00.000Z"
    }'
 ```

 **Expected Response**:

```json
{
  "token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0ZW5hbnRJZCI6ImIzZWQ2MTdlMDA1Y2U0ZGIiLCJlbWFpbCI6ImNlbndhZGlrZUBnbWFpbC5jb20iLCJpYXQiOjE3NjIyMTAwMjIsImV4cCI6MTc2NDgwMjAyMn0.GrKypWHQv5CVQ8u4E0F7xTQWk5Ga0CYMgPqNqX02qYM","tenantId":"b3ed617e005ce4db"
}
```

 **Setup**
```json
  curl -X POST http://localhost:3000/setup \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0ZW5hbnRJZCI6ImIzZWQ2MTdlMDA1Y2U0ZGIiLCJlbWFpbCI6ImNlbndhZGlrZUBnbWFpbC5jb20iLCJtZXRob2QiOiJlbWFpbCIsImlhdCI6MTc2MjM2MzAxOCwiZXhwIjoxNzY0OTU1MDE4fQ.NAUl7gYF0d5CABeETaICQ0WHZUBhCA0P6xP2WN1N3gk" \
  -H "Content-Type: application/json" \
  -d '{
    "setups": [
      {
        "chainId": "westend",
        "address": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        "plugins": {
          "activities": ["extrinsics", "staking", "governance", "transfers"],
          "notifications": [
            {
              "type": "discord",
              "config": {
                "webhook": "https://discord.com/api/webhooks/1234567890/abcXYZ"
              }
            },
            {
              "type": "email",
              "config": {
                "to": "alice@example.com",
                "subject": "[Nani] Westend Activity",
                "html": true
              }
            }
          ]
        }
      },
      {
        "chainId": "asset-hub-westend",
        "address": "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
        "plugins": {
          "activities": ["extrinsics", "staking", "governance", "transfers"],
          "notifications": [ 
            {
              "type": "email",
              "config": {
                "to": "alice@example.com",
                "subjectPrefix": "[AssetHub]"
              }
            },
            {
              "type": "sms",
              "config": {
                "phone": "+15551234567"
              }
            }
          ]
        }
      }
    ]
  }'             
```
  **Expectated Response**

```json
  {
    "success":true,
    "message":"All chain configs saved",
    "results":[
      {
        "chainId":"westend",
        "success":true,
        "address":"15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5",
        "tokenSymbol":"WND"
      },
      {
        "chainId":"asset-hub-westend",
        "success":true,
        "address":"15oF4uVJwmo4TdGW7VfQxNLavjCXviqxT9S1MgbjMNHr6Sp5",
        "tokenSymbol":"WND"
      }
    ]
  } 
```

 **Analytics**

```bash
 curl -X GET "http://localhost:3000/stats?chainId=westend&from=2025-11-01&to=2025-11-05" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0ZW5hbnRJZCI6ImIzZWQ2MTdlMDA1Y2U0ZGIiLCJlbWFpbCI6ImNlbndhZGlrZUBnbWFpbC5jb20iLCJtZXRob2QiOiJlbWFpbCIsImlhdCI6MTc2MjM2OTA5NiwiZXhwIjoxNzY0OTYxMDk2fQ.kl_soS_4LgkpAdfJ4FI9Pkko5btgOx-moH1eBvurA70" | jq . 
```

 **Response**
```json
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                 Dload  Upload   Total   Spent    Left  Speed
100   480  100   480    0     0  17551      0 --:--:-- --:--:-- --:--:-- 17777

{
  "plugin": "basic",
  "filters": {
    "chainId": "westend",
    "from": "2025-11-01",
    "to": "2025-11-05"
  },
  "result": {
    "logsProcessed": 0,
    "stats": {
      "totalEvents": 0,
      "incoming": 0,
      "outgoing": 0,
      "totalAmountIn": 0,
      "totalAmountOut": 0,
      "firstEvent": null,
      "lastEvent": null
    }
  },
  "storage": {
    "totalSizeBytes": 0,
    "logFileCount": 0,
    "chainCount": 2,
    "chains": [
      {
        "chainId": "asset-hub-westend",
        "logCount": 0,
        "sizeBytes": 0
      },
      {
        "chainId": "westend",
        "logCount": 0,
        "sizeBytes": 0
      }
    ],
    "totalSizeMB": 0
  },
  "generatedAt": "2025-11-05T18:59:05.090Z"
}
```

 **Export**
 ```bash
   curl -J -O \
  -G "http://localhost:3000/export" \
  -H "tenantId: b3ed617e005ce4db" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0ZW5hbnRJZCI6ImIzZWQ2MTdlMDA1Y2U0ZGIiLCJlbWFpbCI6ImNlbndhZGlrZUBnbWFpbC5jb20iLCJtZXRob2QiOiJlbWFpbCIsImlhdCI6MTc2MjM2NjUwMiwiZXhwIjoxNzY0OTU4NTAyfQ.tFd6E9HB9n8o3XpF5LUyY4Kkz0bgJqZ4uuR7kGN7HU8" \
  --data-urlencode "chainId=westend" \
  --data-urlencode "type=transfer,staking,governance" \
  --data-urlencode "format=csv"
 ```

 **Response**
 ```sh
  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current
                                  Dload  Upload   Total   Spent    Left  Speed
  100    33  100    33    0     0   1582      0 --:--:-- --:--:-- --:--:--  1650
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
