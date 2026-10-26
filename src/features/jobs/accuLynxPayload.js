// src/features/jobs/accuLynxPayload.js
//
// The material-cost expense, as AccuLynx will hold it. One builder, two senders.
//
// The browser sends this when a crew completes a job (accuLynxSync.js) and the cron
// sends it when no browser did (netlify/functions/acculynx-retry-sync.js). The
// amount, the line items and the description have to be identical between the two,
// because they are not two postings — they are one posting, attempted twice. The
// de-duplication guard in _shared/acculynxWrites.js matches on the AMOUNT to the
// penny, so a retry that computes the figure even slightly differently does not
// look like a retry to AccuLynx: it books the cost a second time.
//
// Relative and extension-ful, like pdfGenerator.js's own imports, so the function
// can load this under Node. See the comment there.
import { buildJobReportModel } from "./pdfGenerator.js";

export const money = (n) => "$" + Number(n).toFixed(2);

/**
 * Everything the expense call needs, derived from the job's own items.
 *
 * `amount` is m.totalWithTax — the TAX-INCLUSIVE figure, and the exact number
 * printed as "TOTAL MATERIAL COST" on the PDF. This used to post the pre-tax
 * subtotal, so the expense in AccuLynx and the report attached to the same job
 * disagreed by the tax on every job. Both numbers come from one call to
 * buildJobReportModel, which is also what the PDF renders from, so they cannot
 * drift: there is only one calculation.
 */
export function buildCostPayload(job, users = [], inv = [], company = null) {
  const model = buildJobReportModel(job, users, inv, company);
  const amount = parseFloat(model.totalWithTax.toFixed(2));

  const lineItems = model.categories
    .flatMap((c) => c.items)
    .filter((i) => i.used > 0)
    .map((i) => ({
      name: i.iname || "Unknown Material",
      category: i.icat || "Materials",
      unit: i.unit || "units",
      quantity: i.used,
      unitPrice: i.unitPrice,
      totalCost: parseFloat(i.total.toFixed(2)),
    }));

  // The second line spells out the tax so the number is auditable from AccuLynx
  // alone, without opening the PDF to find out why the expense is not the sum of
  // the items.
  // `name` before `title`, which is the order the browser has always used. The
  // column was dropped in supabase/15 so only `title` survives on a real row, but
  // the text that lands in AccuLynx must not change spelling just because this
  // moved file — a changed description on a replayed expense is a changed record.
  const paymentDescription =
    `Material Cost - ${job?.name || job?.title || "Job"}\n` +
    `${money(model.grandTotal)} + ${model.taxLabel} ${model.taxPct}% ` +
    `${money(model.salesTax)} = ${money(amount)}`;

  return { model, amount, lineItems, paymentDescription };
}
