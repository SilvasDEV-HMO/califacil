import Link from 'next/link';
import { BrandWordmark } from '@/components/brand-wordmark';
import { Button } from '@/components/ui/button';
import { QrCode, Sparkles, BarChart3, ArrowRight, Copyright } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
      <header className="shrink-0 border-b border-orange-200/50 bg-white/75 backdrop-blur-md">
        <div className="mx-auto flex min-h-[4rem] max-w-7xl items-center justify-between gap-3 px-4 py-2 sm:min-h-[4.5rem] sm:px-6 lg:min-h-[5rem] lg:px-10">
          <BrandWordmark
            priority
            className="shrink-0"
            imgClassName="h-12 w-auto max-w-[min(100%,22rem)] object-contain object-left sm:h-14 sm:max-w-[26rem] lg:h-16 lg:max-w-[30rem]"
          />
          <nav className="flex items-center gap-1 sm:gap-3">
            <Button variant="ghost" size="sm" asChild className="text-gray-700 sm:size-default">
              <Link href="/login">Iniciar sesión</Link>
            </Button>
            <Button size="sm" className="sm:size-default" asChild>
              <Link href="/register">Crear cuenta</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <section className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col justify-center overflow-hidden px-4 py-3 sm:px-6 sm:py-4 lg:px-10 lg:py-5">
          {/* Sin scroll: contenido fijo en el alto de la ventana */}
          <div className="shrink-0">
            <div className="mx-auto w-full max-w-3xl pb-4 text-center sm:pb-5 lg:max-w-4xl lg:pb-6">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-orange-600 sm:mb-4 sm:text-sm lg:text-base">
                Plataforma para Docentes
              </p>
              <h1 className="text-balance text-2xl font-bold tracking-tight text-gray-900 sm:text-4xl lg:text-5xl xl:text-[2.75rem] xl:leading-tight">
                Crea tus exámenes, imprime y califica TODO el mismo dia.
              </h1>
              <p className="mx-auto mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-gray-600 sm:mt-5 sm:text-base lg:mt-6 lg:text-lg">
                Crea evaluaciones personalizadas, compártelas con tus grupos y revisa
                resultados en un solo lugar. Sin complicaciones.
              </p>
              <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:mt-6 sm:flex-row sm:gap-3 lg:mt-8">
                <Button
                  size="default"
                  className="w-full min-w-[200px] sm:w-auto lg:h-12 lg:px-8 lg:text-base"
                  asChild
                >
                  <Link href="/register">
                    Registrate gratis
                    <ArrowRight className="ml-2 h-4 w-4 lg:h-5 lg:w-5" />
                  </Link>
                </Button>
                <Button
                  size="default"
                  variant="outline"
                  className="w-full min-w-[200px] border-orange-200 bg-white/80 sm:w-auto lg:h-12 lg:px-8 lg:text-base"
                  asChild
                >
                  <Link href="/login">Ya tengo cuenta</Link>
                </Button>
              </div>
            </div>
          </div>

          <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-3 lg:max-w-none lg:gap-4">
            <div className="flex flex-col rounded-xl border border-orange-100/80 bg-white/80 p-3.5 shadow-sm backdrop-blur-md sm:min-h-[132px] lg:p-4">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-orange-100 text-orange-700 lg:h-9 lg:w-9">
                <Sparkles className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold text-gray-900 lg:text-base">
                Preguntas con IA
              </h2>
              <p className="mt-1.5 text-xs leading-snug text-gray-600 lg:text-sm">
                Genera reactivos a partir de temas y tipos de pregunta que elijas.
              </p>
            </div>
            <div className="flex flex-col rounded-xl border border-orange-100/80 bg-white/80 p-3.5 shadow-sm backdrop-blur-md sm:min-h-[132px] lg:p-4">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-amber-100 text-amber-800 lg:h-9 lg:w-9">
                <QrCode className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold text-gray-900 lg:text-base">
                Acceso por QR
              </h2>
              <p className="mt-1.5 text-xs leading-snug text-gray-600 lg:text-sm">
                Publica el examen y que los alumnos entren desde el móvil. O imprímelo y
                aplícalo en el aula.
              </p>
            </div>
            <div className="flex flex-col rounded-xl border border-orange-100/80 bg-white/80 p-3.5 shadow-sm backdrop-blur-md sm:min-h-[132px] lg:p-4">
              <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-orange-200/70 text-orange-800 lg:h-9 lg:w-9">
                <BarChart3 className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold text-gray-900 lg:text-base">
                Resultados claros
              </h2>
              <p className="mt-1.5 text-xs leading-snug text-gray-600 lg:text-sm">
                Visualiza el desempeño por examen y por grupo, el mismo día y cuando sea
                necesario.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="shrink-0 border-t border-orange-100/80 bg-white/70 px-4 py-2.5 text-center text-gray-600 backdrop-blur-md sm:py-3 lg:px-10">
        <div className="flex justify-center">
          <BrandWordmark
            href={false}
            className="justify-center"
            imgClassName="mx-auto h-10 w-auto max-w-[min(100%,18rem)] object-contain sm:h-11 sm:max-w-[22rem] lg:h-12 lg:max-w-[24rem]"
          />
        </div>
        <p className="mt-1 text-[11px] leading-snug text-gray-600 sm:text-xs sm:leading-relaxed">
          Herramienta creada por{' '}
          <Link
            href="https://silvasdev.vercel.app/"
            className="font-medium text-orange-600 hover:text-orange-700 hover:underline"
          >
            Silvas Dev
          </Link>
          <br />
          para la Secretaria de Educación y Cultura en Sonora
        </p>
        <p className="mt-1 flex items-center justify-center gap-1 text-[11px] text-gray-500 sm:text-xs">
          <span>Todos los derechos reservados 2026.</span>
          <Copyright className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" aria-hidden />
        </p>
      </footer>
    </div>
  );
}
