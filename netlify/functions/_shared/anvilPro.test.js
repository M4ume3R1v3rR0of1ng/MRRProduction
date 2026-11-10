import { describe, it, expect } from "vitest";
import { isEffectivePro, capabilityAllowed } from "./anvilPro.js";

describe("isEffectivePro", () => {
  it("is on for a paying company in good standing", () => {
    expect(isEffectivePro({ anvil_pro: true, subscription_status: "active" })).toBe(true);
  });

  it("is on for a comped company even with no Stripe add-on", () => {
    expect(
      isEffectivePro({ anvil_pro: false, anvil_pro_comped: true, subscription_status: "trialing" }),
    ).toBe(true);
  });

  it("is off by default", () => {
    expect(isEffectivePro({ subscription_status: "active" })).toBe(false);
    expect(
      isEffectivePro({ anvil_pro: false, anvil_pro_comped: false, subscription_status: "active" }),
    ).toBe(false);
  });

  it("keeps a past_due company on, matching the rest of the product's grace period", () => {
    expect(isEffectivePro({ anvil_pro: true, subscription_status: "past_due" })).toBe(true);
  });

  it("turns off with the subscription, even when the flag is still set", () => {
    // The webhook may not have cleared the flag yet; the cron jobs do not go through
    // resolveCaller, so this is the check that stops a lapsed company being served.
    expect(isEffectivePro({ anvil_pro: true, subscription_status: "canceled" })).toBe(false);
    expect(isEffectivePro({ anvil_pro_comped: true, subscription_status: "suspended" })).toBe(
      false,
    );
  });

  it("is off when there is no company or no status", () => {
    expect(isEffectivePro(null)).toBe(false);
    expect(isEffectivePro(undefined)).toBe(false);
    expect(isEffectivePro({ anvil_pro: true })).toBe(false);
  });

  it("does not treat a truthy non-boolean as an entitlement", () => {
    expect(isEffectivePro({ anvil_pro: "false", subscription_status: "active" })).toBe(false);
  });
});

describe("capabilityAllowed", () => {
  it("lets a free capability through for everyone", () => {
    expect(capabilityAllowed("adjust_stock", false)).toBe(true);
  });
  it("holds a Pro capability back without the add-on", () => {
    expect(capabilityAllowed("reorder_watch", false)).toBe(false);
    expect(capabilityAllowed("reorder_watch", true)).toBe(true);
  });
});
