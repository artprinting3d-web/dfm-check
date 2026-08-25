import { atLeast, PLANS, type Tier } from './plans.js';
import type { EntitlementStore } from './store.js';

/**
 * What a repository is entitled to.
 *
 * The rule is deliberately simple and generous: **public repositories are free, always**.
 * A DFM check on an open hardware project is the thing that makes the check known, and
 * charging for it would be charging the people who advertise it. Private repositories are
 * where the paid plans live.
 *
 * When an account has no entitlement on file, a private repository gets a `neutral` check
 * run explaining the plan — never a `failure`. A red X that means "you did not pay" is
 * indistinguishable from a red X that means "your part will not print", and destroying
 * that distinction would destroy the product.
 */

export interface Decision {
  allowed: boolean;
  tier: Tier;
  /** Shown in the check run when `allowed` is false. */
  reason_en?: string;
}

export interface RepoContext {
  private: boolean;
  ownerId: number;
  ownerLogin: string;
  ownerType: string;
}

export function decide(repo: RepoContext, store: EntitlementStore): Decision {
  const tier = store.effectiveTier(repo.ownerId);

  if (!repo.private) return { allowed: true, tier };

  const needed: Tier = repo.ownerType === 'Organization' ? 'team' : 'pro';
  if (atLeast(tier, needed)) return { allowed: true, tier };

  const plan = PLANS[needed];
  return {
    allowed: false,
    tier,
    reason_en:
      'This is a private repository, and `' +
      repo.ownerLogin +
      '` is on the ' +
      PLANS[tier].name +
      ' plan. Private repositories are covered by ' +
      plan.name +
      ' (' +
      formatPrice(plan.monthlyPriceCents) +
      '/month or ' +
      formatPrice(plan.yearlyPriceCents) +
      '/year). Public repositories stay free on every plan.',
  };
}

function formatPrice(cents: number): string {
  return '$' + (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}
