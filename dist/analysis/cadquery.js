import { fileURLToPath } from 'node:url';
import { analyzeMesh } from './mesh.js';
import { renderedName } from './scad.js';
import { binaryAvailable, readIfExists, runProcess, withTempDir, writeTemp } from './render.js';
/** `assets/cadquery-export.py` exits with this when no CAD library is importable. */
export const EXIT_NO_CAD_LIBRARY = 5;
/**
 * Resolves `assets/cadquery-export.py` from either the TypeScript sources or the compiled
 * `dist/` tree — both sit exactly two levels under the package root.
 */
export function exporterScriptPath() {
    return fileURLToPath(new URL('../../assets/cadquery-export.py', import.meta.url));
}
/**
 * A CadQuery model: executed by the export harness, then reviewed as a mesh.
 *
 * Same rule as OpenSCAD, and for a stronger reason — this is arbitrary Python. Rendering
 * stays off unless the deployment turns it on, and the Action path (the customer's own
 * runner, the customer's own code) is the recommended way to use it.
 */
export async function analyzeCadQuery(path, content, engine, opts) {
    const startedAt = Date.now();
    if (!opts.allowRender) {
        return skipped(path, startedAt, 'Rendering is disabled on this deployment. A CadQuery model is arbitrary Python, and ' +
            'this server does not execute code that arrives in a pull request. Use the ' +
            'edufacturing/dfm-check Action, which runs it inside your own runner.');
    }
    if (!(await binaryAvailable(opts.pythonBin, '--version'))) {
        return skipped(path, startedAt, 'No python interpreter at ' + opts.pythonBin + ', so this model was not rendered.');
    }
    return withTempDir('efdfm-cq-', async (dir) => {
        const src = await writeTemp(dir, 'model.py', content);
        const out = src.replace(/\.py$/, '.stl');
        const res = await runProcess(opts.pythonBin, [opts.exporterScript ?? exporterScriptPath(), src, out], {
            timeoutMs: opts.timeoutMs,
            cwd: dir,
        });
        const stl = await readIfExists(out);
        // Exit 5 is the harness saying this interpreter has neither cadquery nor build123d.
        // That is our environment, not the author's model, and reporting it as a defect in
        // their file is exactly the false positive that gets a CI check switched off.
        if (!stl && res.code === EXIT_NO_CAD_LIBRARY) {
            return skipped(path, startedAt, 'This model was not rendered: the python interpreter at ' +
                opts.pythonBin +
                ' has neither cadquery nor build123d installed. Add a `pip install cadquery` step ' +
                'before the check if you want CadQuery models analysed.');
        }
        if (!stl) {
            return {
                path,
                analyzer: 'cadquery',
                status: 'analyzed',
                findings: [
                    {
                        path,
                        line: pythonErrorLine(res.stderr, 'model.py') ?? 1,
                        severity: 'error',
                        code: 'render_failed',
                        message_en: res.timedOut
                            ? 'The model did not finish within ' + Math.round(opts.timeoutMs / 1000) + ' s.'
                            : 'No solid could be exported. ' + firstErrorLine(res.stderr),
                        fix_en: 'Assign the finished solid to a module-level `result`, or call `show_object(result)`, ' +
                            'and check the model runs on its own.',
                        rule_id: null,
                        source: 'cadquery-export.py exit ' + String(res.code),
                        analyzer: 'cadquery',
                    },
                ],
                notEvaluated: [],
                durationMs: Date.now() - startedAt,
            };
        }
        const report = await analyzeMesh(path, stl, engine, { ...opts, meshName: renderedName(path) });
        return {
            ...report,
            analyzer: 'cadquery',
            findings: report.findings.map((f) => ({ ...f, analyzer: 'cadquery' })),
            durationMs: Date.now() - startedAt,
        };
    });
}
/** Pulls the line number out of a Python traceback frame for the model file itself. */
export function pythonErrorLine(stderr, fileName) {
    const re = new RegExp('File "[^"]*' + fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '", line (\\d+)', 'g');
    let last = null;
    for (const m of stderr.matchAll(re)) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0)
            last = n;
    }
    return last;
}
function firstErrorLine(stderr) {
    const line = stderr
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .find((l) => /^(ERROR|[A-Za-z_]*Error)/.test(l));
    return (line ?? stderr.trim().split('\n').filter(Boolean).pop() ?? '').slice(0, 500);
}
function skipped(path, startedAt, note) {
    return {
        path,
        analyzer: 'cadquery',
        status: 'skipped',
        note_en: note,
        findings: [],
        notEvaluated: [],
        durationMs: Date.now() - startedAt,
    };
}
//# sourceMappingURL=cadquery.js.map