import fs from 'node:fs';
import path from 'node:path';

const destDir = path.join(process.cwd(), 'public', 'tesseract');
const langDir = path.join(destDir, 'lang');
fs.mkdirSync(langDir, { recursive: true });

function copyIfExists(src, destName) {
  if (!fs.existsSync(src)) {
    console.warn(`[copy-tesseract] missing ${src}`);
    return;
  }
  fs.copyFileSync(src, path.join(destDir, destName));
}

copyIfExists(
  path.join(process.cwd(), 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
  'worker.min.js'
);
copyIfExists(
  path.join(process.cwd(), 'node_modules', 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js'),
  'tesseract-core-simd-lstm.wasm.js'
);
copyIfExists(
  path.join(process.cwd(), 'node_modules', 'tesseract.js-core', 'tesseract-core-simd-lstm.wasm'),
  'tesseract-core-simd-lstm.wasm'
);

const langs = ['spa', 'eng'];
const langBase =
  'https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0';

async function downloadLang(code) {
  const file = `${code}.traineddata.gz`;
  const dest = path.join(langDir, file);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
    return;
  }
  const url = `${langBase}/${file}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo bajar ${file}: ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

await Promise.all(langs.map(downloadLang));
console.log('[copy-tesseract] worker, wasm e idiomas spa/eng listos en public/tesseract/');
