/**
 * Sliding Window Rate Limiter Middleware
 * Protects endpoints from abuse and DoS attacks by tracking request timestamps per client IP.
 */
function createRateLimiter({ windowMs = 60 * 1000, maxRequests = 20, message = "Too many requests. Please slow down." } = {}) {
    const clients = new Map();

    // Periodic cleanup of stale client IP records every 5 minutes
    setInterval(() => {
        const now = Date.now();
        for (const [ip, timestamps] of clients.entries()) {
            const active = timestamps.filter(t => now - t < windowMs);
            if (active.length === 0) {
                clients.delete(ip);
            } else {
                clients.set(ip, active);
            }
        }
    }, 5 * 60 * 1000).unref(); // unref ensures interval doesn't block process exit

    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress || "127.0.0.1";
        const now = Date.now();

        const timestamps = clients.get(ip) || [];
        // Keep only requests made within the current sliding window
        const validTimestamps = timestamps.filter(t => now - t < windowMs);

        const currentCount = validTimestamps.length;
        const remaining = Math.max(0, maxRequests - currentCount - 1);
        const oldestTimestamp = validTimestamps[0] || now;
        const resetSeconds = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

        // Standard rate limit response headers
        res.setHeader("X-RateLimit-Limit", maxRequests);
        res.setHeader("X-RateLimit-Remaining", remaining);
        res.setHeader("X-RateLimit-Reset", Math.max(1, resetSeconds));

        if (currentCount >= maxRequests) {
            res.setHeader("Retry-After", Math.max(1, resetSeconds));
            return res.status(429).json({
                error: message,
                limit: maxRequests,
                retryAfterSeconds: Math.max(1, resetSeconds)
            });
        }

        validTimestamps.push(now);
        clients.set(ip, validTimestamps);
        next();
    };
}

module.exports = { createRateLimiter };
