// src/shared/components/ChatParts.jsx
//
// The pieces Team Chat (dashboard) and the assistant widget both draw: a
// message bubble, the thumbnail of a photo waiting to be sent, and the composer
// row. They were two hand-kept copies that had already drifted — Team Chat's
// own-message text used C.w, the surface token, which goes dark in dark mode
// and left dark text on the blue bubble; the widget's used onAccent.
import { Camera, X } from "lucide-react";
import { C } from "../utils/helpers";
import { Row } from "./LayoutPrimitives";
import { Btn, Inp } from "./UIPrimitives";

// One message. The tail corner (the squared one) points at the sender's side.
// pre-wrap so the assistant's multi-line answers keep their line breaks.
export function ChatBubble({ mine, photo, photoAlt, onPhotoClick, children }) {
  return (
    <div
      style={{
        background: mine ? C.blue : C.lg,
        color: mine ? C.onAccent : C.navy,
        borderRadius: "var(--radius-xl)",
        borderBottomRightRadius: mine ? 3 : "var(--radius-xl)",
        borderBottomLeftRadius: mine ? "var(--radius-xl)" : 3,
        padding: "var(--space-3) var(--space-5)",
        fontSize: "var(--text-base)",
        lineHeight: 1.4,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {photo && (
        <img
          src={photo}
          alt={photoAlt}
          onClick={onPhotoClick}
          style={{
            display: "block",
            maxWidth: "100%",
            maxHeight: 160,
            borderRadius: "var(--radius-md)",
            marginBottom: children ? "var(--space-2)" : 0,
            cursor: "pointer",
          }}
        />
      )}
      {children}
    </div>
  );
}

// The photo attached to the message being written, with an × to drop it.
export function PendingPhoto({ src, alt, onRemove, size = 60, style }) {
  const badge = size > 56 ? 18 : 16;
  return (
    <div style={{ position: "relative", width: size, height: size, ...style }}>
      <img
        src={src}
        alt={alt}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          borderRadius: "var(--radius-md)",
          border: `1.5px solid ${C.bd}`,
        }}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove photo"
        style={{
          position: "absolute",
          top: -6,
          right: -6,
          background: C.rd,
          color: C.onAccent,
          border: "none",
          borderRadius: "50%",
          width: badge,
          height: badge,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <X size={badge - 7} aria-hidden="true" />
      </button>
    </div>
  );
}

// Attach-photo button, text box and Send. The file input is hidden and driven
// by the camera button, so the row reads as one control.
export function ChatComposer({
  fileInputRef,
  onPickFile,
  attachTitle,
  attachDisabled,
  value,
  onChange,
  onKeyDown,
  placeholder,
  inputDisabled,
  onSend,
  sendDisabled,
  sendLabel,
  gap = 3,
  style,
}) {
  return (
    <Row gap={gap} align="stretch" style={style}>
      <input ref={fileInputRef} type="file" accept="image/*" onChange={onPickFile} hidden />
      <Btn
        v="ghost"
        onClick={() => fileInputRef.current.click()}
        disabled={attachDisabled}
        title={attachTitle}
        aria-label={attachTitle}
        style={{ padding: "9px 12px" }}
      >
        <Camera size={16} aria-hidden="true" />
      </Btn>
      <Inp
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={inputDisabled}
        style={{ flex: 1, width: "auto", padding: "9px 11px", fontSize: "var(--text-base)" }}
      />
      <Btn
        onClick={onSend}
        disabled={sendDisabled}
        style={{ padding: "9px 16px", fontSize: "var(--text-base)" }}
      >
        {sendLabel}
      </Btn>
    </Row>
  );
}
