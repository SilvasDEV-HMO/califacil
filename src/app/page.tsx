import Link from 'next/link';
import { BrandWordmark } from '@/components/brand-wordmark';
import { Button } from '@/components/ui/button';
import { QrCode, Sparkles, BarChart3, ArrowRight, Copyright } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <header className="shrink-0 border-b border-orange-200/50 bg-white/75 backdrop-blur-md">
        <div
          className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-4 pb-2 sm:px-6 sm:pb-2.5 lg:px-8"
          style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}
        >
          <BrandWordmark
            priority
            className="min-w-0 shrink"
            imgClassName="h-8 w-auto max-w-[min(100%,14rem)] object-contain object-left sm:h-11 sm:max-w-[22rem] lg:h-12 lg:max-w-[26rem]"
          />
          <nav className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-8 px-2 text-xs text-gray-700 sm:h-9 sm:px-3 sm:text-sm"
            >
              <Link href="/login">Iniciar sesión</Link>
            </Button>
            <Button size="sm" className="h-8 px-2.5 text-xs sm:h-9 sm:px-4 sm:text-sm" asChild>
              <Link href="/register">Crear cuenta</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto app-scroll">
        <section className="mx-auto grid h-full min-h-full w-full max-w-5xl grid-rows-[auto_1fr_auto_1fr] px-4 pt-5 sm:px-6 sm:pt-7 lg:px-8 lg:pt-8">
          <div className="flex w-full max-w-3xl flex-col items-center justify-self-center text-center">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-orange-600 sm:text-xs lg:text-sm">
              Plataforma para Docentes
            </p>
            <h1 className="mt-2 max-w-[22ch] text-balance text-[clamp(1.55rem,5.2vw,2.75rem)] font-bold leading-[1.12] tracking-tight text-gray-900 sm:mt-2.5 sm:max-w-none">
              Crea tus exámenes, imprime y califica TODO el mismo día.
            </h1>
            <p className="mx-auto mt-2.5 max-w-xl text-pretty text-[clamp(0.95rem,2vw,1.15rem)] leading-relaxed text-gray-600 sm:mt-3">
              Crea evaluaciones personalizadas, compártelas con tus grupos y revisa resultados en un solo
              lugar. Sin complicaciones.
            </p>

            <div className="mt-4 flex w-full max-w-md flex-col items-stretch gap-2.5 sm:mt-5 sm:max-w-none sm:flex-row sm:items-center sm:justify-center sm:gap-3">
              <Button
                size="sm"
                className="h-11 w-full text-sm font-semibold sm:h-11 sm:w-auto sm:min-w-[11.5rem] sm:px-6 lg:h-12 lg:min-w-[12.5rem] lg:text-base"
                asChild
              >
                <Link href="/register">
                  Regístrate gratis
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-11 w-full border-orange-200 bg-white/85 text-sm font-semibold sm:h-11 sm:w-auto sm:min-w-[11.5rem] sm:px-6 lg:h-12 lg:min-w-[12.5rem] lg:text-base"
                asChild
              >
                <Link href="/login">Ya tengo cuenta</Link>
              </Button>
            </div>
          </div>

          <div className="min-h-0" aria-hidden />

          <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-3 self-center sm:grid-cols-3 sm:gap-3.5 lg:gap-4">
            <article className="flex flex-col items-start rounded-xl border border-orange-100/80 bg-white/90 px-4 py-4 text-left shadow-sm backdrop-blur-md sm:px-4 sm:py-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
                <Sparkles className="h-4 w-4" />
              </div>
              <h2 className="mt-3 text-sm font-semibold text-gray-900 sm:text-[0.95rem]">
                Preguntas con IA
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600 sm:text-[0.8rem]">
                Genera reactivos a partir de temas y tipos de pregunta que elijas.
              </p>
            </article>
            <article className="flex flex-col items-start rounded-xl border border-orange-100/80 bg-white/90 px-4 py-4 text-left shadow-sm backdrop-blur-md sm:px-4 sm:py-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                <QrCode className="h-4 w-4" />
              </div>
              <h2 className="mt-3 text-sm font-semibold text-gray-900 sm:text-[0.95rem]">
                Acceso por QR
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600 sm:text-[0.8rem]">
                Publica el examen y que los alumnos entren desde el móvil. O imprímelo y aplícalo en el
                aula.
              </p>
            </article>
            <article className="flex flex-col items-start rounded-xl border border-orange-100/80 bg-white/90 px-4 py-4 text-left shadow-sm backdrop-blur-md sm:px-4 sm:py-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-200/70 text-orange-800">
                <BarChart3 className="h-4 w-4" />
              </div>
              <h2 className="mt-3 text-sm font-semibold text-gray-900 sm:text-[0.95rem]">
                Resultados claros
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-gray-600 sm:text-[0.8rem]">
                Visualiza el desempeño por examen y por grupo, el mismo día y cuando sea necesario.
              </p>
            </article>
          </div>

          <div className="min-h-0" aria-hidden />
        </section>
      </main>

      <footer className="shrink-0 border-t border-orange-100/80 bg-white/70 px-4 pt-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] text-center text-gray-600 backdrop-blur-md sm:px-6 sm:pt-3 sm:pb-5 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center">
          <BrandWordmark
            href={false}
            className="justify-center"
            imgClassName="mx-auto h-6 w-auto max-w-[min(100%,12rem)] object-contain sm:h-9 sm:max-w-[18rem]"
          />
          <p className="mt-1 text-[0.65rem] leading-snug text-gray-600 sm:mt-1.5 sm:text-xs">
            Herramienta creada por{' '}
            <Link
              href="https://silvasdev.vercel.app/"
              className="font-medium text-orange-600 hover:text-orange-700 hover:underline"
            >
              Silvas Dev
            </Link>
            .
          </p>
          <p className="mt-0.5 flex items-center justify-center gap-1 text-[0.65rem] text-gray-500 sm:text-xs">
            <span>Todos los derechos reservados 2026.</span>
            <Copyright className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" aria-hidden />
          </p>
        </div>
      </footer>
    </div>
  );
}
