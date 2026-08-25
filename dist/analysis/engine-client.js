/**
 * Client for the Edufacturing print-engine (core/print-engine/API.md).
 *
 * The engine is the only place mesh thresholds are decided: it looks every one of them
 * up in the EDi Brain rules core and returns the id it used. This app copies none of
 * those numbers — it forwards the file and renders what comes back. That is why a
 * threshold can change in the rules core and every check run follows without a release.
 */
export class EngineError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'EngineError';
    }
}
export class HttpEngine {
    opts;
    constructor(opts) {
        this.opts = opts;
    }
    headers(contentType) {
        const h = { accept: 'application/json' };
        if (contentType)
            h['content-type'] = contentType;
        if (this.opts.apiKey)
            h['x-edu-key'] = this.opts.apiKey;
        return h;
    }
    async health() {
        const doFetch = this.opts.fetchImpl ?? fetch;
        const res = await doFetch(this.opts.baseUrl + '/health', {
            headers: this.headers(),
            signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
        });
        if (!res.ok)
            throw new EngineError(res.status, 'print-engine /health answered ' + res.status);
        return (await res.json());
    }
    async printability(req) {
        const doFetch = this.opts.fetchImpl ?? fetch;
        const qs = new URLSearchParams({ filename: req.filename });
        if (req.technology)
            qs.set('technology', req.technology);
        if (req.material)
            qs.set('material', req.material);
        if (req.printerId)
            qs.set('printer_id', req.printerId);
        const res = await doFetch(this.opts.baseUrl + '/v1/printability?' + qs.toString(), {
            method: 'POST',
            headers: this.headers('application/octet-stream'),
            body: new Uint8Array(req.content),
            signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
        });
        if (!res.ok) {
            // The engine always answers { "error": "<message in English>" } — never a stack trace.
            let detail = res.status + '';
            try {
                const body = (await res.json());
                if (body?.error)
                    detail = body.error;
            }
            catch {
                detail = (await res.text().catch(() => '')).slice(0, 300) || String(res.status);
            }
            throw new EngineError(res.status, detail);
        }
        return (await res.json());
    }
}
//# sourceMappingURL=engine-client.js.map