import { atLeast, PLANS } from './plans.js';
export function decide(repo, store) {
    const tier = store.effectiveTier(repo.ownerId);
    if (!repo.private)
        return { allowed: true, tier };
    const needed = repo.ownerType === 'Organization' ? 'team' : 'pro';
    if (atLeast(tier, needed))
        return { allowed: true, tier };
    const plan = PLANS[needed];
    return {
        allowed: false,
        tier,
        reason_en: 'This is a private repository, and `' +
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
function formatPrice(cents) {
    return '$' + (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);
}
//# sourceMappingURL=entitlement.js.map