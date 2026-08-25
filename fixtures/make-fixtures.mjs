#!/usr/bin/env node
/**
 * Writes the binary mesh fixtures the tests use.
 *
 * They are generated rather than committed as opaque blobs so that anyone reading the
 * test can see exactly what "a good part" and "a bad part" mean here, in triangles:
 *
 *   good-cube.stl        a closed 20 mm cube. Watertight, no overhang, no thin wall.
 *   bad-overhang.stl     a T-shaped beam whose two arms hang horizontally (90 degrees
 *                        from vertical) over nothing — the shape print-engine's own API
 *                        documentation uses as its overhang example.
 *   bad-open.stl         the same cube with one face missing: not watertight.
 *
 * `node fixtures/make-fixtures.mjs` regenerates them byte-for-byte (no timestamps, no RNG).
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Binary STL: 80-byte header, uint32 triangle count, then 50 bytes per triangle. */
function writeStl(path, triangles, header = 'edufacturing dfm-check fixture') {
  const buf = Buffer.alloc(84 + triangles.length * 50);
  buf.write(header.padEnd(80, ' ').slice(0, 80), 0, 80, 'ascii');
  buf.writeUInt32LE(triangles.length, 80);

  let off = 84;
  for (const [a, b, c] of triangles) {
    const n = normal(a, b, c);
    for (const v of [n, a, b, c]) {
      buf.writeFloatLE(v[0], off);
      buf.writeFloatLE(v[1], off + 4);
      buf.writeFloatLE(v[2], off + 8);
      off += 12;
    }
    buf.writeUInt16LE(0, off);
    off += 2;
  }
  writeFileSync(path, buf);
  return buf.length;
}

function normal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/** Six quads of an axis-aligned box, as twelve triangles with outward normals. */
function boxTriangles(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const p = {
    a: [x0, y0, z0], b: [x1, y0, z0], c: [x1, y1, z0], d: [x0, y1, z0],
    e: [x0, y0, z1], f: [x1, y0, z1], g: [x1, y1, z1], h: [x0, y1, z1],
  };
  return [
    // bottom (-Z)
    [p.a, p.c, p.b], [p.a, p.d, p.c],
    // top (+Z)
    [p.e, p.f, p.g], [p.e, p.g, p.h],
    // front (-Y)
    [p.a, p.b, p.f], [p.a, p.f, p.e],
    // right (+X)
    [p.b, p.c, p.g], [p.b, p.g, p.f],
    // back (+Y)
    [p.c, p.d, p.h], [p.c, p.h, p.g],
    // left (-X)
    [p.d, p.a, p.e], [p.d, p.e, p.h],
  ];
}

const cube = boxTriangles([0, 0, 0], [20, 20, 20]);
writeStl(join(HERE, 'good-cube.stl'), cube);

// The cube with the +Z face removed: 10 triangles, 4 open edges, not watertight.
const open = cube.filter((_, i) => i !== 2 && i !== 3);
writeStl(join(HERE, 'bad-open.stl'), open);

// A T-beam: a 60x10x5 mm bar on top of a 10x10x14 mm stem. The bar's underside on both
// sides of the stem faces straight down over nothing — a 90-degree overhang.
const tBeam = [...boxTriangles([-5, -5, 0], [5, 5, 14]), ...boxTriangles([-30, -5, 14], [30, 5, 19])];
writeStl(join(HERE, 'bad-overhang.stl'), tBeam);

console.log('wrote good-cube.stl, bad-open.stl, bad-overhang.stl');
