/** Severity as the analysers speak it. Mapped to GitHub annotation levels in report/annotations.ts. */
export type Severity = 'error' | 'warn' | 'info';

/** Which analyser produced a finding — also decides how the file was read. */
export type Analyzer = 'mesh' | 'openscad' | 'cadquery' | 'klipper' | 'kicad';

/**
 * One reviewable statement about one place in one file.
 *
 * Provenance is mutually exclusive, exactly as print-engine's `flags[]` defines it
 * (core/print-engine/API.md, section "flags[]"):
 *
 *   rule_id = `dfam.*` / `electronics.*` / ...  + source = null  -> canonical rule from the rules core
 *   rule_id = `heuristic.*`                     + source = null  -> a declared tuned value of a service
 *   rule_id = null                              + source != null -> a fact (mesh topology, a library, a parser)
 */
export interface Finding {
  path: string;
  /** 1-based. 1 for binary files, where "the line" is the file itself. */
  line: number;
  endLine?: number;
  severity: Severity;
  /** Stable machine code, e.g. `overhang`, `annular_ring`, `klipper.err_tmc5160_generic`. */
  code: string;
  message_en: string;
  fix_en?: string;
  rule_id: string | null;
  source: string | null;
  analyzer: Analyzer;
}

/** Something the analyser deliberately did not measure — so silence is never read as "clean". */
export interface NotEvaluated {
  code: string;
  why_en: string;
  rule_id: string | null;
}

/** The result of analysing one changed file. */
export interface FileReport {
  path: string;
  analyzer: Analyzer;
  status: 'analyzed' | 'skipped' | 'error';
  /** Present when status is 'skipped' or 'error'. */
  note_en?: string;
  findings: Finding[];
  notEvaluated: NotEvaluated[];
  /** print-engine printability score, 0..100, when the analyser produced one. */
  score?: number;
  durationMs: number;
}

/** The result of analysing a whole pull request. */
export interface RunReport {
  files: FileReport[];
  findings: Finding[];
  errors: number;
  warnings: number;
  notices: number;
  /** Files that changed but no analyser claims — reported as a count, never silently dropped. */
  unclaimed: string[];
  /** Files an analyser claims but that a cap dropped; named, so a cap is never silent. */
  dropped: string[];
  engine: { url: string; reachable: boolean };
  startedAt: string;
  completedAt: string;
}

/** A file the analysers should look at, with its bytes already in hand. */
export interface ChangedFile {
  path: string;
  /** added | modified | renamed | removed — removed files are never analysed. */
  status: string;
  /** null when the analyser only needs the path, or the content could not be fetched. */
  content: Buffer | null;
}
