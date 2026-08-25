#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { claims, analyzerFor } from './analysis/classify.js';
import { HttpEngine } from './analysis/engine-client.js';
import { conclusionFor, runAnalysis } from './analysis/run.js';
import { buildSummary } from './report/summary.js';
import { provenanceLine } from './report/annotations.js';
import { runProcess } from './analysis/render.js';
function input(name, fallback = '') {
    // The Action passes inputs as INPUT_<NAME>; the plain env var is honoured too.
    const actionVar = 'INPUT_' + name.toUpperCase().replace(/-/g, '_');
    return process.env[actionVar] ?? process.env[name.toUpperCase().replace(/-/g, '_')] ?? fallback;
}
function readOptions(argv) {
    const explicit = argv.filter((a) => !a.startsWith('-'));
    const failOnRaw = input('fail-on', 'error');
    const failOn = failOnRaw === 'warn' || failOnRaw === 'never' ? failOnRaw : 'error';
    return {
        base: input('base', process.env['GITHUB_BASE_REF'] ? 'origin/' + process.env['GITHUB_BASE_REF'] : 'HEAD~1'),
        head: input('head', 'HEAD'),
        failOn,
        engineUrl: (input('engine-url', 'https://edufacturing.com/api/engine') || '').replace(/\/+$/, ''),
        eduKey: input('engine-key'),
        technology: input('technology') || undefined,
        material: input('material') || undefined,
        printerId: input('printer-id') || undefined,
        allowRender: input('render', '1') !== '0',
        openscadBin: input('openscad-bin', 'openscad'),
        pythonBin: input('python-bin', 'python3'),
        renderTimeoutMs: Number(input('render-timeout-sec', '120')) * 1000,
        maxFiles: Number(input('max-files', '25')),
        workdir: resolve(input('working-directory', process.cwd())),
        files: explicit.length ? explicit : undefined,
    };
}
/** `git diff --name-status base...head`, so the list matches what the pull request changed. */
async function changedPaths(opts) {
    const res = await runProcess('git', ['diff', '--name-status', '--diff-filter=d', opts.base + '...' + opts.head], {
        timeoutMs: 60_000,
        cwd: opts.workdir,
    });
    if (res.code !== 0) {
        // A shallow clone has no merge base. Fall back to the single-commit diff and say so.
        const fallback = await runProcess('git', ['diff', '--name-status', '--diff-filter=d', opts.head + '~1', opts.head], {
            timeoutMs: 60_000,
            cwd: opts.workdir,
        });
        if (fallback.code !== 0)
            return { paths: [], note: 'git diff failed: ' + res.stderr.trim() };
        return {
            paths: parseNameStatus(fallback.stdout),
            note: 'Could not diff against ' +
                opts.base +
                ' (a shallow checkout has no merge base). Compared the last commit instead — ' +
                'add `fetch-depth: 0` to actions/checkout for the full range.',
        };
    }
    return { paths: parseNameStatus(res.stdout) };
}
function parseNameStatus(stdout) {
    const out = [];
    for (const line of stdout.split('\n')) {
        const parts = line.trim().split('\t');
        if (parts.length < 2)
            continue;
        // A rename is `R100\told\tnew`; the new path is the one that exists now.
        out.push(parts[parts.length - 1]);
    }
    return out;
}
const LEVEL = { error: 'error', warn: 'warning', info: 'notice' };
/** Workflow-command escaping, per the Actions toolkit: data and properties escape differently. */
function escapeData(value) {
    return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}
function escapeProperty(value) {
    return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}
export function workflowCommands(report) {
    return report.findings.map((f) => {
        const message = [f.message_en, f.fix_en ? 'Fix: ' + f.fix_en : '', provenanceLine(f)]
            .filter(Boolean)
            .join('\n\n');
        const props = [
            'file=' + escapeProperty(f.path),
            'line=' + String(f.line),
            'title=' + escapeProperty('EF DFM: ' + (f.rule_id ?? f.code)),
        ].join(',');
        return '::' + LEVEL[f.severity] + ' ' + props + '::' + escapeData(message);
    });
}
function setOutput(name, value) {
    const file = process.env['GITHUB_OUTPUT'];
    if (!file)
        return;
    // A value with newlines needs the heredoc form.
    const delimiter = 'EFDFM_' + name.toUpperCase();
    appendFileSync(file, name + '<<' + delimiter + '\n' + value + '\n' + delimiter + '\n', 'utf8');
}
export async function main(argv) {
    const opts = readOptions(argv);
    let paths;
    let note;
    if (opts.files) {
        paths = opts.files;
    }
    else {
        const diff = await changedPaths(opts);
        paths = diff.paths;
        note = diff.note;
    }
    if (note)
        process.stdout.write('::notice::' + escapeData(note) + '\n');
    const claimed = paths.filter(claims);
    const unclaimed = paths.filter((p) => !claims(p));
    const dropped = claimed.slice(opts.maxFiles);
    const files = [];
    for (const path of claimed.slice(0, opts.maxFiles)) {
        let content = null;
        try {
            content = readFileSync(resolve(opts.workdir, path));
        }
        catch {
            content = null;
        }
        files.push({ path: relative(opts.workdir, resolve(opts.workdir, path)).split('\\').join('/'), status: 'modified', content });
    }
    const analysable = files.filter((f) => analyzerFor(f.path, f.content) !== null);
    if (!analysable.length) {
        // Тези две са РАЗЛИЧНИ състояния и досега се сливаха в едно съобщение:
        // „нищо не е променено" срещу „променени са файлове, но нито един не може
        // да бъде анализиран". Второто е дефект в настройката или във файла и
        // трябва да се вижда, а не да се чете като „всичко е наред".
        if (!paths.length) {
            process.stdout.write('::notice::No files changed in this diff — nothing for the DFM check to look at.\n');
        }
        else if (!claimed.length) {
            process.stdout.write('::notice::' +
                escapeData(paths.length +
                    ' file(s) changed, none of a kind this check reads (meshes, .scad, CadQuery .py, .kicad_pcb, printer.cfg): ' +
                    paths.slice(0, 10).join(', ')) +
                '\n');
        }
        else {
            process.stdout.write('::warning::' +
                escapeData(claimed.length +
                    ' hardware file(s) changed but none could be read or recognised: ' +
                    claimed.slice(0, 10).join(', ') +
                    '. A mesh that fails to parse lands here — check the file, and that the job has it on disk.') +
                '\n');
        }
        setOutput('errors', '0');
        setOutput('warnings', '0');
        return 0;
    }
    const engine = new HttpEngine({ baseUrl: opts.engineUrl, apiKey: opts.eduKey || undefined });
    const report = await runAnalysis(files, {
        engine,
        engineUrl: opts.engineUrl,
        technology: opts.technology,
        material: opts.material,
        printerId: opts.printerId,
        allowRender: opts.allowRender,
        openscadBin: opts.openscadBin,
        pythonBin: opts.pythonBin,
        renderTimeoutMs: opts.renderTimeoutMs,
        unclaimed,
        dropped,
    });
    for (const command of workflowCommands(report))
        process.stdout.write(command + '\n');
    const summary = buildSummary(report);
    const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
    if (summaryFile)
        appendFileSync(summaryFile, summary + '\n', 'utf8');
    else
        process.stdout.write('\n' + summary + '\n');
    setOutput('errors', String(report.errors));
    setOutput('warnings', String(report.warnings));
    setOutput('notices', String(report.notices));
    const conclusion = conclusionFor(report, opts.failOn);
    return conclusion === 'failure' ? 1 : 0;
}
if (process.argv[1]?.endsWith('cli.js') || process.argv[1]?.endsWith('cli.ts')) {
    main(process.argv.slice(2))
        .then((code) => process.exit(code))
        .catch((err) => {
        process.stderr.write('::error::' + escapeData(err instanceof Error ? err.message : String(err)) + '\n');
        process.exit(1);
    });
}
//# sourceMappingURL=cli.js.map