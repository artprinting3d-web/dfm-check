import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Tier } from './plans.js';

/**
 * Who is entitled to what, kept in one JSON file.
 *
 * A file, not a database, because the whole state is "which account is on which plan" —
 * a few hundred rows at the size where the 100-install threshold for a paid listing is
 * even met. Writes are atomic (write a temp file, rename over the target), so a crash
 * mid-write cannot leave a half-written entitlement file behind.
 *
 * The limitation this carries, stated rather than discovered: one writer. Running two
 * instances against the same file would lose updates, so the deployment runs one, and
 * `reconcile()` exists precisely so a missed webhook can be repaired from GitHub.
 */

export interface Entitlement {
  accountId: number;
  login: string;
  /** 'User' or 'Organization', as GitHub reports it. */
  accountType: string;
  tier: Tier;
  unitCount: number | null;
  onFreeTrial: boolean;
  freeTrialEndsOn: string | null;
  billingCycle: string | null;
  /** Set when the plan was cancelled; the entitlement stays until this date passes. */
  cancelledEffectiveFrom: string | null;
  /** A pending downgrade takes effect on the next billing date, not immediately. */
  pendingTier: Tier | null;
  pendingEffectiveFrom: string | null;
  updatedAt: string;
}

type FileShape = { version: 1; accounts: Record<string, Entitlement> };

export class EntitlementStore {
  private data: FileShape = { version: 1, accounts: {} };
  private readonly file: string;

  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.file = join(dir, 'entitlements.json');
    this.load();
  }

  private load(): void {
    if (!existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as FileShape;
      if (parsed && parsed.version === 1 && parsed.accounts) this.data = parsed;
    } catch {
      // A corrupt store must not take the service down; it degrades to "no paid accounts
      // known", which fails closed for private repos and open for public ones.
      this.data = { version: 1, accounts: {} };
    }
  }

  private persist(): void {
    mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n', 'utf8');
    renameSync(tmp, this.file);
  }

  get(accountId: number): Entitlement | null {
    return this.data.accounts[String(accountId)] ?? null;
  }

  all(): Entitlement[] {
    return Object.values(this.data.accounts);
  }

  put(entitlement: Entitlement): void {
    this.data.accounts[String(entitlement.accountId)] = entitlement;
    this.persist();
  }

  /**
   * The tier that applies right now, which is not always the tier on the record:
   * a cancellation and a downgrade both take effect on a date, and until that date the
   * customer keeps what they paid for.
   */
  effectiveTier(accountId: number): Tier {
    const e = this.get(accountId);
    if (!e) return 'free';
    const now = this.now().getTime();

    if (e.cancelledEffectiveFrom && Date.parse(e.cancelledEffectiveFrom) <= now) return 'free';
    if (e.pendingTier && e.pendingEffectiveFrom && Date.parse(e.pendingEffectiveFrom) <= now) return e.pendingTier;
    return e.tier;
  }
}

/** Builds a fresh record. Exported so the webhook handler and the reconciler agree on the shape. */
export function makeEntitlement(input: {
  accountId: number;
  login: string;
  accountType: string;
  tier: Tier;
  unitCount?: number | null;
  onFreeTrial?: boolean;
  freeTrialEndsOn?: string | null;
  billingCycle?: string | null;
  now?: Date;
}): Entitlement {
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
