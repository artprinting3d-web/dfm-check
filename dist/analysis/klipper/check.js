import { inferConfig } from './parse-cfg.js';
import { MESSAGES_EN, RULE_INPUTS, validateConfig } from './vendor-validate.js';
/**
 * A Klipper `printer.cfg`, checked with the vendored `validateConfig` from
 * klipper-configurator.
 *
 * Two things make this more than a wrapper:
 *
 *   1. Every finding is anchored to the line that caused it. The wizard has no line
 *      numbers; a pull request does, and an annotation on the wrong line is worse than
 *      no annotation.
 *   2. Rules whose inputs the file does not declare are reported as *not evaluated*,
 *      named one by one. Three of the seven rules read `board`, which a printer.cfg
 *      does not carry, and pretending they passed would be the exact failure the
 *      provenance contract exists to prevent.
 */
const SOURCE = 'klipper-configurator validateConfig (vendored)';
/** Which line best explains a rule: the first determined input it reads. */
function lineFor(key, determined) {
    const inputs = RULE_INPUTS[key] ?? [];
    for (const field of inputs) {
        const d = determined[field];
        if (d)
            return d.line;
    }
    return 1;
}
function evidenceFor(key, determined) {
    const inputs = RULE_INPUTS[key] ?? [];
    const parts = inputs.map((f) => determined[f]?.evidence).filter((v) => Boolean(v));
    return parts.join('; ');
}
export function analyzeKlipperConfig(path, content) {
    const startedAt = Date.now();
    const text = content.toString('utf8');
    const { config, determined, undetermined } = inferConfig(text);
    const result = validateConfig(config);
    const findings = [];
    for (const key of result.errors) {
        findings.push(toFinding(path, key, 'error', determined));
    }
    for (const key of result.warnings) {
        findings.push(toFinding(path, key, 'warn', determined));
    }
    // Any rule whose inputs are not all determined was not evaluated. Say so, by name.
    const notEvaluated = [];
    const fired = new Set([...result.errors, ...result.warnings]);
    for (const [key, inputs] of Object.entries(RULE_INPUTS)) {
        if (fired.has(key))
            continue;
        const missing = inputs.filter((f) => undetermined[f] !== undefined);
        if (!missing.length)
            continue;
        notEvaluated.push({
            code: 'klipper.' + key,
            why_en: 'Needs ' +
                missing.join(' and ') +
                ', which this file does not declare. ' +
                missing.map((f) => undetermined[f]).join(' '),
            rule_id: null,
        });
    }
    return {
        path,
        analyzer: 'klipper',
        status: 'analyzed',
        findings,
        notEvaluated,
        durationMs: Date.now() - startedAt,
    };
}
function toFinding(path, key, severity, determined) {
    const evidence = evidenceFor(key, determined);
    const base = MESSAGES_EN[key] ?? key;
    return {
        path,
        line: lineFor(key, determined),
        severity,
        code: 'klipper.' + key,
        message_en: evidence ? base + ' Read from: ' + evidence + '.' : base,
        rule_id: null,
        source: SOURCE,
        analyzer: 'klipper',
    };
}
//# sourceMappingURL=check.js.map