import type { FileReport } from '../types.js';
import type { Engine } from './engine-client.js';
import { analyzeMesh, type MeshOptions } from './mesh.js';
import { binaryAvailable, readIfExists, runProcess, withTempDir, writeTemp } from './render.js';

export interface ScadOptions extends MeshOptions {
  openscadBin: string;
  timeoutMs: number;
  allowRender: boolean;
}

/**
 * An OpenSCAD model: rendered to STL by the OpenSCAD CLI, then handed to print-engine
 * like any other mesh.
 *
 * The line number of a finding is 1 — the mesh has no line numbers, and pretending a
 * geometric verdict maps back to a particular `difference()` would be a guess dressed
 * up as a location. When OpenSCAD itself reports a problem (`ERROR: ... line 12`), that
 * line IS known, and is used.
 */
export async function analyzeScad(
  path: string,
  content: Buffer,
  engine: Engine,
  opts: ScadOptions,
): Promise<FileReport> {
  const startedAt = Date.now();

  if (!opts.allowRender) {
    return skipped(
      path,
      startedAt,
      'Rendering is disabled on this deployment. An OpenSCAD file is a program, and this ' +
        'server does not execute code that arrives in a pull request. Use the ' +
        'edufacturing/dfm-check Action, which renders inside your own runner.',
    );
  }

  if (!(await binaryAvailable(opts.openscadBin))) {
    return skipped(
      path,
      startedAt,
      'The openscad binary was not found (' + opts.openscadBin + '), so this model was not rendered.',
    );
  }

  return withTempDir('efdfm-scad-', async (dir) => {
    const src = await writeTemp(dir, 'model.scad', content);
    const out = src.replace(/\.scad$/, '.stl');

    const res = await runProcess(opts.openscadBin, ['-o', out, src], { timeoutMs: opts.timeoutMs, cwd: dir });
    const stl = await readIfExists(out);

    if (!stl) {
      const why = res.timedOut
        ? 'OpenSCAD did not finish within ' + Math.round(opts.timeoutMs / 1000) + ' s.'
        : 'OpenSCAD produced no geometry.';
      return {
        path,
        analyzer: 'openscad' as const,
        status: 'analyzed' as const,
        findings: [
          {
            path,
            line: openscadErrorLine(res.stderr) ?? 1,
            severity: 'error' as const,
            code: 'render_failed',
            message_en: why + (res.stderr.trim() ? ' OpenSCAD said: ' + firstErrorLine(res.stderr) : ''),
            fix_en: 'Render the file locally with `openscad -o out.stl ' + path + '` and fix what it reports.',
            rule_id: null,
            source: 'openscad CLI exit ' + String(res.code),
            analyzer: 'openscad' as const,
          },
        ],
        notEvaluated: [],
        durationMs: Date.now() - startedAt,
      };
    }

    // The engine parses by extension, so it is told the truth about the bytes it got
    // (an STL), while every annotation still points at the .scad a human can edit.
    const report = await analyzeMesh(path, stl, engine, { ...opts, meshName: renderedName(path) });
    return {
      ...report,
      analyzer: 'openscad' as const,
      findings: report.findings.map((f) => ({ ...f, analyzer: 'openscad' as const })),
      durationMs: Date.now() - startedAt,
    };
  });
}

/** OpenSCAD prints `ERROR: ... in file model.scad, line 12`. When it does, annotate that line. */
export function openscadErrorLine(stderr: string): number | null {
  const m = /line\s+(\d+)/i.exec(stderr);
  if (!m || !m[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstErrorLine(stderr: string): string {
  const line = stderr
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^(ERROR|WARNING)/i.test(l));
  return (line ?? stderr.trim().split('\n')[0] ?? '').slice(0, 500);
}

/** `parts/bracket.scad` -> `bracket.stl`: what the renderer actually produced. */
export function renderedName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.replace(/\.[^.]+$/, '') + '.stl';
}

function skipped(path: string, startedAt: number, note: string): FileReport {
  return {
    path,
    analyzer: 'openscad',
    status: 'skipped',
    note_en: note,
    findings: [],
    notEvaluated: [],
    durationMs: Date.now() - startedAt,
  };
}
