'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { BrandWordmark } from '@/components/brand-wordmark';
import { Mail, Lock, User, Loader2 } from 'lucide-react';
import { toSpanishAuthMessage } from '@/lib/authErrors';

export default function RegisterPage() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
      const { error } = await signUp(email, password, name.trim());
      if (error) {
        toast.error('No se pudo completar el registro', {
          description: toSpanishAuthMessage(error.message),
        });
      } else {
        toast.success('¡Registro exitoso!', {
          description: 'Revisa tu correo para confirmar tu cuenta.',
        });
        router.push('/login');
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
      <div className="flex min-h-0 flex-1 flex-col px-2 pb-0 pt-1 sm:px-4 sm:pt-3 lg:px-8">
        <div className="mx-auto flex w-full max-w-md shrink-0 justify-center sm:max-w-lg md:max-w-xl">
          <BrandWordmark
            priority
            className="translate-x-1.5 justify-center sm:translate-x-2 md:translate-x-2.5"
            imgClassName="h-[5.25rem] w-auto max-w-[min(96vw,30rem)] object-contain object-center sm:h-[5.5rem] md:h-[5.75rem]"
          />
        </div>

        <Card className="mt-2 flex min-h-0 w-full max-w-md flex-1 flex-col overflow-hidden rounded-b-none rounded-t-2xl border-0 shadow-xl sm:mx-auto sm:mt-3 sm:max-w-lg md:max-w-xl">
            <CardHeader className="shrink-0 space-y-0.5 px-4 pb-2 pt-3 sm:px-6 sm:pb-3 sm:pt-5">
              <CardTitle className="text-center text-lg font-bold sm:text-2xl">Crear Cuenta</CardTitle>
              <CardDescription className="text-center text-xs sm:text-sm">
                Regístrate como maestro para comenzar
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-3 pt-0 sm:px-6 sm:pb-5">
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
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-9 pl-9 text-sm sm:h-10"
                      required
                    />
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
                      type="password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="h-9 pl-9 text-sm sm:h-10"
                      required
                    />
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
            </CardContent>
            <CardFooter className="flex shrink-0 justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-0 sm:px-6 sm:pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
              <p className="text-center text-xs text-gray-600 sm:text-sm">
                ¿Ya tienes cuenta?{' '}
                <Link href="/login" className="font-medium text-orange-600 hover:underline">
                  Inicia sesión aquí
                </Link>
              </p>
            </CardFooter>
        </Card>
      </div>
    </div>
  );
}
