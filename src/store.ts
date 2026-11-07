// Salvataggio locale in IndexedDB. Se IndexedDB non è disponibile
// (finestra privata, dati del sito bloccati) si lavora in memoria e lo si segnala.

import type { Notebook, Page } from './model';

const DB_NAME = 'libellus';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;
let memoryOnly = false;
const mem = { notebooks: new Map<string, Notebook>(), pages: new Map<string, Page>() };

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pages')) {
        const s = db.createObjectStore('pages', { keyPath: 'id' });
        s.createIndex('notebookId', 'notebookId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database bloccato da un\'altra scheda'));
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Prova ad aprire il database. Restituisce false se si lavora solo in memoria. */
export async function initStore(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    memoryOnly = true;
    return false;
  }
}

export function isMemoryOnly(): boolean {
  return memoryOnly;
}

export async function loadAll(): Promise<{ notebooks: Notebook[]; pages: Page[] }> {
  if (memoryOnly) return { notebooks: [...mem.notebooks.values()], pages: [...mem.pages.values()] };
  const db = await openDb();
  const tx = db.transaction(['notebooks', 'pages'], 'readonly');
  const [notebooks, pages] = await Promise.all([
    wrap(tx.objectStore('notebooks').getAll() as IDBRequest<Notebook[]>),
    wrap(tx.objectStore('pages').getAll() as IDBRequest<Page[]>),
  ]);
  return { notebooks, pages };
}

export async function putNotebook(nb: Notebook): Promise<void> {
  if (memoryOnly) {
    mem.notebooks.set(nb.id, structuredClone(nb));
    return;
  }
  const db = await openDb();
  const tx = db.transaction('notebooks', 'readwrite');
  tx.objectStore('notebooks').put(nb);
  await txDone(tx);
}

export async function putPage(page: Page): Promise<void> {
  if (memoryOnly) {
    mem.pages.set(page.id, structuredClone(page));
    return;
  }
  const db = await openDb();
  const tx = db.transaction('pages', 'readwrite');
  tx.objectStore('pages').put(page);
  await txDone(tx);
}

export async function putMany(notebooks: Notebook[], pages: Page[]): Promise<void> {
  if (memoryOnly) {
    notebooks.forEach((n) => mem.notebooks.set(n.id, structuredClone(n)));
    pages.forEach((p) => mem.pages.set(p.id, structuredClone(p)));
    return;
  }
  const db = await openDb();
  const tx = db.transaction(['notebooks', 'pages'], 'readwrite');
  notebooks.forEach((n) => tx.objectStore('notebooks').put(n));
  pages.forEach((p) => tx.objectStore('pages').put(p));
  await txDone(tx);
}

export async function deletePage(id: string): Promise<void> {
  if (memoryOnly) {
    mem.pages.delete(id);
    return;
  }
  const db = await openDb();
  const tx = db.transaction('pages', 'readwrite');
  tx.objectStore('pages').delete(id);
  await txDone(tx);
}

export async function deleteNotebook(id: string, pageIds: string[]): Promise<void> {
  if (memoryOnly) {
    mem.notebooks.delete(id);
    pageIds.forEach((p) => mem.pages.delete(p));
    return;
  }
  const db = await openDb();
  const tx = db.transaction(['notebooks', 'pages'], 'readwrite');
  tx.objectStore('notebooks').delete(id);
  pageIds.forEach((p) => tx.objectStore('pages').delete(p));
  await txDone(tx);
}
