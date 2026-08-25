import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { assertWebhookReady, loadConfig, type Config } from './config.js';
import { AppAuth } from './github/auth.js';
import { verifySignature } from './github/verify.js';
import { EntitlementStore } from './billing/store.js';
import { handleMarketplaceEvent, type MarketplaceEvent } from './handlers/marketplace.js';
import { handlePullRequest } from './handlers/pull-request.js';
import type { PullRequestEvent } from './github/files.js';
import { planOverrides } from './billing/plans.js';
import { log } from './log.js';

/**
 * The webhook server.
 *
 * Two routes and no framework: `GET /health` and `POST /webhook`. A webhook endpoint has
 * exactly one job — verify a signature and hand off — and every dependency added to it is
 * a dependency in the path of an unauthenticated request from the public internet.
 *
 * GitHub expects a fast 2xx. The analysis takes seconds to minutes, so the response goes
 * out first and the work continues in the background; the check run in the pull request
 * is where progress is visible, which is where the user is already looking.
 */

const MAX_BODY_BYTES = 25 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Webhook body above ' + MAX_BODY_BYTES + ' bytes.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(payload);
}

export interface ServerDeps {
  cfg: Config;
  auth: AppAuth;
  store: EntitlementStore;
}

export function createApp(deps: ServerDeps) {
  const { cfg, auth, store } = deps;
  const overrides = planOverrides();

  return createServer((req, res) => {
    const url = req.url ?? '/';

    if (req.method === 'GET' && (url === '/health' || url === '/')) {
      send(res, 200, {
        ok: true,
        service: 'edufacturing-dfm-check',
        check_name: cfg.checkName,
        engine: cfg.engineUrl,
        fail_on: cfg.failOn,
        render_enabled: process.env['EF_DFM_ALLOW_RENDER'] === '1',
        accounts_known: store.all().length,
      });
      return;
    }

    if (req.method !== 'POST' || url !== '/webhook') {
      send(res, 404, { error: 'Not found. This service serves GET /health and POST /webhook.' });
      return;
    }

    void (async () => {
      let raw: Buffer;
      try {
        raw = await readBody(req);
      } catch (err) {
        send(res, 413, { error: err instanceof Error ? err.message : 'Body too large.' });
        return;
      }

      const signature = req.headers['x-hub-signature-256'];
      const signatureValue = Array.isArray(signature) ? signature[0] : signature;
      if (!verifySignature(raw, signatureValue, cfg.webhookSecret)) {
        // No detail in the response: a rejected delivery should teach an attacker nothing.
        log.warn('webhook.bad_signature', { delivery: String(req.headers['x-github-delivery'] ?? '') });
        send(res, 401, { error: 'Invalid signature.' });
        return;
      }

      const event = String(req.headers['x-github-event'] ?? '');
      const delivery = String(req.headers['x-github-delivery'] ?? '');

      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        send(res, 400, { error: 'Body is not JSON.' });
        return;
      }

      // Answer first; GitHub times deliveries out, and the work belongs in the background.
      send(res, 202, { accepted: true, event, delivery });

      try {
        switch (event) {
          case 'ping':
            log.info('webhook.ping', { delivery });
            break;

          case 'pull_request':
            await handlePullRequest(payload as PullRequestEvent, { cfg, auth, store });
            break;

          case 'check_run': {
            const body = payload as {
              action: string;
              check_run?: { pull_requests?: Array<{ number: number }> };
              repository?: PullRequestEvent['repository'];
              installation?: { id: number };
            };
            if (body.action !== 'rerequested') break;
            const prNumber = body.check_run?.pull_requests?.[0]?.number;
            if (!prNumber || !body.repository || !body.installation) {
              log.info('check_run.rerequest_without_pr', { delivery });
              break;
            }
            // Re-runs go down the same path; the head sha is re-read from the pull request.
            await handleRerun(prNumber, body.repository, body.installation.id, { cfg, auth, store });
            break;
          }

          case 'marketplace_purchase':
            handleMarketplaceEvent(payload as MarketplaceEvent, { store, overrides });
            break;

          case 'installation':
          case 'installation_repositories':
            log.info('webhook.installation', { delivery, action: (payload as { action?: string }).action });
            break;

          default:
            log.info('webhook.unhandled', { event, delivery });
        }
      } catch (err) {
        log.error('webhook.handler_failed', {
          event,
          delivery,
          why: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });
}

/** Re-runs the check for a pull request whose check run was re-requested from the UI. */
async function handleRerun(
  prNumber: number,
  repository: PullRequestEvent['repository'],
  installationId: number,
  deps: ServerDeps,
): Promise<void> {
  const { cfg, auth } = deps;
  const [owner, repo] = repository.full_name.split('/');
  if (!owner || !repo) return;

  const token = await auth.installationToken(installationId);
  const { rest } = await import('./github/rest.js');
  const pr = await rest<PullRequestEvent['pull_request']>(
    '/repos/' + owner + '/' + repo + '/pulls/' + prNumber,
    { token, apiBase: cfg.apiBase },
  );

  await handlePullRequest(
    {
      action: 'synchronize',
      number: prNumber,
      pull_request: pr,
      repository,
      installation: { id: installationId },
    },
    deps,
  );
}

if (import.meta.url === 'file://' + process.argv[1] || process.argv[1]?.endsWith('server.js')) {
  const cfg = loadConfig();
  assertWebhookReady(cfg);
  const auth = new AppAuth(cfg);
  const store = new EntitlementStore(cfg.dataDir);
  createApp({ cfg, auth, store }).listen(cfg.port, () => {
    log.info('server.listening', {
      port: cfg.port,
      engine: cfg.engineUrl,
      check: cfg.checkName,
      render_enabled: process.env['EF_DFM_ALLOW_RENDER'] === '1',
    });
  });
}
