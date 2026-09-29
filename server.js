const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config();

const urlRoutes = require("./routes/url");
const { urlCache } = require("./utils/cache");

const app = express();

const INSTANCE_ID = process.env.INSTANCE_ID || `instance-${process.pid}`;

// Trust reverse proxy headers (Render, Nginx) for HTTPS protocol and client IPs
app.set("trust proxy", 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Attach distributed instance identifier to all responses
app.use((req, res, next) => {
    res.setHeader("X-Served-By", INSTANCE_ID);
    next();
});

// Health check endpoint for load balancers
app.get("/api/health", (req, res) => {
    const mongoConnected = mongoose.connection.readyState === 1;
    res.status(mongoConnected ? 200 : 503).json({
        status: mongoConnected ? "healthy" : "degraded",
        instanceId: INSTANCE_ID,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
        mongoConnected,
        timestamp: new Date().toISOString()
    });
});

// Cache stats endpoint
app.get("/api/cache/stats", (req, res) => {
    res.json({
        instanceId: INSTANCE_ID,
        cacheType: urlCache.isRedisActive() ? "Redis (Distributed)" : "In-Memory (Local Fallback)",
        isRedisConnected: urlCache.isRedisActive(),
        memoryFallbackKeysCount: urlCache.getMemorySize(),
        timestamp: new Date().toISOString()
    });
});

mongoose
    .connect(process.env.MONGODB_URI)
    .then(() => {
        console.log(`[${INSTANCE_ID}] MongoDB connected successfully`);
    })
    .catch((error) => {
        console.error(`[${INSTANCE_ID}] MongoDB connection failed:`, error);
    });

// Mount URL routes
app.use(urlRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`[${INSTANCE_ID}] Server running at http://localhost:${PORT}`);
});