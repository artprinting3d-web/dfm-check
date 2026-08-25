import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/** Spawns a process with a hard timeout and no shell — arguments are never string-interpolated. */
export function runProcess(bin, args, opts) {
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
        child.stdout.on('data', (d) => {
            if (stdout.length < 64 * 1024)
                stdout += d.toString('utf8');
        });
        child.stderr.on('data', (d) => {
            if (stderr.length < 64 * 1024)
                stderr += d.toString('utf8');
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
export async function binaryAvailable(bin, versionArg = '--version') {
    const res = await runProcess(bin, [versionArg], { timeoutMs: 15_000 });
    return res.code === 0;
}
/** A temporary directory that is removed even when the body throws. */
export async function withTempDir(prefix, body) {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    try {
        return await body(dir);
    }
    finally {
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
}
export async function writeTemp(dir, name, content) {
    const path = join(dir, name);
    await writeFile(path, content);
    return path;
}
export async function readIfExists(path) {
    try {
        const s = await stat(path);
        if (!s.isFile() || s.size === 0)
            return null;
        return await readFile(path);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=render.js.map