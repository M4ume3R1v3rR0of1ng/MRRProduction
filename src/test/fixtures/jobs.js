// src/test/fixtures/jobs.js
//
// Minimal job-pipeline data for the view tests: just the fields the Build Jobs and
// Pull Inventory screens read, so a test's own overrides are the interesting part.
import { getEffectivePerms } from "@/shared/database/permissions";
import { ROLE_PERMS } from "./rolePerms";

export const person = (id, role, extra = {}) => ({
  id,
  name: `${id[0].toUpperCase()}${id.slice(1)} Doe`,
  role,
  email: `${id}@example.com`,
  active: true,
  ...extra,
});

// The production role matrix, so a view test runs under the same flags a real
// user of that role gets.
export const permsFor = (user) => getEffectivePerms(user, ROLE_PERMS, {});

// The views read icon/label/colour off this; the icons are irrelevant here.
const StubIcon = () => null;
export const jSC = {
  draft: { c: "gray", l: "Draft", icon: StubIcon },
  approved: { c: "blue", l: "Approved", icon: StubIcon },
  active: { c: "amber", l: "Active", icon: StubIcon },
  completed: { c: "green", l: "Completed", icon: StubIcon },
  closed: { c: "purple", l: "Closed", icon: StubIcon },
};

export const line = (iid, iname, extra = {}) => ({
  iid,
  iname,
  unit: "bd",
  planned: 10,
  pulled: 0,
  ...extra,
});

export const job = (id, status, extra = {}) => ({
  id,
  title: `Job ${id}`,
  po: `PO-${id}`,
  status,
  addr: "1 Main St",
  createdAt: "2026-07-01",
  items: [],
  ...extra,
});

export const batch = (id, rcvd, rem, price) => ({ id, rcvd, qty: rem, rem, price });
