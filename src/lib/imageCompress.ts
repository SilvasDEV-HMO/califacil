/**
 * Reduce imagen para APIs de visión (límite de tamaño / latencia).
 */
export async function fileToVisionJpegDataUrl(
  file: File,
  maxEdge = 1536,
  quality = 0.88
): Promise<string> {
  const bmp = await createImageBitmap(file);
  const w = bmp.width;
  const h = bmp.height;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No se pudo preparar la imagen');
  ctx.drawImage(bmp, 0, 0, cw, ch);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}
