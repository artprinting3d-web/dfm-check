import type { Config } from '../config.js';
import { createAppJwt } from './jwt.js';
import { rest } from './rest.js';

/**
 * Installation access tokens live one hour (docs.github.com, "Create an installation
 * access token for an app"). We cache them per installation and refresh five minutes
 * early, so a long analysis never runs off the end of its own token.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

export interface InstallationTokenResponse {
  token: string;
  expires_at: string;
}

export class AppAuth {
  private readonly cache = new Map<number, CachedToken>();

  constructor(
    private readonly cfg: Config,
    private readonly fetchImpl?: typeof fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The App-level JWT. Valid for endpoints under /app and /marketplace_listing. */
  appJwt(): string {
    const issuer = this.cfg.clientId || this.cfg.appId;
    return createAppJwt({ issuer, privateKey: this.cfg.privateKey, nowSec: this.now() / 1000 });
  }

  /** A repository-scoped token for one installation, cached until shortly before it expires. */
  async installationToken(installationId: number): Promise<string> {
    const hit = this.cache.get(installationId);
    if (hit && hit.expiresAtMs - REFRESH_MARGIN_MS > this.now()) return hit.token;

    const res = await rest<InstallationTokenResponse>(
      '/app/installations/' + installationId + '/access_tokens',
      {
        method: 'POST',
        token: this.appJwt(),
        apiBase: this.cfg.apiBase,
        fetchImpl: this.fetchImpl,
      },
    );

    const expiresAtMs = Date.parse(res.expires_at);
    this.cache.set(installationId, {
      token: res.token,
      expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : this.now() + 60 * 60 * 1000,
    });
    return res.token;
  }

  /** Drops a cached token — called when GitHub answers 401 with it. */
  invalidate(installationId: number): void {
    this.cache.delete(installationId);
  }
}
