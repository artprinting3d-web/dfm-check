/**
 * The Marketplace plans, and how a webhook payload maps onto them.
 *
 * GitHub assigns the numeric plan ids when the listing is created, so the mapping cannot
 * be hard-coded ahead of the listing. Two ways in, in order:
 *
 *   1. `EF_DFM_PLAN_MAP` — a JSON object of `{ "<plan id>": "free" | "pro" | "team" }`,
 *      filled in once the listing exists. Exact, and the one used in production.
 *   2. the monthly price in the payload — 0 is Free, anything under the team price is Pro.
 *      A fallback, so a plan id that has not been mapped yet degrades to the right tier
 *      instead of to no entitlement at all.
 *
 * "Apps must support both monthly and annual billing" (docs.github.com, requirements for
 * listing a paid app), so each paid plan is priced both ways; `billing_cycle` in the
 * payload says which one the customer chose and does not change the tier.
 */
export const PLANS = {
    free: {
        tier: 'free',
        name: 'Free',
        monthlyPriceCents: 0,
        yearlyPriceCents: 0,
        bullets: [
            'Unlimited public repositories',
            'STL, 3MF, OBJ, PLY, OpenSCAD, CadQuery, KiCad and Klipper checks',
            'Every finding cited back to a rule id',
        ],
    },
    pro: {
        tier: 'pro',
        name: 'Pro',
        monthlyPriceCents: 900,
        yearlyPriceCents: 9000,
        bullets: [
            'Everything in Free',
            'Private repositories',
            'Per-repository technology, material and printer defaults',
        ],
    },
    team: {
        tier: 'team',
        name: 'Team',
        monthlyPriceCents: 2900,
        yearlyPriceCents: 29000,
        bullets: [
            'Everything in Pro',
            'Organisation-wide private repositories',
            'Priority analysis queue',
        ],
    },
};
const TIER_RANK = { free: 0, pro: 1, team: 2 };
export function atLeast(have, need) {
    return TIER_RANK[have] >= TIER_RANK[need];
}
/** The plan id -> tier overrides, parsed once. Invalid JSON is a boot-time error, not a silent no-op. */
export function planOverrides(raw = process.env['EF_DFM_PLAN_MAP']) {
    const map = new Map();
    if (!raw)
        return map;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (err) {
        throw new Error('EF_DFM_PLAN_MAP is not valid JSON: ' + (err instanceof Error ? err.message : String(err)));
    }
    if (!parsed || typeof parsed !== 'object')
        throw new Error('EF_DFM_PLAN_MAP must be a JSON object.');
    for (const [id, tier] of Object.entries(parsed)) {
        if (tier !== 'free' && tier !== 'pro' && tier !== 'team') {
            throw new Error('EF_DFM_PLAN_MAP["' + id + '"] must be free, pro or team.');
        }
        map.set(String(id), tier);
    }
    return map;
}
export function tierFor(plan, overrides) {
    if (!plan)
        return 'free';
    if (plan.id !== undefined) {
        const mapped = overrides.get(String(plan.id));
        if (mapped)
            return mapped;
    }
    const byName = (plan.name ?? '').trim().toLowerCase();
    if (byName === 'free' || byName === 'pro' || byName === 'team')
        return byName;
    const cents = plan.monthly_price_in_cents ?? 0;
    if (cents <= 0)
        return 'free';
    return cents >= PLANS.team.monthlyPriceCents ? 'team' : 'pro';
}
//# sourceMappingURL=plans.js.map