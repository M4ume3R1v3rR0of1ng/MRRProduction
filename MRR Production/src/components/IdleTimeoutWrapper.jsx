// src/components/IdleTimeoutWrapper.jsx
import { useEffect, useRef } from 'react';

export default function IdleTimeoutWrapper({ children, onLogout, isAuthenticated }) {
  // 5 minutes in milliseconds (5 * 60 * 1000)
  const TIMEOUT_IN_MS = 5 * 60 * 1000; 
  const timerRef = useRef(null);

  const resetTimer = () => {
    // Clear any existing active countdown timer
    if (timerRef.current) clearTimeout(timerRef.current);

    // Only start a new countdown timer if the user is actually logged in
    if (isAuthenticated) {
      timerRef.current = setTimeout(() => {
        handleTimeout();
      }, TIMEOUT_IN_MS);
    }
  };

  const handleTimeout = () => {
    console.warn("Session expired due to 5 minutes of inactivity.");
    alert("Your session has expired due to inactivity. Please log in again.");
    onLogout(); // This will clear state and redirect to login
  };

  useEffect(() => {
    // Events that indicate the user is actively working/present
    const activityEvents = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];

    // If authenticated, set up the initial timer and attach listeners
    if (isAuthenticated) {
      resetTimer();
      activityEvents.forEach(event => window.addEventListener(event, resetTimer));
    }

    // Cleanup: Remove listeners and clear timers when component updates or unmounts
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      activityEvents.forEach(event => window.removeEventListener(event, resetTimer));
    };
  }, [isAuthenticated]); // Re-run setup if the user logs in or out

  return <>{children}</>;
}