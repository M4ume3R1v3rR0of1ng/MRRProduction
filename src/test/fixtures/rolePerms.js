// src/test/fixtures/rolePerms.js
//
// Production's role_permissions rows for the job lifecycle, shared by both halves
// of the permission tests:
//
//   - scripts/verify-permission-enforcement.mjs seeds these into a throwaway
//     company and signs in as each role, proving the DATABASE refuses what it should.
//   - src/test/permissionMatrix.test.jsx renders the views with the same rows run
//     through getEffectivePerms, proving the UI hides what the database refuses.
//
// One copy on purpose. When the two had their own, nothing stopped them drifting,
// and a UI test against a different matrix proves nothing about the real one.
//
// The MISSING keys are the interesting part. `field` has no jobs_close stored and
// `employee` has no job keys at all, exactly as in production. The database fills
// those from default_job_perms(); the UI reads them as undefined. Both must come
// out as "no".
//
// Plain ESM with no imports, so the node script can load it without Vite's aliases.
export const ROLE_PERMS = {
  // Jerry's real config: pull and complete yes, close NO.
  coordinator: {
    jobs_build: true,
    jobs_approve: true,
    jobs_pull: true,
    jobs_complete: true,
    jobs_close: false,
  },
  bookkeeper: {
    jobs_build: false,
    jobs_approve: false,
    jobs_pull: false,
    jobs_complete: false,
    jobs_close: true,
  },
  field: {
    jobs_build: false,
    jobs_approve: false,
    jobs_pull: true,
    jobs_complete: true /* jobs_close absent */,
  },
  employee: { fleet_view: true, maint_submit: true /* every job key absent */ },
};
