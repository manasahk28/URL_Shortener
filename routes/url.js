const express = require("express");
const router = express.Router();
const Url = require("../models/Url");
const { generateShortCode } = require("../utils/generateCode");
const { urlCache } = require("../utils/cache");
const { createRateLimiter } = require("../middleware/rateLimiter");

// Rate limit creation to 30 requests per minute per IP
const shortenRateLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: "Rate limit exceeded: You have created too many short URLs. Please wait a minute."
});

const RESERVED_ALIASES = new Set([
    "api",
    "public",
    "health",
    "metrics",
    "analytics",
    "admin",
    "favicon.ico",
    "robots.txt"
]);

/**
 * Validates HTTP or HTTPS URL structure
 */
function isValidUrl(urlString) {
    try {
        const parsed = new URL(urlString);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * Light device detection based on User-Agent header
 */
function detectDevice(userAgent = "") {
    const ua = userAgent.toLowerCase();
    if (/mobile|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return "Mobile";
    if (/tablet|ipad|android(?!.*mobile)/i.test(ua)) return "Tablet";
    return "Desktop";
}

/**
 * POST /api/urls
 * Shorten a new URL with optional custom alias and expiration (rate-limited)
 */
router.post("/api/urls", shortenRateLimiter, async (req, res) => {
    try {
        const { url, customAlias, expiresInDays, expiresAt } = req.body;

        if (!url) {
            return res.status(400).json({ error: "URL is required in request body" });
        }

        if (!isValidUrl(url)) {
            return res.status(400).json({
                error: "Invalid URL. Please provide a valid HTTP or HTTPS URL (e.g. https://example.com)."
            });
        }

        let shortCode;
        let isCustom = false;

        // Custom Alias Validation
        if (customAlias) {
            const alias = customAlias.trim();

            if (!/^[a-zA-Z0-9_-]{3,30}$/.test(alias)) {
                return res.status(400).json({
                    error: "Custom alias must be between 3 and 30 characters and contain only letters, numbers, hyphens, and underscores."
                });
            }

            if (RESERVED_ALIASES.has(alias.toLowerCase())) {
                return res.status(400).json({
                    error: `'${alias}' is a reserved keyword and cannot be used as an alias.`
                });
            }

            const existing = await Url.findOne({ shortCode: alias });
            if (existing) {
                return res.status(409).json({
                    error: "Custom alias is already taken. Please choose another one."
                });
            }

            shortCode = alias;
            isCustom = true;
        } else {
            // Generate collision-checked Base62 code
            let isUnique = false;
            let attempts = 0;

            while (!isUnique && attempts < 5) {
                shortCode = generateShortCode(6);
                const existing = await Url.findOne({ shortCode });
                if (!existing && !RESERVED_ALIASES.has(shortCode.toLowerCase())) {
                    isUnique = true;
                }
                attempts++;
            }

            if (!isUnique) {
                return res.status(500).json({ error: "Failed to generate unique short code. Please try again." });
            }
        }

        // Expiration handling
        let expirationDate = null;
        if (expiresInDays) {
            const days = parseInt(expiresInDays, 10);
            if (isNaN(days) || days <= 0 || days > 365) {
                return res.status(400).json({ error: "expiresInDays must be an integer between 1 and 365." });
            }
            expirationDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
        } else if (expiresAt) {
            expirationDate = new Date(expiresAt);
            if (isNaN(expirationDate.getTime()) || expirationDate <= new Date()) {
                return res.status(400).json({ error: "expiresAt must be a valid future ISO date." });
            }
        }

        const newUrl = new Url({
            originalUrl: url,
            shortCode,
            isCustom,
            expiresAt: expirationDate
        });

        await newUrl.save();

        // Warm up cache for fast first read
        await urlCache.set(shortCode, {
            originalUrl: newUrl.originalUrl,
            expiresAt: newUrl.expiresAt
        });

        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

        return res.status(201).json({
            message: "Short URL generated successfully",
            shortCode: newUrl.shortCode,
            originalUrl: newUrl.originalUrl,
            shortUrl: `${baseUrl}/${newUrl.shortCode}`,
            isCustom: newUrl.isCustom,
            clicks: newUrl.clicks,
            expiresAt: newUrl.expiresAt,
            createdAt: newUrl.createdAt
        });
    } catch (error) {
        console.error("Error creating short URL:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /api/urls/:shortCode/analytics
 * Detailed analytics for a shortened URL
 */
router.get("/api/urls/:shortCode/analytics", async (req, res) => {
    try {
        const { shortCode } = req.params;
        const urlDoc = await Url.findOne({ shortCode });

        if (!urlDoc) {
            return res.status(404).json({ error: "Short URL not found" });
        }

        const isExpired = urlDoc.expiresAt ? new Date() > new Date(urlDoc.expiresAt) : false;

        // Device breakdown
        const deviceBreakdown = { Desktop: 0, Mobile: 0, Tablet: 0 };
        const referrers = {};

        urlDoc.clickHistory.forEach((c) => {
            const dev = c.deviceType || "Desktop";
            deviceBreakdown[dev] = (deviceBreakdown[dev] || 0) + 1;

            const ref = c.referer || "Direct";
            referrers[ref] = (referrers[ref] || 0) + 1;
        });

        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

        return res.json({
            shortCode: urlDoc.shortCode,
            originalUrl: urlDoc.originalUrl,
            shortUrl: `${baseUrl}/${urlDoc.shortCode}`,
            clicks: urlDoc.clicks,
            isCustom: urlDoc.isCustom,
            isExpired,
            expiresAt: urlDoc.expiresAt,
            lastAccessedAt: urlDoc.lastAccessedAt,
            createdAt: urlDoc.createdAt,
            deviceBreakdown,
            referrers,
            recentClicks: urlDoc.clickHistory.slice(-20).reverse()
        });
    } catch (error) {
        console.error("Error fetching analytics:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /api/urls/:shortCode
 * Quick summary stats for a short code
 */
router.get("/api/urls/:shortCode", async (req, res) => {
    try {
        const { shortCode } = req.params;
        const urlDoc = await Url.findOne({ shortCode });

        if (!urlDoc) {
            return res.status(404).json({ error: "Short URL not found" });
        }

        const isExpired = urlDoc.expiresAt ? new Date() > new Date(urlDoc.expiresAt) : false;
        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;

        return res.json({
            shortCode: urlDoc.shortCode,
            originalUrl: urlDoc.originalUrl,
            shortUrl: `${baseUrl}/${urlDoc.shortCode}`,
            clicks: urlDoc.clicks,
            isCustom: urlDoc.isCustom,
            isExpired,
            expiresAt: urlDoc.expiresAt,
            lastAccessedAt: urlDoc.lastAccessedAt,
            createdAt: urlDoc.createdAt
        });
    } catch (error) {
        console.error("Error fetching URL stats:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * GET /:shortCode
 * Redirect to original URL using Cache-Aside pattern
 */
router.get("/:shortCode", async (req, res) => {
    try {
        const { shortCode } = req.params;

        const userAgent = req.get("user-agent") || "Unknown";
        const referer = req.get("referer") || req.get("referrer") || "Direct";
        const deviceType = detectDevice(userAgent);

        // 1. Check Distributed Redis / In-Memory Cache (Cache-Aside pattern)
        const cached = await urlCache.get(shortCode);

        if (cached) {
            // Check expiration on cached record
            if (cached.expiresAt && new Date() > new Date(cached.expiresAt)) {
                await urlCache.del(shortCode);
                return res.status(410).json({
                    error: "This short URL has expired",
                    expiredAt: cached.expiresAt
                });
            }

            res.setHeader("X-Cache", "HIT");

            // Log analytics asynchronously without blocking the redirect response
            Url.updateOne(
                { shortCode },
                {
                    $inc: { clicks: 1 },
                    $set: { lastAccessedAt: new Date() },
                    $push: {
                        clickHistory: {
                            $each: [{ timestamp: new Date(), referer, userAgent, deviceType }],
                            $slice: -50
                        }
                    }
                }
            ).catch(err => console.error("Async click tracking error:", err));

            return res.redirect(cached.originalUrl);
        }

        // 2. Cache Miss: Query MongoDB
        res.setHeader("X-Cache", "MISS");
        const urlDoc = await Url.findOne({ shortCode });

        if (!urlDoc) {
            return res.status(404).json({ error: "Short URL not found" });
        }

        // Check Expiration
        if (urlDoc.expiresAt && new Date() > new Date(urlDoc.expiresAt)) {
            return res.status(410).json({
                error: "This short URL has expired",
                expiredAt: urlDoc.expiresAt
            });
        }

        // Populate cache for subsequent lookups
        await urlCache.set(shortCode, {
            originalUrl: urlDoc.originalUrl,
            expiresAt: urlDoc.expiresAt
        });

        // Atomically increment clicks and log event
        await Url.updateOne(
            { _id: urlDoc._id },
            {
                $inc: { clicks: 1 },
                $set: { lastAccessedAt: new Date() },
                $push: {
                    clickHistory: {
                        $each: [{
                            timestamp: new Date(),
                            referer,
                            userAgent,
                            deviceType
                        }],
                        $slice: -50
                    }
                }
            }
        );

        return res.redirect(urlDoc.originalUrl);
    } catch (error) {
        console.error("Error during redirection:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
