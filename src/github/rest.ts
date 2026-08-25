import { log } from '../log.js';

export interface RestOptions {
  method?: string;
  /** Bearer token: an App JWT or an installation access token. */
  token: string;
  body?: unknown;
  /** Overrides the default `application/vnd.github+json` Accept. */
  accept?: string;
  /** Returns the raw bytes instead of parsed JSON (used for blob downloads). */
  raw?: boolean;
  apiBase?: string;
  /** Retries on 5xx and on secondary-rate-limit responses. */
  retries?: number;
  fetchImpl?: typeof fetch;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly bodyText: string,
  ) {
    super('GitHub ' + status + ' for ' + url + ': ' + bodyText.slice(0, 400));
    this.name = 'GitHubError';
  }
}

const USER_AGENT = 'edufacturing-dfm-check';
const API_VERSION = '2022-11-28';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One GitHub REST call.
 *
 * `X-GitHub-Api-Version: 2022-11-28` is pinned deliberately: an unpinned client
 * silently follows breaking changes, and a check run that stops appearing is the
 * kind of failure nobody notices until a customer does.
 */
export async function rest<T = unknown>(path: string, opts: RestOptions): Promise<T> {
  const base = (opts.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
  const url = path.startsWith('http') ? path : base + path;
  const doFetch = opts.fetchImpl ?? fetch;
  const maxAttempts = (opts.retries ?? 2) + 1;

  const headers: Record<string, string> = {
    accept: opts.accept ?? 'application/vnd.github+json',
    authorization: 'Bearer ' + opts.token,
    'user-agent': USER_AGENT,
    'x-github-api-version': API_VERSION,
  };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: opts.method ?? 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) throw err;
      await sleep(400 * attempt);
      continue;
    }

    if (res.ok) {
      if (opts.raw) return Buffer.from(await res.arrayBuffer()) as T;
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }

    const text = await res.text();
    const retryable =
      res.status >= 500 ||
      res.status === 429 ||
      (res.status === 403 && /secondary rate limit|abuse detection/i.test(text));

    if (!retryable || attempt === maxAttempts) {
      throw new GitHubError(res.status, url, text);
    }

    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * attempt * attempt;
    log.warn('github.retry', { url, status: res.status, attempt, waitMs });
    await sleep(waitMs);
  }

  throw lastError instanceof Error ? lastError : new Error('github request failed: ' + url);
}

/** Follows `Link: rel="next"` and concatenates the pages. Used for the PR file list. */
export async function restPaginate<T = unknown>(path: string, opts: RestOptions & { max?: number }): Promise<T[]> {
  const out: T[] = [];
  const max = opts.max ?? 300;
  let next: string | null = path.includes('?') ? path + '&per_page=100' : path + '?per_page=100';

  while (next && out.length < max) {
    const base = (opts.apiBase ?? 'https://api.github.com').replace(/\/+$/, '');
    const url: string = next.startsWith('http') ? next : base + next;
    const doFetch = opts.fetchImpl ?? fetch;
    const res = await doFetch(url, {
      headers: {
        accept: opts.accept ?? 'application/vnd.github+json',
        authorization: 'Bearer ' + opts.token,
        'user-agent': USER_AGENT,
        'x-github-api-version': API_VERSION,
      },
    });
    if (!res.ok) throw new GitHubError(res.status, url, await res.text());
    const page = (await res.json()) as T[];
    out.push(...page);

    const link = res.headers.get('link') ?? '';
    const match = /<([^>]+)>;\s*rel="next"/.exec(link);
    next = match && match[1] ? match[1] : null;
  }
  return out.slice(0, max);
}
