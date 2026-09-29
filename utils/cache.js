const Redis = require("ioredis");

/**
 * Fallback in-memory cache if Redis is offline
 */
class MemoryCache {
    constructor() {
        this.store = new Map();
    }

    get(key) {
        const entry = this.store.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }

    set(key, value, ttlSeconds = 3600) {
        this.store.set(key, {
            value,
            expiresAt: Date.now() + ttlSeconds * 1000
        });
    }

    del(key) {
        this.store.delete(key);
    }

    get size() {
        return this.store.size;
    }
}

const memoryFallback = new MemoryCache();

let redis = null;
let isRedisConnected = false;

// Initialize Redis if REDIS_URL is provided or default to localhost
const redisUrl = process.env.REDIS_URL;

if (redisUrl) {
    try {
        redis = new Redis(redisUrl, {
            maxRetriesPerRequest: 1,
            retryStrategy(times) {
                // If Redis is not available locally, back off quickly without spamming logs
                if (times > 3) return null;
                return Math.min(times * 1000, 3000);
            },
            reconnectOnError() {
                return false;
            },
            lazyConnect: true
        });

        redis.connect()
            .then(() => {
                isRedisConnected = true;
                console.log("⚡ Connected to Redis distributed cache successfully");
            })
            .catch(() => {
                isRedisConnected = false;
                console.log("ℹ️  Redis not reachable at " + redisUrl + ". Falling back to in-memory caching.");
            });

        redis.on("error", () => {
            isRedisConnected = false;
        });

        redis.on("connect", () => {
            isRedisConnected = true;
        });

        redis.on("close", () => {
            isRedisConnected = false;
        });
    } catch {
        isRedisConnected = false;
    }
} else {
    console.log("ℹ️  No REDIS_URL configured. Using high-performance in-memory cache.");
}

/**
 * Unified Distributed Cache Manager with automatic in-memory fallback
 */
const urlCache = {
    /**
     * Get URL record from Redis or in-memory fallback
     * @param {string} shortCode
     * @returns {Promise<object|null>}
     */
    async get(shortCode) {
        const key = `url:${shortCode}`;

        if (isRedisConnected && redis) {
            try {
                const data = await redis.get(key);
                if (data) return JSON.parse(data);
            } catch (err) {
                console.warn("Redis read error, falling back to memory:", err.message);
            }
        }

        return memoryFallback.get(key);
    },

    /**
     * Store URL record in Redis and in-memory fallback
     * @param {string} shortCode
     * @param {object} value
     * @param {number} ttlSeconds - defaults to 1 hour (3600s)
     */
    async set(shortCode, value, ttlSeconds = 3600) {
        const key = `url:${shortCode}`;
        const serialized = JSON.stringify(value);

        if (isRedisConnected && redis) {
            try {
                await redis.set(key, serialized, "EX", ttlSeconds);
            } catch (err) {
                console.warn("Redis write error, writing to memory:", err.message);
            }
        }

        memoryFallback.set(key, value, ttlSeconds);
    },

    /**
     * Invalidate cached short URL
     * @param {string} shortCode
     */
    async del(shortCode) {
        const key = `url:${shortCode}`;

        if (isRedisConnected && redis) {
            try {
                await redis.del(key);
            } catch (err) {
                console.warn("Redis delete error:", err.message);
            }
        }

        memoryFallback.del(key);
    },

    /**
     * Cache health & metrics
     */
    isRedisActive() {
        return isRedisConnected;
    },

    getMemorySize() {
        return memoryFallback.size;
    }
};

module.exports = { urlCache, redis };
