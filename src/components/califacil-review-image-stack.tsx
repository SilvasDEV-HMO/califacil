'use client';

import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils';

type GeometrySize = {
  imageWidth: number;
  imageHeight: number;
};

type Props = {
  previewUrl: string;
  alt: string;
  geometry: GeometrySize;
  children?: ReactNode;
  /** Alto máximo del recuadro (p. ej. 24rem, min(42dvh, 22rem)). */
  maxHeight?: string;
  className?: string;
  frameClassName?: string;
  frameRef?: Ref<HTMLDivElement>;
  frameProps?: HTMLAttributes<HTMLDivElement>;
};

/**
 * Foto + overlay en la misma caja (aspecto = geometría).
 * Img y SVG llenan el recuadro; no usar object-contain aparte.
 */
export function CalifacilReviewImageStack({
  previewUrl,
  alt,
  geometry,
  children,
  maxHeight = '24rem',
  className,
  frameClassName,
  frameRef,
  frameProps,
}: Props) {
  const W = Math.max(1, geometry.imageWidth);
  const H = Math.max(1, geometry.imageHeight);
  return (
    <div className={cn('flex w-full items-center justify-center', className)}>
      <div
        ref={frameRef}
        {...frameProps}
        className={cn('relative overflow-hidden bg-neutral-200/50', frameClassName, frameProps?.className)}
        style={{
          width: `min(100%, calc(${maxHeight} * ${W} / ${H}))`,
          aspectRatio: `${W} / ${H}`,
          maxHeight,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt={alt}
          className="absolute inset-0 z-0 h-full w-full object-fill object-center"
          draggable={false}
        />
        {children}
      </div>
    </div>
  );
}
