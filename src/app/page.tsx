import Link from 'next/link';
import { BrandWordmark } from '@/components/brand-wordmark';
import { Button } from '@/components/ui/button';
import { QrCode, Sparkles, BarChart3, ArrowRight, Copyright } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <header className="shrink-0 border-b border-orange-200/50 bg-white/75 backdrop-blur-md">
        <div
          className="mx-auto flex w-full max-w-5xl items-center justify-between gap-2 px-3 pb-1.5 sm:px-6 sm:pb-2.5 lg:px-8"
          style={{ paddingTop: 'max(0.35rem, env(safe-area-inset-top, 0px))' }}
        >
          <BrandWordmark
            priority
            className="min-w-0 shrink"
            imgClassName="h-[clamp(1.5rem,4.2vh,2.75rem)] w-auto max-w-[min(100%,11rem)] object-contain object-left sm:h-11 sm:max-w-[22rem] lg:h-12 lg:max-w-[26rem]"
          />
          <nav className="flex shrink-0 items-center gap-1 sm:gap-2.5">
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-8 px-2 text-xs text-gray-700 sm:h-10 sm:px-3 sm:text-base"
            >
              <Link href="/login">Iniciar sesión</Link>
            </Button>
            <Button
              size="sm"
              className="h-8 px-2.5 text-xs sm:h-10 sm:px-4 sm:text-base"
              asChild
            >
              <Link href="/register">Crear cuenta</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/*
          Grid 1fr / auto / 1fr / auto / 1fr: reparte el aire sobrante
          por igual arriba, entre hero y cards, y abajo (sin scroll).
        */}
        <section className="mx-auto grid h-full min-h-0 w-full max-w-5xl grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] px-3 sm:px-6 lg:px-8">
          <div className="min-h-0" aria-hidden />

          <div className="flex w-full max-w-3xl shrink-0 flex-col items-center justify-self-center text-center">
            <p className="text-[clamp(0.65rem,1.6vh,1rem)] font-semibold uppercase tracking-[0.14em] text-orange-600 sm:text-sm lg:text-base">
              Plataforma para Docentes
            </p>
            <h1 className="mt-[clamp(0.35rem,1.1vh,0.75rem)] max-w-[22ch] text-balance text-[clamp(1.25rem,calc(2.2vh+1.6vw),3.1rem)] font-bold leading-[1.12] tracking-tight text-gray-900 sm:mt-3 sm:max-w-none">
              Crea tus exámenes, imprime y califica TODO el mismo día.
            </h1>
            <p className="mx-auto mt-[clamp(0.4rem,1.2vh,0.85rem)] max-w-xl text-pretty text-[clamp(0.8rem,calc(1.4vh+0.35vw),1.3rem)] leading-snug text-gray-600 sm:mt-3.5 sm:leading-relaxed">
              Crea evaluaciones personalizadas, compártelas con tus grupos y revisa resultados en un solo
              lugar. Sin complicaciones.
            </p>

            <div className="mt-[clamp(0.65rem,2vh,1.5rem)] flex w-full max-w-md flex-row items-stretch justify-center gap-2 sm:mt-6 sm:max-w-none sm:gap-3">
              <Button
                size="sm"
                className="h-[clamp(2.25rem,5vh,3.5rem)] min-w-0 flex-1 text-[clamp(0.8rem,1.4vh,1.125rem)] font-semibold sm:h-12 sm:flex-none sm:min-w-[12rem] sm:px-6 sm:text-base lg:h-14 lg:min-w-[13rem] lg:text-lg"
                asChild
              >
                <Link href="/register">
                  Regístrate gratis
                  <ArrowRight className="ml-1 h-3.5 w-3.5 sm:ml-1.5 sm:h-4 sm:w-4 lg:h-5 lg:w-5" />
                </Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-[clamp(2.25rem,5vh,3.5rem)] min-w-0 flex-1 border-orange-200 bg-white/85 text-[clamp(0.8rem,1.4vh,1.125rem)] font-semibold sm:h-12 sm:flex-none sm:min-w-[12rem] sm:px-6 sm:text-base lg:h-14 lg:min-w-[13rem] lg:text-lg"
                asChild
              >
                <Link href="/login">Ya tengo cuenta</Link>
              </Button>
            </div>
          </div>

          <div className="min-h-0" aria-hidden />

          <div className="mx-auto grid w-full max-w-4xl shrink-0 grid-cols-3 gap-1.5 self-center sm:gap-3.5 lg:gap-4">
            <article className="flex min-w-0 flex-col items-start rounded-lg border border-orange-100/80 bg-white/90 px-2 py-2 text-left shadow-sm backdrop-blur-md sm:rounded-xl sm:px-4 sm:py-5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-orange-100 text-orange-700 sm:h-10 sm:w-10 sm:rounded-lg">
                <Sparkles className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
              </div>
              <h2 className="mt-1.5 text-[clamp(0.7rem,1.4vh,1.05rem)] font-semibold leading-tight text-gray-900 sm:mt-3 sm:text-[1.05rem]">
                Preguntas con IA
              </h2>
              <p className="mt-1 text-[clamp(0.62rem,1.2vh,0.9rem)] leading-snug text-gray-600 sm:mt-1.5 sm:leading-relaxed">
                Genera reactivos a partir de temas y tipos de pregunta que elijas.
              </p>
            </article>
            <article className="flex min-w-0 flex-col items-start rounded-lg border border-orange-100/80 bg-white/90 px-2 py-2 text-left shadow-sm backdrop-blur-md sm:rounded-xl sm:px-4 sm:py-5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-800 sm:h-10 sm:w-10 sm:rounded-lg">
                <QrCode className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
              </div>
              <h2 className="mt-1.5 text-[clamp(0.7rem,1.4vh,1.05rem)] font-semibold leading-tight text-gray-900 sm:mt-3 sm:text-[1.05rem]">
                Acceso por QR
              </h2>
              <p className="mt-1 text-[clamp(0.62rem,1.2vh,0.9rem)] leading-snug text-gray-600 sm:mt-1.5 sm:leading-relaxed">
                Publica el examen y que los alumnos entren desde el móvil. O imprímelo y aplícalo en el
                aula.
              </p>
            </article>
            <article className="flex min-w-0 flex-col items-start rounded-lg border border-orange-100/80 bg-white/90 px-2 py-2 text-left shadow-sm backdrop-blur-md sm:rounded-xl sm:px-4 sm:py-5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-orange-200/70 text-orange-800 sm:h-10 sm:w-10 sm:rounded-lg">
                <BarChart3 className="h-3.5 w-3.5 sm:h-5 sm:w-5" />
              </div>
              <h2 className="mt-1.5 text-[clamp(0.7rem,1.4vh,1.05rem)] font-semibold leading-tight text-gray-900 sm:mt-3 sm:text-[1.05rem]">
                Resultados claros
              </h2>
              <p className="mt-1 text-[clamp(0.62rem,1.2vh,0.9rem)] leading-snug text-gray-600 sm:mt-1.5 sm:leading-relaxed">
                Visualiza el desempeño por examen y por grupo, el mismo día y cuando sea necesario.
              </p>
            </article>
          </div>

          <div className="min-h-0" aria-hidden />
        </section>
      </main>

      <footer className="shrink-0 border-t border-orange-100/80 bg-white/70 px-3 pt-1.5 pb-[max(0.4rem,env(safe-area-inset-bottom,0px))] text-center text-gray-600 backdrop-blur-md sm:px-6 sm:pt-3 sm:pb-5 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center">
          <BrandWordmark
            href={false}
            className="justify-center"
            imgClassName="mx-auto h-[clamp(1.1rem,3vh,2.25rem)] w-auto max-w-[min(100%,10rem)] object-contain sm:h-9 sm:max-w-[18rem]"
          />
          <p className="mt-0.5 text-[clamp(0.6rem,1.2vh,0.875rem)] leading-snug text-gray-600 sm:mt-1.5 sm:text-sm">
            Herramienta creada por{' '}
            <Link
              href="https://silvasdev.vercel.app/"
              className="font-medium text-orange-600 hover:text-orange-700 hover:underline"
            >
              Silvas Dev
            </Link>
            .
          </p>
          <p className="mt-0 flex items-center justify-center gap-1 text-[clamp(0.6rem,1.2vh,0.875rem)] text-gray-500 sm:text-sm">
            <span>Todos los derechos reservados 2026.</span>
            <Copyright className="h-3 w-3 shrink-0 sm:h-4 sm:w-4" aria-hidden />
          </p>
        </div>
      </footer>
    </div>
  );
}
