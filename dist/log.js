function emit(level, msg, fields = {}) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
    if (level === 'error')
        process.stderr.write(line + '\n');
    else
        process.stdout.write(line + '\n');
}
export const log = {
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
};
//# sourceMappingURL=log.js.map