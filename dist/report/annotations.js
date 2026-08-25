/**
 * Findings, rendered as check run annotations.
 *
 * Ordering matters more than it looks: GitHub shows the first annotations inline on the
 * diff and the API accepts them 50 at a time, so errors go first and notices last. A
 * truncated list must never be a list that dropped the failures.
 */
const LEVEL = {
    error: 'failure',
    warn: 'warning',
    info: 'notice',
};
const RANK = { error: 0, warn: 1, info: 2 };
/** The provenance line that goes under every message — the audit trail, in one sentence. */
export function provenanceLine(f) {
    if (f.rule_id && f.rule_id.startsWith('heuristic.')) {
        return 'Heuristic: ' + f.rule_id + ' (a declared setting of the analysis service, not a canonical rule).';
    }
    if (f.rule_id)
        return 'Rule: ' + f.rule_id + ' (EDi Brain rules core).';
    if (f.source)
        return 'Source: ' + f.source + ' (a measured fact, not a threshold).';
    return 'Source: not stated.';
}
export function toAnnotation(f) {
    const parts = [f.message_en];
    if (f.fix_en)
        parts.push('Fix: ' + f.fix_en);
    parts.push(provenanceLine(f));
    return {
        path: f.path,
        start_line: f.line,
        end_line: f.endLine ?? f.line,
        annotation_level: LEVEL[f.severity],
        message: parts.join('\n\n'),
        title: annotationTitle(f),
        raw_details: JSON.stringify({ code: f.code, rule_id: f.rule_id, source: f.source, analyzer: f.analyzer, severity: f.severity }, null, 2),
    };
}
export function annotationTitle(f) {
    const label = f.rule_id ?? f.code;
    return 'EF DFM: ' + label;
}
/** Every finding as an annotation, errors first. The caller batches them by 50. */
export function toAnnotations(report) {
    return [...report.findings]
        .sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.path.localeCompare(b.path) || a.line - b.line)
        .map(toAnnotation);
}
//# sourceMappingURL=annotations.js.map