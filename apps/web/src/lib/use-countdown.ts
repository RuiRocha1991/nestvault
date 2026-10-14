import { useCallback, useEffect, useState } from 'react';

/** Wait before the "send again" link of an email screen can be used again. */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Seconds left of a pause the server (or a cooldown) decided; the screen only counts it down. */
export function useCountdown(): [secondsLeft: number, start: (seconds: number) => void] {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const running = secondsLeft > 0;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [running]);

  const start = useCallback((seconds: number) => {
    setSecondsLeft(seconds);
  }, []);
  return [secondsLeft, start];
}
