import { createSign } from 'node:crypto';
/**
 * A GitHub App JWT, signed exactly as docs.github.com requires
 * ("Generating a JSON Web Token (JWT) for a GitHub App"):
 *
 *   alg  RS256
 *   iat  60 seconds in the past, against clock drift
 *   exp  no more than 10 minutes into the future
 *   iss  the client id (recommended) or the app id
 *
 * We use 9 minutes, one minute under the ceiling, so a slow request cannot
 * expire the token GitHub is still reading.
 */
export const JWT_LIFETIME_SEC = 540;
export const JWT_BACKDATE_SEC = 60;
function b64url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}
export function createAppJwt(opts) {
    if (!opts.issuer)
        throw new Error('createAppJwt: issuer is required (app id or client id).');
    if (!opts.privateKey)
        throw new Error('createAppJwt: privateKey is required (PEM).');
    const now = Math.floor(opts.nowSec ?? Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const payload = {
        iat: now - JWT_BACKDATE_SEC,
        exp: now + JWT_LIFETIME_SEC,
        iss: opts.issuer,
    };
    const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
    const signer = createSign('RSA-SHA256');
    signer.update(signingInput);
    signer.end();
    const signature = b64url(signer.sign(opts.privateKey));
    return signingInput + '.' + signature;
}
/** Decodes the payload of a JWT this module produced. For tests and for logging `exp`, nothing else. */
export function decodeJwtPayload(token) {
    const part = token.split('.')[1];
    if (!part)
        throw new Error('decodeJwtPayload: not a JWT.');
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}
//# sourceMappingURL=jwt.js.map