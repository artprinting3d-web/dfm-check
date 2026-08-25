import { createHmac, timingSafeEqual } from 'node:crypto';
/**
 * Validates X-Hub-Signature-256 per docs.github.com,
 * "Validating webhook deliveries":
 *
 *   value is `sha256=` + hex HMAC-SHA256 of the RAW request body
 *   the comparison must be constant time (crypto.timingSafeEqual)
 *
 * The body must be the raw bytes. Parsing the JSON and re-serialising it changes
 * key order and whitespace and silently breaks every signature, so this function
 * takes a Buffer and never a parsed object.
 */
export function verifySignature(rawBody, headerValue, secret) {
    if (!secret)
        return false;
    if (!headerValue)
        return false;
    const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(headerValue, 'utf8');
    // timingSafeEqual throws on a length mismatch; a wrong length is a wrong signature.
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(a, b);
}
//# sourceMappingURL=verify.js.map