import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
export class EntitlementStore {
    dir;
    now;
    data = { version: 1, accounts: {} };
    file;
    constructor(dir, now = () => new Date()) {
        this.dir = dir;
        this.now = now;
        this.file = join(dir, 'entitlements.json');
        this.load();
    }
    load() {
        if (!existsSync(this.file))
            return;
        try {
            const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
            if (parsed && parsed.version === 1 && parsed.accounts)
                this.data = parsed;
        }
        catch {
            // A corrupt store must not take the service down; it degrades to "no paid accounts
            // known", which fails closed for private repos and open for public ones.
            this.data = { version: 1, accounts: {} };
        }
    }
    persist() {
        mkdirSync(this.dir, { recursive: true });
        const tmp = this.file + '.tmp';
        writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n', 'utf8');
        renameSync(tmp, this.file);
    }
    get(accountId) {
        return this.data.accounts[String(accountId)] ?? null;
    }
    all() {
        return Object.values(this.data.accounts);
    }
    put(entitlement) {
        this.data.accounts[String(entitlement.accountId)] = entitlement;
        this.persist();
    }
    /**
     * The tier that applies right now, which is not always the tier on the record:
     * a cancellation and a downgrade both take effect on a date, and until that date the
     * customer keeps what they paid for.
     */
    effectiveTier(accountId) {
        const e = this.get(accountId);
        if (!e)
            return 'free';
        const now = this.now().getTime();
        if (e.cancelledEffectiveFrom && Date.parse(e.cancelledEffectiveFrom) <= now)
            return 'free';
        if (e.pendingTier && e.pendingEffectiveFrom && Date.parse(e.pendingEffectiveFrom) <= now)
            return e.pendingTier;
        return e.tier;
    }
}
/** Builds a fresh record. Exported so the webhook handler and the reconciler agree on the shape. */
export function makeEntitlement(input) {
    return {
        accountId: input.accountId,
        login: input.login,
        accountType: input.accountType,
        tier: input.tier,
        unitCount: input.unitCount ?? null,
        onFreeTrial: input.onFreeTrial ?? false,
        freeTrialEndsOn: input.freeTrialEndsOn ?? null,
        billingCycle: input.billingCycle ?? null,
        cancelledEffectiveFrom: null,
        pendingTier: null,
        pendingEffectiveFrom: null,
        updatedAt: (input.now ?? new Date()).toISOString(),
    };
}
//# sourceMappingURL=store.js.map