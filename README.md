# 🔗 Distributed URL Shortener

A high-performance, production-ready distributed URL shortening service built with **Node.js, Express, MongoDB Atlas, Redis, and Nginx**.

---

## 🏗️ System Architecture

```text
                                  USERS / CLIENTS
                                         │
                                         ▼
                            ┌────────────────────────┐
                            │   Nginx Load Balancer  │
                            │      (Port: 8080)      │
                            └────────────┬───────────┘
                                         │  (Round-Robin Load Distribution)
                 ┌───────────────────────┼───────────────────────┐
                 ▼                       ▼                       ▼
       ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
       │  Node.js Worker  │    │  Node.js Worker  │    │  Node.js Worker  │
       │   [Server 1]     │    │   [Server 2]     │    │   [Server 3]     │
       │  (Port: 3000)    │    │  (Port: 3000)    │    │  (Port: 3000)    │
       └─────────┬────────┘    └─────────┬────────┘    └─────────┬────────┘
                 │                       │                       │
                 │      🛡️ Sliding-Window Rate Limiting         │
                 │                       │                       │
                 └───────────────────────┼───────────────────────┘
                                         │
                                         ▼
                            ┌────────────────────────┐
                            │    Redis (Port 6379)   │
                            │   Distributed Cache    │
                            │  (Cache-Aside Pattern) │
                            └────────────┬───────────┘
                                         │  (Cache Miss Fallback)
                                         ▼
                            ┌────────────────────────┐
                            │     MongoDB Atlas      │
                            │  (Indexed URL Mappings)│
                            └────────────────────────┘
```

---

## 📁 Repository Structure

```text
URL_Shortener/
├── models/
│   └── Url.js                 # Mongoose schema (originalUrl, shortCode, clicks, clickHistory)
├── routes/
│   └── url.js                 # API endpoints (shorten, redirect, analytics, stats)
├── middleware/
│   └── rateLimiter.js         # Sliding-window IP rate limiter
├── utils/
│   ├── cache.js               # Redis client with automatic in-memory fallback
│   └── generateCode.js        # Cryptographic Base62 code generator
├── public/
│   └── index.html             # Modern dark-mode web application & analytics dashboard
├── cluster.js                 # Native Node.js multi-core cluster runner
├── Dockerfile                 # Production container definition
├── docker-compose.yml         # 3 Node instances + Redis + Nginx cluster
├── nginx.conf                 # Nginx reverse proxy & round-robin load balancer
├── server.js                  # Express app entrypoint & health checks
└── README.md                  # Documentation & system design guide
```

---

## ✨ Features & Engineering Highlights

| Feature | Description | Engineering Design |
| :--- | :--- | :--- |
| **Base62 Encoding** | Collision-checked 6-char IDs (`a-z`, `A-Z`, `0-9`) | $62^6 \approx 56.8 \text{ billion}$ unique combinations |
| **Custom Aliases** | Custom user-chosen paths (`/myportfolio`) | Regex validation, uniqueness check & reserved route guard |
| **Link Expiration** | Auto-expiring links (`expiresInDays` / `expiresAt`) | Evaluated at lookup; returns `HTTP 410 Gone` once expired |
| **Real-time Analytics** | Clicks, device type (Desktop/Mobile/Tablet), referrers | Atomic MongoDB updates (`$inc`, `$push` capped array) |
| **Distributed Cache** | Redis key-value store with in-memory fallback | Immediate redirects (`< 1ms`), sets `X-Cache: HIT/MISS` |
| **Sliding-Window Rate Limiter** | IP-based request throttling on creation API | Protects against DoS; returns `HTTP 429` & `Retry-After` |
| **Multi-Core Clustering** | Native Node.js `cluster` runner | Forks worker processes across CPU cores with auto-healing |
| **Docker & Nginx** | 5-container cluster with reverse proxy | Distributes traffic round-robin across 3 Node.js instances |

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB Atlas URI
- Docker Desktop *(required only for multi-container deployment)*

### 1. Installation
```bash
git clone <repo-url>
cd URL_Shortener
npm install
```

### 2. Environment Variables (`.env`)
Create a `.env` file in the project root:
```env
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/urlshortener?retryWrites=true&w=majority
PORT=3000
BASE_URL=http://localhost:3000
REDIS_URL=redis://localhost:6379   # Optional for local dev; automated in Docker
```

### 3. Run the Application

#### Option A: Docker Compose (Full Distributed Production Cluster)
```bash
docker-compose up --build
```
- **Access the Web App via Nginx**: `http://localhost:8080`
- **Active Containers**: 3 Node.js servers (`web-1`, `web-2`, `web-3`), 1 Redis container, 1 Nginx load balancer.

#### Option B: Native Multi-Core Cluster (No Docker needed)
```bash
npm run cluster
```
Forks worker processes across your CPU cores on port `3000`.

#### Option C: Development Server (with nodemon live reload)
```bash
npm run dev
```
Runs a single instance at `http://localhost:3000`.

---

## 📡 API Reference

### 1. Shorten a URL
- **Endpoint**: `POST /api/urls`
- **Rate Limit**: 30 requests/minute per IP
- **Headers**: `Content-Type: application/json`
- **Body**:
```json
{
  "url": "https://www.example.com/products/category/item?id=928374",
  "customAlias": "my-phone",       // optional (3-30 chars, alphanumeric/hyphens)
  "expiresInDays": 7               // optional (1-365 days)
}
```
- **Response** (`201 Created`):
```json
{
  "message": "Short URL generated successfully",
  "shortCode": "my-phone",
  "originalUrl": "https://www.example.com/products/category/item?id=928374",
  "shortUrl": "http://localhost:8080/my-phone",
  "isCustom": true,
  "clicks": 0,
  "expiresAt": "2026-10-07T00:00:00.000Z",
  "createdAt": "2026-09-30T00:00:00.000Z"
}
```

### 2. Redirect to Target URL
- **Endpoint**: `GET /:shortCode`
- **Response**: `HTTP 302 Found` with `Location` header.
- **Headers Returned**:
  - `X-Served-By`: e.g. `server-1`, `server-2`, or `server-3`
  - `X-Cache`: `HIT` (from Redis) or `MISS` (from MongoDB)

### 3. View Detailed Link Analytics
- **Endpoint**: `GET /api/urls/:shortCode/analytics`
- **Response** (`200 OK`):
```json
{
  "shortCode": "my-phone",
  "originalUrl": "https://www.example.com/products/category/item?id=928374",
  "clicks": 42,
  "isExpired": false,
  "lastAccessedAt": "2026-09-30T01:14:00.000Z",
  "deviceBreakdown": {
    "Desktop": 28,
    "Mobile": 12,
    "Tablet": 2
  },
  "referrers": {
    "Direct": 20,
    "https://twitter.com": 14,
    "https://linkedin.com": 8
  },
  "recentClicks": [
    {
      "timestamp": "2026-09-30T01:14:00.000Z",
      "referer": "https://twitter.com",
      "deviceType": "Mobile"
    }
  ]
}
```

### 4. Quick Link Stats
- **Endpoint**: `GET /api/urls/:shortCode`
- Returns summary click count, target URL, and expiration date.

### 5. Health Check (Load Balancer Probe)
- **Endpoint**: `GET /api/health`
- **Response** (`200 OK`):
```json
{
  "status": "healthy",
  "instanceId": "server-1",
  "uptimeSeconds": 340,
  "memoryUsageMb": 24.1,
  "mongoConnected": true
}
```

### 6. Cache Stats
- **Endpoint**: `GET /api/cache/stats`
- Returns active cache type (`Redis (Distributed)` vs `In-Memory (Local Fallback)`), connection status, and key counts.

---

## 💡 System Design Q&A (Interview Ready)

### Why Base62 instead of Base64?
Base64 includes `+` and `/`, which are URL-reserved characters requiring percent-encoding in query parameters or URL paths. Base62 only uses standard alphanumeric characters `[0-9a-zA-Z]`, which are completely safe for URLs without escaping.

### How does the Cache-Aside pattern work here?
1. On `GET /:shortCode`, the server checks Redis.
2. **Cache Hit**: The server redirects immediately without querying MongoDB, cutting response times to `< 1ms`. Click tracking is logged asynchronously to avoid blocking user redirection.
3. **Cache Miss**: The server fetches the record from MongoDB Atlas, writes it to Redis with a TTL, and performs the redirect.

### Why Redis instead of In-Memory caching in a distributed setup?
In a multi-server setup behind a load balancer, In-Memory caching leads to **cache fragmentation** (Server 1 doesn't know what Server 2 cached). By using a centralized Redis container, all workers (`web-1`, `web-2`, `web-3`) share a unified cache pool, guaranteeing high cache hit ratios regardless of which server Nginx routes the request to.

### How does the service scale horizontally?
All Node.js backend instances are completely **stateless**. Session state and persistent data reside in MongoDB Atlas, and transient cache state lives in Redis. Scaling to 10 or 50 servers simply requires adjusting the `replicas` count in `docker-compose.yml` or adding entries to `nginx.conf`.
