'use client';

import Image from 'next/image';

type ExamMiniPreviewProps = {
  title: string;
};

/**
 * Miniatura visual tipo hoja de examen (sin capturar DOM ni llamadas extra a BD).
 */
export function ExamMiniPreview({ title }: ExamMiniPreviewProps) {
  return (
    <div className="pointer-events-none relative mx-auto w-full max-w-[280px] select-none overflow-hidden rounded-md border border-gray-200 bg-white shadow-inner">
      <div
        className="flex items-center gap-1.5 border-b border-gray-800 bg-gray-50/90 px-1.5 py-1"
        aria-hidden
      >
        <Image
          src="/ith-wordmark.png"
          alt="I.T.H."
          width={120}
          height={32}
          className="h-5 w-auto max-w-[55%] object-contain object-left"
        />
        <span className="ml-auto text-[6px] font-medium uppercase tracking-wide text-gray-500">
          Carta
        </span>
      </div>
      <div className="px-2 pb-2 pt-1.5">
        <p className="line-clamp-2 text-center text-[8px] font-bold leading-snug text-gray-900">
          {title}
        </p>
        <div className="mt-1.5 space-y-1">
          <div className="flex gap-1 text-[6px] text-gray-600">
            <span className="font-serif font-semibold">1.</span>
            <span className="line-clamp-1 flex-1 border-b border-dotted border-gray-300 pb-px">
              &nbsp;
            </span>
          </div>
          <div className="h-0.5 rounded-full bg-gray-200" />
          <div className="h-0.5 rounded-full bg-gray-200" />
          <div className="h-0.5 rounded-full bg-gray-200" />
        </div>
      </div>
    </div>
  );
}
