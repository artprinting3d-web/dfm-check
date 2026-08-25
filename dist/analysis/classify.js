/**
 * Which analyser, if any, claims a changed file.
 *
 * Two stages on purpose. `claims(path)` is the cheap filter run against the pull
 * request file list, before any bytes are downloaded. `analyzerFor(path, content)`
 * is the honest answer, because a `.py` is only a CadQuery model if it imports
 * CadQuery, and a `.cfg` is only a Klipper config if it declares `[printer]`.
 */
/** Mesh formats print-engine parses (GET /health -> input_formats). */
export const MESH_EXTENSIONS = ['.stl', '.3mf', '.obj', '.ply', '.off', '.glb', '.gltf', '.amf', '.dae'];
function ext(path) {
    const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
    const dot = base.lastIndexOf('.');
    return dot <= 0 ? '' : base.slice(dot);
}
function basename(path) {
    return path.slice(path.lastIndexOf('/') + 1).toLowerCase();
}
/** Cheap path-only filter, applied to the PR file list. Deliberately generous — content decides. */
export function claims(path) {
    const e = ext(path);
    if (MESH_EXTENSIONS.includes(e))
        return true;
    if (e === '.scad')
        return true;
    if (e === '.kicad_pcb')
        return true;
    if (e === '.py')
        return true;
    if (e === '.cfg' || e === '.conf')
        return true;
    return false;
}
/** True when a `.py` file is a CadQuery model rather than any other Python file in the repo. */
export function looksLikeCadQuery(content) {
    if (!content)
        return false;
    const head = content.subarray(0, 64 * 1024).toString('utf8');
    return /^\s*(import\s+cadquery|from\s+cadquery\s+import|import\s+build123d|from\s+build123d\s+import)/m.test(head);
}
/**
 * True when a `.cfg` is a Klipper printer config.
 *
 * `[printer]` with a `kinematics:` key is Klipper's own required section — a Klipper
 * instance refuses to start without it — which makes it a safer marker than the file name.
 */
export function looksLikeKlipperConfig(path, content) {
    if (!content)
        return false;
    const text = content.subarray(0, 256 * 1024).toString('utf8');
    if (/^\s*\[printer\]/m.test(text) && /^\s*kinematics\s*:/m.test(text))
        return true;
    // A file literally called printer.cfg that includes other files still counts.
    return basename(path) === 'printer.cfg' && /^\s*\[include\s/m.test(text);
}
export function analyzerFor(path, content) {
    const e = ext(path);
    if (MESH_EXTENSIONS.includes(e))
        return 'mesh';
    if (e === '.scad')
        return 'openscad';
    if (e === '.kicad_pcb')
        return 'kicad';
    if (e === '.py')
        return looksLikeCadQuery(content) ? 'cadquery' : null;
    if (e === '.cfg' || e === '.conf')
        return looksLikeKlipperConfig(path, content) ? 'klipper' : null;
    return null;
}
/** The extension print-engine should be told about, so it picks the right parser. */
export function meshFilename(path) {
    return path.slice(path.lastIndexOf('/') + 1);
}
//# sourceMappingURL=classify.js.map