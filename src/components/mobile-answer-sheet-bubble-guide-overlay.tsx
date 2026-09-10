'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  CALIFACIL_ANSWER_SHEET_ALIGN_FRAME_NORM,
  CALIFACIL_ALIGN_STRIPS_NORM,
} from '@/lib/printExam';
import {
  califacilStaticFiducialCornerGuidesInViewportPx,
  mapPageNormToAlignGuideViewport,
} from '@/lib/omrScan';
import type { MobileGuideRectPx } from '@/components/mobile-scan-viewfinder-overlay';

type Props = {
  guideRect: MobileGuideRectPx;
  aligned?: boolean;
  fiducialCorners?: [boolean, boolean, boolean, boolean];
  stripAligned?: boolean;
};

function stripRectInViewport(
  strip: { left: number; top: number; width: number; height: number },
  guideRect: MobileGuideRectPx
) {
  const frame = CALIFACIL_ANSWER_SHEET_ALIGN_FRAME_NORM;
  const tl = mapPageNormToAlignGuideViewport(strip.left, strip.top, guideRect, frame);
  const br = mapPageNormToAlignGuideViewport(
    strip.left + strip.width,
    strip.top + strip.height,
    guideRect,
    frame
  );
  return {
    x: tl.x,
    y: tl.y,
    width: Math.max(6, br.x - tl.x),
    height: Math.max(6, br.y - tl.y),
  };
}

/**
 * Guía fija: marco carta, franjas laterales y 4 esquinas negras como en la hoja impresa.
 */
export function MobileAnswerSheetAlignGuideOverlay({
  guideRect,
  aligned = false,
  fiducialCorners = [false, false, false, false],
  stripAligned = false,
}: Props) {
  const stripRects = useMemo(
    () => CALIFACIL_ALIGN_STRIPS_NORM.map((strip) => stripRectInViewport(strip, guideRect)),
    [guideRect]
  );

  // Misma posición que detectAnswerSheetFiducialsInRoi (CALIFACIL_FIDUCIAL_CENTERS_NORM).
  const cornerGuides = useMemo(
    () => califacilStaticFiducialCornerGuidesInViewportPx(guideRect),
    [guideRect]
  );

  const frameStroke = aligned ? 'rgba(251,146,60,0.98)' : 'rgba(251,146,60,0.72)';
  const stripStroke = stripAligned ? 'rgba(251,146,60,0.95)' : 'rgba(251,146,60,0.55)';
  const stripFill = stripAligned ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.08)';

  return (
    <svg
      className={cn('pointer-events-none absolute inset-0 z-[12] h-full w-full')}
      aria-hidden
    >
      <rect
        x={guideRect.left}
        y={guideRect.top}
        width={guideRect.width}
        height={guideRect.height}
        fill="none"
        stroke={frameStroke}
        strokeWidth={2.5}
        strokeDasharray={aligned ? '0' : '10 8'}
        vectorEffect="non-scaling-stroke"
      />
      {stripRects.map((strip, index) => (
        <rect
          key={index}
          x={strip.x}
          y={strip.y}
          width={strip.width}
          height={strip.height}
          fill={stripFill}
          stroke={stripStroke}
          strokeWidth={stripAligned ? 2.5 : 1.75}
          strokeDasharray={stripAligned ? '0' : '4 4'}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {cornerGuides.map((guide, index) => {
        const detected = fiducialCorners[index] ?? false;
        return (
          <rect
            key={index}
            x={guide.left}
            y={guide.top}
            width={guide.size}
            height={guide.size}
            fill={detected ? 'rgba(251,146,60,0.28)' : 'rgba(255,255,255,0.06)'}
            stroke={detected ? 'rgba(251,146,60,0.98)' : 'rgba(255,255,255,0.5)'}
            strokeWidth={detected ? 2.75 : 2}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
