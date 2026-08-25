import type { KlipperConfigState } from './vendor-validate.js';

/**
 * Reading a Klipper `printer.cfg` into the wizard's ConfigState.
 *
 * The vendored `validateConfig` was written for a wizard, where every field is answered
 * by a human. A `printer.cfg` answers only some of them, and the honest thing to do with
 * the rest is to leave them undefined rather than to guess a default that then fires a
 * rule. `board`, in particular, is genuinely not derivable: Klipper knows the MCU chip in
 * the serial path, not the board model, so an Octopus and a no-name clone look identical.
 * A field is filled in only when the file states it.
 *
 * Where a field is undetermined, the rules that read it are reported as not evaluated —
 * see check.ts — so a green result never means "the board is fine", only "what the file
 * declares is consistent".
 */

export interface CfgSection {
  /** Section head, e.g. `printer`, `tmc2209`, `mcu`. Lowercased. */
  name: string;
  /** The argument after the head, e.g. `stepper_x` in `[tmc2209 stepper_x]`. */
  arg: string;
  /** 1-based line of the `[section]` header. */
  line: number;
  /** key -> { value, line }. Keys are lowercased; values keep their case. */
  options: Map<string, { value: string; line: number }>;
}

export interface ParsedCfg {
  sections: CfgSection[];
  /** True when the config pulls in other files, so an absent section proves nothing. */
  hasIncludes: boolean;
}

/** Klipper's config is INI-like: `[section arg]` headers, `key: value` or `key = value` options. */
export function parseCfg(text: string): ParsedCfg {
  const sections: CfgSection[] = [];
  let hasIncludes = false;
  let current: CfgSection | null = null;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const lineNo = i + 1;
    const withoutComment = raw.replace(/(^|\s)[#;].*$/, '');
    const trimmed = withoutComment.trim();
    if (!trimmed) continue;

    const header = /^\[([^\]]+)\]$/.exec(trimmed);
    if (header) {
      const inner = header[1]!.trim();
      const space = inner.search(/\s/);
      const name = (space === -1 ? inner : inner.slice(0, space)).toLowerCase();
      const arg = space === -1 ? '' : inner.slice(space + 1).trim();
      if (name === 'include') hasIncludes = true;
      current = { name, arg, line: lineNo, options: new Map() };
      sections.push(current);
      continue;
    }

    if (!current) continue;
    // Continuation lines (indented, no separator) belong to the previous key; ignored here.
    const kv = /^([A-Za-z0-9_.]+)\s*[:=]\s*(.*)$/.exec(trimmed);
    if (!kv) continue;
    current.options.set(kv[1]!.toLowerCase(), { value: kv[2]!.trim(), line: lineNo });
  }

  return { sections, hasIncludes };
}

export type Field = keyof KlipperConfigState;

export interface Determination {
  /** Where in the file the value was read from. */
  line: number;
  /** What in the file decided it, in the user's own words, e.g. `[printer] kinematics: corexy`. */
  evidence: string;
}

export interface InferredConfig {
  config: KlipperConfigState;
  determined: Partial<Record<Field, Determination>>;
  /** Fields the file does not state, with the reason. */
  undetermined: Partial<Record<Field, string>>;
  parsed: ParsedCfg;
}

/** Klipper `kinematics:` values mapped onto the wizard's printerType ids. */
const KINEMATICS: Record<string, string> = {
  cartesian: 'cartesian',
  corexy: 'corexy',
  hybrid_corexy: 'corexy',
  corexz: 'corexz',
  hybrid_corexz: 'corexz',
  delta: 'delta',
  rotary_delta: 'delta',
};

function find(parsed: ParsedCfg, name: string): CfgSection | undefined {
  return parsed.sections.find((s) => s.name === name);
}

function findAll(parsed: ParsedCfg, name: string): CfgSection[] {
  return parsed.sections.filter((s) => s.name === name);
}

export function inferConfig(text: string): InferredConfig {
  const parsed = parseCfg(text);
  const config: KlipperConfigState = {};
  const determined: Partial<Record<Field, Determination>> = {};
  const undetermined: Partial<Record<Field, string>> = {};

  const set = (field: Field, value: string, line: number, evidence: string): void => {
    config[field] = value;
    determined[field] = { line, evidence };
  };

  // --- printerType -----------------------------------------------------------
  const printer = find(parsed, 'printer');
  const kinematics = printer?.options.get('kinematics');
  if (kinematics) {
    const mapped = KINEMATICS[kinematics.value.toLowerCase()];
    if (mapped) set('printerType', mapped, kinematics.line, '[printer] kinematics: ' + kinematics.value);
    else undetermined['printerType'] = 'kinematics: ' + kinematics.value + ' has no equivalent in the rule set.';
  } else {
    undetermined['printerType'] = 'No [printer] section with a kinematics option.';
  }

  // --- zLeveling -------------------------------------------------------------
  const qgl = find(parsed, 'quad_gantry_level');
  const zTilt = find(parsed, 'z_tilt');
  const bedMesh = find(parsed, 'bed_mesh');
  if (qgl) set('zLeveling', 'qgl', qgl.line, '[quad_gantry_level]');
  else if (zTilt) set('zLeveling', 'z_tilt', zTilt.line, '[z_tilt]');
  else if (bedMesh) set('zLeveling', 'bed_mesh', bedMesh.line, '[bed_mesh]');
  else if (parsed.hasIncludes)
    undetermined['zLeveling'] =
      'No levelling section here, but the config uses [include ...], so it may be declared in another file.';
  else set('zLeveling', 'none', printer?.line ?? 1, 'no [quad_gantry_level], [z_tilt] or [bed_mesh] section');

  // --- stepperDrivers --------------------------------------------------------
  const tmc5160 = find(parsed, 'tmc5160');
  const tmc2240 = find(parsed, 'tmc2240');
  const tmc2209 = find(parsed, 'tmc2209');
  const tmc2130 = find(parsed, 'tmc2130');
  if (tmc5160) set('stepperDrivers', 'tmc5160', tmc5160.line, '[tmc5160 ' + tmc5160.arg + ']');
  else if (tmc2240) set('stepperDrivers', 'tmc2240', tmc2240.line, '[tmc2240 ' + tmc2240.arg + ']');
  else if (tmc2209) set('stepperDrivers', 'tmc2209', tmc2209.line, '[tmc2209 ' + tmc2209.arg + ']');
  else if (tmc2130) undetermined['stepperDrivers'] = 'TMC2130 is not one of the ids the rule set knows.';
  else if (parsed.hasIncludes)
    undetermined['stepperDrivers'] = 'No [tmc*] section here, and the config uses [include ...].';
  else
    set(
      'stepperDrivers',
      'generic',
      printer?.line ?? 1,
      'no [tmc2209], [tmc2240] or [tmc5160] section, so the drivers are not UART/SPI controlled',
    );

  // --- homingType ------------------------------------------------------------
  let sensorless: { line: number; evidence: string } | null = null;
  let physical: { line: number; evidence: string } | null = null;
  for (const s of parsed.sections) {
    if (!s.name.startsWith('stepper')) continue;
    const pin = s.options.get('endstop_pin');
    if (!pin) continue;
    if (/virtual_endstop/i.test(pin.value)) {
      sensorless ??= { line: pin.line, evidence: '[' + s.name + '] endstop_pin: ' + pin.value };
    } else {
      physical ??= { line: pin.line, evidence: '[' + s.name + '] endstop_pin: ' + pin.value };
    }
  }
  if (sensorless) set('homingType', 'sensorless', sensorless.line, sensorless.evidence);
  else if (physical) set('homingType', 'endstop', physical.line, physical.evidence);
  else undetermined['homingType'] = 'No stepper section declares an endstop_pin.';

  // --- probe -----------------------------------------------------------------
  const bltouch = find(parsed, 'bltouch');
  const beacon = find(parsed, 'beacon') ?? find(parsed, 'scanner') ?? find(parsed, 'cartographer');
  const bd = find(parsed, 'bd_sensor');
  const genericProbe = find(parsed, 'probe');
  if (bltouch) set('probe', 'bltouch', bltouch.line, '[bltouch]');
  else if (beacon) set('probe', 'beacon', beacon.line, '[' + beacon.name + ']');
  else if (bd) set('probe', 'bd_sensor', bd.line, '[bd_sensor]');
  else if (genericProbe)
    undetermined['probe'] =
      '[probe] does not say which probe it is — Voron Tap, Klicky and a plain inductive sensor all use it.';
  else if (parsed.hasIncludes) undetermined['probe'] = 'No probe section here, and the config uses [include ...].';
  else set('probe', 'none', printer?.line ?? 1, 'no probe section');

  // --- board -----------------------------------------------------------------
  // Explicit marker first; then the one board *class* a config really does declare:
  // a secondary [mcu <name>] on CAN is a toolhead board, which is what the CAN rule means.
  const marker = /^[ \t]*#[ \t]*efdfm-board:[ \t]*([A-Za-z0-9_]+)/m.exec(text);
  const toolheadMcu = findAll(parsed, 'mcu').find((s) => s.arg !== '' && s.options.has('canbus_uuid'));
  if (marker) {
    const line = text.slice(0, marker.index).split('\n').length;
    set('board', marker[1]!.toLowerCase(), line, '# efdfm-board: ' + marker[1]);
  } else if (toolheadMcu) {
    set(
      'board',
      'ebb2209',
      toolheadMcu.line,
      '[mcu ' + toolheadMcu.arg + '] with canbus_uuid — a CAN toolhead board',
    );
  } else {
    undetermined['board'] =
      'A printer.cfg names the MCU chip, not the board model, so the board cannot be read from this file. ' +
      'Declare it with a `# efdfm-board: octopus` comment to enable the board rules.';
  }

  // --- extruder / hotendType -------------------------------------------------
  undetermined['extruder'] = 'A printer.cfg declares steps and gear ratio, not which extruder body is fitted.';
  undetermined['hotendType'] = 'A printer.cfg declares the heater and thermistor, not the hotend model.';

  return { config, determined, undetermined, parsed };
}
