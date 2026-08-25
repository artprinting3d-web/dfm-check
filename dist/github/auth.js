import { createAppJwt } from './jwt.js';
import { rest } from './rest.js';
/**
 * Installation access tokens live one hour (docs.github.com, "Create an installation
 * access token for an app"). We cache them per installation and refresh five minutes
 * early, so a long analysis never runs off the end of its own token.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
export class AppAuth {
    cfg;
    fetchImpl;
    now;
    cache = new Map();
    constructor(cfg, fetchImpl, now = () => Date.now()) {
        this.cfg = cfg;
        this.fetchImpl = fetchImpl;
        this.now = now;
    }
    /** The App-level JWT. Valid for endpoints under /app and /marketplace_listing. */
    appJwt() {
        const issuer = this.cfg.clientId || this.cfg.appId;
        return createAppJwt({ issuer, privateKey: this.cfg.privateKey, nowSec: this.now() / 1000 });
    }
    /** A repository-scoped token for one installation, cached until shortly before it expires. */
    async installationToken(installationId) {
        const hit = this.cache.get(installationId);
        if (hit && hit.expiresAtMs - REFRESH_MARGIN_MS > this.now())
            return hit.token;
        const res = await rest('/app/installations/' + installationId + '/access_tokens', {
            method: 'POST',
            token: this.appJwt(),
            apiBase: this.cfg.apiBase,
            fetchImpl: this.fetchImpl,
        });
        const expiresAtMs = Date.parse(res.expires_at);
        this.cache.set(installationId, {
            token: res.token,
            expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : this.now() + 60 * 60 * 1000,
        });
        return res.token;
    }
    /** Drops a cached token — called when GitHub answers 401 with it. */
    invalidate(installationId) {
        this.cache.delete(installationId);
    }
}
//# sourceMappingURL=auth.js.map