/**
 * Client for the Edufacturing print-engine (core/print-engine/API.md).
 *
 * The engine is the only place mesh thresholds are decided: it looks every one of them
 * up in the EDi Brain rules core and returns the id it used. This app copies none of
 * those numbers — it forwards the file and renders what comes back. That is why a
 * threshold can change in the rules core and every check run follows without a release.
 */

export interface EngineFlag {
  severity: 'error' | 'warn' | 'info';
  code: string;
  msg_en: string;
  fix_en?: string;
  rule_id: string | null;
  source: string | null;
}

export interface EngineNotEvaluated {
  code: string;
  why_en: string;
  rule_id: string | null;
}

export interface PrintabilityResponse {
  file: string;
  format: string;
  technology?: string;
  material_id?: string | null;
  printer_id?: string | null;
  metrics: {
    triangles: number;
    vertices: number;
    bbox_mm: { min: number[]; max: number[]; size: number[] };
    volume_mm3: number;
    area_mm2: number;
    watertight: boolean;
    open_edges: number;
    bodies: number;
  };
  score: number;
  flags: EngineFlag[];
  not_evaluated?: EngineNotEvaluated[];
}

export interface EngineHealth {
  ok: boolean;
  service: string;
  rules_core?: { rules_in_core?: number; cited_by_engine?: number };
}

export interface EngineClientOptions {
  baseUrl: string;
  /** Sent as X-Edu-Key when the deployment puts the engine behind the shared secret. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class EngineError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface PrintabilityRequest {
  filename: string;
  content: Buffer;
  technology?: string;
  material?: string;
  printerId?: string;
}

/** What the analysers depend on. A test supplies its own implementation; no network in unit tests. */
export interface Engine {
  printability(req: PrintabilityRequest): Promise<PrintabilityResponse>;
  health(): Promise<EngineHealth>;
}

export class HttpEngine implements Engine {
  constructor(private readonly opts: EngineClientOptions) {}

  private headers(contentType?: string): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/json' };
    if (contentType) h['content-type'] = contentType;
    if (this.opts.apiKey) h['x-edu-key'] = this.opts.apiKey;
    return h;
  }

  async health(): Promise<EngineHealth> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(this.opts.baseUrl + '/health', {
      headers: this.headers(),
      signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
    });
    if (!res.ok) throw new EngineError(res.status, 'print-engine /health answered ' + res.status);
    return (await res.json()) as EngineHealth;
  }

  async printability(req: PrintabilityRequest): Promise<PrintabilityResponse> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const qs = new URLSearchParams({ filename: req.filename });
    if (req.technology) qs.set('technology', req.technology);
    if (req.material) qs.set('material', req.material);
    if (req.printerId) qs.set('printer_id', req.printerId);

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
        const body = (await res.json()) as { error?: string };
        if (body?.error) detail = body.error;
      } catch {
        detail = (await res.text().catch(() => '')).slice(0, 300) || String(res.status);
      }
      throw new EngineError(res.status, detail);
    }

    return (await res.json()) as PrintabilityResponse;
  }
}
