'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
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
  const dashboardHome = pathname === '/dashboard';

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast.error('Error al cerrar sesión');
    } else {
      toast.success('Sesión cerrada');
      router.push('/login');
    }
  };

  if (loading) {
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

  return (
    <div className="h-full min-h-0 overflow-hidden bg-orange-50/25 backdrop-blur-[1px]">
      {/* Escritorio: barra lateral */}
      <aside className="fixed left-0 top-0 z-50 hidden h-full max-h-[100dvh] w-64 flex-col overflow-y-auto border-r border-gray-200 bg-white lg:flex app-scroll">
        <div className="flex h-full min-h-0 flex-col">
          <div className="border-b border-gray-200 px-4 py-5 sm:px-5">
            <BrandWordmark
              href="/dashboard"
              priority
              className="w-full"
              imgClassName="h-16 w-auto max-w-full object-contain object-left sm:h-[4.75rem] lg:h-[5.25rem]"
            />
          </div>
          <nav className="flex-1 space-y-1 p-4" aria-label="Navegación principal">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-4 py-3 font-medium text-gray-700 transition-colors hover:bg-orange-50 hover:text-orange-600',
                  navActive(pathname, item.href) && 'bg-orange-50 text-orange-600'
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span>{item.label === 'Inicio' ? 'Dashboard' : item.label}</span>
              </Link>
            ))}
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
        <header className="z-30 shrink-0 border-b border-gray-200 bg-white/95 backdrop-blur-sm lg:hidden">
          <div
            className="flex items-center justify-between gap-2 px-3 py-2"
            style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
          >
            <BrandWordmark
              href="/dashboard"
              priority
              imgClassName="h-12 w-auto max-w-[min(58vw,14rem)] object-contain sm:h-[3.25rem]"
            />
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
            'min-h-0 flex-1 overscroll-contain px-3 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-4 sm:pt-4 lg:pb-4',
            dashboardHome ? 'flex flex-col overflow-hidden' : 'app-scroll overflow-y-auto'
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
          <div className="mx-auto flex max-w-lg items-stretch justify-around pt-1">
            {navItems.map((item) => {
              const active = navActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg py-2 text-[11px] font-medium leading-tight transition-colors',
                    active ? 'text-orange-600' : 'text-gray-500 active:bg-gray-50'
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.5 : 2} />
                  <span className="truncate px-0.5">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
