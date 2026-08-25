import { rest, restPaginate } from './rest.js';
export class FilesClient {
    owner;
    repo;
    opts;
    constructor(owner, repo, opts) {
        this.owner = owner;
        this.repo = repo;
        this.opts = opts;
    }
    async listPullFiles(pullNumber) {
        return restPaginate('/repos/' + this.owner + '/' + this.repo + '/pulls/' + pullNumber + '/files', { token: this.opts.token, apiBase: this.opts.apiBase, fetchImpl: this.opts.fetchImpl, max: 3000 });
    }
    /** Raw bytes of one blob. Binary-safe: no text decoding happens on this path. */
    async blob(fileSha) {
        return rest('/repos/' + this.owner + '/' + this.repo + '/git/blobs/' + fileSha, {
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
    async collect(pullNumber, claim, limits) {
        const all = await this.listPullFiles(pullNumber);
        const live = all.filter((f) => f.status !== 'removed' && f.status !== 'unchanged');
        const claimed = live.filter((f) => claim(f.filename));
        const unclaimed = live.filter((f) => !claim(f.filename)).map((f) => f.filename);
        const dropped = claimed.slice(limits.maxFiles).map((f) => f.filename);
        const take = claimed.slice(0, limits.maxFiles);
        const files = [];
        const tooLarge = [];
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
//# sourceMappingURL=files.js.map