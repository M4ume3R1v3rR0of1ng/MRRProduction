import React, { createContext, useContext, useState } from 'react';
import { C } from '../utils/helpers';

const NotificationContext = createContext();

export function NotificationProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = (message, type = 'error', duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  };

  // Maps notification types to cohesive operational design tokens
  const getToastStyle = (type) => {
    switch (type) {
      case 'success': return { bg: C.gB || '#d1fae5', border: C.gr || '#10b981', color: '#065f46' };
      case 'warning': return { bg: C.aB || '#fef3c7', border: C.am || '#f59e0b', color: '#92400e' };
      case 'error':
      default: return { bg: '#fee2e2', border: '#ef4444', color: '#991b1b' };
    }
  };

  return (
    <NotificationContext.Provider value={{ showToast }}>
      {children}
      
      {/* Floating Toast Portal Container Layout */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: "var(--space-4)", maxWidth: 360 }}>
        {toasts.map((t) => {
          const style = getToastStyle(t.type);
          return (
            <div
              key={t.id}
              style={{
                background: style.bg,
                borderLeft: `5px solid ${style.border}`,
                color: style.color,
                padding: '12px 16px',
                borderRadius: "var(--radius-md)",
                fontSize: "var(--text-base)",
                fontWeight: "var(--weight-bold)",
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                animation: 'slideIn 0.2s ease',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'start',
                gap: 12
              }}
            >
              <div>{t.message}</div>
              <button
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: "var(--weight-black)", padding: 0, fontSize: "var(--text-md)", lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </NotificationContext.Provider>
  );
}

export const useNotify = () => useContext(NotificationContext);