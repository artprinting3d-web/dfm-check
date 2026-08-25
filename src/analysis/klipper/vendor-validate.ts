/**
 * VENDORED — do not edit by hand.
 *
 * Source: Edufacturing_HUB/Creative_Lab/Tools_new/klipper-configurator
 *   `validateConfig` and `ValidationResult`  <- src/data.ts (lines 205-245)
 *   the English message table                <- src/i18n.ts  (lines 243-250)
 *
 * Copied verbatim; the only changes are the ones that make it stand alone here:
 *   - `ConfigState` is narrowed to the fields validateConfig actually reads, and every
 *     field is optional, because a printer.cfg does not declare all of them (see parse-cfg.ts);
 *   - the message table is inlined instead of imported through the tool's i18n module.
 *
 * The rules themselves are the tool's, not this app's, and they are electro-mechanical
 * compatibility statements rather than numeric thresholds — the EDi Brain rules core has
 * no Klipper rules (checked 2026-08-23: `klipper|firmware|stallguard|sensorless` matches
 * nothing in dist/edufacturing-rules.json). Findings from this module therefore carry
 * `rule_id: null` and name the tool as their `source`, exactly as the provenance contract
 * in core/print-engine/API.md prescribes for a fact that is not a canonical rule.
 *
 * `scripts/vendor-diff.sh` proves this copy still matches its source.
 */

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

/** The subset of the tool's ConfigState that validateConfig reads. */
export interface KlipperConfigState {
  printerType?: string;
  zLeveling?: string;
  board?: string;
  stepperDrivers?: string;
  homingType?: string;
  extruder?: string;
  hotendType?: string;
  probe?: string;
}

/**
 * Validation returns i18n KEYS (not localised strings).
 * Consumer must call `getT(lang)(key)` to render.
 * Keys are defined in `src/i18n.ts` under the err_/warn_ prefix.
 */
export const validateConfig = (config: KlipperConfigState): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (config.stepperDrivers === 'tmc5160' && config.board === 'generic') {
    errors.push('err_tmc5160_generic');
  }

  if (config.stepperDrivers === 'tmc5160' && (config.board === 'skr_mini_e3' || config.board === 'skr_pico')) {
    errors.push('err_tmc5160_skr_mini');
  }

  if (config.printerType === 'corexy' && config.zLeveling === 'none') {
    warnings.push('warn_corexy_no_level');
  }

  if (config.probe === 'beacon' && (config.board === 'skr_mini_e3' || config.board === 'generic')) {
    warnings.push('warn_beacon_weak_board');
  }

  if (config.homingType === 'sensorless' && (config.stepperDrivers === 'generic' || config.stepperDrivers === 'a4988')) {
    errors.push('err_sensorless_dumb');
  }

  if ((config.board === 'sht36' || config.board === 'ebb2209') && config.probe === 'bltouch') {
    warnings.push('warn_can_bltouch');
  }

  if (config.hotendType === 'rapido' && config.extruder === 'generic') {
    warnings.push('warn_rapido_generic_extruder');
  }

  return { errors, warnings };
};

/** The tool's own English copy for each key, verbatim from src/i18n.ts. */
export const MESSAGES_EN: Record<string, string> = {
  err_tmc5160_generic:
    'Specific requirement: TMC5160 needs a board with hardware SPI support (e.g., BTT Octopus). A "Generic" board offers no guarantee of SPI pins.',
  err_tmc5160_skr_mini:
    'Incompatibility: BTT SKR Mini / Pico have integrated drivers soldered to the board and cannot accept external drivers (e.g., TMC5160).',
  err_sensorless_dumb:
    'Homing error: Sensorless homing (StallGuard) requires intelligent TMC drivers (TMC2209, 2240, or 5160).',
  warn_corexy_no_level:
    'Recommendation: CoreXY kinematics are usually paired with QGL (Quad Gantry Level) or Z-Tilt for proper gantry leveling.',
  warn_beacon_weak_board:
    'Potential conflict: The Beacon probe needs a special connection interface (USB or CAN). Check that you have free ports.',
  warn_can_bltouch:
    'CAN Toolhead can require tricky pin configuration for BLTouch due to limited I/O. Consider Tap or Inductive instead.',
  warn_rapido_generic_extruder:
    'A high-flow hotend may struggle with a generic/bowden extruder at high speeds. A direct drive (Orbiter, Stealthburner) is recommended.',
};

/** Which ConfigState fields each rule reads. Used to say why a rule was not evaluated. */
export const RULE_INPUTS: Record<string, Array<keyof KlipperConfigState>> = {
  err_tmc5160_generic: ['stepperDrivers', 'board'],
  err_tmc5160_skr_mini: ['stepperDrivers', 'board'],
  warn_corexy_no_level: ['printerType', 'zLeveling'],
  warn_beacon_weak_board: ['probe', 'board'],
  err_sensorless_dumb: ['homingType', 'stepperDrivers'],
  warn_can_bltouch: ['board', 'probe'],
  warn_rapido_generic_extruder: ['hotendType', 'extruder'],
};
