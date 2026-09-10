'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';
import { isCalifacilIthEmail, normalizeAuthEmail } from '@/lib/ithAuth';

async function ensureIthAccount(email: string, password: string, fullName?: string) {
  const res = await fetch('/api/auth/ensure-ith', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, fullName }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    hint?: string;
  };
  if (!res.ok || !payload.ok) {
    const err = new Error(payload.error || 'No se pudo preparar la cuenta I.T.H.');
    (err as Error & { hint?: string }).hint = payload.hint;
    throw err;
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const bootstrapSession = async () => {
      // Primero recuperar desde storage local (rápido y estable entre pestañas).
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      setUser(session?.user ?? null);
      setLoading(false);
    };

    void bootstrapSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const name = fullName.trim();
    const normalizedEmail = normalizeAuthEmail(email);

    // @ith.com: crear/confirmar en servidor (sin OTP) y entrar de inmediato.
    if (isCalifacilIthEmail(normalizedEmail)) {
      try {
        await ensureIthAccount(normalizedEmail, password, name);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'No se pudo registrar la cuenta I.T.H.';
        return {
          data: { user: null, session: null },
          error: { message, name: 'IthEnsureError', status: 400 },
        };
      }
      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      return { data, error };
    }

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          role: 'teacher',
          full_name: name,
          name,
        },
      },
    });
    return { data, error };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const normalizedEmail = normalizeAuthEmail(email);
    let { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    // Docentes I.T.H. sin confirmar: reparar con service_role y reintentar.
    if (
      error &&
      isCalifacilIthEmail(normalizedEmail) &&
      /confirm|verif/i.test(error.message || '')
    ) {
      try {
        await ensureIthAccount(normalizedEmail, password);
        ({ data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        }));
      } catch (ensureErr) {
        const message =
          ensureErr instanceof Error
            ? ensureErr.message
            : 'No se pudo confirmar la cuenta I.T.H.';
        return {
          data: { user: null, session: null },
          error: { message, name: 'IthEnsureError', status: 400 },
        };
      }
    }

    return { data, error };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/dashboard`,
      },
    });
    return { data, error };
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  }, []);

  return {
    user,
    loading,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
  };
}
