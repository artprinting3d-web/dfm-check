import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Running a renderer.
 *
 * OpenSCAD and CadQuery models are *programs*. Rendering one means executing code that
 * arrived in a pull request, which on a shared webhook server is a straightforward way
 * to be compromised by anyone who can open a PR from a fork.
 *
 * So rendering is off by default in the App (`EF_DFM_ALLOW_RENDER=1` to enable, and then
 * only inside the container, which has no credentials mounted) and on by default in the
 * composite Action, where the code runs in the repository's own ephemeral runner and the
 * blast radius is the customer's, not ours. The check run says which mode produced it.
 */

export interface RenderResult {
  ok: boolean;
  stl?: Buffer;
  /** stderr, trimmed. Shown to the user when a render fails: it is where the syntax error is. */
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Spawns a process with a hard timeout and no shell — arguments are never string-interpolated. */
export function runProcess(
  bin: string,
  args: string[],
  opts: { timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < 64 * 1024) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(err), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** True when a binary can be executed at all. Used to skip honestly instead of failing loudly. */
export async function binaryAvailable(bin: string, versionArg = '--version'): Promise<boolean> {
  const res = await runProcess(bin, [versionArg], { timeoutMs: 15_000 });
  return res.code === 0;
}

/** A temporary directory that is removed even when the body throws. */
export async function withTempDir<T>(prefix: string, body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function writeTemp(dir: string, name: string, content: Buffer | string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

export async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    const s = await stat(path);
    if (!s.isFile() || s.size === 0) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}
