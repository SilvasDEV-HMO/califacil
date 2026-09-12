import { canRequestCalificarLiveCamera } from '@/lib/calificarLiveCamera';

type TorchTrack = MediaStreamTrack & { applyConstraints(c: MediaTrackConstraints): Promise<void> };

function torchConstraintSets(enabled: boolean): MediaTrackConstraints[] {
  return [
    { advanced: [{ torch: enabled } as MediaTrackConstraintSet] },
    { torch: enabled } as MediaTrackConstraints,
    { advanced: [{ fillLightMode: enabled ? 'flash' : 'off' } as MediaTrackConstraintSet] },
  ];
}

export function trackReportsTorchCapability(track: MediaStreamTrack | null | undefined): boolean {
  if (!track || typeof track.getCapabilities !== 'function') return false;
  const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
  return Boolean(caps.torch);
}

/** Intenta activar/desactivar linterna en el track actual (sin reiniciar stream). */
export async function applyTorchToTrack(
  track: MediaStreamTrack | null | undefined,
  enabled: boolean
): Promise<boolean> {
  const t = track as TorchTrack | null | undefined;
  if (!t || typeof t.applyConstraints !== 'function') return false;
  for (const constraints of torchConstraintSets(enabled)) {
    try {
      await t.applyConstraints(constraints);
      return true;
    } catch {
      // Android / iOS varían el constraint aceptado.
    }
  }
  return false;
}

type StreamRef = { current: MediaStream | null };

type RestartTorchOpts = {
  streamRef: StreamRef;
  videoEl?: HTMLVideoElement | null;
  enabled: boolean;
};

/**
 * En iOS Safari a veces torch solo funciona tras reiniciar getUserMedia con el mismo deviceId.
 */
export async function restartStreamWithTorch({
  streamRef,
  videoEl,
  enabled,
}: RestartTorchOpts): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
  const prev = streamRef.current;
  const prevTrack = prev?.getVideoTracks()[0];
  const settings =
    prevTrack && typeof prevTrack.getSettings === 'function' ? prevTrack.getSettings() : null;
  const deviceId = settings?.deviceId;

  const baseVideo: MediaTrackConstraints = {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  };
  if (deviceId) {
    baseVideo.deviceId = { exact: deviceId };
  }

  const videoVariants: MediaTrackConstraints[] = enabled
    ? [
        {
          ...baseVideo,
          advanced: [{ torch: true } as MediaTrackConstraintSet],
        },
        {
          ...baseVideo,
          advanced: [{ fillLightMode: 'flash' } as MediaTrackConstraintSet],
        },
        { ...baseVideo, torch: true } as MediaTrackConstraints,
        baseVideo,
      ]
    : [baseVideo];

  if (!canRequestCalificarLiveCamera()) return false;

  for (const video of videoVariants) {
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      prev?.getTracks().forEach((t) => t.stop());
      streamRef.current = next;
      if (videoEl) {
        videoEl.srcObject = next;
        try {
          await videoEl.play();
        } catch {
          // Ignorar si el elemento no está montado.
        }
      }
      const track = next.getVideoTracks()[0];
      if (enabled && track) {
        const ok = await applyTorchToTrack(track, true);
        if (!ok) {
          next.getTracks().forEach((t) => t.stop());
          streamRef.current = prev;
          if (videoEl && prev) {
            videoEl.srcObject = prev;
            try {
              await videoEl.play();
            } catch {
              // Ignorar si el elemento no está montado.
            }
          }
          continue;
        }
      }
      return true;
    } catch {
      // Probar el siguiente formato de constraints.
    }
  }
  return false;
}

export type SetCameraTorchOpts = RestartTorchOpts;

/** Activa o apaga el flash; prueba applyConstraints y reinicio de stream en iOS. */
export async function setCameraTorch(opts: SetCameraTorchOpts): Promise<boolean> {
  const track = opts.streamRef.current?.getVideoTracks()[0];
  const direct = await applyTorchToTrack(track, opts.enabled);
  if (direct) return true;
  if (!opts.enabled) {
    return restartStreamWithTorch(opts);
  }
  return restartStreamWithTorch(opts);
}
