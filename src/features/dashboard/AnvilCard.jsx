// src/features/dashboard/AnvilCard.jsx
//
// ANVIL on the dashboard: this morning's briefing, and a way in.
//
// WHY THIS READS THE BRIEFING RATHER THAN BUILDING ONE
//
// send-daily-briefing.js already assembles each person's day and writes it
// into their own conversation (supabase/41) as a `proactive` message. This
// card renders THAT row.
//
// The alternative — recomputing the same summary here from the data the
// dashboard already has in memory — was tempting and wrong. It would mean two
// implementations of "what matters today", in two languages, drifting apart
// until the card and the chat bubble disagreed about whether a truck is
// overdue. Worse, the permission filtering that makes a briefing honest
// (anvilBriefing.js gates every section on the same permission as its page)
// lives server-side, and a client-side copy would be filtering on perms the
// browser can see rather than the ones the database enforces.
//
// So: one briefing, written once, shown in two places.
//
// It follows that the card is EMPTY on a quiet morning, and that is the
// intended behavior — buildBriefing writes no row when it found nothing worth
// saying. The card then shows the prompts instead of inventing a status.
import { useEffect, useState } from "react";
import { Bot, MessageSquare } from "lucide-react";
import { supabase } from "@/shared/utils/supabase";
import { C } from "@/shared/utils/helpers";
import {
  Card,
  Row,
  Stack,
  Text,
  Muted,
  SectionTitle,
  Btn,
  TextBtn,
} from "@/shared/components/UIPrimitives";
import { askAnvil } from "@/shared/components/anvil";
import { translations } from "@/shared/utils/translations";

// The questions worth a one-tap shortcut, each gated on the permission that
// makes the answer meaningful — a driver should not be offered "which jobs lost
// money", and tapping it would only earn them a permission error.
//
// Deliberately phrased as a person would type them, not as tool names: these go
// through the same path as anything typed into the composer.
const PROMPTS = [
  {
    key: "briefing",
    perm: null,
    en: "What should I look at today?",
    es: "¿Qué debería revisar hoy?",
  },
  {
    key: "maintenance",
    perm: (p) => p.fleet_view || p.maint_manage,
    en: "What maintenance is due?",
    es: "¿Qué mantenimiento vence?",
  },
  {
    key: "lowstock",
    perm: (p) => p.inv_view,
    en: "What inventory is running low?",
    es: "¿Qué inventario se está agotando?",
  },
  {
    key: "week",
    perm: (p) => p.jobs_view,
    en: "What is on the schedule this week?",
    es: "¿Qué hay en el calendario esta semana?",
  },
  {
    key: "margin",
    perm: (p) => p.reports_view && p.jobs_revenue,
    en: "Which jobs had the thinnest margin?",
    es: "¿Qué trabajos tuvieron el margen más bajo?",
  },
];

export default function AnvilCard({ user, perms = {}, lang = "en" }) {
  const t = translations[lang] || translations.en;
  const [briefing, setBriefing] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    // Newest proactive message only. Not filtered by date in the query: a
    // briefing written on Friday is still the last thing ANVIL said on a
    // Monday morning before the cron runs, and showing it beats showing
    // nothing — the row carries its own timestamp, rendered below, so nobody
    // mistakes it for today's.
    supabase
      .from("chat_messages")
      .select("id, text, created_at")
      .eq("user_id", user.id)
      .eq("role", "assistant")
      .eq("proactive", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // Non-fatal: the prompts below are the point of the card, and they
          // work with no briefing at all.
          console.error("AnvilCard: failed to load the latest briefing:", error.message);
        }
        setBriefing(data?.[0] || null);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const prompts = PROMPTS.filter((p) => !p.perm || p.perm(perms));
  const es = lang === "es";

  const writtenWhen = briefing?.created_at
    ? new Date(briefing.created_at).toLocaleDateString(es ? "es-ES" : "en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <Card>
      <Row gap={4} align="baseline" justify="space-between" wrap style={{ marginBottom: 12 }}>
        <SectionTitle as="h3" icon={Bot}>
          {t.cwBriefingTitle}
        </SectionTitle>
        {writtenWhen && (
          <Text as="span" size="2xs" weight="bold" color={C.sub}>
            {writtenWhen}
          </Text>
        )}
      </Row>

      {/* pre-wrap, because buildBriefing writes real bullet lines and losing
          them would run the whole day into one paragraph. */}
      {briefing ? (
        <Text
          size="sm"
          color={C.navy}
          style={{ whiteSpace: "pre-wrap", display: "block", marginBottom: 12 }}
        >
          {briefing.text}
        </Text>
      ) : (
        loaded && (
          <Muted as="p" size="sm" style={{ margin: "0 0 12px" }}>
            {t.cwBriefingEmpty}
          </Muted>
        )
      )}

      <Stack gap={2}>
        {prompts.map((p) => (
          <TextBtn
            key={p.key}
            size="xs"
            onClick={() => askAnvil(es ? p.es : p.en, { view: "dashboard" })}
            style={{ textAlign: "left", padding: "2px 0" }}
          >
            <Row inline as="span" gap={2}>
              <MessageSquare size={12} aria-hidden="true" /> {es ? p.es : p.en}
            </Row>
          </TextBtn>
        ))}
      </Stack>

      <Row style={{ marginTop: 12 }}>
        <Btn v="outline" sz="sm" onClick={() => askAnvil(t.cwBriefingAsk, { view: "dashboard" })}>
          <Bot size={14} aria-hidden="true" /> {t.cwOpen}
        </Btn>
      </Row>
    </Card>
  );
}
