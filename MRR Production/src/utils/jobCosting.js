// src/utils/jobCosting.js
//
// What a job cost, and what it earned.
//
// ── The bug this replaces ──
//
// Job profitability used to compute revenue as `estimatedMaterialCost * 3.2`.
// There is no contract value anywhere in the system, so that multiplier WAS the
// revenue: a made-up number, printed in a currency column, exported to CSV, and
// handed to whoever asked how the business is doing.
//
// It was also arithmetically rigged. With revenue defined as 3.2 x estimate, a job
// that spends exactly its estimate reports
//
//     (3.2e - e) / 3.2e = 68.75%
//
// every single time, and the "healthy" trophy threshold was 65%. A job only lost
// its trophy by overrunning materials more than 12%. So the report congratulated
// you on virtually everything, and what it actually measured was materials
// variance wearing a profitability label.
//
// ── The rule here ──
//
// Revenue is a fact someone enters (jobs.contract_value), not something derived.
// When it is missing, EVERY function below returns null rather than a number.
// Null renders as "not set". It must never render as 0, because a zero-revenue job
// looks like a catastrophic loss, and it must never be guessed at, because that is
// exactly how the 3.2 got here.

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

const lines = (job) => (job?.items || job?.materials || []).filter(Boolean);

// What the crew actually consumed: pulled minus what came back.
// Priced at priceAtPull, which FIFO already resolved from the batches the material
// genuinely came from. See doFifo — this is not an average of the catalog price.
export const actualMaterialCost = (job) =>
  lines(job).reduce(
    (sum, i) => sum + (num(i.pulled) - num(i.returned)) * num(i.priceAtPull),
    0,
  );

// What the plan expected to spend, at the same prices, so the comparison below
// isolates quantity variance rather than mixing in price movement.
export const plannedMaterialCost = (job) =>
  lines(job).reduce((sum, i) => sum + num(i.planned) * num(i.priceAtPull), 0);

// How far material usage ran over or under plan, as a percentage.
//
// This is the honest version of what the 3.2 multiplier was accidentally
// measuring, and it is genuinely useful — it just is not profit. Positive means
// the job burned more material than planned.
//
// Null when there was no plan to compare against: a job with no planned cost has
// no baseline, and 0 would read as "exactly on plan".
export const materialsVariancePct = (job) => {
  const planned = plannedMaterialCost(job);
  if (planned <= 0) return null;
  return ((actualMaterialCost(job) - planned) / planned) * 100;
};

// The entered contract value, or null. Zero is treated as unset on purpose: it is
// far more likely to be an empty field saved as 0 than a genuinely free roof.
export const contractValue = (job) => {
  const v = parseFloat(job?.contract_value);
  return Number.isFinite(v) && v > 0 ? v : null;
};

export const hasRevenue = (job) => contractValue(job) !== null;

// Gross profit on materials only.
//
// NOT the profit of the job. Labour, overhead, subs and disposal are nowhere in
// this system, so this is revenue minus material cost and nothing else. Whatever
// renders it has to say so, or it overstates every job by the largest cost line
// in roofing.
export const grossProfit = (job) => {
  const revenue = contractValue(job);
  if (revenue === null) return null;
  return revenue - actualMaterialCost(job);
};

export const grossMarginPct = (job) => {
  const revenue = contractValue(job);
  if (revenue === null) return null;
  return ((revenue - actualMaterialCost(job)) / revenue) * 100;
};

// Material cost as a share of the contract. The number a roofer actually watches:
// materials are a fairly predictable slice of a job, so a figure well outside the
// usual band means the estimate or the pull was wrong.
export const materialCostRatioPct = (job) => {
  const revenue = contractValue(job);
  if (revenue === null) return null;
  return (actualMaterialCost(job) / revenue) * 100;
};

// Totals across many jobs.
//
// Jobs without a contract value are counted and reported separately rather than
// folded in at zero. A portfolio margin computed over jobs whose revenue is
// unknown is not a conservative estimate, it is a wrong one.
export const summarizeJobs = (jobs = []) => {
  const all = (jobs || []).filter(Boolean);
  const withRevenue = all.filter(hasRevenue);

  const revenue = withRevenue.reduce((s, j) => s + contractValue(j), 0);
  const costOfThose = withRevenue.reduce((s, j) => s + actualMaterialCost(j), 0);

  return {
    jobCount: all.length,
    pricedCount: withRevenue.length,
    // Jobs still missing a contract value. Surfaced so the gap is visible rather
    // than quietly shrinking the denominator.
    unpricedCount: all.length - withRevenue.length,
    revenue,
    // Material spend across EVERY job, priced or not. This one is always knowable,
    // because it comes from the batches.
    materialCost: all.reduce((s, j) => s + actualMaterialCost(j), 0),
    materialCostOfPriced: costOfThose,
    grossProfit: withRevenue.length ? revenue - costOfThose : null,
    grossMarginPct: revenue > 0 ? ((revenue - costOfThose) / revenue) * 100 : null,
  };
};
