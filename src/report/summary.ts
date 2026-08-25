import type { RunReport } from '../types.js';
import { annotationRequestCount } from '../github/checks.js';

/**
 * The Markdown body of the check run, and the same text for the PR comment.
 *
 * Written to be read by someone who did not ask for it: what was looked at, what was
 * found, what was deliberately not measured, and where every number came from. The
 * "not measured" table is not padding — a check that stays silent about its blind spots
 * teaches people to trust it for things it never checked.
 */

export function checkTitle(report: RunReport): string {
  if (report.files.some((f) => f.status === 'error')) return 'DFM check could not finish';
  if (report.errors > 0) return report.errors + (report.errors === 1 ? ' problem' : ' problems') + ' to fix';
  if (report.warnings > 0) return report.warnings + (report.warnings === 1 ? ' warning' : ' warnings');
  const analysed = report.files.filter((f) => f.status === 'analyzed').length;
  if (analysed === 0) return 'Nothing to check';
  return 'Manufacturable: ' + analysed + (analysed === 1 ? ' file' : ' files') + ' clean';
}

function scoreCell(score: number | undefined): string {
  return score === undefined ? '—' : String(score) + '/100';
}

const ANALYZER_LABEL: Record<string, string> = {
  mesh: 'mesh',
  openscad: 'OpenSCAD',
  cadquery: 'CadQuery',
  kicad: 'KiCad',
  klipper: 'Klipper',
};

export function buildSummary(report: RunReport): string {
  const out: string[] = [];

  const analysed = report.files.filter((f) => f.status === 'analyzed');
  const skipped = report.files.filter((f) => f.status === 'skipped');
  const broken = report.files.filter((f) => f.status === 'error');

  out.push('## ' + checkTitle(report));
  out.push('');
  out.push(
    [
      String(report.errors) + ' error' + (report.errors === 1 ? '' : 's'),
      String(report.warnings) + ' warning' + (report.warnings === 1 ? '' : 's'),
      String(report.notices) + ' notice' + (report.notices === 1 ? '' : 's'),
      'across ' + String(analysed.length) + ' file' + (analysed.length === 1 ? '' : 's'),
    ].join(' · '),
  );
  out.push('');

  if (!report.engine.reachable) {
    out.push(
      '> **The analysis engine did not answer.** Mesh, OpenSCAD and CadQuery findings are ' +
        'missing from this run — KiCad and Klipper checks run locally and are unaffected. ' +
        'Engine: `' +
        report.engine.url +
        '`',
    );
    out.push('');
  }

  if (analysed.length) {
    out.push('| File | Checked as | Score | Errors | Warnings | Notices |');
    out.push('|---|---|--:|--:|--:|--:|');
    for (const f of analysed) {
      const e = f.findings.filter((x) => x.severity === 'error').length;
      const w = f.findings.filter((x) => x.severity === 'warn').length;
      const i = f.findings.filter((x) => x.severity === 'info').length;
      out.push(
        '| `' +
          f.path +
          '` | ' +
          (ANALYZER_LABEL[f.analyzer] ?? f.analyzer) +
          ' | ' +
          scoreCell(f.score) +
          ' | ' +
          e +
          ' | ' +
          w +
          ' | ' +
          i +
          ' |',
      );
    }
    out.push('');
  }

  const errors = report.findings.filter((f) => f.severity === 'error');
  if (errors.length) {
    out.push('### What must change');
    out.push('');
    for (const f of errors.slice(0, 20)) {
      out.push('- **`' + f.path + ':' + f.line + '`** — ' + f.message_en);
      if (f.fix_en) out.push('  - Fix: ' + f.fix_en);
      out.push('  - ' + (f.rule_id ? '`' + f.rule_id + '`' : f.source ?? 'no source stated'));
    }
    if (errors.length > 20) out.push('- …and ' + (errors.length - 20) + ' more, all annotated on the diff.');
    out.push('');
  }

  const warnings = report.findings.filter((f) => f.severity === 'warn');
  if (warnings.length) {
    out.push('### Worth a look');
    out.push('');
    for (const f of warnings.slice(0, 15)) {
      out.push('- **`' + f.path + ':' + f.line + '`** — ' + f.message_en);
    }
    if (warnings.length > 15) out.push('- …and ' + (warnings.length - 15) + ' more.');
    out.push('');
  }

  // --- blind spots ----------------------------------------------------------
  const notEvaluated = new Map<string, { why: string; rule: string | null }>();
  for (const f of report.files) {
    for (const n of f.notEvaluated) notEvaluated.set(n.code, { why: n.why_en, rule: n.rule_id });
  }
  if (notEvaluated.size) {
    out.push('<details><summary>What this check did <b>not</b> measure (' + notEvaluated.size + ')</summary>');
    out.push('');
    out.push('| Not measured | Why | Rule it would need |');
    out.push('|---|---|---|');
    for (const [code, v] of notEvaluated) {
      out.push('| `' + code + '` | ' + v.why.replace(/\|/g, '\\|') + ' | ' + (v.rule ? '`' + v.rule + '`' : '—') + ' |');
    }
    out.push('');
    out.push('</details>');
    out.push('');
  }

  if (skipped.length) {
    out.push('<details><summary>Skipped (' + skipped.length + ')</summary>');
    out.push('');
    for (const f of skipped) out.push('- `' + f.path + '` — ' + (f.note_en ?? 'no reason recorded'));
    out.push('');
    out.push('</details>');
    out.push('');
  }

  if (broken.length) {
    out.push('### The check itself failed on these');
    out.push('');
    for (const f of broken) out.push('- `' + f.path + '` — ' + (f.note_en ?? 'no reason recorded'));
    out.push('');
  }

  if (report.dropped.length) {
    out.push(
      '> This pull request changed more matching files than one run analyses. ' +
        report.dropped.length +
        ' were not looked at: ' +
        report.dropped.map((p) => '`' + p + '`').join(', ') +
        '. Raise `EF_DFM_MAX_FILES` or split the pull request.',
    );
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push(
    'Thresholds are looked up by id in the EDi Brain rules core and cited on every finding. ' +
      'A finding with a `heuristic.*` id is a tuned setting of the analysis service, not a ' +
      'canonical rule, and says so. Engine: `' +
      report.engine.url +
      '`.',
  );

  return out.join('\n');
}

/** A one-paragraph version for the PR comment, which should not repeat the whole table. */
export function buildComment(report: RunReport, checkUrl: string): string {
  const head =
    report.errors > 0
      ? '**EF DFM Check found ' + report.errors + ' problem' + (report.errors === 1 ? '' : 's') + '.**'
      : report.warnings > 0
        ? '**EF DFM Check passed with ' + report.warnings + ' warning' + (report.warnings === 1 ? '' : 's') + '.**'
        : '**EF DFM Check passed.**';

  const files = report.files.filter((f) => f.status === 'analyzed');
  const list = files
    .slice(0, 10)
    .map((f) => '`' + f.path + '`' + (f.score === undefined ? '' : ' (' + f.score + '/100)'))
    .join(', ');

  return [
    head,
    '',
    files.length ? 'Checked: ' + list + (files.length > 10 ? ', and ' + (files.length - 10) + ' more.' : '') : '',
    '',
    'Every finding is annotated on the diff with the rule id behind it. [Full report](' + checkUrl + ')',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/** How many API calls the annotations will cost. Logged, and shown in the run's own footer. */
export function annotationCost(report: RunReport): number {
  return annotationRequestCount(report.findings.length);
}
