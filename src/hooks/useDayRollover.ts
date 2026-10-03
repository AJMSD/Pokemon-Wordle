import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { msUntilNextJstMidnight } from '../utils/pokemonUtils';

// Fire just after midnight so the clock has definitely rolled over.
const MIDNIGHT_SLACK_MS = 1500;

/**
 * Keeps a long-open tab on today's puzzle: when the JST date changes (timer at
 * midnight, or the tab becoming visible again) the game is re-initialised and,
 * when signed in, the server session is reloaded.
 */
export function useDayRollover() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = () => {
      const auth = useAuthStore.getState();
      const token = !auth.isGuest ? auth.session?.access_token ?? null : null;
      useGameStore.getState().checkForNewDay(token);
    };

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        check();
        schedule();
      }, msUntilNextJstMidnight() + MIDNIGHT_SLACK_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        check();
        // Timers are throttled in background tabs, so re-arm against the clock.
        schedule();
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    schedule();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timer);
    };
  }, []);
}

export default useDayRollover;
