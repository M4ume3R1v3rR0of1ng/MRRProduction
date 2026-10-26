// src/shared/components/TranslatableText.jsx
//
// A block of typed free text with a "Translate" link under it.
//
// Everywhere else in the app, text arrives from translations.js already in the
// reader's language. This is for the other kind — the sentence a driver typed
// into a maintenance request — where the words are whatever the person who
// filed it speaks. See src/shared/utils/freeTextTranslation.js.
//
// WHY THE ORIGINAL IS THE DEFAULT
//
// The note is the record. The shop is held to what was actually written, and a
// machine translation is an aid for reading it, not a replacement for it — so
// the original is what renders until someone asks, and "Show original" is
// always one tap away afterwards. The toggle only appears when a translation
// would say something different: a note already in the reader's language gets
// no link at all, because offering to translate English into English is noise.
//
// A SESSION, NOT A SETTING
//
// Translating one note is remembered for the tab (sessionStorage, in the util),
// so re-opening that ticket shows it translated again without a second model
// call. It is not remembered across sessions, because a translation is not a
// record and should not start looking like one.

import { useCallback, useEffect, useRef, useState } from "react";
import { Languages } from "lucide-react";
import { C } from "@/shared/utils/helpers";
import { translations } from "@/shared/utils/translations";
import {
  isUseful,
  readCache,
  translateText,
  TRANSLATABLE_LANGS,
} from "@/shared/utils/freeTextTranslation";
import { Row, Text, Muted } from "./LayoutPrimitives";
import { TextBtn } from "./UIPrimitives";

export default function TranslatableText({
  text,
  lang = "en",
  // An inline bold lead-in, for the call sites that read "Schedule Info: ..."
  label,
  // Wraps the body in quotes the way the review dialog already quotes a note.
  quote = false,
  as = "div",
  size,
  color,
  weight,
  style,
  toggleStyle,
}) {
  const t = translations[lang] || translations.en;
  const trimmed = (text || "").trim();
  const supported = TRANSLATABLE_LANGS.includes(lang);

  // "idle" → nothing asked for yet. "done" carries a result, which may turn out
  // to say nothing new; isUseful below is what decides whether to offer it.
  const [state, setState] = useState({ phase: "idle", result: null, error: null });
  const [showTranslation, setShowTranslation] = useState(false);
  const [asked, setAsked] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A note translated earlier in this session comes back already translated —
  // the reader asked once, and asking again per scroll is not a preference they
  // expressed. A new or edited note resets to its original.
  useEffect(() => {
    const cached = supported && trimmed ? readCache(lang, trimmed) : null;
    if (cached) {
      setState({ phase: "done", result: cached, error: null });
      const useful = isUseful(cached, trimmed);
      setShowTranslation(useful);
      setAsked(useful);
    } else {
      setState({ phase: "idle", result: null, error: null });
      setShowTranslation(false);
      setAsked(false);
    }
  }, [trimmed, lang, supported]);

  const fetchTranslation = useCallback(async () => {
    setAsked(true);
    setState({ phase: "loading", result: null, error: null });
    try {
      const result = await translateText(trimmed, lang);
      if (!alive.current) return;
      setState({ phase: "done", result, error: null });
      setShowTranslation(isUseful(result, trimmed));
    } catch (err) {
      if (!alive.current) return;
      setState({ phase: "idle", result: null, error: err.message });
    }
  }, [trimmed, lang]);

  const translated = state.phase === "done" && isUseful(state.result, trimmed);
  const body = showTranslation && translated ? state.result.translation : trimmed;

  const control = () => {
    if (!supported || !trimmed) return null;

    if (state.phase === "loading") {
      return (
        <Muted size="2xs" aria-live="polite" style={toggleStyle}>
          {t.trTranslating}
        </Muted>
      );
    }

    if (state.error) {
      return (
        <Row gap={2} aria-live="polite" style={toggleStyle}>
          <Muted size="2xs">{t.trFailed}</Muted>
          <TextBtn size="2xs" color={C.blue} underline onClick={fetchTranslation}>
            {t.trRetry}
          </TextBtn>
        </Row>
      );
    }

    if (state.phase === "done") {
      // Nothing new to show. Said out loud only if someone actually pressed the
      // link — an unprompted "already in English" on every note is clutter.
      if (!translated) {
        return asked ? (
          <Muted size="2xs" aria-live="polite" style={toggleStyle}>
            {t.trAlreadyInLang}
          </Muted>
        ) : null;
      }
      return (
        <Row gap={2} wrap style={toggleStyle}>
          <TextBtn
            size="2xs"
            color={C.blue}
            underline
            onClick={() => setShowTranslation((v) => !v)}
          >
            <Row inline as="span" gap={1}>
              <Languages size={11} aria-hidden="true" />
              {showTranslation ? t.trShowOriginal : t.trTranslate}
            </Row>
          </TextBtn>
          {showTranslation && <Muted size="2xs">{t.trMachineNote}</Muted>}
        </Row>
      );
    }

    return (
      <TextBtn size="2xs" color={C.blue} underline onClick={fetchTranslation} style={toggleStyle}>
        <Row inline as="span" gap={1}>
          <Languages size={11} aria-hidden="true" />
          {t.trTranslate}
        </Row>
      </TextBtn>
    );
  };

  return (
    <>
      <Text as={as} size={size} color={color} weight={weight} style={style}>
        {label && <strong>{label}</strong>}
        {label ? " " : null}
        {quote ? `"${body}"` : body}
      </Text>
      {control()}
    </>
  );
}
