// src/components/ErrorBoundary.jsx
import React from 'react';
import { C } from '../utils/helpers';
import { translations } from '../utils/translations';

// This boundary is mounted in main.jsx, ABOVE <App/>, which is where the app's
// `lang` state lives — so it can never be handed the language as a prop. That is
// why ebTitle/ebExceptionMessage sat translated but unused since they were
// written. Reading the persisted choice straight from localStorage is the way in,
// using the same key and the same fallback order App itself uses.
//
// A crash screen is a bad moment to switch someone into a language they do not
// read, and it is the screen most likely to be photographed and sent to you.
function crashLang() {
  try {
    const saved = localStorage.getItem('sw_lang');
    if (saved === 'en' || saved === 'es') return saved;
  } catch {
    // Private mode or storage disabled. Fall through to detection.
  }
  return typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('es')
    ? 'es'
    : 'en';
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the exact error and component stack trace to the console
    console.group("🚨 CRITICAL APPLICATION CRASH DETECTED 🚨");
    console.error("Error Detail:", error);
    console.error("Component Stack Trace:", errorInfo.componentStack);
    console.groupEnd();
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback UI matching Maumee River Roofing's look
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          background: 'var(--c-subtle)',
          fontFamily: 'sans-serif',
          padding: 20,
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ color: 'var(--c-slate)', fontSize: "var(--text-3xl)", fontWeight: "var(--weight-black)", margin: '0 0 8px 0' }}>
            {(translations[crashLang()] || translations.en).ebTitle}
          </h1>
          <p style={{ color: 'var(--c-sub)', fontSize: "var(--text-md)", maxWidth: 440, margin: '0 0 24px 0', lineHeight: 1.5 }}>
            A runtime error occurred in the user interface layer. Staging inventories, warehouse records, and contract pipelines remain safe in Supabase.
          </p>
          
          <div style={{
            background: 'var(--c-surface)',
            border: '1.5px solid var(--c-line)',
            borderRadius: "var(--radius-md)",
            padding: 16,
            maxWidth: 600,
            width: '100%',
            textAlign: 'left',
            marginBottom: 24,
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
          }}>
            <div style={{ fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)", color: 'var(--c-rust)', textTransform: 'uppercase', marginBottom: 6 }}>
              {(translations[crashLang()] || translations.en).ebExceptionMessage}
            </div>
            <pre style={{
              margin: 0,
              fontSize: "var(--text-sm)",
              fontFamily: 'monospace',
              color: 'var(--c-slate)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              background: 'var(--c-rust-wash)',
              padding: 10,
              borderRadius: "var(--radius-sm)",
              border: '1px solid var(--c-rust-wash)'
            }}>
              {this.state.error?.toString() || "Unknown runtime exception."}
            </pre>
          </div>

          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'var(--c-slate)',
              color: 'var(--c-on-accent)',
              border: 'none',
              borderRadius: "var(--radius-sm)",
              padding: '10px 20px',
              fontSize: "var(--text-base)",
              fontWeight: "var(--weight-bold)",
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(27,82,184,0.3)',
              transition: 'background 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--c-slate)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--c-slate)'}
          >
            🔄 Force App Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}