/**
 * Permite correr OMR (document.createElement('canvas')) en Node con @napi-rs/canvas.
 */
import { createCanvas, Image, Canvas } from '@napi-rs/canvas';

export function installNodeCanvasShim(): void {
  const g = globalThis as unknown as {
    HTMLCanvasElement?: unknown;
    HTMLImageElement?: unknown;
    Image?: unknown;
    document?: {
      createElement: (tag: string) => unknown;
    };
    requestAnimationFrame?: (cb: (t: number) => void) => unknown;
    __OMR_NODE_CANVAS_SHIM__?: boolean;
  };
  if (g.__OMR_NODE_CANVAS_SHIM__) return;
  g.__OMR_NODE_CANVAS_SHIM__ = true;
  g.HTMLCanvasElement = Canvas;
  g.HTMLImageElement = Image;
  g.Image = Image;
  g.document = {
    createElement(tag: string) {
      if (tag.toLowerCase() === 'canvas') return createCanvas(300, 150);
      throw new Error(`document.createElement('${tag}') no está soportado en el shim OMR`);
    },
  };
  if (typeof g.requestAnimationFrame !== 'function') {
    g.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  }
}
