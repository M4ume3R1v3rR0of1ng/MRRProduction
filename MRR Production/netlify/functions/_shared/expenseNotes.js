// netlify/functions/_shared/expenseNotes.js
//
// The `notes` field on an AccuLynx Additional Job Expense is capped at 250
// characters. Not 1900, which is what this used to truncate at — every sync for a
// job with more than a few materials was rejected outright with
// "Field AdditionalExpense.Notes exceeds the maximum of 250 characters."
//
// 250 will not hold an itemised material list, and it does not need to: the full
// per-item breakdown is in the completion report PDF filed on the same job. So fit
// as many lines as the cap allows and point at the document for the rest, rather
// than slicing mid-number and leaving a line that reads like a different figure.

export const MAX_EXPENSE_NOTES = 250;

const tailFor = (n) => `\n+${n} more, see the job report PDF`;

export function buildExpenseNotes(paymentDescription, lineItems, max = MAX_EXPENSE_NOTES) {
  const header = String(paymentDescription || "Material cost").trim();
  const lines = Array.isArray(lineItems)
    ? lineItems.map((li) =>
        `${li.name} ${li.quantity} ${li.unit} @ $${Number(li.unitPrice || 0).toFixed(2)} = $${Number(li.totalCost || 0).toFixed(2)}`
      )
    : [];

  const everything = [header, ...lines].join("\n");
  if (everything.length <= max) return everything;

  let notes = header;
  let included = 0;
  for (const line of lines) {
    const next = `${notes}\n${line}`;
    // Only keep a line if the "+N more" pointer still fits after it. Without this
    // the last line wins the space and the reader never learns anything is missing.
    if (next.length + tailFor(lines.length - included - 1).length > max) break;
    notes = next;
    included += 1;
  }

  const omitted = lines.length - included;
  if (omitted > 0) notes += tailFor(omitted);

  // Final guard for the pathological case: a header alone longer than the cap.
  return notes.length > max ? `${notes.slice(0, max - 1)}…` : notes;
}
