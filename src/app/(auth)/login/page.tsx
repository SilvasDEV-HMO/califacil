'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BrandWordmark } from '@/components/brand-wordmark';
import { Mail, Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import { toSpanishAuthMessage } from '@/lib/authErrors';
import { supabase } from '@/lib/supabase';
import { isCalifacilSuperUserEmail, isSubscriptionActive } from '@/lib/billing';

type LoginApiResponse = {
  ok?: boolean;
  error?: string;
  hint?: string;
  locked?: boolean;
  retryAfterSeconds?: number;
  attemptsLeft?: number;
  nextLockMinutes?: number;
  message?: string | null;
  access_token?: string;
  refresh_token?: string;
  user?: { id: string | null; email: string | null };
};

function formatWait(totalSec: number): string {
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes} min ${seconds.toString().padStart(2, '0')}s`;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);

  const refreshLock = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/login', { method: 'GET', cache: 'no-store' });
      const payload = (await res.json().catch(() => ({}))) as LoginApiResponse;
      if (payload.locked && (payload.retryAfterSeconds ?? 0) > 0) {
        setLockSeconds(payload.retryAfterSeconds ?? 0);
      } else {
        setLockSeconds(0);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refreshLock();
  }, [refreshLock]);

  const locked = lockSeconds > 0;

  useEffect(() => {
    if (!locked) return;
    const id = window.setInterval(() => {
      setLockSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [locked]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked) return;
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const payload = (await res.json().catch(() => ({}))) as LoginApiResponse;

      if (payload.locked && (payload.retryAfterSeconds ?? 0) > 0) {
        setLockSeconds(payload.retryAfterSeconds ?? 0);
        toast.error('Acceso bloqueado', {
          description: payload.error || 'Espera antes de volver a intentar.',
        });
        return;
      }

      if (!res.ok || !payload.ok || !payload.access_token || !payload.refresh_token) {
        toast.error('Error al iniciar sesión', {
          description: toSpanishAuthMessage(payload.error),
        });
        return;
      }

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: payload.access_token,
        refresh_token: payload.refresh_token,
      });
      if (sessionError) {
        toast.error('No se pudo guardar la sesión', {
          description: toSpanishAuthMessage(sessionError.message),
        });
        return;
      }

      const userId = payload.user?.id;
      const userEmail = payload.user?.email;
      if (!userId) {
        toast.error('No se pudo validar tu sesion.');
        return;
      }

      const { data: billingRow, error: billingError } = await supabase
        .from('teacher_billing')
        .select('is_active,subscription_status')
        .eq('user_id', userId)
        .maybeSingle();

      if (billingError) {
        toast.error('Error al validar tu suscripcion', {
          description: toSpanishAuthMessage(billingError.message),
        });
        return;
      }

      if (!isCalifacilSuperUserEmail(userEmail) && !isSubscriptionActive(billingRow)) {
        toast.message('Tu cuenta esta creada, pero aun no tiene un plan activo.');
        router.push('/billing');
        return;
      }

      toast.success('¡Bienvenido de vuelta!');
      router.push('/dashboard');
    } catch {
      toast.error('Error inesperado', {
        description: 'Inténtalo de nuevo en unos momentos.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-x-hidden overflow-y-auto overscroll-contain bg-white/35 backdrop-blur-[2px]">
      <header className="shrink-0 border-b border-orange-200/50 bg-white/75 backdrop-blur-md">
        <div
          className="mx-auto flex w-full max-w-5xl items-center justify-center px-4 pb-1 sm:px-6 sm:pb-1.5 lg:px-8"
          style={{ paddingTop: 'max(0.25rem, env(safe-area-inset-top, 0px))' }}
        >
          <BrandWordmark
            priority
            className="justify-center"
            imgClassName="h-11 w-auto max-w-[min(100%,18rem)] object-contain sm:h-12 sm:max-w-[24rem] lg:h-14 lg:max-w-[28rem]"
          />
        </div>
      </header>

      <main
        className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col items-center px-4 sm:px-6 lg:px-8"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="min-h-0 flex-1" aria-hidden />
        <Card className="w-full max-w-md shrink-0 overflow-hidden rounded-2xl border-0 shadow-xl sm:max-w-lg">
          <CardHeader className="space-y-1 px-4 pb-3 pt-5 sm:px-6 sm:pb-3 sm:pt-6">
            <CardTitle className="text-center text-xl font-bold sm:text-2xl">Iniciar Sesión</CardTitle>
            <CardDescription className="text-center text-xs sm:text-sm">
              Ingresa tus credenciales para acceder a tu cuenta
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 px-4 pb-5 pt-0 sm:space-y-4 sm:px-6 sm:pb-6">
            <form onSubmit={handleSubmit} className="space-y-3.5 sm:space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs sm:text-sm">
                  Correo electrónico
                </Label>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 sm:h-4 sm:w-4" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="maestro@escuela.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 pl-9 text-base sm:h-10 sm:text-sm"
                    disabled={locked}
                    autoComplete="username"
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs sm:text-sm">
                  Contraseña
                </Label>
                <div className="relative">
                  <Lock className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 sm:h-4 sm:w-4" />
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 pl-9 pr-10 text-base sm:h-10 sm:text-sm"
                    disabled={locked}
                    autoComplete="current-password"
                    required
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-orange-500 transition-colors hover:text-orange-600"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
              <Button
                type="submit"
                className="h-11 w-full bg-orange-600 text-sm font-semibold hover:bg-orange-700 sm:h-10"
                disabled={loading || locked}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Iniciando sesión...
                  </>
                ) : locked ? (
                  `Espera ${formatWait(lockSeconds)}`
                ) : (
                  'Iniciar Sesión'
                )}
              </Button>
              {locked ? (
                <p className="text-center text-xs text-amber-800 sm:text-sm">
                  Esta red superó 3 intentos fallidos. El bloqueo aumenta 10 minutos cada vez (10,
                  20, 30…).
                </p>
              ) : null}
            </form>
            <p className="text-center text-xs text-gray-600 sm:text-sm">
              ¿No tienes cuenta?{' '}
              <Link href="/register" className="font-medium text-orange-600 hover:underline">
                Regístrate aquí
              </Link>
            </p>
          </CardContent>
        </Card>
        <div className="min-h-0 flex-[2]" aria-hidden />
      </main>
    </div>
  );
}
