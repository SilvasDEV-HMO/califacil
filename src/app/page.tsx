import Link from 'next/link';
import { BrandWordmark } from '@/components/brand-wordmark';
import { Button } from '@/components/ui/button';
import { QrCode, Sparkles, BarChart3, ArrowRight, Copyright } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col overflow-y-auto bg-transparent app-scroll">
      <header className="shrink-0 border-b border-orange-200/50 bg-white/75 backdrop-blur-md">
        <div className="mx-auto flex min-h-[4rem] max-w-7xl items-center justify-between gap-2 px-3 py-1.5 sm:min-h-[4.5rem] sm:gap-3 sm:px-6 sm:py-2 lg:min-h-[5rem] lg:px-10">
          <BrandWordmark
            priority
            className="min-w-0 shrink lg:origin-left lg:scale-[1.12]"
            imgClassName="h-[2.85rem] w-auto max-w-[min(100%,20rem)] object-contain object-left sm:h-[3.35rem] sm:max-w-[26rem] lg:h-16 lg:max-w-[32rem]"
          />
          <nav className="flex shrink-0 items-center gap-0.5 sm:gap-3">
            <Button variant="ghost" size="sm" asChild className="h-8 px-2 text-xs text-gray-700 sm:h-9 sm:px-3 sm:text-sm">
              <Link href="/login">Iniciar sesión</Link>
            </Button>
            <Button size="sm" className="h-8 px-2.5 text-xs sm:h-9 sm:px-4 sm:text-sm" asChild>
              <Link href="/register">Crear cuenta</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <section className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col justify-between gap-[clamp(0.45rem,1.3vh,0.9rem)] px-3 pb-[clamp(0.45rem,1.2vh,0.9rem)] pt-[clamp(0.45rem,1.2vh,0.9rem)] sm:gap-4 sm:px-6 sm:py-4 lg:justify-center lg:px-10 lg:py-5">
          <div className="shrink-0">
            <div className="mx-auto w-full max-w-[min(100%,35rem)] text-center sm:max-w-3xl lg:max-w-4xl">
              <p className="mb-[clamp(0.1rem,0.5vh,0.55rem)] text-[clamp(0.62rem,1.45vh,0.9rem)] font-medium uppercase tracking-wide text-orange-600 sm:mb-3 sm:text-sm lg:text-base">
                Plataforma para Docentes
              </p>
              <h1 className="text-balance text-[clamp(1.35rem,5.7vw,2.4rem)] font-bold leading-[1.1] tracking-tight text-gray-900 sm:text-4xl lg:text-5xl xl:text-[2.75rem] xl:leading-tight">
                Crea tus exámenes, imprime y califica TODO el mismo día.
              </h1>
              <p className="mx-auto mt-[clamp(0.25rem,0.9vh,0.8rem)] max-w-2xl text-pretty text-[clamp(0.7rem,1.65vh,1.06rem)] leading-[1.32] text-gray-600 sm:mt-5 sm:text-base sm:leading-relaxed lg:mt-6 lg:text-lg">
                Crea evaluaciones personalizadas, compártelas con tus grupos y revisa resultados en un
                solo lugar. Sin complicaciones.
              </p>
              <div className="mt-[clamp(0.45rem,1.1vh,1rem)] flex flex-col items-stretch justify-center gap-[clamp(0.35rem,0.9vh,0.7rem)] sm:mt-6 sm:flex-row sm:items-center sm:gap-3 lg:mt-8">
                <Button
                  size="sm"
                  className="h-[clamp(2.45rem,5.2vh,3.2rem)] w-full min-w-0 text-[clamp(1rem,2.3vh,1.2rem)] sm:h-10 sm:min-w-[200px] sm:w-auto sm:text-sm lg:h-12 lg:px-8 lg:text-base"
                  asChild
                >
                  <Link href="/register">
                    Regístrate gratis
                    <ArrowRight className="ml-2 h-3.5 w-3.5 sm:h-4 sm:w-4 lg:h-5 lg:w-5" />
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-[clamp(2.35rem,5vh,3.15rem)] w-full min-w-0 border-orange-200 bg-white/80 text-[clamp(0.98rem,2.15vh,1.18rem)] sm:h-10 sm:min-w-[200px] sm:w-auto sm:text-sm lg:h-12 lg:px-8 lg:text-base"
                  asChild
                >
                  <Link href="/login">Ya tengo cuenta</Link>
                </Button>
              </div>
            </div>
          </div>

          <div className="mx-auto grid w-full max-w-[min(100%,36rem)] grid-cols-1 gap-[clamp(0.45rem,1.1vh,0.8rem)] sm:max-w-4xl sm:grid-cols-3 sm:gap-3 lg:max-w-none lg:gap-4">
            <div className="flex flex-row items-start gap-2.5 rounded-lg border border-orange-100/80 bg-white/80 p-[clamp(0.6rem,1.65vh,1rem)] shadow-sm backdrop-blur-md sm:flex-col sm:rounded-xl sm:p-3.5 lg:p-4">
              <div className="flex h-[clamp(1.7rem,4vh,2.35rem)] w-[clamp(1.7rem,4vh,2.35rem)] shrink-0 items-center justify-center rounded-md bg-orange-100 text-orange-700 sm:mb-2 sm:h-8 sm:w-8 lg:h-9 lg:w-9">
                <Sparkles className="h-[clamp(0.85rem,1.9vh,1.2rem)] w-[clamp(0.85rem,1.9vh,1.2rem)] sm:h-4 sm:w-4" />
              </div>
              <div className="min-w-0 text-left sm:text-left">
                <h2 className="text-[clamp(0.78rem,1.9vh,1.05rem)] font-semibold text-gray-900 sm:text-sm lg:text-base">
                  Preguntas con IA
                </h2>
                <p className="mt-[clamp(0.1rem,0.45vh,0.35rem)] text-[clamp(0.68rem,1.55vh,0.9rem)] leading-snug text-gray-600 sm:mt-1.5 sm:text-xs lg:text-sm">
                  Genera reactivos a partir de temas y tipos de pregunta que elijas.
                </p>
              </div>
            </div>
            <div className="flex flex-row items-start gap-2.5 rounded-lg border border-orange-100/80 bg-white/80 p-[clamp(0.6rem,1.65vh,1rem)] shadow-sm backdrop-blur-md sm:flex-col sm:rounded-xl sm:p-3.5 lg:p-4">
              <div className="flex h-[clamp(1.7rem,4vh,2.35rem)] w-[clamp(1.7rem,4vh,2.35rem)] shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-800 sm:mb-2 sm:h-8 sm:w-8 lg:h-9 lg:w-9">
                <QrCode className="h-[clamp(0.85rem,1.9vh,1.2rem)] w-[clamp(0.85rem,1.9vh,1.2rem)] sm:h-4 sm:w-4" />
              </div>
              <div className="min-w-0 text-left sm:text-left">
                <h2 className="text-[clamp(0.78rem,1.9vh,1.05rem)] font-semibold text-gray-900 sm:text-sm lg:text-base">Acceso por QR</h2>
                <p className="mt-[clamp(0.1rem,0.45vh,0.35rem)] text-[clamp(0.68rem,1.55vh,0.9rem)] leading-snug text-gray-600 sm:mt-1.5 sm:text-xs lg:text-sm">
                  Publica el examen y que los alumnos entren desde el móvil. O imprímelo y aplícalo en el
                  aula.
                </p>
              </div>
            </div>
            <div className="flex flex-row items-start gap-2.5 rounded-lg border border-orange-100/80 bg-white/80 p-[clamp(0.6rem,1.65vh,1rem)] shadow-sm backdrop-blur-md sm:flex-col sm:rounded-xl sm:p-3.5 lg:p-4">
              <div className="flex h-[clamp(1.7rem,4vh,2.35rem)] w-[clamp(1.7rem,4vh,2.35rem)] shrink-0 items-center justify-center rounded-md bg-orange-200/70 text-orange-800 sm:mb-2 sm:h-8 sm:w-8 lg:h-9 lg:w-9">
                <BarChart3 className="h-[clamp(0.85rem,1.9vh,1.2rem)] w-[clamp(0.85rem,1.9vh,1.2rem)] sm:h-4 sm:w-4" />
              </div>
              <div className="min-w-0 text-left sm:text-left">
                <h2 className="text-[clamp(0.78rem,1.9vh,1.05rem)] font-semibold text-gray-900 sm:text-sm lg:text-base">
                  Resultados claros
                </h2>
                <p className="mt-[clamp(0.1rem,0.45vh,0.35rem)] text-[clamp(0.68rem,1.55vh,0.9rem)] leading-snug text-gray-600 sm:mt-1.5 sm:text-xs lg:text-sm">
                  Visualiza el desempeño por examen y por grupo, el mismo día y cuando sea necesario.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="shrink-0 border-t border-orange-100/80 bg-white/70 px-3 py-1.5 text-center text-gray-600 backdrop-blur-md sm:py-2.5 lg:px-10">
        <div className="flex justify-center">
          <BrandWordmark
            href={false}
            className="justify-center"
            imgClassName="mx-auto h-8 w-auto max-w-[min(100%,16rem)] object-contain sm:h-11 sm:max-w-[22rem] lg:h-12 lg:max-w-[24rem]"
          />
        </div>
        <p className="mt-0.5 text-[9px] leading-tight text-gray-600 sm:mt-1 sm:text-xs sm:leading-relaxed">
          Herramienta creada por{' '}
          <Link
            href="https://silvasdev.vercel.app/"
            className="font-medium text-orange-600 hover:text-orange-700 hover:underline"
          >
            Silvas Dev
          </Link>{' '}
          para la Secretaría de Educación y Cultura en Sonora
        </p>
        <p className="mt-0.5 flex items-center justify-center gap-1 text-[9px] text-gray-500 sm:mt-1 sm:text-xs">
          <span>Todos los derechos reservados 2026.</span>
          <Copyright className="h-3 w-3 shrink-0 sm:h-4 sm:w-4" aria-hidden />
        </p>
      </footer>
    </div>
  );
}
