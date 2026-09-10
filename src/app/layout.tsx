import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from 'sonner';
import { ThemeProvider } from '@/components/theme-provider';
import { MathWallpaper } from '@/components/math-wallpaper';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'CaliFácil - I.T.H.',
  description: 'Crea exámenes personalizados con IA, aplícalos mediante QR y analiza el rendimiento de tus alumnos.',
  applicationName: 'CaliFácil',
  icons: {
    icon: [
      { url: '/favicon.png', sizes: '48x48', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CaliFácil',
  },
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
          <div className="exam-layout-chrome flex h-full min-h-0 flex-col overflow-hidden">
            <MathWallpaper />
            <div className="relative z-[1] isolate flex min-h-0 flex-1 flex-col overflow-hidden">
              {children}
            </div>
            <Toaster
              position="top-right"
              className="z-[200]"
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
