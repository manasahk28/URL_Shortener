# 🔗 Distributed URL Shortener

A high-performance, production-ready distributed URL shortening service built with **Node.js, Express, MongoDB Atlas, and Nginx**.

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
                                         │  (Round-Robin / Health-Aware)
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

## ✨ Features & Engineering Highlights

| Feature | Description | Engineering Design |
| :--- | :--- | :--- |
| **Base62 Encoding** | Collision-checked 6-char IDs (`a-z`, `A-Z`, `0-9`) | $62^6 \approx 56.8 \text{ billion}$ unique combinations |
| **Custom Aliases** | Custom user-chosen paths (`/myportfolio`) | RegEx validation, uniqueness check & reserved route guard |
| **Link Expiration** | Auto-expiring links (`expiresInDays` / `expiresAt`) | Evaluated at lookup; returns `HTTP 410 Gone` once expired |
| **Real-time Analytics** | Clicks, device type (Desktop/Mobile/Tablet), referrers | Atomic MongoDB updates (`$inc`, `$push` capped array) |
| **Cache-Aside Pattern** | In-memory key-value cache layer | Immediate redirects (`< 1ms`), sets `X-Cache: HIT/MISS` |
| **Sliding-Window Rate Limiter** | IP-based request throttling on creation API | Protects against DoS; returns `HTTP 429` & `Retry-After` |
| **Multi-Core Clustering** | Native Node.js `cluster` runner | Forks worker processes across CPU cores with auto-healing |
| **Docker & Nginx** | Multi-container setup with reverse proxy | Distributes traffic across 3 independent Node instances |

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB Atlas URI (or local MongoDB)

### 1. Installation
```bash
git clone <repo-url>
cd URL_Shortener
npm install
```

### 2. Environment Variables (`.env`)
```env
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/urlshortener?retryWrites=true&w=majority
PORT=3000
BASE_URL=http://localhost:3000
```

### 3. Run the Application

#### Option A: Development Server (with Live Reload)
```bash
npm run dev
```

#### Option B: Multi-Core Cluster (Production)
```bash
npm run cluster
```

#### Option C: Distributed Cluster via Docker Compose (3 Node Instances + Nginx)
```bash
docker-compose up --build
```
*Access the service via Nginx at `http://localhost:8080`.*

---

## 📡 API Reference

### 1. Shorten a URL
- **Endpoint**: `POST /api/urls`
- **Headers**: `Content-Type: application/json`
- **Body**:
```json
{
  "url": "https://www.example.com/products/category/item?id=928374",
  "customAlias": "my-phone",       // optional
  "expiresInDays": 7               // optional (1-365)
}
```
- **Response** (`201 Created`):
```json
{
  "message": "Short URL generated successfully",
  "shortCode": "my-phone",
  "originalUrl": "https://www.example.com/products/category/item?id=928374",
  "shortUrl": "http://localhost:3000/my-phone",
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
  - `X-Served-By`: e.g. `server-1` / `instance-28480`
  - `X-Cache`: `HIT` or `MISS`

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
  "recentClicks": [ ... ]
}
```

### 4. Health Check (Load Balancer Probe)
- **Endpoint**: `GET /api/health`
- **Response** (`200 OK`):
```json
{
  "status": "healthy",
  "instanceId": "instance-28480",
  "uptimeSeconds": 120,
  "memoryUsageMb": 21.4,
  "mongoConnected": true
}
```

---

## 💡 System Design Q&A (Interview Ready)

### Why Base62 instead of Base64?
Base64 includes `+` and `/`, which are URL-reserved characters requiring percent-encoding. Base62 only uses `[0-9a-zA-Z]`, which is safe for URLs without escaping.

### How are collisions handled?
When generating a random Base62 code, our service checks MongoDB and the in-memory cache. In case of collision, a retry loop regenerates a new key (up to 5 attempts). At $62^6$ possibilities, collision probability is minuscule.

### What is the Cache-Aside pattern?
1. The application first checks the cache.
2. If hit $\rightarrow$ returns immediately without contacting MongoDB.
3. If miss $\rightarrow$ reads from MongoDB, stores in cache with TTL, and returns.
4. On redirect, analytics logging is performed asynchronously to keep redirect latency sub-millisecond.

### How does the service scale horizontally?
Node instances are stateless. Session state or shared data resides in MongoDB Atlas (and Redis for distributed caching). Adding more Node.js instances behind Nginx requires zero code changes.
