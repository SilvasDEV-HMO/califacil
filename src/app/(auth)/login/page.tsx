'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { BrandWordmark } from '@/components/brand-wordmark';
import { Mail, Lock, Loader2, Eye, EyeOff } from 'lucide-react';
import { toSpanishAuthMessage } from '@/lib/authErrors';
import { supabase } from '@/lib/supabase';
import { isCalifacilSuperUserEmail, isSubscriptionActive } from '@/lib/billing';

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data, error } = await signIn(email, password);
      if (error) {
        toast.error('Error al iniciar sesión', {
          description: toSpanishAuthMessage(error.message),
        });
      } else {
        const userId = data.user?.id;
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

        if (
          !isCalifacilSuperUserEmail(data.user?.email) &&
          !isSubscriptionActive(billingRow)
        ) {
          toast.message('Tu cuenta esta creada, pero aun no tiene un plan activo.');
          router.push('/billing');
          return;
        }

        toast.success('¡Bienvenido de vuelta!');
        router.push('/dashboard');
      }
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
                    className="h-11 pl-9 text-sm sm:h-10"
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
                    className="h-11 pl-9 pr-10 text-sm sm:h-10"
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
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Iniciando sesión...
                  </>
                ) : (
                  'Iniciar Sesión'
                )}
              </Button>
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
