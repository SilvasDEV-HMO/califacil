'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/hooks/useAuth';
import { BrandWordmark } from '@/components/brand-wordmark';
import { Mail, Lock, Loader2 } from 'lucide-react';
import { toSpanishAuthMessage } from '@/lib/authErrors';

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await signIn(email, password);
      if (error) {
        toast.error('Error al iniciar sesión', {
          description: toSpanishAuthMessage(error.message),
        });
      } else {
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

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        toast.error('Error al iniciar sesión con Google', {
          description: toSpanishAuthMessage(error.message),
        });
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
    <div className="flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden bg-white/35 backdrop-blur-[2px]">
      <div className="flex min-h-0 flex-1 items-center justify-center px-2 py-1 sm:px-4 sm:py-3 lg:px-8">
        <div className="flex h-full max-h-full w-full max-w-md flex-col justify-center gap-2 sm:max-w-lg sm:gap-3 md:max-w-xl">
          <div className="flex shrink-0 justify-center">
            <BrandWordmark
              priority
              className="translate-x-1.5 justify-center sm:translate-x-2 md:translate-x-2.5"
              imgClassName="h-[5.25rem] w-auto max-w-[min(96vw,30rem)] object-contain object-center sm:h-[5.5rem] md:h-[5.75rem]"
            />
          </div>

          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-0 shadow-xl">
            <CardHeader className="space-y-0.5 px-4 pb-2 pt-3 sm:px-6 sm:pb-3 sm:pt-5">
              <CardTitle className="text-center text-lg font-bold sm:text-2xl">Iniciar Sesión</CardTitle>
              <CardDescription className="text-center text-xs sm:text-sm">
                Ingresa tus credenciales para acceder a tu cuenta
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5 px-4 pb-3 pt-0 sm:space-y-3 sm:px-6 sm:pb-5">
              <form onSubmit={handleSubmit} className="space-y-2.5 sm:space-y-3">
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
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-9 pl-9 text-sm sm:h-10"
                      required
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="h-9 w-full bg-orange-600 text-sm hover:bg-orange-700 sm:h-10"
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

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <Separator className="w-full" />
                </div>
                <div className="relative flex justify-center text-[10px] uppercase sm:text-xs">
                  <span className="bg-white px-2 text-gray-500">O continúa con</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-9 w-full text-sm sm:h-10"
                onClick={handleGoogleSignIn}
                disabled={loading}
              >
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    fill="#4285F4"
                  />
                  <path
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    fill="#34A853"
                  />
                  <path
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    fill="#FBBC05"
                  />
                  <path
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    fill="#EA4335"
                  />
                </svg>
                Google
              </Button>
            </CardContent>
            <CardFooter className="flex justify-center px-4 pb-3 pt-0 sm:px-6 sm:pb-4">
              <p className="text-center text-xs text-gray-600 sm:text-sm">
                ¿No tienes cuenta?{' '}
                <Link href="/register" className="font-medium text-orange-600 hover:underline">
                  Regístrate aquí
                </Link>
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
