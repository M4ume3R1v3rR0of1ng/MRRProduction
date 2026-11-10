// Lives in _shared/ for the reason stripeWebhookMust.test.js explains.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { anvilProFromSubscription } from "../stripe-webhook.js";

describe("anvilProFromSubscription", () => {
  const saved = {};
  beforeEach(() => {
    saved.m = process.env.STRIPE_ANVIL_PRO_PRICE_ID;
    saved.a = process.env.STRIPE_ANVIL_PRO_ANNUAL_PRICE_ID;
  });
  afterEach(() => {
    for (const [k, v] of [
      ["STRIPE_ANVIL_PRO_PRICE_ID", saved.m],
      ["STRIPE_ANVIL_PRO_ANNUAL_PRICE_ID", saved.a],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const sub = (...priceIds) => ({ items: { data: priceIds.map((id) => ({ price: { id } })) } });

  // The null that matters: until the Pro prices exist the webhook must not write
  // companies.anvil_pro, which 65 may not have added. See the comment on the function.
  it("returns null, meaning do not write, while the add-on is unconfigured", () => {
    delete process.env.STRIPE_ANVIL_PRO_PRICE_ID;
    delete process.env.STRIPE_ANVIL_PRO_ANNUAL_PRICE_ID;
    expect(anvilProFromSubscription(sub("price_base"))).toBeNull();
  });

  it("is true when the monthly add-on is a line item", () => {
    process.env.STRIPE_ANVIL_PRO_PRICE_ID = "price_pro_m";
    expect(anvilProFromSubscription(sub("price_base", "price_pro_m"))).toBe(true);
  });

  it("is true when the annual add-on is a line item", () => {
    process.env.STRIPE_ANVIL_PRO_PRICE_ID = "price_pro_m";
    process.env.STRIPE_ANVIL_PRO_ANNUAL_PRICE_ID = "price_pro_y";
    expect(anvilProFromSubscription(sub("price_base", "price_pro_y"))).toBe(true);
  });

  it("is false when configured but the add-on is not on the subscription", () => {
    process.env.STRIPE_ANVIL_PRO_PRICE_ID = "price_pro_m";
    expect(anvilProFromSubscription(sub("price_base"))).toBe(false);
  });

  it("returns null when the items are unreadable, rather than switching a paying company off", () => {
    process.env.STRIPE_ANVIL_PRO_PRICE_ID = "price_pro_m";
    expect(anvilProFromSubscription({})).toBeNull();
  });
});
