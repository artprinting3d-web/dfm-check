# Printability Check

**Design-for-manufacturing review as CI, for repositories where the hardware is the code.**

Software has had linters for thirty years. Hardware kept reviewing STL files by eye, and
found the overhang after the print failed.

This is a GitHub App and a GitHub Action that read what a pull request changed — meshes,
OpenSCAD and CadQuery models, KiCad boards, Klipper printer configs — and annotate the diff
with what will not manufacture, on the line that caused it, naming the rule behind every
verdict.

```
parts/shelf-bracket.stl:1                                              ✗ failure
  22.6% of the surface overhangs beyond the 45° limit measured from vertical
  (steepest: 90°); 22.6% is past the cooled-PLA limit and will sag even with
  active cooling.

  Fix: Rotate by [90, 0, 0]° — overhang area drops to 0.0%.
  Rule: dfam.fdm.overhang_angle (EDi Brain rules core).

pcb/board.kicad_pcb:39                                                 ✗ failure
  On F.Cu, 2 copper tracks are narrower than the Class 2 minimum conductor
  width of 0.1 mm (narrowest: 0.07 mm).

  Fix: Widen these tracks to at least 0.1 mm.
  Rule: electronics.min_trace_width_ipc_class2 (EDi Brain rules core).
```

---

## What it reads

| Files | Checked for |
|---|---|
| `.stl` `.3mf` `.obj` `.ply` `.off` `.glb` `.gltf` `.amf` `.dae` | watertightness, thin walls, overhangs, aspect ratio, support access, build-volume fit, material requirements — with a printability score and a suggested rotation |
| `.scad` | rendered by OpenSCAD, then checked as a mesh; syntax errors annotated on the line OpenSCAD names |
| `.py` importing `cadquery` or `build123d` | executed by an export harness, then checked as a mesh |
| `.kicad_pcb` | conductor width against IPC-2221B Class 2, annular ring against IPC Class 2 and Class 3 |
| `printer.cfg` (Klipper) | contradictions between kinematics, levelling, drivers, homing and probe |

A `.py` is only a model if it imports a CAD library. A `.cfg` is only a Klipper config if it
declares `[printer] kinematics:`. Nothing else in your repository is touched.

## Where the numbers come from

Every threshold is looked up by id in the **EDi Brain rules core** and returned with that id.
There is not one tuned constant in this repository that pretends to be a standard.

Each finding carries exactly one kind of provenance:

| Looks like | Means |
|---|---|
| `Rule: dfam.fdm.overhang_angle (EDi Brain rules core)` | a canonical rule, auditable back to its source |
| `Heuristic: heuristic.wall_sample_count` | a declared setting of the analysis service, published at `GET /v1/rules` |
| `Source: mesh topology (konvertor-3d splitBodies)` | a measured fact, not a threshold at all |

The PCB rules are pulled straight out of the rules core by `scripts/gen-pcb-rules.mjs`, which
refuses to write a snapshot if an id has disappeared. The Klipper rules are vendored verbatim
from `klipper-configurator`, and `npm run check:vendor` proves the copy still matches its
source, rule by rule and string by string.

## What it does **not** do

The check run says this itself, every time, in a section called *What this check did not
measure*. A tool that stays quiet about its blind spots teaches people to trust it for things
it never checked.

- **It is not a DRC.** A real design rule check needs KiCad itself — `kicad-cli pcb drc
  --format json`, with the violations parsed explicitly, because kicad-cli exits 0 even when
  it finds violations (`ecad.kicad.drc_zero_violations_gate`). This reads the board file only,
  so it does conductor width and annular ring, and says so.
- **Trace-to-trace spacing** is a between-objects quantity. It needs the pairwise geometry a
  DRC does.
- **Bridge length, hole diameter, assembly clearance** are not readable from a mesh: a mesh
  has triangles, not features, and one uploaded body has no mating partner.
- **The board model in a `printer.cfg`** is not knowable. Klipper names the MCU chip in the
  serial path, not the board, so an Octopus and a no-name clone are indistinguishable — three
  of the seven Klipper rules read `board`, and they are reported as *not evaluated* rather
  than silently passed. Declare it with `# efdfm-board: octopus` to switch them on.

---

## Use it as an Action

No app, no account, no webhook. It runs in your own runner.

```yaml
# .github/workflows/dfm.yml
name: DFM
on: pull_request

jobs:
  printability:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0        # the check diffs against the base branch

      - uses: artprinting3d-web/dfm-check@v1
        with:
          technology: fdm
          material: pla
          fail-on: error
```

| Input | Default | What it does |
|---|---|---|
| `base` | the pull request base | ref to diff against |
| `fail-on` | `error` | `error` \| `warn` \| `never` |
| `technology` | `fdm` | `fdm` \| `sla` \| `sls` \| `dmls` |
| `material` | — | `pla`, `abs`, `petg`, … — tightens or loosens the overhang limit |
| `printer-id` | — | enables the build-volume check |
| `render` | `1` | render OpenSCAD and CadQuery models |
| `max-files` | `25` | files analysed per run; anything dropped is named, never silently skipped |

Outputs: `errors`, `warnings`, `notices`.

The action installs OpenSCAD for you on Linux runners. It does **not** install CadQuery —
that pulls OpenCascade and takes minutes, which is not worth spending on every repository
that has no CadQuery in it. Add your own step if you want `.py` models analysed:

```yaml
      - run: pip install cadquery
      - uses: artprinting3d-web/dfm-check@v1
```

Without it, CadQuery models are **skipped with a note**, never reported as broken. A tool we
failed to install is our problem, not a defect in your part — and a check that blames your
file for our missing dependency is a check you will switch off by Friday.

## Use it as an App

Install it, and every pull request gets a check run. Nothing to add to the repository.

Optional, at the repository root:

```json
// .efdfm.json
{ "technology": "fdm", "material": "abs", "printer_id": "bambu_lab_x1_carbon" }
```

Free for every public repository. Private repositories are covered by the paid plans —
see `docs/listing/plans.md`.

A private repository without a plan gets a `neutral` check run with an explanation, never a
`failure`. A red X that means "you have not paid" looks exactly like a red X that means "this
part will not print", and confusing those two would destroy the only thing this tool is for.

---

## Running the service

Zero runtime dependencies: Node 22 and nothing else. That is deliberate for something that
terminates an unauthenticated request from the public internet.

```bash
npm ci
npm run build
cp .env.example .env      # fill in APP_ID, CLIENT_ID, PRIVATE_KEY_PATH, WEBHOOK_SECRET_PATH
node dist/server.js
```

`GET /health` · `POST /webhook`. Port 8303 by default — 8300 rules-api, 8301 cad-api,
8302 print-engine, 8303 this.

The service **refuses to start** without a webhook secret and a private key. An unverified
webhook endpoint accepts forged deliveries from anyone who learns the URL, and a warning in a
log nobody reads is not a mitigation.

`EF_DFM_ALLOW_RENDER` is off by default and should stay off on a shared server: an OpenSCAD
file is a program, a CadQuery model is arbitrary Python, and executing either one because
somebody opened a pull request from a fork is a straightforward way to be compromised. The
Action exists so that rendering happens in the customer's own disposable runner instead.

```bash
docker compose up -d       # 8303, non-root, key and secret mounted read-only
```

## Developing

```bash
npm run typecheck          # tsc, strict
npm test                   # 87 tests, no network
EF_DFM_LIVE=1 npx vitest run test/live-engine.test.ts   # against the live engine
npm run check:vendor       # the vendored Klipper validator still matches its source
npm run check:listing      # the Marketplace copy is still inside its limits
npm run gen:rules          # re-pull the PCB rules from the rules core
bash scripts/mutate.sh     # break 15 things on purpose; the suite must go red for each
```

`scripts/mutate.sh` is the one that matters. A green suite proves the code passes its tests;
it does not prove the tests would notice if the code stopped working. So each thing this
product exists to do is deliberately broken — findings dropped, the annotation limit raised
past what the API accepts, the webhook signature always saying yes, a cancellation applied
before its date — and a mutation the suite survives is reported as a failure of the script.
All fifteen are currently caught.

Fixtures are generated, not committed as opaque blobs: `node fixtures/make-fixtures.mjs`
writes the cube, the open cube and the T-beam from their triangles, so anyone reading the test
can see what "a good part" and "a bad part" mean here.

## Layout

```
src/github/      JWT, installation tokens, webhook signature, check runs, blobs
src/analysis/    classification, print-engine client, renderers, KiCad, Klipper
src/report/      findings -> annotations, findings -> Markdown summary
src/billing/     plans, entitlement store, who is allowed what
src/handlers/    pull_request, marketplace_purchase
src/server.ts    two routes and no framework
src/cli.ts       the Action path: the same analysers, workflow commands instead of a check run
```
