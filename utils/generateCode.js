const crypto = require("crypto");

const BASE62_CHARS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Generates a cryptographically secure random Base62 short code.
 * 6 characters = 62^6 (~56.8 billion) possible combinations.
 * 
 * @param {number} length - Length of short code (defaults to 6)
 * @returns {string} Generated code
 */
function generateShortCode(length = 6) {
    const bytes = crypto.randomBytes(length);
    let code = "";
    for (let i = 0; i < length; i++) {
        code += BASE62_CHARS[bytes[i] % BASE62_CHARS.length];
    }
    return code;
}

module.exports = { generateShortCode };
