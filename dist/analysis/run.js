import { analyzerFor } from './classify.js';
import { analyzeMesh } from './mesh.js';
import { analyzeScad } from './scad.js';
import { analyzeCadQuery } from './cadquery.js';
import { analyzeKicad } from './kicad.js';
import { analyzeKlipperConfig } from './klipper/check.js';
/**
 * Runs every analyser over the changed files of one pull request.
 *
 * Files are analysed one at a time on purpose: print-engine does real geometric work per
 * request, and a fan-out of twenty meshes from one PR would be a self-inflicted load
 * spike on a service that other products share.
 */
export async function runAnalysis(files, opts) {
    const startedAt = new Date().toISOString();
    let reachable = true;
    try {
        await opts.engine.health();
    }
    catch {
        reachable = false;
    }
    const reports = [];
    for (const file of files) {
        const kind = analyzerFor(file.path, file.content);
        if (!kind)
            continue;
        if (!file.content) {
            reports.push({
                path: file.path,
                analyzer: kind,
                status: 'skipped',
                note_en: 'The file contents could not be fetched from GitHub.',
                findings: [],
                notEvaluated: [],
                durationMs: 0,
            });
            continue;
        }
        const meshOpts = { technology: opts.technology, material: opts.material, printerId: opts.printerId };
        try {
            switch (kind) {
                case 'mesh':
                    reports.push(await analyzeMesh(file.path, file.content, opts.engine, meshOpts));
                    break;
                case 'openscad':
                    reports.push(await analyzeScad(file.path, file.content, opts.engine, {
                        ...meshOpts,
                        openscadBin: opts.openscadBin,
                        timeoutMs: opts.renderTimeoutMs,
                        allowRender: opts.allowRender,
                    }));
                    break;
                case 'cadquery':
                    reports.push(await analyzeCadQuery(file.path, file.content, opts.engine, {
                        ...meshOpts,
                        pythonBin: opts.pythonBin,
                        timeoutMs: opts.renderTimeoutMs,
                        allowRender: opts.allowRender,
                    }));
                    break;
                case 'kicad':
                    reports.push(analyzeKicad(file.path, file.content));
                    break;
                case 'klipper':
                    reports.push(analyzeKlipperConfig(file.path, file.content));
                    break;
            }
        }
        catch (err) {
            // An analyser that throws is a bug in this app, not a verdict about the file.
            reports.push({
                path: file.path,
                analyzer: kind,
                status: 'error',
                note_en: 'The ' + kind + ' analyser failed: ' + (err instanceof Error ? err.message : String(err)),
                findings: [],
                notEvaluated: [],
                durationMs: 0,
            });
        }
    }
    const findings = reports.flatMap((r) => r.findings);
    return {
        files: reports,
        findings,
        errors: findings.filter((f) => f.severity === 'error').length,
        warnings: findings.filter((f) => f.severity === 'warn').length,
        notices: findings.filter((f) => f.severity === 'info').length,
        unclaimed: opts.unclaimed ?? [],
        dropped: opts.dropped ?? [],
        engine: { url: opts.engineUrl, reachable },
        startedAt,
        completedAt: new Date().toISOString(),
    };
}
/** The conclusion a check run should carry, given the policy. */
export function conclusionFor(report, failOn) {
    const analyserBroke = report.files.some((f) => f.status === 'error');
    if (analyserBroke)
        return 'failure';
    if (failOn === 'never')
        return report.errors + report.warnings > 0 ? 'neutral' : 'success';
    if (failOn === 'warn')
        return report.errors + report.warnings > 0 ? 'failure' : 'success';
    if (report.errors > 0)
        return 'failure';
    return report.warnings > 0 ? 'neutral' : 'success';
}
//# sourceMappingURL=run.js.map