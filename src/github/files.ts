import { rest, restPaginate } from './rest.js';
import type { ChangedFile } from '../types.js';

/**
 * Reading the changed files of a pull request.
 *
 * `GET /repos/{owner}/{repo}/pulls/{n}/files` returns at most 3000 files, 100 per page
 * (docs.github.com, "List pull requests files"). Its `status` is one of
 * added | removed | modified | renamed | copied | changed | unchanged.
 *
 * Content comes from `GET /repos/{owner}/{repo}/git/blobs/{file_sha}` with the
 * `application/vnd.github.raw+json` media type, which "supports blobs up to 100
 * megabytes" — the contents endpoint stops at 1 MB, which a binary STL passes on day one.
 */
export interface PullFile {
  sha: string | null;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  previous_filename?: string;
}

export interface FilesClientOptions {
  token: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

export class FilesClient {
  constructor(
    private readonly owner: string,
    private readonly repo: string,
    private readonly opts: FilesClientOptions,
  ) {}

  async listPullFiles(pullNumber: number): Promise<PullFile[]> {
    return restPaginate<PullFile>(
      '/repos/' + this.owner + '/' + this.repo + '/pulls/' + pullNumber + '/files',
      { token: this.opts.token, apiBase: this.opts.apiBase, fetchImpl: this.opts.fetchImpl, max: 3000 },
    );
  }

  /** Raw bytes of one blob. Binary-safe: no text decoding happens on this path. */
  async blob(fileSha: string): Promise<Buffer> {
    return rest<Buffer>('/repos/' + this.owner + '/' + this.repo + '/git/blobs/' + fileSha, {
      token: this.opts.token,
      apiBase: this.opts.apiBase,
      fetchImpl: this.opts.fetchImpl,
      accept: 'application/vnd.github.raw+json',
      raw: true,
    });
  }

  /**
   * The changed files an analyser could claim, with their bytes.
   *
   * Deleted files are dropped — there is nothing left to analyse, and flagging a part
   * somebody removed is exactly the noise that makes a CI check get switched off.
   */
  async collect(
    pullNumber: number,
    claim: (path: string) => boolean,
    limits: { maxFiles: number; maxFileBytes: number },
  ): Promise<{ files: ChangedFile[]; unclaimed: string[]; dropped: string[]; tooLarge: string[] }> {
    const all = await this.listPullFiles(pullNumber);
    const live = all.filter((f) => f.status !== 'removed' && f.status !== 'unchanged');

    const claimed = live.filter((f) => claim(f.filename));
    const unclaimed = live.filter((f) => !claim(f.filename)).map((f) => f.filename);
    const dropped = claimed.slice(limits.maxFiles).map((f) => f.filename);
    const take = claimed.slice(0, limits.maxFiles);

    const files: ChangedFile[] = [];
    const tooLarge: string[] = [];
    for (const f of take) {
      if (!f.sha) {
        files.push({ path: f.filename, status: f.status, content: null });
        continue;
      }
      const content = await this.blob(f.sha);
      if (content.length > limits.maxFileBytes) {
        tooLarge.push(f.filename);
        continue;
      }
      files.push({ path: f.filename, status: f.status, content });
    }

    return { files, unclaimed, dropped, tooLarge };
  }
}

/** Minimal shape of a pull_request webhook payload, only the fields this app reads. */
export interface PullRequestEvent {
  action: string;
  number: number;
  pull_request: {
    number: number;
    head: { sha: string; ref: string };
    base: { sha: string; ref: string };
    draft?: boolean;
    html_url: string;
  };
  repository: {
    full_name: string;
    name: string;
    private: boolean;
    owner: { login: string; id: number; type: string };
  };
  installation?: { id: number };
}
