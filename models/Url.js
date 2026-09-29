const mongoose = require("mongoose");

const urlSchema = new mongoose.Schema({
    originalUrl: {
        type: String,
        required: true,
        trim: true
    },
    shortCode: {
        type: String,
        required: true,
        unique: true,
        index: true,
        trim: true
    },
    clicks: {
        type: Number,
        default: 0
    },
    isCustom: {
        type: Boolean,
        default: false
    },
    expiresAt: {
        type: Date,
        default: null
    },
    lastAccessedAt: {
        type: Date,
        default: null
    },
    clickHistory: [
        {
            timestamp: {
                type: Date,
                default: Date.now
            },
            referer: {
                type: String,
                default: "Direct"
            },
            userAgent: {
                type: String,
                default: "Unknown"
            },
            deviceType: {
                type: String,
                default: "Desktop"
            }
        }
    ],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Url", urlSchema);
