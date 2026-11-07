// Modello dati di Libellus.
// Le coordinate degli elementi sono "unità mondo": 1 unità = 1 pixel CSS a zoom 100%.

/** Punto di un tratto: x, y, pressione (0..1). */
export type Point = [number, number, number];

export interface StrokeItem {
  type: 'stroke';
  id: string;
  tool: 'pen' | 'highlighter';
  color: string;
  size: number;
  points: Point[];
  /** true se la pressione viene da una penna vera, false se è simulata (mouse/dito). */
  pressure: boolean;
}

export interface TextItem {
  type: 'text';
  id: string;
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
}

export interface ImageItem {
  type: 'image';
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** data URL dell'immagine (in esportazione diventa un file in assets/). */
  src: string;
  /** Fissata al foglio: non si seleziona né si sposta (es. pagine di un PDF). */
  locked?: boolean;
  /** Testo contenuto nell'immagine, usato dalla ricerca (es. testo di una pagina PDF). */
  text?: string;
}

export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'polygon';

export const SHAPE_KINDS: { id: Exclude<ShapeKind, 'polygon'>; label: string }[] = [
  { id: 'line', label: 'Linea' },
  { id: 'arrow', label: 'Freccia' },
  { id: 'rect', label: 'Rettangolo' },
  { id: 'ellipse', label: 'Ellisse' },
];

/**
 * Forma geometrica.
 * line/arrow: due punti (inizio, fine). rect/ellipse: due angoli opposti del riquadro.
 * polygon: i vertici, chiuso.
 */
export interface ShapeItem {
  type: 'shape';
  id: string;
  kind: ShapeKind;
  pts: [number, number][];
  color: string;
  size: number;
}

export type Item = StrokeItem | TextItem | ImageItem | ShapeItem;

export type Paper = 'bianca' | 'righe' | 'quadretti' | 'puntini';

export const PAPERS: { id: Paper; label: string }[] = [
  { id: 'bianca', label: 'Bianca' },
  { id: 'righe', label: 'Righe' },
  { id: 'quadretti', label: 'Quadretti 5 mm' },
  { id: 'puntini', label: 'Puntini' },
];

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export interface Page {
  id: string;
  notebookId: string;
  title: string;
  order: number;
  paper: Paper;
  items: Item[];
  view?: View;
  created: number;
  updated: number;
}

export interface Notebook {
  id: string;
  title: string;
  color: string;
  order: number;
  created: number;
  updated: number;
}

/** Colori del dorso dei quaderni. */
export const NOTEBOOK_COLORS = ['#1f7a73', '#2b59c3', '#b23a48', '#c07a12', '#6b4bb8', '#3d4a5c'];

export function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    /* contesto non sicuro: si usa il fallback */
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function newNotebook(title: string, order: number): Notebook {
  const now = Date.now();
  return {
    id: uid(),
    title,
    color: NOTEBOOK_COLORS[order % NOTEBOOK_COLORS.length],
    order,
    created: now,
    updated: now,
  };
}

export function newPage(notebookId: string, title: string, order: number, paper: Paper = 'quadretti'): Page {
  const now = Date.now();
  return { id: uid(), notebookId, title, order, paper, items: [], created: now, updated: now };
}
