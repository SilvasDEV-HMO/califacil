import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { MathWallpaper } from '@/components/math-wallpaper';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'CaliFácil - SEC Sonora',
  description: 'Crea exámenes personalizados con IA, aplícalos mediante QR y analiza el rendimiento de tus alumnos.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#fff7ed',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="h-[100dvh] overflow-hidden" suppressHydrationWarning>
      <body className={`${inter.className} h-[100dvh] max-h-[100dvh] overflow-hidden antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <MathWallpaper />
            <div className="relative z-[1] isolate flex min-h-0 flex-1 flex-col overflow-hidden">
              {children}
            </div>
            <Toaster
              position="top-right"
              offset={{ top: '0.5rem', right: '0.75rem' }}
              mobileOffset={{
                top: 'max(0.5rem, env(safe-area-inset-top, 0px))',
                right: 'max(0.75rem, env(safe-area-inset-right, 0px))',
              }}
              richColors
            />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
