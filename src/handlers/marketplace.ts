import { rest } from '../github/rest.js';
import { planOverrides, tierFor, type MarketplacePlan, type Tier } from '../billing/plans.js';
import { makeEntitlement, type EntitlementStore } from '../billing/store.js';
import { log } from '../log.js';

/**
 * The `marketplace_purchase` webhook.
 *
 * Five actions, and each one means something different about *when* the change applies
 * (docs.github.com, "marketplace_purchase"):
 *
 *   purchased               a new subscription — effective now
 *   changed                 an upgrade or a downgrade that has already taken effect
 *   cancelled               the plan ends at `effective_date`, not today
 *   pending_change          a downgrade scheduled for `effective_date`
 *   pending_change_cancelled the scheduled change is off
 *
 * Applying a cancellation immediately would cut off a customer who has paid through the
 * end of the cycle, so the dates are stored and `EntitlementStore.effectiveTier` decides.
 */

export interface MarketplaceAccount {
  id: number;
  login: string;
  type: string;
}

export interface MarketplacePurchase {
  account: MarketplaceAccount;
  billing_cycle?: string;
  unit_count?: number | null;
  on_free_trial?: boolean;
  free_trial_ends_on?: string | null;
  next_billing_date?: string | null;
  plan?: MarketplacePlan;
}

export interface MarketplaceEvent {
  action: string;
  effective_date?: string;
  marketplace_purchase: MarketplacePurchase;
  previous_marketplace_purchase?: MarketplacePurchase;
}

export interface MarketplaceHandlerOptions {
  store: EntitlementStore;
  overrides?: Map<string, Tier>;
  now?: () => Date;
}

export function handleMarketplaceEvent(event: MarketplaceEvent, opts: MarketplaceHandlerOptions): Tier {
  const overrides = opts.overrides ?? planOverrides();
  const now = (opts.now ?? (() => new Date()))();
  const purchase = event.marketplace_purchase;
  const account = purchase.account;
  const tier = tierFor(purchase.plan, overrides);

  const existing = opts.store.get(account.id);
  const base =
    existing ??
    makeEntitlement({
      accountId: account.id,
      login: account.login,
      accountType: account.type,
      tier,
      now,
    });

  const next = { ...base, login: account.login, accountType: account.type, updatedAt: now.toISOString() };

  switch (event.action) {
    case 'purchased':
    case 'changed':
      next.tier = tier;
      next.unitCount = purchase.unit_count ?? null;
      next.onFreeTrial = purchase.on_free_trial ?? false;
      next.freeTrialEndsOn = purchase.free_trial_ends_on ?? null;
      next.billingCycle = purchase.billing_cycle ?? null;
      next.cancelledEffectiveFrom = null;
      next.pendingTier = null;
      next.pendingEffectiveFrom = null;
      break;

    case 'cancelled':
      // The subscription runs until effective_date. Until then, nothing changes.
      next.cancelledEffectiveFrom = event.effective_date ?? now.toISOString();
      next.pendingTier = null;
      next.pendingEffectiveFrom = null;
      break;

    case 'pending_change':
      next.pendingTier = tier;
      next.pendingEffectiveFrom = event.effective_date ?? null;
      break;

    case 'pending_change_cancelled':
      next.pendingTier = null;
      next.pendingEffectiveFrom = null;
      break;

    default:
      log.warn('marketplace.unknown_action', { action: event.action, accountId: account.id });
      return opts.store.effectiveTier(account.id);
  }

  opts.store.put(next);
  log.info('marketplace.updated', {
    action: event.action,
    accountId: account.id,
    tier: next.tier,
    pendingTier: next.pendingTier,
    cancelledEffectiveFrom: next.cancelledEffectiveFrom,
  });
  return opts.store.effectiveTier(account.id);
}

/**
 * Repairs the store from GitHub for one account.
 *
 * A webhook that never arrived — a deploy during the delivery, a 500 from us — would
 * otherwise leave a paying customer looking unpaid forever. `GET /marketplace_listing/
 * accounts/{account_id}` (JWT auth) is the source of truth to fall back to.
 */
export async function reconcileAccount(
  accountId: number,
  opts: {
    store: EntitlementStore;
    appJwt: string;
    apiBase?: string;
    fetchImpl?: typeof fetch;
    overrides?: Map<string, Tier>;
    now?: () => Date;
    /** Set true to hit the stubbed endpoint GitHub provides for testing a listing. */
    stubbed?: boolean;
  },
): Promise<Tier> {
  const path = opts.stubbed
    ? '/marketplace_listing/stubbed/accounts/' + accountId
    : '/marketplace_listing/accounts/' + accountId;

  const res = await rest<{ id: number; login: string; type: string; marketplace_purchase?: MarketplacePurchase }>(
    path,
    { token: opts.appJwt, apiBase: opts.apiBase, fetchImpl: opts.fetchImpl },
  );

  const purchase = res.marketplace_purchase;
  const tier = tierFor(purchase?.plan, opts.overrides ?? planOverrides());
  const now = (opts.now ?? (() => new Date()))();

  opts.store.put(
    makeEntitlement({
      accountId: res.id,
      login: res.login,
      accountType: res.type,
      tier,
      unitCount: purchase?.unit_count ?? null,
      onFreeTrial: purchase?.on_free_trial ?? false,
      freeTrialEndsOn: purchase?.free_trial_ends_on ?? null,
      billingCycle: purchase?.billing_cycle ?? null,
      now,
    }),
  );
  return tier;
}
