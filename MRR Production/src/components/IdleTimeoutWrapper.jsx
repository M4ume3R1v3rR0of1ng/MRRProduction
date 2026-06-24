// src/components/IdleTimeoutWrapper.jsx
import { useEffect, useRef } from 'react';

// ── 🟢 FIXED: ACCEPT THE TIMEOUT PROP WITH A 5-MINUTE DEFAULT FALLBACK ──
export default function IdleTimeoutWrapper({ children, onLogout, isAuthenticated, timeout }) {
  
  // Use the passed timeout value (e.g., from App.jsx) or default to 5 minutes if not provided[cite: 4]
  const TIMEOUT_IN_MS = timeout || (5 * 60 * 1000); 
  const timerRef = useRef(null);

  const resetTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current); //[cite: 4]

    if (isAuthenticated) { //[cite: 4]
      timerRef.current = setTimeout(() => {
        handleTimeout();
      }, TIMEOUT_IN_MS); //[cite: 4]
    }
  };

  const handleTimeout = () => {
    // Dynamically calculate the printed log message based on the active milliseconds count
    const minutesLogged = Math.round(TIMEOUT_IN_MS / 60 / 1000);
    console.warn(`Session expired due to ${minutesLogged} minutes of inactivity.`);
    alert(`Your session has expired due to ${minutesLogged} minutes of inactivity. Please log in again.`);
    onLogout(); //[cite: 4]
  };

  useEffect(() => {
    const activityEvents = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart']; //[cite: 4]

    if (isAuthenticated) { //[cite: 4]
      resetTimer();
      activityEvents.forEach(event => window.addEventListener(event, resetTimer)); //[cite: 4]
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current); //[cite: 4]
      activityEvents.forEach(event => window.removeEventListener(event, resetTimer)); //[cite: 4]
    };
  }, [isAuthenticated, TIMEOUT_IN_MS]); // 🟢 Added TIMEOUT_IN_MS to safely track prop changes!

  return <>{children}</>; //[cite: 4]
}