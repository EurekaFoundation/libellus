import type { Item, Point, ShapeItem, StrokeItem, TextItem } from './model';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const TEXT_LINE = 1.3;

/** Misura approssimata dei testi; viene aggiornata dal canvas quando disponibile. */
let measureCtx: CanvasRenderingContext2D | null = null;
export function textFont(size: number): string {
  return `${size}px "Atkinson Hyperlegible", system-ui, sans-serif`;
}
export function measureText(item: TextItem): { w: number; h: number } {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  const lines = item.text.split('\n');
  let w = 0;
  if (measureCtx) {
    measureCtx.font = textFont(item.size);
    for (const l of lines) w = Math.max(w, measureCtx.measureText(l).width);
  } else {
    w = Math.max(...lines.map((l) => l.length)) * item.size * 0.55;
  }
  return { w: Math.max(w, item.size * 0.5), h: lines.length * item.size * TEXT_LINE };
}

const boundsCache = new WeakMap<Item, Rect>();

export function itemBounds(item: Item): Rect {
  const cached = boundsCache.get(item);
  if (cached) return cached;
  let r: Rect;
  if (item.type === 'stroke') {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of item.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const pad = item.size;
    r = { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  } else if (item.type === 'text') {
    const m = measureText(item);
    r = { x: item.x, y: item.y, w: m.w, h: m.h };
  } else if (item.type === 'shape') {
    const xs = item.pts.map((p) => p[0]), ys = item.pts.map((p) => p[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    // La punta della freccia sporge un po' oltre la linea.
    const pad = item.size / 2 + (item.kind === 'arrow' ? arrowHeadLength(item) * 0.6 : 0);
    r = { x: minX - pad, y: minY - pad, w: Math.max(...xs) - minX + pad * 2, h: Math.max(...ys) - minY + pad * 2 };
  } else {
    r = { x: item.x, y: item.y, w: item.w, h: item.h };
  }
  boundsCache.set(item, r);
  return r;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}

export function unionRects(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Il tratto passa entro `radius` dal punto? */
export function strokeHits(stroke: StrokeItem, x: number, y: number, radius: number): boolean {
  const b = itemBounds(stroke);
  if (!rectsIntersect(b, { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 })) return false;
  const pts = stroke.points;
  const tol = radius + stroke.size / 2;
  if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) <= tol;
  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= tol) return true;
  }
  return false;
}

export function arrowHeadLength(s: ShapeItem): number {
  return Math.max(12, s.size * 4);
}

/** Contorno della forma come spezzata (per collisioni e gomma). */
export function shapeOutline(s: ShapeItem): [number, number][] {
  const [a, b] = s.pts;
  switch (s.kind) {
    case 'line':
    case 'arrow':
      return [a, b];
    case 'rect':
      return [a, [b[0], a[1]], b, [a[0], b[1]], a];
    case 'ellipse': {
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
      const rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2;
      const out: [number, number][] = [];
      for (let i = 0; i <= 48; i++) {
        const t = (i / 48) * Math.PI * 2;
        out.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry]);
      }
      return out;
    }
    case 'polygon':
      return [...s.pts, s.pts[0]];
  }
}

export function shapeHits(s: ShapeItem, x: number, y: number, radius: number): boolean {
  const b = itemBounds(s);
  if (!rectsIntersect(b, { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 })) return false;
  const o = shapeOutline(s);
  const tol = radius + s.size / 2;
  for (let i = 1; i < o.length; i++) {
    if (distToSegment(x, y, o[i - 1][0], o[i - 1][1], o[i][0], o[i][1]) <= tol) return true;
  }
  return false;
}

/**
 * Elemento più in alto sotto il punto (per selezione e testo).
 * Gli elementi fissati al foglio vengono ignorati, salvo `includeLocked`.
 */
export function hitTest(items: Item[], x: number, y: number, tolerance: number, includeLocked = false): Item | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type === 'image' && it.locked && !includeLocked) continue;
    if (it.type === 'stroke') {
      if (strokeHits(it, x, y, tolerance)) return it;
    } else if (it.type === 'shape') {
      if (shapeHits(it, x, y, tolerance)) return it;
    } else if (rectContains(itemBounds(it), x, y)) return it;
  }
  return null;
}

export function isLocked(it: Item): boolean {
  return it.type === 'image' && !!it.locked;
}

export function translateItem(item: Item, dx: number, dy: number): Item {
  if (item.type === 'stroke') {
    return { ...item, points: item.points.map(([x, y, p]) => [x + dx, y + dy, p] as Point) };
  }
  if (item.type === 'shape') {
    return { ...item, pts: item.pts.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
  }
  return { ...item, x: item.x + dx, y: item.y + dy };
}

/** Scala uniforme rispetto al punto (ox, oy). Anche gli spessori e i caratteri seguono la scala. */
export function scaleItem(item: Item, ox: number, oy: number, s: number): Item {
  const fx = (x: number) => ox + (x - ox) * s;
  const fy = (y: number) => oy + (y - oy) * s;
  switch (item.type) {
    case 'stroke':
      return {
        ...item,
        size: Math.max(0.5, item.size * s),
        points: item.points.map(([x, y, p]) => [fx(x), fy(y), p] as Point),
      };
    case 'shape':
      return {
        ...item,
        size: Math.max(0.5, item.size * s),
        pts: item.pts.map(([x, y]) => [fx(x), fy(y)] as [number, number]),
      };
    case 'text':
      return { ...item, x: fx(item.x), y: fy(item.y), size: Math.max(4, item.size * s) };
    case 'image':
      return { ...item, x: fx(item.x), y: fy(item.y), w: item.w * s, h: item.h * s };
  }
}
