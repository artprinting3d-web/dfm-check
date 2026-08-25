import { readFileSync } from 'node:fs';
function env(name, fallback = '') {
    const v = process.env[name];
    return v === undefined || v === '' ? fallback : v;
}
/**
 * The first of several names that is set.
 *
 * The deployment on edufacturing.com uses the short names — `APP_ID`, `CLIENT_ID`,
 * `PRIVATE_KEY_PATH`, `WEBHOOK_SECRET` — and this repository documented the `GITHUB_*`
 * ones. Both work, short name first, so the same image runs in either environment.
 */
function envAny(names, fallback = '') {
    for (const name of names) {
        const v = process.env[name];
        if (v !== undefined && v !== '')
            return v;
    }
    return fallback;
}
function num(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '')
        return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n))
        throw new Error(name + ' must be a number, got ' + JSON.stringify(raw));
    return n;
}
/** Reads the key from an inline PEM, or from a path on disk. The path form is the one to use. */
function readPrivateKey() {
    const inline = envAny(['PRIVATE_KEY', 'GITHUB_APP_PRIVATE_KEY']);
    if (inline)
        return inline.includes('\\n') ? inline.replace(/\\n/g, '\n') : inline;
    const path = envAny(['PRIVATE_KEY_PATH', 'GITHUB_APP_PRIVATE_KEY_PATH']);
    if (!path)
        return '';
    return readFileSync(path, 'utf8');
}
/**
 * The webhook secret, from the environment or from a file.
 *
 * The file form exists because a secret in an environment variable is visible to every
 * process on the box and to `docker inspect`; a file can be 0600 and owned by one user.
 */
function readWebhookSecret() {
    const inline = envAny(['WEBHOOK_SECRET', 'GITHUB_WEBHOOK_SECRET']);
    if (inline)
        return inline.trim();
    const path = envAny(['WEBHOOK_SECRET_PATH', 'GITHUB_WEBHOOK_SECRET_PATH']);
    if (!path)
        return '';
    return readFileSync(path, 'utf8').trim();
}
export function loadConfig() {
    const failOnRaw = env('EF_DFM_FAIL_ON', 'error');
    if (failOnRaw !== 'error' && failOnRaw !== 'warn' && failOnRaw !== 'never') {
        throw new Error('EF_DFM_FAIL_ON must be error | warn | never, got ' + JSON.stringify(failOnRaw));
    }
    return {
        port: num('PORT', 8303),
        appId: envAny(['APP_ID', 'GITHUB_APP_ID']),
        clientId: envAny(['CLIENT_ID', 'GITHUB_APP_CLIENT_ID']),
        privateKey: readPrivateKey(),
        webhookSecret: readWebhookSecret(),
        apiBase: envAny(['GITHUB_API_BASE'], 'https://api.github.com').replace(/\/+$/, ''),
        engineUrl: env('EF_ENGINE_URL', 'https://edufacturing.com/api/engine').replace(/\/+$/, ''),
        eduKey: env('EDU_API_KEY'),
        // The name the check appears under in the pull request, and therefore the name a
        // branch protection rule refers to. It matches the App, "Printability Check".
        checkName: env('EF_DFM_CHECK_NAME', 'Printability Check'),
        failOn: failOnRaw,
        maxFiles: num('EF_DFM_MAX_FILES', 25),
        maxFileBytes: num('EF_DFM_MAX_FILE_BYTES', 52_428_800),
        dataDir: env('EF_DFM_DATA_DIR', 'data'),
        tmpDir: env('EF_DFM_TMP_DIR', 'tmp'),
        openscadBin: env('EF_OPENSCAD_BIN', 'openscad'),
        pythonBin: env('EF_PYTHON_BIN', 'python3'),
        renderTimeoutSec: num('EF_RENDER_TIMEOUT_SEC', 120),
    };
}
/**
 * Refuses to serve webhooks without the secrets that make them safe. An endpoint with
 * no secret accepts forged deliveries from anyone who learns the URL, so this is a
 * hard failure at boot rather than a warning in a log nobody reads.
 *
 * The CLI (the Action path) never calls this: it needs neither key nor secret.
 */
export function assertWebhookReady(cfg) {
    const missing = [];
    if (!cfg.webhookSecret)
        missing.push('WEBHOOK_SECRET (or WEBHOOK_SECRET_PATH)');
    if (!cfg.privateKey)
        missing.push('PRIVATE_KEY_PATH (or PRIVATE_KEY)');
    if (!cfg.appId && !cfg.clientId)
        missing.push('APP_ID or CLIENT_ID');
    if (missing.length) {
        throw new Error('Refusing to start the webhook server without: ' +
            missing.join(', ') +
            '. An unverified webhook endpoint accepts forged deliveries. See .env.example.');
    }
}
//# sourceMappingURL=config.js.map