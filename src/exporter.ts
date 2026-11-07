// Formato di file aperto ".libellus": un archivio ZIP leggibile da chiunque.
//
//   manifest.json          { format, version, notebook, pages: [ "pages/<id>.json", ... ] }
//   pages/<id>.json        la pagina, con le immagini che puntano a "assets/<id>.<ext>"
//   assets/<id>.<ext>      le immagini originali
//
// Le pagine restano JSON leggibile: chi vuole può scrivere un convertitore in pochi minuti.

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { Item, Notebook, Page } from './model';
import { uid } from './model';
import { drawItem, PAPER_COLOR } from './board';
import { itemBounds, unionRects } from './geometry';

export const FORMAT = 'libellus';
export const FORMAT_VERSION = 1;

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

function dataUrlToBytes(url: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!m) return null;
  const mime = m[1];
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  }
  return { bytes: strToU8(decodeURIComponent(m[3])), mime };
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(bin)}`;
}

export function exportNotebook(nb: Notebook, pages: Page[]): Blob {
  const files: Zippable = {};
  const pagePaths: string[] = [];
  const assetsByUrl = new Map<string, string>();

  for (const page of [...pages].sort((a, b) => a.order - b.order)) {
    const items: Item[] = page.items.map((it) => {
      if (it.type !== 'image' || !it.src.startsWith('data:')) return it;
      let path = assetsByUrl.get(it.src);
      if (!path) {
        const parsed = dataUrlToBytes(it.src);
        if (!parsed) return it;
        path = `assets/${uid()}.${MIME_EXT[parsed.mime] ?? 'bin'}`;
        files[path] = [parsed.bytes, { level: 0 }];
        assetsByUrl.set(it.src, path);
      }
      return { ...it, src: path };
    });
    const path = `pages/${page.id}.json`;
    files[path] = strToU8(JSON.stringify({ ...page, items }, null, 1));
    pagePaths.push(path);
  }

  const manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    app: 'Libellus',
    exported: new Date().toISOString(),
    notebook: nb,
    pages: pagePaths,
  };
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped as BlobPart], { type: 'application/zip' });
}

/** Importa un quaderno. Gli identificativi vengono rigenerati, così l'import non sovrascrive nulla. */
export async function importNotebook(file: Blob, order: number): Promise<{ notebook: Notebook; pages: Page[] }> {
  const data = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data);
  } catch {
    throw new Error('Il file non è un archivio .libellus valido.');
  }
  const manifestRaw = entries['manifest.json'];
  if (!manifestRaw) throw new Error('Nel file manca manifest.json: non sembra un quaderno di Libellus.');
  const manifest = JSON.parse(strFromU8(manifestRaw));
  if (manifest.format !== FORMAT) throw new Error('Il file non è un quaderno di Libellus.');
  if (manifest.version > FORMAT_VERSION) {
    throw new Error('Il quaderno è stato creato con una versione più recente di Libellus. Aggiorna l\'app.');
  }

  const now = Date.now();
  const notebook: Notebook = { ...manifest.notebook, id: uid(), order, updated: now };
  const pages: Page[] = [];
  for (const path of manifest.pages as string[]) {
    const raw = entries[path];
    if (!raw) continue;
    const p = JSON.parse(strFromU8(raw)) as Page;
    const items = p.items.map((it): Item => {
      const fresh = { ...it, id: uid() };
      if (fresh.type === 'image' && fresh.src.startsWith('assets/')) {
        const bytes = entries[fresh.src];
        const ext = fresh.src.split('.').pop() ?? '';
        const mime = Object.entries(MIME_EXT).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
        if (bytes) fresh.src = bytesToDataUrl(bytes, mime);
      }
      return fresh;
    });
    pages.push({ ...p, id: uid(), notebookId: notebook.id, items });
  }
  return { notebook, pages };
}

/** Esporta la pagina come immagine PNG, ritagliata sul contenuto. */
export async function exportPagePng(page: Page, scale = 2): Promise<Blob | null> {
  const bounds = unionRects(page.items.map(itemBounds));
  if (!bounds) return null;
  const pad = 32;
  const w = Math.ceil(bounds.w + pad * 2), h = Math.ceil(bounds.h + pad * 2);
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Precarica le immagini.
  const imgs = new Map<string, HTMLImageElement>();
  await Promise.all(
    page.items
      .filter((i) => i.type === 'image')
      .map(
        (i) =>
          new Promise<void>((res) => {
            const img = new Image();
            img.onload = () => res();
            img.onerror = () => res();
            img.src = i.type === 'image' ? i.src : '';
            imgs.set(img.src, img);
          }),
      ),
  );

  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(pad - bounds.x, pad - bounds.y);
  for (const it of page.items) {
    drawItem(ctx, it, (src) => {
      const img = imgs.get(src) ?? [...imgs.values()].find((i) => i.src === src);
      return img && img.naturalWidth ? img : null;
    });
  }
  return new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'quaderno';
}
