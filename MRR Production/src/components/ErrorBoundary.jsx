// src/components/ErrorBoundary.jsx
import React from 'react';
import { C } from '../utils/helpers';

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
          background: '#f8fafc',
          fontFamily: 'sans-serif',
          padding: 20,
          textAlign: 'center'
        }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ color: '#0f294a', fontSize: 22, fontWeight: 900, margin: '0 0 8px 0' }}>
            System Interface Interrupted
          </h1>
          <p style={{ color: '#64748b', fontSize: 14, maxWidth: 440, margin: '0 0 24px 0', lineHeight: 1.5 }}>
            A runtime error occurred in the user interface layer. Staging inventories, warehouse records, and contract pipelines remain safe in Supabase.
          </p>
          
          <div style={{
            background: '#ffffff',
            border: '1.5px solid #e2e8f0',
            borderRadius: 8,
            padding: 16,
            maxWidth: 600,
            width: '100%',
            textAlign: 'left',
            marginBottom: 24,
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', marginBottom: 6 }}>
              Exception Message
            </div>
            <pre style={{
              margin: 0,
              fontSize: 12,
              fontFamily: 'monospace',
              color: '#0f294a',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              background: '#fff5f5',
              padding: 10,
              borderRadius: 6,
              border: '1px solid #fee2e2'
            }}>
              {this.state.error?.toString() || "Unknown runtime exception."}
            </pre>
          </div>

          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#1b52b8',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              padding: '10px 20px',
              fontSize: 13,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(27,82,184,0.3)',
              transition: 'background 0.2s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#154294'}
            onMouseLeave={e => e.currentTarget.style.background = '#1b52b8'}
          >
            🔄 Force App Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}