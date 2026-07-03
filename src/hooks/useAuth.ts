import { useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/services/supabase';

interface AuthState {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

/**
 * Reactive auth state hook.
 * Subscribes to Supabase's onAuthStateChange — single source of truth.
 * No polling, no manual refresh — Supabase's SDK handles token rotation.
 */
export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let settled = false;

    // Safety timeout — if Supabase takes >5s (offline/slow), unblock the UI
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        setIsLoading(false);
      }
    }, 5000);

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        setSession(session);
        setIsLoading(false);
      }
    }).catch(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        setIsLoading(false);
      }
    });

    // Subscribe to auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setIsLoading(false);
    });

    return () => {
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    user: session?.user ?? null,
    isLoading,
    isAuthenticated: !!session,
  };
}
