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
import { Mail, Lock, User, Loader2, Eye, EyeOff } from 'lucide-react';
import { toSpanishAuthMessage } from '@/lib/authErrors';
import { supabase } from '@/lib/supabase';

export default function RegisterPage() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden');
      return;
    }

    if (password.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres');
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await signUp(email, password, name.trim());
      if (error) {
        toast.error('No se pudo completar el registro', {
          description: toSpanishAuthMessage(error.message),
        });
      } else {
        if (data.session?.user) {
          toast.success('¡Registro exitoso! Ahora elige tu plan para activar tu acceso.');
          router.push('/billing');
        } else {
          setPendingVerification(true);
          toast.success('Te enviamos un codigo de verificacion a tu correo.');
        }
      }
    } catch {
      toast.error('Error inesperado', {
        description: 'Inténtalo de nuevo en unos momentos.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !verificationCode.trim()) {
      toast.error('Ingresa tu correo y el codigo de verificacion.');
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: verificationCode.trim(),
        type: 'signup',
      });

      if (error) {
        toast.error('Codigo invalido', {
          description: toSpanishAuthMessage(error.message),
        });
        return;
      }

      toast.success('Correo verificado correctamente');
      router.push('/billing');
    } catch {
      toast.error('Error inesperado', {
        description: 'Inténtalo de nuevo en unos momentos.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (!email.trim()) {
      toast.error('Primero ingresa tu correo.');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
      });
      if (error) {
        toast.error('No se pudo reenviar el codigo', {
          description: toSpanishAuthMessage(error.message),
        });
      } else {
        toast.success('Codigo reenviado a tu correo.');
      }
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
        <Card className="flex max-h-[min(100%,calc(100dvh-6.5rem))] w-full max-w-md shrink-0 flex-col overflow-hidden rounded-2xl border-0 shadow-xl sm:max-h-none sm:max-w-lg">
          <CardHeader className="shrink-0 space-y-1 px-4 pb-3 pt-5 sm:px-6 sm:pb-3 sm:pt-6">
            <CardTitle className="text-center text-xl font-bold sm:text-2xl">
              {pendingVerification ? 'Verificar correo' : 'Crear Cuenta'}
            </CardTitle>
            <CardDescription className="text-center text-xs sm:text-sm">
              {pendingVerification
                ? 'Ingresa el codigo que te enviamos por correo'
                : 'Regístrate como maestro para comenzar'}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-5 pt-0 sm:px-6 sm:pb-6">
            {pendingVerification ? (
              <form onSubmit={handleVerifyCode} className="flex flex-col gap-3 sm:gap-3.5">
                <div className="space-y-1">
                  <Label htmlFor="verificationCode" className="text-xs sm:text-sm">
                    Codigo de verificacion
                  </Label>
                  <Input
                    id="verificationCode"
                    type="text"
                    inputMode="numeric"
                    placeholder="Clave de 8 caracteres"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value)}
                    className="h-10 text-sm sm:h-10"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="mt-1 h-10 w-full bg-orange-600 text-sm hover:bg-orange-700 sm:h-10"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Verificando...
                    </>
                  ) : (
                    'Confirmar codigo'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-full text-sm sm:h-10"
                  disabled={loading}
                  onClick={() => void handleResendCode()}
                >
                  Reenviar codigo
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-2.5 sm:gap-3">
                <div className="space-y-1">
                  <Label htmlFor="name" className="text-xs sm:text-sm">
                    Nombre completo
                  </Label>
                  <div className="relative">
                    <User className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 sm:h-4 sm:w-4" />
                    <Input
                      id="name"
                      type="text"
                      placeholder="Juan Pérez"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-9 pl-9 text-sm sm:h-10"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1">
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
                      className="h-9 pl-9 text-sm sm:h-10"
                      required
                    />
                  </div>
                </div>
                <div className="space-y-1">
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
                      className="h-9 pl-9 pr-10 text-sm sm:h-10"
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
                <div className="space-y-1">
                  <Label htmlFor="confirmPassword" className="text-xs sm:text-sm">
                    Confirmar contraseña
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 sm:h-4 sm:w-4" />
                    <Input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-9 pl-9 pr-10 text-sm sm:h-10"
                      required
                    />
                    <button
                      type="button"
                      aria-label={
                        showConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                      }
                      onClick={() => setShowConfirmPassword((prev) => !prev)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-orange-500 transition-colors hover:text-orange-600"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
                <Button
                  type="submit"
                  className="mt-1 h-9 w-full bg-orange-600 text-sm hover:bg-orange-700 sm:h-10"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creando cuenta...
                    </>
                  ) : (
                    'Crear Cuenta'
                  )}
                </Button>
              </form>
            )}
            <p className="text-center text-xs text-gray-600 sm:text-sm">
              ¿Ya tienes cuenta?{' '}
              <Link href="/login" className="font-medium text-orange-600 hover:underline">
                Inicia sesión aquí
              </Link>
            </p>
          </CardContent>
        </Card>
        <div className="min-h-0 flex-[2]" aria-hidden />
      </main>
    </div>
  );
}
