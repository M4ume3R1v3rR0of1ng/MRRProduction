// src/utils/salesTax.js
//
// US state sales-tax starting points for the Company Details tax line.
//
// IMPORTANT: `taxPct` is the STATE base rate only. Actual sales tax at a job site
// usually adds county/city rates on top, and a few states change their rate year to
// year. So this is a sensible default the admin can still override by hand — picking
// a state fills the rate in, it does not lock it. The five NOMAD states with no state
// sales tax (AK, DE, MT, NH, OR) are 0 here; AK/MT still allow local taxes.
export const US_STATES = [
  { code: "AL", name: "Alabama", taxPct: 4.0 },
  { code: "AK", name: "Alaska", taxPct: 0 },
  { code: "AZ", name: "Arizona", taxPct: 5.6 },
  { code: "AR", name: "Arkansas", taxPct: 6.5 },
  { code: "CA", name: "California", taxPct: 7.25 },
  { code: "CO", name: "Colorado", taxPct: 2.9 },
  { code: "CT", name: "Connecticut", taxPct: 6.35 },
  { code: "DE", name: "Delaware", taxPct: 0 },
  { code: "DC", name: "District of Columbia", taxPct: 6.0 },
  { code: "FL", name: "Florida", taxPct: 6.0 },
  { code: "GA", name: "Georgia", taxPct: 4.0 },
  { code: "HI", name: "Hawaii", taxPct: 4.0 },
  { code: "ID", name: "Idaho", taxPct: 6.0 },
  { code: "IL", name: "Illinois", taxPct: 6.25 },
  { code: "IN", name: "Indiana", taxPct: 7.0 },
  { code: "IA", name: "Iowa", taxPct: 6.0 },
  { code: "KS", name: "Kansas", taxPct: 6.5 },
  { code: "KY", name: "Kentucky", taxPct: 6.0 },
  { code: "LA", name: "Louisiana", taxPct: 5.0 },
  { code: "ME", name: "Maine", taxPct: 5.5 },
  { code: "MD", name: "Maryland", taxPct: 6.0 },
  { code: "MA", name: "Massachusetts", taxPct: 6.25 },
  { code: "MI", name: "Michigan", taxPct: 6.0 },
  { code: "MN", name: "Minnesota", taxPct: 6.875 },
  { code: "MS", name: "Mississippi", taxPct: 7.0 },
  { code: "MO", name: "Missouri", taxPct: 4.225 },
  { code: "MT", name: "Montana", taxPct: 0 },
  { code: "NE", name: "Nebraska", taxPct: 5.5 },
  { code: "NV", name: "Nevada", taxPct: 6.85 },
  { code: "NH", name: "New Hampshire", taxPct: 0 },
  { code: "NJ", name: "New Jersey", taxPct: 6.625 },
  { code: "NM", name: "New Mexico", taxPct: 4.875 },
  { code: "NY", name: "New York", taxPct: 4.0 },
  { code: "NC", name: "North Carolina", taxPct: 4.75 },
  { code: "ND", name: "North Dakota", taxPct: 5.0 },
  { code: "OH", name: "Ohio", taxPct: 5.75 },
  { code: "OK", name: "Oklahoma", taxPct: 4.5 },
  { code: "OR", name: "Oregon", taxPct: 0 },
  { code: "PA", name: "Pennsylvania", taxPct: 6.0 },
  { code: "RI", name: "Rhode Island", taxPct: 7.0 },
  { code: "SC", name: "South Carolina", taxPct: 6.0 },
  { code: "SD", name: "South Dakota", taxPct: 4.2 },
  { code: "TN", name: "Tennessee", taxPct: 7.0 },
  { code: "TX", name: "Texas", taxPct: 6.25 },
  { code: "UT", name: "Utah", taxPct: 6.1 },
  { code: "VT", name: "Vermont", taxPct: 6.0 },
  { code: "VA", name: "Virginia", taxPct: 5.3 },
  { code: "WA", name: "Washington", taxPct: 6.5 },
  { code: "WV", name: "West Virginia", taxPct: 6.0 },
  { code: "WI", name: "Wisconsin", taxPct: 5.0 },
  { code: "WY", name: "Wyoming", taxPct: 4.0 },
];

export function stateByCode(code) {
  return US_STATES.find((s) => s.code === code) || null;
}
