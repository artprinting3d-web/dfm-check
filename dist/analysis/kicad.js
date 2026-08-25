import { childNamed, childrenNamed, numberOf, parseSexpr, stringOf, SexprError } from './sexpr.js';
import pcbRules from './pcb-rules.json' with { type: 'json' };
const RULES = pcbRules.rules;
function threshold(id) {
    const rule = RULES[id];
    const v = rule?.constraint?.value;
    if (typeof v !== 'number') {
        throw new Error('pcb-rules.json has no numeric value for ' + id + ' — regenerate with scripts/gen-pcb-rules.mjs');
    }
    return v;
}
function severityOf(id) {
    const s = RULES[id]?.severity;
    return s === 'error' || s === 'warn' || s === 'info' ? s : 'warn';
}
/**
 * Reads the objects the checks need out of a parsed board.
 *
 * Only *top-level* `segment` / `arc` / `via` nodes count. A `(width …)` inside a
 * footprint's `fp_line` is silkscreen or courtyard, not copper, and flagging it would be
 * a false positive on every board that has a logo on it.
 */
export function readBoard(root) {
    const tracks = [];
    const vias = [];
    for (const node of root.children) {
        if (node.head === 'segment' || node.head === 'arc') {
            const width = numberOf(childNamed(node, 'width'));
            if (width === null)
                continue;
            tracks.push({
                width,
                layer: stringOf(childNamed(node, 'layer')) ?? 'unknown',
                net: stringOf(childNamed(node, 'net')) ?? '',
                line: node.line,
            });
        }
        else if (node.head === 'via') {
            const size = numberOf(childNamed(node, 'size'));
            const drill = numberOf(childNamed(node, 'drill'));
            if (size === null || drill === null)
                continue;
            vias.push({ size, drill, line: node.line });
        }
    }
    return {
        tracks,
        vias,
        version: stringOf(childrenNamed(root, 'version')[0]),
        generator: stringOf(childrenNamed(root, 'generator')[0]),
    };
}
function group(map, key, line, value, layer) {
    const g = map.get(key);
    if (!g) {
        map.set(key, { count: 1, firstLine: line, worst: value, layers: new Set(layer ? [layer] : []) });
        return;
    }
    g.count++;
    g.firstLine = Math.min(g.firstLine, line);
    g.worst = Math.min(g.worst, value);
    if (layer)
        g.layers.add(layer);
}
function mm(value) {
    return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + ' mm';
}
/**
 * Board dimensions arrive as decimal millimetres in text, and `(0.7 - 0.5) / 2` is
 * 0.09999999999999998 in binary floating point. Comparing that against a 0.1 mm rule
 * would report a via that is exactly on the limit as below it. Everything is therefore
 * rounded to nanometres — six decimal places — before any comparison.
 */
function nm(value) {
    return Math.round(value * 1e6) / 1e6;
}
/** "1 via has" / "2 vias have" — a report that cannot write English does not get read. */
function plural(count, singular, pluralForm, verbSingular, verbPlural) {
    return count === 1
        ? count + ' ' + singular + ' ' + verbSingular
        : count + ' ' + pluralForm + ' ' + verbPlural;
}
export function checkBoard(path, facts) {
    const findings = [];
    const FAB_MIN_WIDTH = 'electronics.min_trace_width_ipc_class2';
    const ONE_AMP_WIDTH = 'electronics.trace_width_1A_10C_external_min';
    const RING_CLASS2 = 'electronics.min_annular_ring_ipc_class2';
    const RING_CLASS3 = 'electronics.min_annular_ring_ipc_class3';
    const fabMin = threshold(FAB_MIN_WIDTH);
    const oneAmp = threshold(ONE_AMP_WIDTH);
    const ring2 = threshold(RING_CLASS2);
    const ring3 = threshold(RING_CLASS3);
    // --- conductor width -------------------------------------------------------
    const tooNarrow = new Map();
    const belowOneAmp = new Map();
    for (const t of facts.tracks) {
        const width = nm(t.width);
        if (width < fabMin)
            group(tooNarrow, t.layer, t.line, width, t.layer);
        else if (width < oneAmp)
            group(belowOneAmp, t.layer, t.line, width, t.layer);
    }
    for (const [layer, g] of tooNarrow) {
        findings.push({
            path,
            line: g.firstLine,
            severity: severityOf(FAB_MIN_WIDTH),
            code: 'trace_width_below_fab_minimum',
            message_en: 'On ' +
                layer +
                ', ' +
                plural(g.count, 'copper track', 'copper tracks', 'is', 'are') +
                ' narrower than the Class 2 minimum conductor width of ' +
                mm(fabMin) +
                ' (narrowest: ' +
                mm(g.worst) +
                '). Below this width a standard subtractive etch cannot hold the conductor reliably.',
            fix_en: 'Widen these tracks to at least ' + mm(fabMin) + ', or ask the fabricator to confirm a finer process.',
            rule_id: FAB_MIN_WIDTH,
            source: null,
            analyzer: 'kicad',
        });
    }
    for (const [layer, g] of belowOneAmp) {
        findings.push({
            path,
            line: g.firstLine,
            severity: 'info',
            code: 'trace_width_below_1a',
            message_en: 'On ' +
                layer +
                ', ' +
                plural(g.count, 'copper track', 'copper tracks', 'is', 'are') +
                ' narrower than ' +
                mm(oneAmp) +
                ' (narrowest: ' +
                mm(g.worst) +
                '), the IPC-2221 width for 1 A at a 10 degC rise on an outer layer with 1 oz copper. ' +
                'That is fine for signals and not fine for power: this check cannot tell which these are.',
            fix_en: 'Confirm none of these tracks carries 1 A or more; widen the ones that do.',
            rule_id: ONE_AMP_WIDTH,
            source: null,
            analyzer: 'kicad',
        });
    }
    // --- annular ring ----------------------------------------------------------
    const ringFail = new Map();
    const ringClass3 = new Map();
    for (const v of facts.vias) {
        const ring = nm((v.size - v.drill) / 2);
        if (ring < ring2)
            group(ringFail, 'via', v.line, ring);
        else if (ring < ring3)
            group(ringClass3, 'via', v.line, ring);
    }
    for (const [, g] of ringFail) {
        findings.push({
            path,
            line: g.firstLine,
            severity: severityOf(RING_CLASS2),
            code: 'annular_ring_below_class2',
            message_en: plural(g.count, 'via', 'vias', 'has', 'have') +
                ' an annular ring below the IPC Class 2 minimum of ' +
                mm(ring2) +
                ' (smallest: ' +
                mm(g.worst) +
                '). A ring this thin can tear away from the barrel under thermal cycling.',
            fix_en: 'Increase the via pad diameter, or reduce the drill, so that (pad - drill) / 2 is at least ' + mm(ring2) + '.',
            rule_id: RING_CLASS2,
            source: null,
            analyzer: 'kicad',
        });
    }
    for (const [, g] of ringClass3) {
        findings.push({
            path,
            line: g.firstLine,
            severity: 'info',
            code: 'annular_ring_below_class3',
            message_en: plural(g.count, 'via', 'vias', 'meets', 'meet') +
                ' IPC Class 2 but not Class 3, which asks for ' +
                mm(ring3) +
                ' (smallest here: ' +
                mm(g.worst) +
                '). Only relevant if this board is built to Class 3.',
            fix_en: 'If this design is Class 3 (high reliability), grow the via pads to a ' + mm(ring3) + ' ring.',
            rule_id: RING_CLASS3,
            source: null,
            analyzer: 'kicad',
        });
    }
    const notEvaluated = [
        {
            code: 'drc',
            why_en: 'A full design rule check needs KiCad itself: `kicad-cli pcb drc --format json`, with the ' +
                'violations array parsed explicitly (kicad-cli exits 0 even when it finds violations). ' +
                'This analyser reads the board file only.',
            rule_id: 'ecad.kicad.drc_zero_violations_gate',
        },
        {
            code: 'conductor_spacing',
            why_en: 'Trace-to-trace spacing is a between-objects quantity: it needs every pair of copper ' +
                'objects on a layer compared geometrically, which is what DRC does.',
            rule_id: 'electronics.min_trace_space_ipc_class2',
        },
        {
            code: 'creepage_clearance',
            why_en: 'The required clearance depends on the working voltage of each net, and a board file ' +
                'does not carry net voltages.',
            rule_id: 'electronics.creepage_clearance_0_50V',
        },
        {
            code: 'thermal_via_drill',
            why_en: 'The drill range applies to thermal vias specifically, and a board file does not mark ' +
                'which vias are thermal.',
            rule_id: 'electronics.thermal_via_drill_size',
        },
    ];
    return { findings, notEvaluated };
}
export function analyzeKicad(path, content) {
    const startedAt = Date.now();
    let root;
    try {
        root = parseSexpr(content.toString('utf8'));
    }
    catch (err) {
        const why = err instanceof SexprError ? err.message : String(err);
        return {
            path,
            analyzer: 'kicad',
            status: 'analyzed',
            findings: [
                {
                    path,
                    line: 1,
                    severity: 'error',
                    code: 'unparsable_board',
                    message_en: 'This file could not be read as a KiCad board: ' + why,
                    fix_en: 'Open and re-save the board in KiCad; a truncated or merge-mangled board file cannot be checked.',
                    rule_id: null,
                    source: 'kicad s-expression parser',
                    analyzer: 'kicad',
                },
            ],
            notEvaluated: [],
            durationMs: Date.now() - startedAt,
        };
    }
    if (root.head !== 'kicad_pcb') {
        return {
            path,
            analyzer: 'kicad',
            status: 'skipped',
            note_en: 'Not a board file: the root node is (' + root.head + '), not (kicad_pcb).',
            findings: [],
            notEvaluated: [],
            durationMs: Date.now() - startedAt,
        };
    }
    const facts = readBoard(root);
    const { findings, notEvaluated } = checkBoard(path, facts);
    return {
        path,
        analyzer: 'kicad',
        status: 'analyzed',
        findings,
        notEvaluated,
        durationMs: Date.now() - startedAt,
    };
}
/** Exposed for the tests and for the summary line that reports what was read. */
export const pcbRulesSnapshot = pcbRules;
//# sourceMappingURL=kicad.js.map