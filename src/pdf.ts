// Importazione dei PDF: ogni pagina diventa un'immagine fissata al foglio, su cui scrivere a mano.
// pdf.js viene caricato solo quando serve, per tenere leggero l'avvio dell'app.

import type { ImageItem } from './model';
import { uid } from './model';

export interface PdfProgress {
  page: number;
  total: number;
}

let workerReady = false;

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  if (!workerReady) {
    // Il worker viene incluso come testo e avviato da un blob: così funziona anche
    // aprendo Libellus come file locale, senza server.
    // Il worker è un modulo ES; lo si trasforma in script classico (togliendo l'export finale)
    // perché i worker-modulo non partono quando la pagina è aperta da file locale (file://).
    const raw = (await import('pdfjs-dist/build/pdf.worker.min.mjs?raw')).default;
    const code = raw.replace(/export\s*\{[^}]*\};?\s*$/, '').replace(/import\.meta\.url/g, 'self.location.href');
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    pdfjs.GlobalWorkerOptions.workerPort = new Worker(url);
    workerReady = true;
  }
  return pdfjs;
}

/** Larghezza in pixel a zoom 100%: 1 punto tipografico = 4/3 di pixel. */
const PT_TO_PX = 4 / 3;
/** Risoluzione dell'immagine rispetto alla dimensione a zoom 100% (2 = nitido anche ingrandendo). */
const RENDER_SCALE = 2;
export const PAGE_GAP = 32;

export async function importPdf(
  file: Blob,
  origin: { x: number; y: number },
  onProgress?: (p: PdfProgress) => void,
): Promise<ImageItem[]> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  let doc;
  try {
    doc = await pdfjs.getDocument({ data }).promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'PasswordException') throw new Error('Il PDF è protetto da password: aprilo e salvane una copia senza protezione.');
    throw new Error('Non riesco a leggere questo PDF.');
  }

  const items: ImageItem[] = [];
  let y = origin.y;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress?.({ page: n, total: doc.numPages });
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: PT_TO_PX * RENDER_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas non disponibile');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;

      let text = '';
      try {
        const tc = await page.getTextContent();
        text = tc.items
          .map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : ''))
          .join('')
          .replace(/[ \t]+/g, ' ')
          .trim();
      } catch {
        /* pagina senza testo (es. scansione): nessun problema */
      }

      const w = vp.width / RENDER_SCALE, h = vp.height / RENDER_SCALE;
      items.push({
        type: 'image',
        id: uid(),
        x: origin.x,
        y,
        w,
        h,
        src: canvas.toDataURL('image/jpeg', 0.86),
        locked: true,
        text: text || undefined,
      });
      y += h + PAGE_GAP;
      page.cleanup();
      // Lascia respirare l'interfaccia tra una pagina e l'altra.
      await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    await doc.destroy();
  }
  return items;
}
