import type { Config } from '../config.js';
import type { AppAuth } from '../github/auth.js';
import { ChecksClient } from '../github/checks.js';
import { FilesClient, type PullRequestEvent } from '../github/files.js';
import { GitHubError, rest } from '../github/rest.js';
import { claims } from '../analysis/classify.js';
import { HttpEngine, type Engine } from '../analysis/engine-client.js';
import { conclusionFor, runAnalysis } from '../analysis/run.js';
import { toAnnotations } from '../report/annotations.js';
import { buildSummary, checkTitle } from '../report/summary.js';
import { decide } from '../billing/entitlement.js';
import type { EntitlementStore } from '../billing/store.js';
import { log } from '../log.js';

/** Only these actions start an analysis. Everything else is a no-op with a logged reason. */
export const HANDLED_ACTIONS = new Set(['opened', 'synchronize', 'reopened', 'ready_for_review']);

export interface RepoSettings {
  technology?: string;
  material?: string;
  printer_id?: string;
}

export interface PullRequestHandlerDeps {
  cfg: Config;
  auth: AppAuth;
  store: EntitlementStore;
  /** Injected in tests; the server builds an HttpEngine. */
  engine?: Engine;
  fetchImpl?: typeof fetch;
}

/**
 * `.efdfm.json` at the repository root, read at the head commit.
 *
 * Optional, and absent by default. It exists because the overhang limit for ABS is not
 * the overhang limit for PLA — the analysis engine applies a material-specific rule when
 * it is told the material, and a repository that prints one material should not have to
 * say so in every pull request.
 */
export async function readRepoSettings(
  owner: string,
  repo: string,
  ref: string,
  opts: { token: string; apiBase?: string; fetchImpl?: typeof fetch },
): Promise<RepoSettings> {
  try {
    const raw = await rest<Buffer>(
      '/repos/' + owner + '/' + repo + '/contents/.efdfm.json?ref=' + encodeURIComponent(ref),
      {
        token: opts.token,
        apiBase: opts.apiBase,
        fetchImpl: opts.fetchImpl,
        accept: 'application/vnd.github.raw+json',
        raw: true,
        retries: 0,
      },
    );
    const parsed = JSON.parse(raw.toString('utf8')) as RepoSettings;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (err) {
    // 404 is the normal case: most repositories have no settings file.
    if (err instanceof GitHubError && err.status === 404) return {};
    log.warn('repo_settings.unreadable', { owner, repo, ref, why: err instanceof Error ? err.message : String(err) });
    return {};
  }
}

export async function handlePullRequest(event: PullRequestEvent, deps: PullRequestHandlerDeps): Promise<void> {
  const { cfg, auth, store } = deps;

  if (!HANDLED_ACTIONS.has(event.action)) {
    log.info('pull_request.ignored', { action: event.action, repo: event.repository.full_name });
    return;
  }
  if (!event.installation?.id) {
    log.warn('pull_request.no_installation', { repo: event.repository.full_name });
    return;
  }
  if (event.pull_request.draft && event.action !== 'ready_for_review') {
    log.info('pull_request.draft_skipped', { repo: event.repository.full_name, number: event.number });
    return;
  }

  const [owner, repo] = event.repository.full_name.split('/');
  if (!owner || !repo) throw new Error('Unexpected repository.full_name: ' + event.repository.full_name);

  const headSha = event.pull_request.head.sha;
  const token = await auth.installationToken(event.installation.id);
  const checks = new ChecksClient(owner, repo, { token, apiBase: cfg.apiBase, fetchImpl: deps.fetchImpl });

  const run = await checks.start({
    name: cfg.checkName,
    headSha,
    externalId: event.repository.full_name + '#' + event.number,
  });

  try {
    // --- entitlement ---------------------------------------------------------
    const decision = decide(
      {
        private: event.repository.private,
        ownerId: event.repository.owner.id,
        ownerLogin: event.repository.owner.login,
        ownerType: event.repository.owner.type,
      },
      store,
    );

    if (!decision.allowed) {
      // Neutral, never failure: not paying is not a manufacturing defect.
      await checks.complete({
        checkRunId: run.id,
        conclusion: 'neutral',
        output: {
          title: 'Not included in the current plan',
          summary: '## Not included in the current plan\n\n' + decision.reason_en,
        },
      });
      log.info('pull_request.not_entitled', { repo: event.repository.full_name, tier: decision.tier });
      return;
    }

    // --- gather --------------------------------------------------------------
    const files = new FilesClient(owner, repo, { token, apiBase: cfg.apiBase, fetchImpl: deps.fetchImpl });
    const collected = await files.collect(event.number, claims, {
      maxFiles: cfg.maxFiles,
      maxFileBytes: cfg.maxFileBytes,
    });

    const settings = await readRepoSettings(owner, repo, headSha, {
      token,
      apiBase: cfg.apiBase,
      fetchImpl: deps.fetchImpl,
    });

    const engine =
      deps.engine ??
      new HttpEngine({ baseUrl: cfg.engineUrl, apiKey: cfg.eduKey || undefined, fetchImpl: deps.fetchImpl });

    // --- analyse -------------------------------------------------------------
    const report = await runAnalysis(collected.files, {
      engine,
      engineUrl: cfg.engineUrl,
      technology: settings.technology,
      material: settings.material,
      printerId: settings.printer_id,
      // Renderers stay off on the server: a pull request from a fork must never be able
      // to execute code here. The Action runs them in the customer's own runner instead.
      allowRender: process.env['EF_DFM_ALLOW_RENDER'] === '1',
      openscadBin: cfg.openscadBin,
      pythonBin: cfg.pythonBin,
      renderTimeoutMs: cfg.renderTimeoutSec * 1000,
      unclaimed: collected.unclaimed,
      dropped: [...collected.dropped, ...collected.tooLarge],
    });

    const conclusion = conclusionFor(report, cfg.failOn);
    await checks.complete({
      checkRunId: run.id,
      conclusion,
      output: {
        title: checkTitle(report),
        summary: buildSummary(report),
        annotations: toAnnotations(report),
      },
    });

    log.info('pull_request.completed', {
      repo: event.repository.full_name,
      number: event.number,
      conclusion,
      errors: report.errors,
      warnings: report.warnings,
      notices: report.notices,
      files: report.files.length,
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    log.error('pull_request.failed', { repo: event.repository.full_name, number: event.number, why });
    await checks
      .fail(
        run.id,
        'DFM check could not finish',
        'The check did not complete: ' +
          why +
          '\n\nThis is a fault on our side, not a verdict about your files. ' +
          'Re-run the check, or open an issue at https://github.com/edufacturing/dfm-check/issues.',
      )
      .catch((e) => log.error('pull_request.fail_report_failed', { why: String(e) }));
  }
}
