/**
 * A tokeniser for KiCad's s-expression board format, keeping the line of every node.
 *
 * A regex over the file would be shorter and wrong: `(width 0.12)` appears inside
 * footprint silkscreen graphics as often as it appears inside a copper track, and a
 * flat grep cannot tell a 0.12 mm silkscreen line from a 0.12 mm trace. The structure
 * is what carries the meaning, so the structure is what gets parsed.
 */

export interface SNode {
  /** The head symbol, e.g. `segment`, `via`, `width`. */
  head: string;
  /** Child nodes, in order. */
  children: SNode[];
  /** Atoms directly after the head, in order: numbers stay strings, quotes are removed. */
  atoms: string[];
  /** 1-based line of the opening parenthesis. */
  line: number;
}

export class SexprError extends Error {}

export function parseSexpr(text: string): SNode {
  let i = 0;
  let line = 1;
  const n = text.length;

  function skipSpace(): void {
    while (i < n) {
      const c = text[i]!;
      if (c === '\n') {
        line++;
        i++;
      } else if (c === ' ' || c === '\t' || c === '\r') {
        i++;
      } else if (c === '#') {
        // Not part of the format, but harmless to tolerate in hand-edited files.
        while (i < n && text[i] !== '\n') i++;
      } else {
        return;
      }
    }
  }

  function readAtom(): string {
    const start = i;
    if (text[i] === '"') {
      i++;
      let out = '';
      while (i < n) {
        const c = text[i]!;
        if (c === '\\' && i + 1 < n) {
          out += text[i + 1];
          i += 2;
          continue;
        }
        if (c === '"') {
          i++;
          return out;
        }
        if (c === '\n') line++;
        out += c;
        i++;
      }
      throw new SexprError('Unterminated string starting at offset ' + start);
    }
    while (i < n) {
      const c = text[i]!;
      if (c === '(' || c === ')' || c === ' ' || c === '\t' || c === '\n' || c === '\r') break;
      i++;
    }
    return text.slice(start, i);
  }

  function readNode(): SNode {
    if (text[i] !== '(') throw new SexprError('Expected ( at line ' + line);
    const nodeLine = line;
    i++; // consume (
    skipSpace();
    const head = readAtom();
    const node: SNode = { head, children: [], atoms: [], line: nodeLine };

    for (;;) {
      skipSpace();
      if (i >= n) throw new SexprError('Unexpected end of file inside (' + head + ' at line ' + nodeLine);
      const c = text[i]!;
      if (c === ')') {
        i++;
        return node;
      }
      if (c === '(') {
        node.children.push(readNode());
      } else {
        node.atoms.push(readAtom());
      }
    }
  }

  skipSpace();
  const root = readNode();
  return root;
}

/** Direct children with a given head. Never recurses — nesting is the whole point. */
export function childrenNamed(node: SNode, head: string): SNode[] {
  return node.children.filter((c) => c.head === head);
}

export function childNamed(node: SNode, head: string): SNode | undefined {
  return node.children.find((c) => c.head === head);
}

/** First atom of `(head value)` as a number, or null when absent or unparsable. */
export function numberOf(node: SNode | undefined): number | null {
  if (!node) return null;
  const raw = node.atoms[0];
  if (raw === undefined) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

export function stringOf(node: SNode | undefined): string | null {
  if (!node) return null;
  return node.atoms[0] ?? null;
}
