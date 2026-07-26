'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { BrandWordmark } from '@/components/brand-wordmark';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LayoutDashboard, Users, FileText, LogOut, UserRound, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { toSpanishAuthMessage } from '@/lib/authErrors';
import { supabase } from '@/lib/supabase';
import { isCalifacilSuperUserEmail, isSubscriptionActive } from '@/lib/billing';

function navActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, signOut } = useAuth();
  const [billingReady, setBillingReady] = useState(false);
  const dashboardHome = pathname === '/dashboard';

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    const guardBilling = async () => {
      if (loading || !user) return;
      setBillingReady(false);
      const { data, error } = await supabase
        .from('teacher_billing')
        .select('is_active,subscription_status')
        .eq('user_id', user.id)
        .maybeSingle();

      if (
        !isCalifacilSuperUserEmail(user.email) &&
        (error || !isSubscriptionActive(data))
      ) {
        router.replace('/billing');
        return;
      }
      setBillingReady(true);
    };

    void guardBilling();
  }, [loading, user, router]);

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast.error('Error al cerrar sesión', {
        description: toSpanishAuthMessage(error.message),
      });
    } else {
      toast.success('Sesión cerrada');
      router.push('/login');
    }
  };

  if (loading || !billingReady) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-orange-600" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const navItems = [
    { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
    { href: '/groups', label: 'Grupos', icon: Users },
    { href: '/exams', label: 'Exámenes', icon: FileText },
    { href: '/calificar', label: 'Calificar', icon: Camera },
  ] as const;

  const isCalificarRoute =
    pathname === '/calificar' || pathname.startsWith('/calificar/');

  return (
    <div className="h-full min-h-0 overflow-hidden bg-orange-50/25 backdrop-blur-[1px]">
      {/* Escritorio: barra lateral */}
      <aside className="fixed left-0 top-0 z-50 hidden h-full max-h-[100dvh] w-64 flex-col overflow-y-auto border-r border-gray-200 bg-white lg:flex app-scroll">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-gray-200 px-4 py-5 sm:px-5">
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="w-full cursor-pointer text-left"
              aria-label="CaliFácil, ir al dashboard"
            >
              <BrandWordmark
                href={false}
                priority
                className="w-full"
                imgClassName="h-16 w-auto max-w-full object-contain object-left sm:h-[4.75rem] lg:h-[5.25rem]"
              />
            </button>
          </div>
          <nav className="flex-1 space-y-1 p-4" aria-label="Navegación principal">
            {navItems.map((item) => {
              const active = navActive(pathname, item.href);
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => router.push(item.href)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-lg px-4 py-3 text-left font-medium text-gray-700 transition-colors hover:bg-orange-50 hover:text-orange-600',
                    active && 'bg-orange-50 text-orange-600'
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  <span>{item.label === 'Inicio' ? 'Dashboard' : item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="border-t border-gray-200 p-4">
            <div className="mb-4 rounded-lg bg-gray-50 px-4 py-2">
              <p className="text-sm text-gray-500">Conectado como</p>
              <p className="truncate text-sm font-medium text-gray-900">{user.email}</p>
            </div>
            <Button variant="outline" className="flex w-full items-center gap-2" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex h-full min-h-0 flex-col overflow-hidden lg:ml-64">
        {/* Móvil: cabecera compacta + cuenta */}
        <header
          className="z-30 shrink-0 border-b border-gray-200 bg-white/95 backdrop-blur-sm lg:hidden"
        >
          <div
            className="flex items-center justify-between gap-2 px-3 pb-2"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)' }}
          >
            <span className="inline-flex min-w-0 max-w-[min(100%,20rem)] items-center sm:max-w-[20rem]">
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="max-w-full cursor-pointer text-left"
                aria-label="CaliFácil, ir al dashboard"
              >
                <BrandWordmark
                  href={false}
                  priority
                  imgClassName="h-[58px] w-auto max-w-full object-contain object-left sm:h-[3.25rem] sm:max-w-[16rem]"
                />
              </button>
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label="Cuenta">
                  <UserRound className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[min(90vw,18rem)]">
                <DropdownMenuLabel className="font-normal">
                  <span className="block truncate text-xs text-muted-foreground">Sesión</span>
                  <span className="block truncate text-sm font-medium">{user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer gap-2 text-red-600 focus:text-red-600">
                  <LogOut className="h-4 w-4" />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main
          className={cn(
            'mx-auto min-h-0 w-full max-w-[1500px] flex-1 overscroll-contain sm:px-5 sm:pt-4 lg:px-6 lg:pb-4 xl:px-8',
            isCalificarRoute
              ? 'flex flex-col px-0 pt-0 pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] lg:px-6 lg:pt-4 lg:pb-4'
              : 'px-4 pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-5',
            dashboardHome
              ? 'flex flex-col max-sm:overflow-y-auto max-sm:app-scroll sm:overflow-hidden'
              : 'app-scroll overflow-y-auto'
          )}
        >
          {children}
        </main>

        {/* Móvil: barra inferior tipo app */}
        <nav
          className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur-md lg:hidden"
          style={{ paddingBottom: 'max(0.35rem, env(safe-area-inset-bottom, 0px))' }}
          aria-label="Navegación principal"
        >
          <div className="mx-auto flex max-w-lg items-stretch justify-around px-1 pt-1">
            {navItems.map((item) => {
              const active = navActive(pathname, item.href);
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => router.push(item.href)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-12 min-w-0 flex-1 cursor-pointer touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg border-0 bg-transparent py-1.5 text-[11px] font-medium leading-tight transition-colors',
                    active ? 'text-orange-600' : 'text-gray-500 active:bg-gray-50'
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.5 : 2} />
                  <span className="max-w-full truncate px-0.5 text-center">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
