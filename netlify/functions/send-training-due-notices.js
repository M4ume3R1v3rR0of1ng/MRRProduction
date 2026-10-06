// netlify/functions/send-training-due-notices.js
//
// Nightly job: warn someone a few days before an assigned training clip is due,
// then nudge them once a day while it stays overdue. Assignments and their
// deadlines come from supabase/48; the two sent-stamps this writes come from 49.
//
// FOUR CHANNELS, ONE DECISION — the same shape as
// send-maintenance-push-notices.js, which this deliberately mirrors rather than
// reinvents:
//   1. iOS push via APNs (_shared/apns.js), gated on apnsReady since the Apple
//      key is not in place yet. Skipped, never fatal.
//   2. The training_assignments row itself: stamping heads_up_sent_at /
//      overdue_last_sent_at is an UPDATE on a table supabase/49 put on the
//      realtime publication, and 48's policy already limits that stream to the
//      assignee's own rows. An open tab hears about it immediately.
//   3. An email via Resend, for the person who will not open the app today.
//   4. A chat_messages row (supabase/41) — the same words, persisted into their
//      own conversation with the Steadwerk Assistant, so the reminder is still
//      there at next login rather than being a toast nobody was looking at.
//
// GROUPED PER PERSON, NOT PER ASSIGNMENT
//
// The oil pipeline sends per vehicle because a driver has one truck. Training
// arrives in bulk: an admin assigning five clips to the crew with one deadline
// would otherwise mean five emails and five chat messages each, on the same
// morning, which is how someone learns to ignore all of them. So the sweep
// collects everything due for one person, sends ONE notice naming them, and
// then stamps every assignment it covered.
//
// ENGLISH ONLY, KNOWINGLY
//
// These notices are built here, in English, exactly like the oil-due ones. The
// app ships Spanish, but the language preference lives in the browser's own
// localStorage (see ErrorBoundary's crashLang) and has never been persisted
// server-side, so a function has nothing to read. A Spanish-speaking crew member
// gets an English email and an English chat message. Fixing that properly means
// storing the preference on the profile, which is a change worth making on its
// own rather than smuggling in here.
//
// Like daily-archive.js and the oil sweep: the cron invokes this, not a person,
// so there is no token or active company to resolve. adminClient() bypasses RLS
// entirely, which makes every .eq("company_id", ...) below load-bearing rather
// than decorative — see the warning at supabase/02_tenancy_tables.sql:405.
//
// Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both via adminClient),
// RESEND_API_KEY (email), plus APNS_KEY / APNS_KEY_ID / APNS_TEAM_ID /
// APNS_BUNDLE_ID and optionally APNS_PRODUCTION for push once that is ready.

import { Resend } from "resend";
import { adminClient, platformFromAddress } from "./_shared/tenant.js";
import { withSentry } from "./_shared/sentry.js";
import { sendPush, isDeadTokenResponse } from "./_shared/apns.js";

const MAIL_FROM = platformFromAddress("alerts");

// How many days ahead the heads-up goes out. Matches DUE_SOON_DAYS in
// src/features/training/trainingAssignments.js, so the badge turning amber in
// the app and the notice arriving are the same event rather than two thresholds
// that drift apart. Kept as its own constant because a Netlify function cannot
// import from src/.
const HEADS_UP_WINDOW_DAYS = 3;

const DAY_MS = 86400000;

// "YYYY-MM-DD" -> a UTC midnight Date. The column is a DATE, so there is no
// instant to preserve and no timezone to honour; comparing two UTC midnights is
// what makes the day arithmetic below whole numbers.
export function parseDueDay(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

// True when `isoTimestamp` falls on the same UTC calendar day as `todayStr`.
// Caps the overdue nudge at one a day — same helper, same reason, as
// isSameUtcDay in the oil sweep.
export function isSameUtcDay(isoTimestamp, todayStr) {
  if (!isoTimestamp) return false;
  return String(isoTimestamp).slice(0, 10) === todayStr;
}

// The pure decision for one assignment on one day. No I/O, so this is what the
// tests drive directly.
//
// Returns one of:
//   "none"     nothing to do today
//   "heads_up" the deadline is close and no heads-up has gone out yet
//   "overdue"  the deadline has passed and today's nudge has not gone out
export function decideTrainingNotice({ assignment, todayStr }) {
  if (!assignment) return "none";

  // Watched. Nothing to chase, however late they were.
  if (assignment.completed_at) return "none";

  // No deadline means no reminder. This is the whole reason due_on is nullable:
  // "watch this when you get a minute" must not generate a nightly nudge, or
  // every optional assignment becomes an urgent one.
  if (!assignment.due_on) return "none";

  const due = parseDueDay(assignment.due_on);
  const today = parseDueDay(todayStr);
  if (!due || !today) return "none";

  const daysOut = Math.round((due - today) / DAY_MS);

  if (daysOut < 0) {
    // Overdue. Once a day, every day, until it is watched or withdrawn.
    return isSameUtcDay(assignment.overdue_last_sent_at, todayStr) ? "none" : "overdue";
  }

  // Inside the window, including the due day itself. A RANGE rather than
  // `daysOut === HEADS_UP_WINDOW_DAYS`: an assignment created two days before
  // its deadline would never match an exact equality and would go out with no
  // warning at all, straight to overdue.
  if (daysOut <= HEADS_UP_WINDOW_DAYS) {
    return assignment.heads_up_sent_at ? "none" : "heads_up";
  }

  return "none";
}

// Groups one person's pending notices into the single message they will get.
// `titles` are the clip names, already resolved by the caller.
export function buildHeadsUpMessage(titles, dueOn) {
  const n = titles.length;
  const what = n === 1 ? `"${titles[0]}"` : `${n} training clips`;
  return {
    title: n === 1 ? "Training due soon" : `${n} training clips due soon`,
    body:
      n === 1
        ? `${what} is due ${dueOn}. Open Training to watch it and mark it done.`
        : `You have ${what} due by ${dueOn}: ${titles.join(", ")}. Open Training to watch them.`,
    data: { type: "training_due_soon" },
  };
}

export function buildOverdueMessage(titles, dueOn) {
  const n = titles.length;
  const what = n === 1 ? `"${titles[0]}"` : `${n} assigned training clips`;
  return {
    title: n === 1 ? "Training overdue" : `${n} training clips overdue`,
    body:
      n === 1
        ? `${what} was due ${dueOn} and has not been marked watched yet.`
        : `${what} are past their due date and have not been marked watched: ${titles.join(", ")}.`,
    data: { type: "training_overdue" },
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Pushes to every device registered for this person, pruning tokens APNs
// reports as dead. A no-op rather than an error when APNs is not configured —
// the other three channels still fire. Same body as the oil sweep's
// pushToDriver; kept local because the two differ in their log prefix and
// nothing else, and a shared helper would need the prefix threaded through it
// anyway.
async function pushToUser(admin, userId, message, logLabel, apnsReady) {
  if (!apnsReady) return false;

  const { data: tokens, error } = await admin
    .from("device_push_tokens")
    .select("token")
    .eq("user_id", userId);
  if (error) {
    console.error(`send-training-due-notices: token lookup failed for ${logLabel}:`, error.message);
    return false;
  }
  if (!tokens?.length) return false;

  let anySent = false;
  const deadTokens = [];
  for (const { token } of tokens) {
    try {
      const result = await sendPush(token, message);
      if (result.ok) anySent = true;
      else if (isDeadTokenResponse(result)) deadTokens.push(token);
      else
        console.error(
          `send-training-due-notices: APNs rejected a token for ${logLabel}: ${result.statusCode} ${result.reason || ""}`,
        );
    } catch (err) {
      console.error(`send-training-due-notices: APNs send failed for ${logLabel}:`, err.message);
    }
  }
  if (deadTokens.length) {
    await admin.from("device_push_tokens").delete().in("token", deadTokens);
  }
  return anySent;
}

// Best-effort: a missing key or a Resend failure logs and returns rather than
// throwing, so it never takes the row stamp (which drives the in-app channel)
// down with it.
async function emailUser(person, companyName, message, logLabel) {
  if (!person?.email) return;
  if (!process.env.RESEND_API_KEY) {
    console.warn("send-training-due-notices: RESEND_API_KEY not set — skipping email.");
    return;
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: `${companyName} Alerts <${MAIL_FROM}>`,
      to: person.email,
      subject: `${message.title} — Steadwerk`,
      html:
        `<p>${escapeHtml(message.body)}</p>` +
        `<p>Open Steadwerk and go to Training to watch and mark it done.</p>`,
    });
  } catch (err) {
    console.error(`send-training-due-notices: email failed for ${logLabel}:`, err.message);
  }
}

// The persisted channel. origin_session_id stays null on purpose — that is what
// tells ChatWidget's realtime subscription the row did not come from a tab it
// should skip as its own echo (see supabase/41's "WHY origin_session_id").
async function writeAssistantChatMessage(admin, companyId, userId, text, logLabel) {
  const { error } = await admin.from("chat_messages").insert({
    company_id: companyId,
    user_id: userId,
    role: "assistant",
    text,
    proactive: true,
  });
  if (error) {
    console.error(`send-training-due-notices: chat message failed for ${logLabel}:`, error.message);
  }
}

const rawHandler = async () => {
  // Gates the push ATTEMPT only. The row stamp, the email and the chat message
  // need no Apple credentials.
  const apnsReady = ["APNS_KEY", "APNS_KEY_ID", "APNS_TEAM_ID", "APNS_BUNDLE_ID"].every(
    (k) => !!process.env[k],
  );
  if (!apnsReady) {
    console.warn(
      "send-training-due-notices: APNs env vars are not fully set — skipping the push attempt " +
        "this run (row stamp, email and chat message still go out normally).",
    );
  }

  const admin = adminClient();
  const todayStr = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  const { data: companies, error: companiesError } = await admin
    .from("companies")
    .select("id, name");
  if (companiesError) {
    console.error("send-training-due-notices: failed to load companies:", companiesError.message);
    return { statusCode: 500, body: JSON.stringify({ error: companiesError.message }) };
  }

  let headsUpSent = 0;
  let overdueSent = 0;

  for (const company of companies || []) {
    // Only rows that could possibly need a notice: unfinished and dated. The
    // partial index from supabase/49 covers exactly this shape.
    const { data: assignments, error: assignError } = await admin
      .from("training_assignments")
      .select("*")
      .eq("company_id", company.id)
      .is("completed_at", null)
      .not("due_on", "is", null);

    if (assignError) {
      console.error(
        `send-training-due-notices: company ${company.id} assignment read failed:`,
        assignError.message,
      );
      continue;
    }
    if (!assignments?.length) continue;

    // Decide first, then fetch names only for the people and clips that
    // actually need one. Most nights that is nobody.
    const pending = new Map(); // userId -> { heads_up: [], overdue: [] }
    for (const assignment of assignments) {
      const action = decideTrainingNotice({ assignment, todayStr });
      if (action === "none") continue;
      if (!pending.has(assignment.user_id))
        pending.set(assignment.user_id, { heads_up: [], overdue: [] });
      pending.get(assignment.user_id)[action].push(assignment);
    }
    if (pending.size === 0) continue;

    const mediaIds = [
      ...new Set(
        [...pending.values()].flatMap((g) => [...g.heads_up, ...g.overdue].map((a) => a.media_id)),
      ),
    ];
    const [{ data: people, error: peopleError }, { data: clips, error: clipError }] =
      await Promise.all([
        admin
          .from("profiles")
          .select("id, email, full_name")
          .in("id", [...pending.keys()]),
        admin.from("training_media").select("id, title").in("id", mediaIds),
      ]);

    if (peopleError || clipError) {
      console.error(
        `send-training-due-notices: company ${company.id} lookup failed:`,
        (peopleError || clipError).message,
      );
      continue;
    }

    const personById = new Map((people || []).map((p) => [p.id, p]));
    const titleById = new Map((clips || []).map((c) => [c.id, c.title]));

    for (const [userId, groups] of pending) {
      const person = personById.get(userId);
      const logLabel = `${person?.email || userId} @ ${company.id}`;

      for (const kind of ["overdue", "heads_up"]) {
        const rows = groups[kind];
        if (!rows.length) continue;

        const titles = rows.map((a) => titleById.get(a.media_id)).filter(Boolean);
        // Every clip vanished between the two reads — nothing left to name, so
        // there is nothing worth sending.
        if (!titles.length) continue;

        // The nearest deadline is the one worth naming: it is the one that
        // actually bites first.
        const dueOn = rows
          .map((a) => a.due_on)
          .sort((x, y) => String(x).localeCompare(String(y)))[0];

        const message =
          kind === "overdue"
            ? buildOverdueMessage(titles, dueOn)
            : buildHeadsUpMessage(titles, dueOn);

        await Promise.all([
          pushToUser(admin, userId, message, logLabel, apnsReady),
          emailUser(person, company.name, message, logLabel),
          writeAssistantChatMessage(admin, company.id, userId, message.body, logLabel),
        ]);

        // Stamped last, and only for the rows this notice actually covered. A
        // send that half-failed still stamps: this is at-least-once notification
        // intent, not a delivery guarantee, and the alternative is a loop that
        // re-sends the same email every night because one channel is down.
        const column = kind === "overdue" ? "overdue_last_sent_at" : "heads_up_sent_at";
        const { error: stampError } = await admin
          .from("training_assignments")
          .update({ [column]: nowIso })
          .in(
            "id",
            rows.map((a) => a.id),
          );
        if (stampError) {
          console.error(
            `send-training-due-notices: stamping ${column} failed for ${logLabel}:`,
            stampError.message,
          );
        }

        if (kind === "overdue") overdueSent++;
        else headsUpSent++;
      }
    }
  }

  console.log(
    `send-training-due-notices: heads-up ${headsUpSent}, overdue ${overdueSent} (grouped per person).`,
  );
  return { statusCode: 200, body: JSON.stringify({ ok: true, headsUpSent, overdueSent }) };
};

export const handler = withSentry("send-training-due-notices", rawHandler);

// 13:05 UTC ≈ 8am Central / 9am Eastern. Five minutes after the oil sweep rather
// than on the same minute: both hit every company's rows with the service key,
// and staggering them keeps one slow run from overlapping the other.
export const config = {
  schedule: "5 13 * * *",
};
