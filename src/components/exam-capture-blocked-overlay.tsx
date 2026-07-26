'use client';

import { createPortal } from 'react-dom';
import { CameraOff } from 'lucide-react';
import { BrandWordmark } from '@/components/brand-wordmark';

export type ExamProtectionOverlayVariant = 'screenshot' | 'tab_hidden';

type Props = {
  variant: ExamProtectionOverlayVariant;
};

const COPY: Record<
  ExamProtectionOverlayVariant,
  { title: string; body: string }
> = {
  screenshot: {
    title: 'Captura de pantalla bloqueada',
    body: 'Parece que intentaste hacer una captura, grabación o compartir pantalla. Por seguridad del examen, esta acción no está permitida y el intento será anulado.',
  },
  tab_hidden: {
    title: 'Contenido protegido',
    body: 'Saliste de la aplicación del examen. Vuelve de inmediato o el intento quedará anulado.',
  },
};

export function ExamCaptureBlockedOverlay({ variant }: Props) {
  if (typeof document === 'undefined') return null;

  const { title, body } = COPY[variant];

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] flex flex-col items-center justify-center bg-black px-8 text-center"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="exam-protection-title"
      aria-describedby="exam-protection-body"
    >
      <div className="mb-10 flex h-24 w-24 items-center justify-center rounded-full bg-[#25D366]/10">
        <CameraOff className="h-14 w-14 text-[#25D366]" strokeWidth={1.5} />
      </div>

      <h2 id="exam-protection-title" className="mb-4 text-2xl font-semibold text-white">
        {title}
      </h2>
      <p id="exam-protection-body" className="max-w-md text-base leading-relaxed text-gray-400">
        {body}
      </p>

      <div className="mt-14 opacity-90">
        <BrandWordmark href={false} imgClassName="h-9 w-auto" />
      </div>
    </div>,
    document.body
  );
}
