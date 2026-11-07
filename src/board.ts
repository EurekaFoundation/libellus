// La tela infinita: disegno, gomma, selezione, testo, spostamento e zoom.

import { getStroke } from 'perfect-freehand';
import type { ImageItem, Item, Page, Paper, Point, ShapeItem, ShapeKind, StrokeItem, TextItem, View } from './model';
import { uid } from './model';
import { recognize } from './recognize';
import {
  arrowHeadLength,
  hitTest,
  isLocked,
  itemBounds,
  scaleItem,
  shapeHits,
  rectsIntersect,
  strokeHits,
  textFont,
  TEXT_LINE,
  translateItem,
  unionRects,
  type Rect,
} from './geometry';

export type Tool = 'pen' | 'highlighter' | 'eraser' | 'select' | 'text' | 'shape' | 'hand';

export interface ToolStyle {
  color: string;
  size: number;
}

export interface BoardEvents {
  onItemsChange(items: Item[]): void;
  onViewChange(view: View): void;
  onHistoryChange(canUndo: boolean, canRedo: boolean): void;
  onSelectionChange(count: number): void;
  onZoomChange(zoom: number): void;
  /** Una forma disegnata a mano è stata riconosciuta. */
  onShapeSnap?(): void;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';

export const PAPER_COLOR = '#fdfdfb';
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const HISTORY_LIMIT = 200;

type Gesture =
  | { kind: 'none' }
  | { kind: 'draw'; stroke: StrokeItem; snapped: ShapeItem | null }
  | { kind: 'shape'; item: ShapeItem }
  | { kind: 'resize'; ax: number; ay: number; cx: number; cy: number; s: number }
  | { kind: 'erase'; removed: Set<string>; before: Item[] }
  | { kind: 'pan'; sx: number; sy: number; camX: number; camY: number }
  | { kind: 'move'; wx: number; wy: number; dx: number; dy: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number };

const pathCache = new WeakMap<StrokeItem, Path2D>();

function strokeOptions(s: StrokeItem, last: boolean) {
  if (s.tool === 'highlighter') {
    return { size: s.size, thinning: 0, smoothing: 0.6, streamline: 0.4, simulatePressure: false, last };
  }
  return {
    size: s.size,
    thinning: 0.6,
    smoothing: 0.55,
    streamline: 0.45,
    simulatePressure: !s.pressure,
    last,
  };
}

function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  const len = outline.length;
  if (len < 3) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < len; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % len];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

function strokePath(s: StrokeItem, live = false): Path2D {
  if (!live) {
    const c = pathCache.get(s);
    if (c) return c;
  }
  const pts = s.tool === 'highlighter' ? s.points.map(([x, y]) => [x, y, 0.5]) : s.points;
  const p = outlineToPath(getStroke(pts, strokeOptions(s, !live)));
  if (!live) pathCache.set(s, p);
  return p;
}

export class Board {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private host: HTMLElement;
  private events: BoardEvents;

  items: Item[] = [];
  paper: Paper = 'quadretti';
  tool: Tool = 'pen';
  shapeKind: Exclude<ShapeKind, 'polygon'> = 'rect';
  styles: Record<'pen' | 'highlighter' | 'eraser' | 'text' | 'shape', ToolStyle> = {
    pen: { color: '#1b2230', size: 4 },
    highlighter: { color: '#ffd23f', size: 22 },
    eraser: { color: '', size: 18 },
    text: { color: '#1b2230', size: 22 },
    shape: { color: '#1b2230', size: 3 },
  };

  private cam = { x: 0, y: 0, zoom: 1 };
  private undoStack: Item[][] = [];
  private redoStack: Item[][] = [];
  private selection = new Set<string>();
  private gesture: Gesture = { kind: 'none' };
  private activePointer: number | null = null;
  private touches = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; cx: number; cy: number; zoom: number; camX: number; camY: number } | null = null;
  private penSeen = false;
  private spaceDown = false;
  private hover: { x: number; y: number } | null = null;
  private images = new Map<string, HTMLImageElement>();
  private raf = 0;
  private editor: HTMLTextAreaElement | null = null;
  private editingId: string | null = null;
  private dpr = 1;
  private holdTimer = 0;
  private flash: { id: string; until: number } | null = null;

  constructor(host: HTMLElement, events: BoardEvents) {
    this.host = host;
    this.events = events;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'board-canvas';
    this.canvas.setAttribute('aria-label', 'Pagina del quaderno');
    this.canvas.tabIndex = 0;
    host.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D non disponibile');
    this.ctx = ctx;

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    c.addEventListener('pointermove', (e) => this.onPointerMove(e));
    c.addEventListener('pointerup', (e) => this.onPointerUp(e));
    c.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.requestRender();
    });
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- Stato pubblico ----------

  load(page: Page) {
    this.commitEditor();
    this.items = page.items;
    this.paper = page.paper;
    this.cam = page.view ? { ...page.view } : { x: -40, y: -40, zoom: 1 };
    this.undoStack = [];
    this.redoStack = [];
    this.selection.clear();
    this.gesture = { kind: 'none' };
    this.emitHistory();
    this.events.onSelectionChange(0);
    this.events.onZoomChange(this.cam.zoom);
    this.requestRender();
  }

  setPaper(p: Paper) {
    this.paper = p;
    this.requestRender();
  }

  setTool(t: Tool) {
    this.commitEditor();
    this.tool = t;
    if (t !== 'select') this.clearSelection();
    this.canvas.dataset.tool = t;
    this.requestRender();
  }

  get view(): View {
    return { ...this.cam };
  }

  get selectionCount(): number {
    return this.selection.size;
  }

  setSpace(down: boolean) {
    this.spaceDown = down;
    this.canvas.dataset.panning = down ? 'yes' : '';
  }

  // ---------- Cronologia ----------

  private commit(next: Item[]) {
    this.undoStack.push(this.items);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.items = next;
    this.changed();
  }

  private changed() {
    this.emitHistory();
    this.events.onItemsChange(this.items);
    this.requestRender();
  }

  private emitHistory() {
    this.events.onHistoryChange(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  undo() {
    this.commitEditor();
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.items);
    this.items = prev;
    this.pruneSelection();
    this.changed();
  }

  redo() {
    this.commitEditor();
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.items);
    this.items = next;
    this.pruneSelection();
    this.changed();
  }

  // ---------- Selezione ----------

  private pruneSelection() {
    const ids = new Set(this.items.map((i) => i.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
    this.events.onSelectionChange(this.selection.size);
  }

  clearSelection() {
    if (!this.selection.size) return;
    this.selection.clear();
    this.events.onSelectionChange(0);
    this.requestRender();
  }

  selectAll() {
    this.selection = new Set(this.items.filter((i) => !isLocked(i)).map((i) => i.id));
    this.events.onSelectionChange(this.selection.size);
    this.requestRender();
  }

  /** Quante immagini ci sono nella selezione (per offrire "Fissa al foglio"). */
  get selectedImages(): number {
    return this.items.filter((i) => i.type === 'image' && this.selection.has(i.id)).length;
  }

  /** Fissa al foglio le immagini selezionate. */
  lockSelection() {
    const next = this.items.map((i) => (i.type === 'image' && this.selection.has(i.id) ? { ...i, locked: true } : i));
    this.selection.clear();
    this.events.onSelectionChange(0);
    this.commit(next);
  }

  get lockedCount(): number {
    return this.items.filter(isLocked).length;
  }

  /** Sblocca tutti gli elementi fissati della pagina e li seleziona. */
  unlockAll() {
    const ids: string[] = [];
    const next = this.items.map((i) => {
      if (i.type === 'image' && i.locked) {
        ids.push(i.id);
        return { ...i, locked: false };
      }
      return i;
    });
    if (!ids.length) return;
    this.setTool('select');
    this.selection = new Set(ids);
    this.events.onSelectionChange(ids.length);
    this.commit(next);
  }

  /** Aggiunge più elementi in un solo passo annullabile (es. le pagine di un PDF). */
  addItems(items: Item[]) {
    if (items.length) this.commit([...this.items, ...items]);
  }

  /** Centra la vista sull'elemento e lo evidenzia per un momento. */
  revealItem(id: string) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return;
    const b = itemBounds(it);
    const r = this.canvas.getBoundingClientRect();
    let zoom = this.cam.zoom;
    const fit = Math.min((r.width - 96) / b.w, (r.height - 96) / b.h);
    if (fit < zoom) zoom = Math.max(MIN_ZOOM, fit);
    this.cam = { zoom, x: b.x + b.w / 2 - r.width / 2 / zoom, y: b.y + b.h / 2 - r.height / 2 / zoom };
    this.flash = { id, until: performance.now() + 1600 };
    this.viewChanged();
    const tick = () => {
      if (!this.flash) return;
      if (performance.now() > this.flash.until) this.flash = null;
      this.requestRender();
      if (this.flash) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** Mostra la vista di un'area del mondo (es. la prima pagina di un PDF appena importato). */
  showRect(rect: Rect) {
    const r = this.canvas.getBoundingClientRect();
    const zoom = Math.max(MIN_ZOOM, Math.min(1.5, (r.width - 96) / rect.w));
    this.cam = { zoom, x: rect.x + rect.w / 2 - r.width / 2 / zoom, y: rect.y - 48 / zoom };
    this.viewChanged();
  }

  get viewTopLeft(): { x: number; y: number } {
    return { x: this.cam.x + 48 / this.cam.zoom, y: this.cam.y + 48 / this.cam.zoom };
  }

  deleteSelection() {
    if (!this.selection.size) return;
    const next = this.items.filter((i) => !this.selection.has(i.id));
    this.selection.clear();
    this.events.onSelectionChange(0);
    this.commit(next);
  }

  duplicateSelection() {
    if (!this.selection.size) return;
    const copies = this.items
      .filter((i) => this.selection.has(i.id))
      .map((i) => ({ ...translateItem(i, 24, 24), id: uid() }));
    this.selection = new Set(copies.map((c) => c.id));
    this.events.onSelectionChange(this.selection.size);
    this.commit([...this.items, ...copies]);
  }

  // ---------- Inserimento ----------

  private viewCenter(): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return this.toWorld(r.width / 2, r.height / 2);
  }

  insertImage(src: string, natW: number, natH: number, at?: { x: number; y: number }) {
    const r = this.canvas.getBoundingClientRect();
    const maxW = (r.width * 0.6) / this.cam.zoom;
    const scale = Math.min(1, maxW / natW);
    const w = natW * scale, h = natH * scale;
    const c = at ?? this.viewCenter();
    const item: ImageItem = { type: 'image', id: uid(), x: c.x - w / 2, y: c.y - h / 2, w, h, src };
    this.setTool('select');
    this.selection = new Set([item.id]);
    this.events.onSelectionChange(1);
    this.commit([...this.items, item]);
  }

  insertText(text: string) {
    const c = this.viewCenter();
    const st = this.styles.text;
    const item: TextItem = { type: 'text', id: uid(), x: c.x, y: c.y, text, color: st.color, size: st.size };
    this.commit([...this.items, item]);
  }

  /** Coordinate mondo di un punto dello schermo relativo alla pagina (clientX/Y). */
  clientToWorld(cx: number, cy: number) {
    const r = this.canvas.getBoundingClientRect();
    return this.toWorld(cx - r.left, cy - r.top);
  }

  // ---------- Vista ----------

  private toWorld(sx: number, sy: number) {
    return { x: sx / this.cam.zoom + this.cam.x, y: sy / this.cam.zoom + this.cam.y };
  }

  private toScreen(wx: number, wy: number) {
    return { x: (wx - this.cam.x) * this.cam.zoom, y: (wy - this.cam.y) * this.cam.zoom };
  }

  private viewChanged() {
    this.events.onViewChange(this.view);
    this.events.onZoomChange(this.cam.zoom);
    this.positionEditor();
    this.requestRender();
  }

  zoomAt(factor: number, sx?: number, sy?: number) {
    const r = this.canvas.getBoundingClientRect();
    const px = sx ?? r.width / 2, py = sy ?? r.height / 2;
    const before = this.toWorld(px, py);
    this.cam.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.cam.zoom * factor));
    this.cam.x = before.x - px / this.cam.zoom;
    this.cam.y = before.y - py / this.cam.zoom;
    this.viewChanged();
  }

  resetZoom() {
    this.zoomAt(1 / this.cam.zoom);
  }

  fitContent() {
    const b = unionRects(this.items.map(itemBounds));
    const r = this.canvas.getBoundingClientRect();
    if (!b) {
      this.cam = { x: -40, y: -40, zoom: 1 };
    } else {
      const pad = 48;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h, 2)));
      this.cam = { zoom, x: b.x + b.w / 2 - r.width / 2 / zoom, y: b.y + b.h / 2 - r.height / 2 / zoom };
    }
    this.viewChanged();
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.requestRender();
  }

  // ---------- Input ----------

  private local(e: PointerEvent | MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onPointerDown(e: PointerEvent) {
    this.canvas.focus({ preventScroll: true });
    if (e.pointerType === 'pen') this.penSeen = true;

    // Tocco: due dita = zoom; con una penna attiva il dito sposta soltanto.
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, this.local(e));
      if (this.touches.size === 2) {
        this.cancelGesture();
        this.startPinch();
        return;
      }
      if (this.touches.size > 2) return;
    }
    if (this.activePointer !== null) return;

    const p = this.local(e);
    const w = this.toWorld(p.x, p.y);
    const panRequested =
      e.button === 1 || e.button === 2 || this.spaceDown || this.tool === 'hand' || (e.pointerType === 'touch' && this.penSeen);
    if (e.button !== 0 && !panRequested) return;

    this.activePointer = e.pointerId;
    this.canvas.setPointerCapture(e.pointerId);
    this.commitEditor();

    if (panRequested) {
      this.gesture = { kind: 'pan', sx: p.x, sy: p.y, camX: this.cam.x, camY: this.cam.y };
      this.canvas.dataset.grabbing = 'yes';
      return;
    }

    const pressure = e.pointerType === 'pen';
    switch (this.tool) {
      case 'pen':
      case 'highlighter': {
        const st = this.styles[this.tool];
        const stroke: StrokeItem = {
          type: 'stroke',
          id: uid(),
          tool: this.tool,
          color: st.color,
          size: st.size,
          points: [[w.x, w.y, pressure ? e.pressure || 0.5 : 0.5]],
          pressure,
        };
        this.gesture = { kind: 'draw', stroke, snapped: null };
        if (this.tool === 'pen') this.armHold();
        break;
      }
      case 'shape': {
        const st = this.styles.shape;
        const item: ShapeItem = {
          type: 'shape',
          id: uid(),
          kind: this.shapeKind,
          pts: [
            [w.x, w.y],
            [w.x, w.y],
          ],
          color: st.color,
          size: st.size,
        };
        this.gesture = { kind: 'shape', item };
        break;
      }
      case 'eraser':
        this.gesture = { kind: 'erase', removed: new Set(), before: this.items };
        this.eraseAt(w.x, w.y);
        break;
      case 'select': {
        const tol = 6 / this.cam.zoom;
        const corner = this.handleAt(p.x, p.y);
        const sel = this.selectionBounds();
        if (corner && sel) {
          const pad = 6 / this.cam.zoom;
          const L = sel.x - pad, T = sel.y - pad, R = sel.x + sel.w + pad, B = sel.y + sel.h + pad;
          const c = { nw: [L, T], ne: [R, T], sw: [L, B], se: [R, B] }[corner];
          const a = { nw: [R, B], ne: [L, B], sw: [R, T], se: [L, T] }[corner];
          this.gesture = { kind: 'resize', ax: a[0], ay: a[1], cx: c[0], cy: c[1], s: 1 };
          break;
        }
        if (sel && w.x >= sel.x && w.x <= sel.x + sel.w && w.y >= sel.y && w.y <= sel.y + sel.h) {
          this.gesture = { kind: 'move', wx: w.x, wy: w.y, dx: 0, dy: 0 };
          break;
        }
        const hit = hitTest(this.items, w.x, w.y, tol);
        if (hit) {
          if (e.shiftKey) {
            if (this.selection.has(hit.id)) this.selection.delete(hit.id);
            else this.selection.add(hit.id);
          } else this.selection = new Set([hit.id]);
          this.events.onSelectionChange(this.selection.size);
          this.gesture = { kind: 'move', wx: w.x, wy: w.y, dx: 0, dy: 0 };
        } else {
          if (!e.shiftKey) this.clearSelection();
          this.gesture = { kind: 'marquee', x0: w.x, y0: w.y, x1: w.x, y1: w.y };
        }
        break;
      }
      case 'text': {
        const hit = hitTest(this.items, w.x, w.y, 4 / this.cam.zoom);
        this.activePointer = null;
        if (hit && hit.type === 'text') this.openEditor(hit);
        else this.openEditor(null, w.x, w.y);
        e.preventDefault();
        return;
      }
    }
    this.requestRender();
  }

  private onPointerMove(e: PointerEvent) {
    const p = this.local(e);
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) {
      this.touches.set(e.pointerId, p);
      if (this.pinch) {
        this.updatePinch();
        return;
      }
    }
    this.hover = e.pointerType === 'touch' ? null : p;

    if (e.pointerId !== this.activePointer) {
      if (this.tool === 'eraser') this.requestRender();
      if (this.tool === 'select' && e.pointerType !== 'touch') {
        const h = this.handleAt(p.x, p.y);
        if (h) this.canvas.dataset.handle = h === 'nw' || h === 'se' ? 'nwse' : 'nesw';
        else delete this.canvas.dataset.handle;
      }
      return;
    }
    const g = this.gesture;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const samples = events.length ? events : [e];

    switch (g.kind) {
      case 'pan':
        this.cam.x = g.camX - (p.x - g.sx) / this.cam.zoom;
        this.cam.y = g.camY - (p.y - g.sy) / this.cam.zoom;
        this.viewChanged();
        return;
      case 'draw': {
        if (g.snapped) return; // forma già riconosciuta: si aspetta il rilascio
        const last = g.stroke.points[g.stroke.points.length - 1];
        let moved = false;
        for (const s of samples) {
          const q = this.local(s);
          const w = this.toWorld(q.x, q.y);
          const pr = g.stroke.pressure ? s.pressure || 0.5 : 0.5;
          if (Math.hypot(w.x - last[0], w.y - last[1]) * this.cam.zoom > 1.5) moved = true;
          g.stroke.points.push([w.x, w.y, pr] as Point);
        }
        if (moved && g.stroke.tool === 'pen') this.armHold();
        break;
      }
      case 'shape': {
        const w = this.toWorld(p.x, p.y);
        const [a] = g.item.pts;
        let bx = w.x, by = w.y;
        if (e.shiftKey) {
          if (g.item.kind === 'line' || g.item.kind === 'arrow') {
            const ang = Math.round(Math.atan2(by - a[1], bx - a[0]) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(bx - a[0], by - a[1]);
            bx = a[0] + Math.cos(ang) * len;
            by = a[1] + Math.sin(ang) * len;
          } else {
            const d = Math.max(Math.abs(bx - a[0]), Math.abs(by - a[1]));
            bx = a[0] + Math.sign(bx - a[0] || 1) * d;
            by = a[1] + Math.sign(by - a[1] || 1) * d;
          }
        }
        g.item = { ...g.item, pts: [a, [bx, by]] };
        break;
      }
      case 'resize': {
        const w = this.toWorld(p.x, p.y);
        const vx = g.cx - g.ax, vy = g.cy - g.ay;
        const len2 = vx * vx + vy * vy || 1;
        g.s = Math.max(0.05, ((w.x - g.ax) * vx + (w.y - g.ay) * vy) / len2);
        break;
      }
      case 'erase':
        for (const s of samples) {
          const q = this.local(s);
          const w = this.toWorld(q.x, q.y);
          this.eraseAt(w.x, w.y);
        }
        break;
      case 'move': {
        const w = this.toWorld(p.x, p.y);
        g.dx = w.x - g.wx;
        g.dy = w.y - g.wy;
        break;
      }
      case 'marquee': {
        const w = this.toWorld(p.x, p.y);
        g.x1 = w.x;
        g.y1 = w.y;
        break;
      }
    }
    this.requestRender();
  }

  private onPointerUp(e: PointerEvent) {
    if (e.pointerType === 'touch') {
      this.touches.delete(e.pointerId);
      if (this.pinch && this.touches.size < 2) {
        this.pinch = null;
        this.events.onViewChange(this.view);
      }
    }
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    delete this.canvas.dataset.grabbing;
    const g = this.gesture;
    this.gesture = { kind: 'none' };

    switch (g.kind) {
      case 'draw':
        clearTimeout(this.holdTimer);
        this.commit([...this.items, g.snapped ?? g.stroke]);
        break;
      case 'shape': {
        const [a, b] = g.item.pts;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) * this.cam.zoom > 3) this.commit([...this.items, g.item]);
        break;
      }
      case 'resize':
        if (Math.abs(g.s - 1) > 0.001) {
          this.commit(this.items.map((i) => (this.selection.has(i.id) ? scaleItem(i, g.ax, g.ay, g.s) : i)));
        }
        break;
      case 'erase':
        if (g.removed.size) {
          this.undoStack.push(g.before);
          if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
          this.redoStack = [];
          this.changed();
        }
        break;
      case 'move':
        if (g.dx || g.dy) {
          this.commit(this.items.map((i) => (this.selection.has(i.id) ? translateItem(i, g.dx, g.dy) : i)));
        }
        break;
      case 'marquee': {
        const r: Rect = {
          x: Math.min(g.x0, g.x1),
          y: Math.min(g.y0, g.y1),
          w: Math.abs(g.x1 - g.x0),
          h: Math.abs(g.y1 - g.y0),
        };
        for (const it of this.items) if (!isLocked(it) && rectsIntersect(r, itemBounds(it))) this.selection.add(it.id);
        this.events.onSelectionChange(this.selection.size);
        break;
      }
      case 'pan':
        this.events.onViewChange(this.view);
        break;
    }
    this.requestRender();
  }

  /** Tenendo fermo il puntatore per mezzo secondo, il tratto diventa una forma. */
  private armHold() {
    clearTimeout(this.holdTimer);
    this.holdTimer = window.setTimeout(() => {
      const g = this.gesture;
      if (g.kind !== 'draw' || g.snapped) return;
      const shape = recognize(g.stroke, g.stroke.id);
      if (!shape) return;
      g.snapped = shape;
      this.events.onShapeSnap?.();
      this.requestRender();
    }, 550);
  }

  /** Maniglia di ridimensionamento sotto il punto dello schermo. */
  private handleAt(sx: number, sy: number): Corner | null {
    if (this.tool !== 'select') return null;
    const sb = this.selectionBounds();
    if (!sb) return null;
    const pad = 6;
    const a = this.toScreen(sb.x, sb.y), b = this.toScreen(sb.x + sb.w, sb.y + sb.h);
    const corners: [Corner, number, number][] = [
      ['nw', a.x - pad, a.y - pad],
      ['ne', b.x + pad, a.y - pad],
      ['sw', a.x - pad, b.y + pad],
      ['se', b.x + pad, b.y + pad],
    ];
    for (const [c, x, y] of corners) if (Math.abs(sx - x) <= 9 && Math.abs(sy - y) <= 9) return c;
    return null;
  }

  private cancelGesture() {
    clearTimeout(this.holdTimer);
    if (this.gesture.kind === 'erase' && this.gesture.removed.size) this.items = this.gesture.before;
    this.gesture = { kind: 'none' };
    this.activePointer = null;
    this.requestRender();
  }

  private startPinch() {
    const [a, b] = [...this.touches.values()];
    this.pinch = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      zoom: this.cam.zoom,
      camX: this.cam.x,
      camY: this.cam.y,
    };
  }

  private updatePinch() {
    const pz = this.pinch;
    if (!pz) return;
    const [a, b] = [...this.touches.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pz.zoom * (dist / pz.dist)));
    const wx = pz.camX + pz.cx / pz.zoom, wy = pz.camY + pz.cy / pz.zoom;
    this.cam = { zoom, x: wx - cx / zoom, y: wy - cy / zoom };
    this.events.onZoomChange(zoom);
    this.positionEditor();
    this.requestRender();
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = this.local(e);
    // Ctrl + rotella (o pizzico sul touchpad) = zoom; rotella = scorrimento.
    if (e.ctrlKey || e.metaKey) {
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      this.zoomAt(Math.exp(-delta * 0.0025), p.x, p.y);
      return;
    }
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 16;
      dy *= 16;
    }
    if (e.shiftKey && !dx) {
      dx = dy;
      dy = 0;
    }
    this.cam.x += dx / this.cam.zoom;
    this.cam.y += dy / this.cam.zoom;
    this.viewChanged();
  }

  private onDoubleClick(e: MouseEvent) {
    if (this.tool !== 'select') return;
    const p = this.local(e);
    const w = this.toWorld(p.x, p.y);
    const hit = hitTest(this.items, w.x, w.y, 4 / this.cam.zoom);
    if (hit && hit.type === 'text') this.openEditor(hit);
  }

  private eraseAt(x: number, y: number) {
    const g = this.gesture;
    if (g.kind !== 'erase') return;
    const radius = this.styles.eraser.size / 2 / this.cam.zoom;
    const keep = this.items.filter((it) => {
      if ((it.type === 'stroke' && strokeHits(it, x, y, radius)) || (it.type === 'shape' && shapeHits(it, x, y, radius))) {
        g.removed.add(it.id);
        return false;
      }
      return true;
    });
    if (keep.length !== this.items.length) {
      this.items = keep;
      this.events.onItemsChange(this.items);
    }
  }

  private selectionBounds(): Rect | null {
    if (!this.selection.size) return null;
    return unionRects(this.items.filter((i) => this.selection.has(i.id)).map(itemBounds));
  }

  // ---------- Editor di testo ----------

  private openEditor(item: TextItem | null, x = 0, y = 0) {
    this.commitEditor();
    const st = this.styles.text;
    const ta = document.createElement('textarea');
    ta.className = 'text-editor';
    ta.spellcheck = true;
    ta.setAttribute('aria-label', 'Testo');
    ta.dataset.x = String(item ? item.x : x);
    ta.dataset.y = String(item ? item.y : y);
    ta.dataset.size = String(item ? item.size : st.size);
    ta.dataset.color = item ? item.color : st.color;
    ta.value = item ? item.text : '';
    this.editingId = item ? item.id : null;
    this.editor = ta;
    this.host.appendChild(ta);
    this.positionEditor();
    this.autosizeEditor();
    ta.addEventListener('input', () => this.autosizeEditor());
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))) {
        ev.preventDefault();
        this.commitEditor();
        this.canvas.focus();
      }
    });
    ta.addEventListener('blur', () => this.commitEditor());
    // Nasconde il testo originale mentre si modifica.
    this.requestRender();
    requestAnimationFrame(() => ta.focus());
  }

  private positionEditor() {
    const ta = this.editor;
    if (!ta) return;
    const s = this.toScreen(Number(ta.dataset.x), Number(ta.dataset.y));
    const size = Number(ta.dataset.size) * this.cam.zoom;
    ta.style.left = s.x + 'px';
    ta.style.top = s.y + 'px';
    ta.style.fontSize = size + 'px';
    ta.style.lineHeight = String(TEXT_LINE);
    ta.style.color = ta.dataset.color || '';
    this.autosizeEditor();
  }

  private autosizeEditor() {
    const ta = this.editor;
    if (!ta) return;
    ta.style.width = '4px';
    ta.style.height = '4px';
    ta.style.width = Math.max(ta.scrollWidth + 8, 40) + 'px';
    ta.style.height = ta.scrollHeight + 'px';
  }

  commitEditor() {
    const ta = this.editor;
    if (!ta) return;
    this.editor = null;
    const id = this.editingId;
    this.editingId = null;
    const text = ta.value.replace(/\s+$/, '');
    ta.remove();
    const existing = id ? this.items.find((i) => i.id === id) : undefined;
    if (existing && existing.type === 'text') {
      if (!text) this.commit(this.items.filter((i) => i.id !== id));
      else if (text !== existing.text) this.commit(this.items.map((i) => (i.id === id ? { ...existing, text } : i)));
      else this.requestRender();
    } else if (text) {
      const item: TextItem = {
        type: 'text',
        id: uid(),
        x: Number(ta.dataset.x),
        y: Number(ta.dataset.y),
        text,
        color: ta.dataset.color || '#1b2230',
        size: Number(ta.dataset.size),
      };
      this.commit([...this.items, item]);
    } else this.requestRender();
  }

  get isEditingText(): boolean {
    return this.editor !== null;
  }

  // ---------- Disegno ----------

  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private image(src: string): HTMLImageElement | null {
    let img = this.images.get(src);
    if (!img) {
      img = new Image();
      img.onload = () => this.requestRender();
      img.src = src;
      this.images.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  private render() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER_COLOR;
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawPaper(width / this.dpr, height / this.dpr);

    const z = this.cam.zoom;
    ctx.save();
    ctx.scale(z, z);
    ctx.translate(-this.cam.x, -this.cam.y);

    const viewRect: Rect = { x: this.cam.x, y: this.cam.y, w: width / this.dpr / z, h: height / this.dpr / z };
    const g = this.gesture;
    const moving = g.kind === 'move' ? g : null;
    const resizing = g.kind === 'resize' ? g : null;

    // Trasformazione di anteprima per gli elementi selezionati che si stanno spostando o ridimensionando.
    const preview = (c: CanvasRenderingContext2D) => {
      if (moving) c.translate(moving.dx, moving.dy);
      else if (resizing) {
        c.translate(resizing.ax, resizing.ay);
        c.scale(resizing.s, resizing.s);
        c.translate(-resizing.ax, -resizing.ay);
      }
    };

    for (const it of this.items) {
      if (it.id === this.editingId) continue;
      const sel = (moving || resizing) && this.selection.has(it.id);
      if (sel) {
        ctx.save();
        preview(ctx);
      }
      const b = itemBounds(it);
      const visible = sel || rectsIntersect(b, viewRect);
      if (visible) drawItem(ctx, it, (src) => this.image(src));
      if (sel) ctx.restore();
    }
    if (g.kind === 'draw') {
      if (g.snapped) drawShape(ctx, g.snapped);
      else drawStroke(ctx, g.stroke, true);
    }
    if (g.kind === 'shape') drawShape(ctx, g.item);

    // Evidenziazione di un risultato di ricerca
    if (this.flash) {
      const it = this.items.find((i) => i.id === this.flash!.id);
      if (it) {
        const b = itemBounds(it);
        const left = this.flash.until - performance.now();
        const alpha = Math.max(0, Math.min(1, left / 600));
        const pad = 10 / z;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(255, 210, 63, 0.18)';
        ctx.strokeStyle = '#d9a400';
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        ctx.roundRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, 8 / z);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // Selezione
    const sb = this.selectionBounds();
    if (sb) {
      ctx.save();
      preview(ctx);
      const pad = 6 / z;
      const k = resizing ? resizing.s : 1; // lo spessore del riquadro resta costante a schermo
      ctx.lineWidth = 1.5 / z / k;
      ctx.strokeStyle = '#1f7a73';
      ctx.setLineDash([6 / z / k, 4 / z / k]);
      ctx.strokeRect(sb.x - pad, sb.y - pad, sb.w + pad * 2, sb.h + pad * 2);
      ctx.setLineDash([]);
      if (this.tool === 'select' && !moving) {
        const hs = 9 / z / k;
        ctx.fillStyle = '#ffffff';
        for (const [x, y] of [
          [sb.x - pad, sb.y - pad],
          [sb.x + sb.w + pad, sb.y - pad],
          [sb.x - pad, sb.y + sb.h + pad],
          [sb.x + sb.w + pad, sb.y + sb.h + pad],
        ]) {
          ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs);
          ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs);
        }
      }
      ctx.restore();
    }
    if (g.kind === 'marquee') {
      ctx.fillStyle = 'rgba(31,122,115,0.08)';
      ctx.strokeStyle = '#1f7a73';
      ctx.lineWidth = 1 / z;
      const x = Math.min(g.x0, g.x1), y = Math.min(g.y0, g.y1);
      ctx.fillRect(x, y, Math.abs(g.x1 - g.x0), Math.abs(g.y1 - g.y0));
      ctx.strokeRect(x, y, Math.abs(g.x1 - g.x0), Math.abs(g.y1 - g.y0));
    }
    ctx.restore();

    // Cursore della gomma
    if (this.tool === 'eraser' && this.hover && !this.spaceDown) {
      ctx.beginPath();
      ctx.arc(this.hover.x, this.hover.y, this.styles.eraser.size / 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#5d6676';
      ctx.stroke();
    }
  }

  private drawPaper(w: number, h: number) {
    if (this.paper === 'bianca') return;
    const ctx = this.ctx;
    const z = this.cam.zoom;
    const base = this.paper === 'righe' ? 32 : this.paper === 'quadretti' ? 20 : 24;
    let step = base;
    while (step * z < 8) step *= 5;
    const s = step * z;
    const ox = -((this.cam.x * z) % s);
    const oy = -((this.cam.y * z) % s);
    ctx.save();
    if (this.paper === 'puntini') {
      ctx.fillStyle = '#b4bfcd';
      const r = Math.max(0.8, Math.min(1.6, 1.2 * z));
      for (let x = ox; x < w + s; x += s) for (let y = oy; y < h + s; y += s) ctx.fillRect(x - r / 2, y - r / 2, r, r);
    } else {
      ctx.lineWidth = 1;
      ctx.strokeStyle = this.paper === 'righe' ? '#b9cbe3' : '#d4deea';
      ctx.beginPath();
      for (let y = oy; y < h + s; y += s) {
        const yy = Math.round(y) + 0.5;
        ctx.moveTo(0, yy);
        ctx.lineTo(w, yy);
      }
      if (this.paper === 'quadretti') {
        for (let x = ox; x < w + s; x += s) {
          const xx = Math.round(x) + 0.5;
          ctx.moveTo(xx, 0);
          ctx.lineTo(xx, h);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------- Funzioni di disegno condivise (anche per l'esportazione PNG) ----------

export function drawStroke(ctx: CanvasRenderingContext2D, s: StrokeItem, live = false) {
  ctx.save();
  if (s.tool === 'highlighter') {
    ctx.globalAlpha = 0.45;
    ctx.globalCompositeOperation = 'multiply';
  }
  ctx.fillStyle = s.color;
  ctx.fill(strokePath(s, live));
  ctx.restore();
}

export function drawShape(ctx: CanvasRenderingContext2D, s: ShapeItem) {
  const [a, b] = s.pts;
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (s.kind) {
    case 'line':
    case 'arrow': {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      if (s.kind === 'arrow') {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const len = Math.min(arrowHeadLength(s), Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.6);
        ctx.beginPath();
        ctx.moveTo(b[0] - Math.cos(ang - 0.45) * len, b[1] - Math.sin(ang - 0.45) * len);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(b[0] - Math.cos(ang + 0.45) * len, b[1] - Math.sin(ang + 0.45) * len);
        ctx.stroke();
      }
      break;
    }
    case 'rect':
      ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      break;
    case 'ellipse':
      ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'polygon':
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.stroke();
      break;
  }
  ctx.restore();
}

export function drawItem(
  ctx: CanvasRenderingContext2D,
  it: Item,
  getImage: (src: string) => HTMLImageElement | null,
) {
  if (it.type === 'stroke') drawStroke(ctx, it);
  else if (it.type === 'shape') drawShape(ctx, it);
  else if (it.type === 'text') {
    ctx.save();
    ctx.font = textFont(it.size);
    ctx.fillStyle = it.color;
    ctx.textBaseline = 'middle';
    const lh = it.size * TEXT_LINE;
    it.text.split('\n').forEach((line, i) => ctx.fillText(line, it.x, it.y + i * lh + lh / 2));
    ctx.restore();
  } else {
    const img = getImage(it.src);
    if (img) ctx.drawImage(img, it.x, it.y, it.w, it.h);
    else {
      ctx.save();
      ctx.fillStyle = '#e8ecf1';
      ctx.fillRect(it.x, it.y, it.w, it.h);
      ctx.restore();
    }
  }
}
