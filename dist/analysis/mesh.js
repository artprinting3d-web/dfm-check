import { EngineError } from './engine-client.js';
import { meshFilename } from './classify.js';
/**
 * A mesh file, reviewed by print-engine.
 *
 * Every flag the engine returns becomes one annotation on line 1 of the file: a binary
 * STL has no lines, and pointing at "the file" is the truthful place to point. The
 * message, the fix and the rule id are the engine's own words — this module invents
 * no thresholds and rewords no verdicts.
 */
export async function analyzeMesh(path, content, engine, opts = {}) {
    const startedAt = Date.now();
    try {
        const res = await engine.printability({
            filename: opts.meshName ?? meshFilename(path),
            content,
            technology: opts.technology ?? 'fdm',
            material: opts.material,
            printerId: opts.printerId,
        });
        const findings = res.flags.map((flag) => ({
            path,
            line: 1,
            severity: flag.severity,
            code: flag.code,
            message_en: flag.msg_en,
            fix_en: flag.fix_en,
            rule_id: flag.rule_id,
            source: flag.source,
            analyzer: 'mesh',
        }));
        return {
            path,
            analyzer: 'mesh',
            status: 'analyzed',
            findings,
            notEvaluated: (res.not_evaluated ?? []).map((n) => ({
                code: n.code,
                why_en: n.why_en,
                rule_id: n.rule_id,
            })),
            score: res.score,
            durationMs: Date.now() - startedAt,
        };
    }
    catch (err) {
        // 400/413/422 are statements about the file; 5xx and network faults are statements
        // about us. Both are reported — a check that quietly skips a file is worse than none.
        const isEngineError = err instanceof EngineError;
        const status = isEngineError ? err.status : 0;
        const detail = err instanceof Error ? err.message : String(err);
        const aboutTheFile = status >= 400 && status < 500;
        return {
            path,
            analyzer: 'mesh',
            status: aboutTheFile ? 'analyzed' : 'error',
            note_en: aboutTheFile ? undefined : 'print-engine did not answer: ' + detail,
            findings: aboutTheFile
                ? [
                    {
                        path,
                        line: 1,
                        severity: 'error',
                        code: 'unreadable_mesh',
                        message_en: 'print-engine could not analyse this file: ' + detail,
                        fix_en: 'Re-export the model; check the file is a complete, uncorrupted mesh under 50 MB.',
                        rule_id: null,
                        source: 'print-engine ' + status,
                        analyzer: 'mesh',
                    },
                ]
                : [],
            notEvaluated: [],
            durationMs: Date.now() - startedAt,
        };
    }
}
//# sourceMappingURL=mesh.js.map