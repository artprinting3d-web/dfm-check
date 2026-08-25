import { rest } from './rest.js';

/**
 * The Check Runs API, with its documented limits enforced here rather than discovered
 * in production (docs.github.com, REST "Check Runs"):
 *
 *   - at most 50 annotations per request; the rest go out as further PATCHes, and
 *     "annotations are appended to the list of annotations that already exist"
 *   - annotation.title  <= 255 characters
 *   - annotation.message and raw_details <= 64 KB
 *   - at most 3 actions; label <= 20, description <= 40, identifier <= 20
 *   - start_column / end_column are only legal when start_line === end_line
 */
export const MAX_ANNOTATIONS_PER_REQUEST = 50;
export const MAX_ANNOTATION_TITLE = 255;
export const MAX_ANNOTATION_MESSAGE_BYTES = 64 * 1024;
/** output.summary is rendered as Markdown in the PR; GitHub truncates long bodies, so we cap it ourselves. */
export const MAX_SUMMARY_CHARS = 65_535;
export const MAX_TEXT_CHARS = 65_535;

export type AnnotationLevel = 'notice' | 'warning' | 'failure';

export interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: AnnotationLevel;
  message: string;
  start_column?: number;
  end_column?: number;
  title?: string;
  raw_details?: string;
}

export interface CheckAction {
  label: string;
  description: string;
  identifier: string;
}

export interface CheckOutput {
  title: string;
  summary: string;
  text?: string;
  annotations?: CheckAnnotation[];
}

export type CheckStatus = 'queued' | 'in_progress' | 'completed';
export type CheckConclusion =
  | 'success'
  | 'failure'
  | 'neutral'
  | 'cancelled'
  | 'skipped'
  | 'timed_out'
  | 'action_required'
  | 'stale';

export interface CheckRun {
  id: number;
  html_url: string;
  name: string;
  status: string;
  conclusion: string | null;
}

export interface ChecksClientOptions {
  token: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

function clampUtf8(value: string, maxBytes: number): string {
  const buf = Buffer.from(value, 'utf8');
  if (buf.length <= maxBytes) return value;
  // Cut on a character boundary: decode the truncated buffer and drop the replacement tail.
  const cut = buf.subarray(0, maxBytes - 3).toString('utf8').replace(/�+$/, '');
  return cut + '...';
}

/** Brings one annotation inside every documented limit. Called on the way out, always. */
export function normalizeAnnotation(a: CheckAnnotation): CheckAnnotation {
  const startLine = Math.max(1, Math.floor(a.start_line));
  const endLine = Math.max(startLine, Math.floor(a.end_line));
  const out: CheckAnnotation = {
    path: a.path,
    start_line: startLine,
    end_line: endLine,
    annotation_level: a.annotation_level,
    message: clampUtf8(a.message, MAX_ANNOTATION_MESSAGE_BYTES),
  };
  if (a.title) out.title = a.title.length > MAX_ANNOTATION_TITLE ? a.title.slice(0, MAX_ANNOTATION_TITLE - 3) + '...' : a.title;
  if (a.raw_details) out.raw_details = clampUtf8(a.raw_details, MAX_ANNOTATION_MESSAGE_BYTES);
  // Columns are only accepted on a single line.
  if (startLine === endLine && a.start_column !== undefined) {
    out.start_column = a.start_column;
    if (a.end_column !== undefined) out.end_column = a.end_column;
  }
  return out;
}

export class ChecksClient {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly opts: ChecksClientOptions,
  ) {}

  private path(suffix = ''): string {
    return '/repos/' + this.owner + '/' + this.repo + '/check-runs' + suffix;
  }

  /** Opens the check run as `in_progress` so the PR shows work in flight from the first second. */
  async start(params: { name: string; headSha: string; detailsUrl?: string; externalId?: string }): Promise<CheckRun> {
    return rest<CheckRun>(this.path(), {
      method: 'POST',
      token: this.opts.token,
      apiBase: this.opts.apiBase,
      fetchImpl: this.opts.fetchImpl,
      body: {
        name: params.name,
        head_sha: params.headSha,
        status: 'in_progress' satisfies CheckStatus,
        started_at: new Date().toISOString(),
        ...(params.detailsUrl ? { details_url: params.detailsUrl } : {}),
        ...(params.externalId ? { external_id: params.externalId } : {}),
      },
    });
  }

  /**
   * Closes the check run and delivers every annotation.
   *
   * The first 50 ride along with the conclusion; each further batch of 50 is a
   * separate PATCH, which appends. The conclusion is set on the first call so a
   * failure that happens while later batches are still going out is already visible.
   */
  async complete(params: {
    checkRunId: number;
    conclusion: CheckConclusion;
    output: CheckOutput;
    actions?: CheckAction[];
  }): Promise<CheckRun> {
    const all = (params.output.annotations ?? []).map(normalizeAnnotation);
    const first = all.slice(0, MAX_ANNOTATIONS_PER_REQUEST);
    const rest_ = all.slice(MAX_ANNOTATIONS_PER_REQUEST);

    const body: Record<string, unknown> = {
      status: 'completed' satisfies CheckStatus,
      conclusion: params.conclusion,
      completed_at: new Date().toISOString(),
      output: {
        title: params.output.title,
        summary: params.output.summary.slice(0, MAX_SUMMARY_CHARS),
        ...(params.output.text ? { text: params.output.text.slice(0, MAX_TEXT_CHARS) } : {}),
        annotations: first,
      },
    };
    if (params.actions?.length) body['actions'] = params.actions.slice(0, 3);

    const run = await rest<CheckRun>(this.path('/' + params.checkRunId), {
      method: 'PATCH',
      token: this.opts.token,
      apiBase: this.opts.apiBase,
      fetchImpl: this.opts.fetchImpl,
      body,
    });

    for (let i = 0; i < rest_.length; i += MAX_ANNOTATIONS_PER_REQUEST) {
      const batch = rest_.slice(i, i + MAX_ANNOTATIONS_PER_REQUEST);
      await rest<CheckRun>(this.path('/' + params.checkRunId), {
        method: 'PATCH',
        token: this.opts.token,
        apiBase: this.opts.apiBase,
        fetchImpl: this.opts.fetchImpl,
        body: {
          output: {
            title: params.output.title,
            summary: params.output.summary.slice(0, MAX_SUMMARY_CHARS),
            annotations: batch,
          },
        },
      });
    }

    return run;
  }

  /** Reports the run as `failure` with the reason, so a crash is never a silently green PR. */
  async fail(checkRunId: number, title: string, summary: string): Promise<CheckRun> {
    return rest<CheckRun>(this.path('/' + checkRunId), {
      method: 'PATCH',
      token: this.opts.token,
      apiBase: this.opts.apiBase,
      fetchImpl: this.opts.fetchImpl,
      body: {
        status: 'completed',
        conclusion: 'failure' satisfies CheckConclusion,
        completed_at: new Date().toISOString(),
        output: { title, summary },
      },
    });
  }
}

/** How many PATCH requests a given annotation count costs. Used by the tests and the summary. */
export function annotationRequestCount(total: number): number {
  if (total <= MAX_ANNOTATIONS_PER_REQUEST) return 1;
  return 1 + Math.ceil((total - MAX_ANNOTATIONS_PER_REQUEST) / MAX_ANNOTATIONS_PER_REQUEST);
}
