// Ricerca nei titoli delle pagine, nei testi e nel testo dei PDF importati.

import type { Notebook, Page } from './model';

export interface SearchHit {
  notebook: Notebook;
  page: Page;
  kind: 'title' | 'text' | 'pdf';
  itemId?: string;
  snippet: string;
}

const MAX_HITS = 50;

/** Minuscolo e senza accenti, mantenendo la lunghezza (così le posizioni restano valide). */
export function fold(s: string): string {
  return [...s].map((c) => c.normalize('NFD')[0] ?? c).join('').toLocaleLowerCase('it');
}

function snippetAround(text: string, at: number, len: number): string {
  const flat = text.replace(/\s+/g, ' ');
  // Le posizioni si spostano di poco togliendo gli spazi doppi: si ricalcolano sul testo appiattito.
  const start = Math.max(0, at - 40);
  const end = Math.min(flat.length, at + len + 60);
  return (start > 0 ? '…' : '') + flat.slice(start, end).trim() + (end < flat.length ? '…' : '');
}

export function search(query: string, notebooks: Notebook[], pages: Page[]): SearchHit[] {
  const q = fold(query.trim().replace(/\s+/g, ' '));
  if (q.length < 2) return [];
  const byId = new Map(notebooks.map((n) => [n.id, n]));
  const hits: SearchHit[] = [];
  const sorted = [...pages].sort((a, b) => b.updated - a.updated);

  for (const page of sorted) {
    const notebook = byId.get(page.notebookId);
    if (!notebook) continue;
    if (fold(page.title).includes(q)) hits.push({ notebook, page, kind: 'title', snippet: page.title });
    for (const it of page.items) {
      const raw = it.type === 'text' ? it.text : it.type === 'image' ? it.text : undefined;
      if (!raw) continue;
      const flat = raw.replace(/\s+/g, ' ');
      const at = fold(flat).indexOf(q);
      if (at < 0) continue;
      hits.push({
        notebook,
        page,
        kind: it.type === 'image' ? 'pdf' : 'text',
        itemId: it.id,
        snippet: snippetAround(flat, at, q.length),
      });
      if (hits.length >= MAX_HITS) return hits;
    }
  }
  return hits;
}
