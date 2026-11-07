// Differenze tra la versione nel browser e la versione desktop (Tauri).

import { download } from './exporter';

/** true quando Libellus gira come programma installato. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface FileFilter {
  name: string;
  extensions: string[];
}

/**
 * Salva un file. Nel browser lo scarica; nel programma desktop apre la finestra
 * di sistema "Salva con nome". Restituisce false se l'utente annulla.
 */
export async function saveFile(blob: Blob, filename: string, filter: FileFilter): Promise<boolean> {
  if (!isDesktop) {
    download(blob, filename);
    return true;
  }
  const [{ save }, { writeFile }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs'),
  ]);
  const path = await save({ defaultPath: filename, filters: [filter] });
  if (!path) return false;
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}
