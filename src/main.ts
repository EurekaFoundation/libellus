import '@fontsource/cinzel/latin-600.css';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import './styles.css';

import { Board, type Tool } from './board';
import { icons } from './icons';
import { NOTEBOOK_COLORS, PAPERS, SHAPE_KINDS, newNotebook, newPage, uid, type Item, type Notebook, type Page, type Paper } from './model';
import * as store from './store';
import { exportNotebook, exportPagePng, importNotebook, safeFilename } from './exporter';
import { saveFile } from './platform';
import { seedWelcome } from './welcome';
import { fold, search, type SearchHit } from './search';

const DEMO = import.meta.env.MODE === 'demo';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- Stato ----------

let notebooks: Notebook[] = [];
let pages: Page[] = [];
let currentPage: Page | null = null;
const expanded = new Set<string>();

const pagesOf = (nbId: string) => pages.filter((p) => p.notebookId === nbId).sort((a, b) => a.order - b.order);
const notebookOf = (page: Page) => notebooks.find((n) => n.id === page.notebookId)!;

// ---------- Salvataggio ----------

const dirty = new Set<string>();
let saveTimer = 0;
const saveState = $('save-state');

function markDirty(page: Page) {
  page.updated = Date.now();
  dirty.add(page.id);
  saveState.textContent = 'Modifiche in corso…';
  saveState.dataset.state = 'pending';
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flush, 400);
}

async function flush() {
  const ids = [...dirty];
  dirty.clear();
  try {
    for (const id of ids) {
      const p = pages.find((x) => x.id === id);
      if (p) await store.putPage(p);
    }
    showSaved();
  } catch (e) {
    saveState.textContent = 'Salvataggio non riuscito: esporta il quaderno per non perdere il lavoro';
    saveState.dataset.state = 'error';
    console.error(e);
  }
}

function showSaved() {
  if (store.isMemoryOnly()) {
    saveState.textContent = 'Il browser non permette il salvataggio: esporta il quaderno prima di chiudere';
    saveState.dataset.state = 'error';
  } else {
    saveState.textContent = 'Salvato su questo dispositivo';
    saveState.dataset.state = 'ok';
  }
}

// Salva subito quando la finestra viene chiusa o nascosta.
window.addEventListener('beforeunload', () => {
  if (dirty.size) void flush();
});
window.addEventListener('pagehide', () => {
  if (dirty.size) void flush();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && dirty.size) void flush();
});

// ---------- Lavagna ----------

const board = new Board($('board-host'), {
  onItemsChange(items: Item[]) {
    if (!currentPage) return;
    currentPage.items = items;
    markDirty(currentPage);
  },
  onViewChange(view) {
    if (!currentPage) return;
    currentPage.view = view;
    markDirty(currentPage);
  },
  onHistoryChange(canUndo, canRedo) {
    $<HTMLButtonElement>('undo').disabled = !canUndo;
    $<HTMLButtonElement>('redo').disabled = !canRedo;
  },
  onSelectionChange(count) {
    const bar = $('selbar');
    bar.hidden = count === 0;
    $('sel-count').textContent = count === 1 ? '1 elemento selezionato' : `${count} elementi selezionati`;
    $('sel-lock').hidden = count === 0 || board.selectedImages === 0;
  },
  onZoomChange(zoom) {
    $('zoom-label').textContent = Math.round(zoom * 100) + '%';
  },
});

// ---------- Strumenti ----------

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: 'pen', label: 'Penna', key: 'P' },
  { id: 'highlighter', label: 'Evidenziatore', key: 'H' },
  { id: 'eraser', label: 'Gomma', key: 'E' },
  { id: 'text', label: 'Testo', key: 'T' },
  { id: 'shape', label: 'Forme', key: 'S' },
  { id: 'select', label: 'Selezione', key: 'V' },
  { id: 'hand', label: 'Sposta il foglio', key: 'Spazio' },
];

const INKS = [
  { c: '#1b2230', n: 'Inchiostro' },
  { c: '#2b59c3', n: 'Blu' },
  { c: '#c8323a', n: 'Rosso' },
  { c: '#1d7a4a', n: 'Verde' },
  { c: '#6b4bb8', n: 'Viola' },
  { c: '#d9731a', n: 'Arancio' },
];
const MARKERS = [
  { c: '#ffd23f', n: 'Giallo' },
  { c: '#7ee08a', n: 'Verde' },
  { c: '#ff8fc7', n: 'Rosa' },
  { c: '#7cc8ff', n: 'Azzurro' },
  { c: '#ffb05c', n: 'Arancio' },
];
const SIZES: Record<string, { v: number; n: string }[]> = {
  pen: [
    { v: 2, n: 'Fine' },
    { v: 4, n: 'Media' },
    { v: 8, n: 'Grossa' },
  ],
  highlighter: [
    { v: 12, n: 'Fine' },
    { v: 22, n: 'Media' },
    { v: 34, n: 'Larga' },
  ],
  eraser: [
    { v: 10, n: 'Piccola' },
    { v: 18, n: 'Media' },
    { v: 40, n: 'Grande' },
  ],
  text: [
    { v: 16, n: 'Piccolo' },
    { v: 22, n: 'Normale' },
    { v: 34, n: 'Titolo' },
  ],
  shape: [
    { v: 2, n: 'Fine' },
    { v: 3, n: 'Media' },
    { v: 6, n: 'Grossa' },
  ],
};

function renderTools() {
  const box = $('tools');
  box.innerHTML = '';
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool';
    b.innerHTML = icons[t.id];
    b.title = `${t.label} (${t.key})`;
    b.setAttribute('aria-label', t.label);
    b.setAttribute('aria-pressed', String(board.tool === t.id));
    b.addEventListener('click', () => selectTool(t.id));
    box.appendChild(b);
  }
}

function renderStyleControls() {
  const tool = board.tool;
  const swatches = $('swatches');
  const sizes = $('sizes');
  swatches.innerHTML = '';
  sizes.innerHTML = '';
  const hasColor = tool === 'pen' || tool === 'highlighter' || tool === 'text' || tool === 'shape';
  const hasSize = hasColor || tool === 'eraser';
  swatches.hidden = !hasColor;
  sizes.hidden = !hasSize;
  if (tool === 'shape') {
    for (const k of SHAPE_KINDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'size shape-kind';
      b.innerHTML = icons[k.id];
      b.title = k.label + ' (Maiusc per linee a 45° e figure regolari)';
      b.setAttribute('aria-label', k.label);
      b.setAttribute('aria-pressed', String(board.shapeKind === k.id));
      b.addEventListener('click', () => {
        board.shapeKind = k.id;
        renderStyleControls();
      });
      swatches.appendChild(b);
    }
    const sep = document.createElement('span');
    sep.className = 'tb-sep';
    swatches.appendChild(sep);
  }
  if (hasColor) {
    const st = board.styles[tool as 'pen' | 'highlighter' | 'text' | 'shape'];
    const palette = tool === 'highlighter' ? MARKERS : INKS;
    for (const sw of palette) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.setProperty('--sw', sw.c);
      b.title = sw.n;
      b.setAttribute('aria-label', `Colore ${sw.n}`);
      b.setAttribute('aria-pressed', String(st.color.toLowerCase() === sw.c));
      b.addEventListener('click', () => {
        st.color = sw.c;
        renderStyleControls();
      });
      swatches.appendChild(b);
    }
    const custom = document.createElement('label');
    custom.className = 'swatch swatch-custom';
    custom.title = 'Altro colore';
    const isCustom = !palette.some((p) => p.c === st.color.toLowerCase());
    custom.setAttribute('aria-pressed', String(isCustom));
    if (isCustom) custom.style.setProperty('--sw', st.color);
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.id = 'custom-color';
    inp.value = st.color;
    inp.setAttribute('aria-label', 'Scegli un altro colore');
    inp.addEventListener('input', () => {
      st.color = inp.value;
      custom.style.setProperty('--sw', inp.value);
    });
    inp.addEventListener('change', () => renderStyleControls());
    custom.appendChild(inp);
    swatches.appendChild(custom);
  }
  if (hasSize) {
    const st = board.styles[tool as 'pen' | 'highlighter' | 'eraser' | 'text' | 'shape'];
    SIZES[tool].forEach((s, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'size';
      b.title = s.n;
      b.setAttribute('aria-label', `Spessore ${s.n}`);
      b.setAttribute('aria-pressed', String(st.size === s.v));
      const dot = document.createElement('span');
      dot.className = 'size-dot';
      dot.style.width = dot.style.height = `${[4, 8, 13][i]}px`;
      if (tool !== 'eraser') dot.style.background = st.color;
      b.appendChild(dot);
      b.addEventListener('click', () => {
        st.size = s.v;
        renderStyleControls();
      });
      sizes.appendChild(b);
    });
  }
}

function selectTool(t: Tool) {
  board.setTool(t);
  renderTools();
  renderStyleControls();
}

// ---------- Barra laterale ----------

function renderSidebar() {
  const nav = $('notebooks');
  nav.innerHTML = '';
  const sorted = [...notebooks].sort((a, b) => a.order - b.order);
  for (const nb of sorted) {
    const open = expanded.has(nb.id);
    const wrap = document.createElement('section');
    wrap.className = 'nb';
    wrap.style.setProperty('--spine', nb.color);
    wrap.dataset.open = String(open);

    const head = document.createElement('div');
    head.className = 'nb-head';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nb-toggle';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.innerHTML = `<span class="nb-chev">${icons.chevron}</span><span class="nb-spine" aria-hidden="true"></span><span class="nb-title"></span><span class="nb-count"></span>`;
    toggle.querySelector('.nb-title')!.textContent = nb.title;
    const count = pagesOf(nb.id).length;
    toggle.querySelector('.nb-count')!.textContent = String(count);
    toggle.addEventListener('click', () => {
      if (open) expanded.delete(nb.id);
      else expanded.add(nb.id);
      renderSidebar();
    });
    toggle.addEventListener('dblclick', () => renameNotebook(nb));
    head.appendChild(toggle);
    head.appendChild(moreButton(`Opzioni del quaderno ${nb.title}`, (anchor) =>
      showMenu(anchor, [
        { label: 'Rinomina', action: () => renameNotebook(nb) },
        { label: 'Cambia colore', action: () => cycleColor(nb) },
        { label: 'Esporta (.libellus)', action: () => doExportNotebook(nb) },
        { label: 'Elimina quaderno', danger: true, action: () => removeNotebook(nb) },
      ]),
    ));
    wrap.appendChild(head);

    if (open) {
      const list = document.createElement('ul');
      list.className = 'page-list';
      for (const p of pagesOf(nb.id)) {
        const li = document.createElement('li');
        li.className = 'page-row';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'page-link';
        if (currentPage?.id === p.id) b.setAttribute('aria-current', 'page');
        b.textContent = p.title || 'Senza titolo';
        b.addEventListener('click', () => openPage(p));
        li.appendChild(b);
        li.appendChild(moreButton(`Opzioni della pagina ${p.title}`, (anchor) =>
          showMenu(anchor, [
            { label: 'Rinomina', action: () => { openPage(p); focusTitle(); } },
            { label: 'Duplica pagina', action: () => duplicatePage(p) },
            { label: 'Sblocca elementi fissati', action: () => unlockPage(p) },
            { label: 'Sposta su', action: () => movePage(p, -1) },
            { label: 'Sposta giù', action: () => movePage(p, 1) },
            { label: 'Elimina pagina', danger: true, action: () => removePage(p) },
          ]),
        ));
        list.appendChild(li);
      }
      const addLi = document.createElement('li');
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'page-add';
      add.innerHTML = `${icons.plus}<span>Nuova pagina</span>`;
      add.addEventListener('click', () => addPage(nb));
      addLi.appendChild(add);
      list.appendChild(addLi);
      wrap.appendChild(list);
    }
    nav.appendChild(wrap);
  }
}

function moreButton(label: string, onClick: (anchor: HTMLElement) => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn more';
  b.innerHTML = icons.more;
  b.setAttribute('aria-label', label);
  b.setAttribute('aria-haspopup', 'menu');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(b);
  });
  return b;
}

// ---------- Menu e dialoghi ----------

interface MenuEntry {
  label: string;
  danger?: boolean;
  action: () => void;
}

const menu = $('menu');
function showMenu(anchor: HTMLElement, entries: MenuEntry[]) {
  menu.innerHTML = '';
  for (const en of entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.className = 'menu-item' + (en.danger ? ' danger' : '');
    b.textContent = en.label;
    b.addEventListener('click', () => {
      hideMenu();
      en.action();
    });
    menu.appendChild(b);
  }
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = r.right - mw;
  if (left < 8) left = Math.min(r.left, window.innerWidth - mw - 8);
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
  (menu.querySelector('button') as HTMLButtonElement | null)?.focus();
}
function hideMenu() {
  menu.hidden = true;
}
document.addEventListener('pointerdown', (e) => {
  if (!menu.hidden && !menu.contains(e.target as Node)) hideMenu();
});

interface DialogButton {
  label: string;
  kind?: 'primary' | 'danger';
  value: string;
}

function openDialog(title: string, body: string | HTMLElement, buttons: DialogButton[]): Promise<string | null> {
  const dlg = $('dialog');
  $('dialog-title').textContent = title;
  const bodyEl = $('dialog-body');
  bodyEl.innerHTML = '';
  if (typeof body === 'string') {
    const p = document.createElement('p');
    p.textContent = body;
    bodyEl.appendChild(p);
  } else bodyEl.appendChild(body);
  const actions = $('dialog-actions');
  actions.innerHTML = '';
  dlg.hidden = false;
  return new Promise((resolve) => {
    const close = (v: string | null) => {
      dlg.hidden = true;
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(null);
      }
    };
    document.addEventListener('keydown', onKey, true);
    dlg.onclick = (e) => {
      if (e.target === dlg) close(null);
    };
    buttons.forEach((bt) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn' + (bt.kind === 'primary' ? ' btn-primary' : bt.kind === 'danger' ? ' btn-danger-solid' : '');
      b.textContent = bt.label;
      b.addEventListener('click', () => close(bt.value));
      actions.appendChild(b);
    });
    const input = bodyEl.querySelector('input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') close('ok');
      });
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    } else (actions.lastElementChild as HTMLButtonElement | null)?.focus();
  });
}

async function askText(title: string, label: string, value: string): Promise<string | null> {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.id = 'dialog-input';
  input.value = value;
  input.maxLength = 120;
  wrap.append(span, input);
  const r = await openDialog(title, wrap, [
    { label: 'Annulla', value: 'cancel' },
    { label: 'Salva', kind: 'primary', value: 'ok' },
  ]);
  return r === 'ok' ? input.value.trim() : null;
}

let toastTimer = 0;
function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 3200);
}

// ---------- Azioni su quaderni e pagine ----------

function openPage(p: Page) {
  if (currentPage?.id === p.id) return;
  currentPage = p;
  expanded.add(p.notebookId);
  board.load(p);
  $<HTMLInputElement>('page-title').value = p.title;
  $<HTMLSelectElement>('paper').value = p.paper;
  $('crumb-notebook').textContent = notebookOf(p).title;
  try {
    localStorage.setItem('libellus:last', p.id);
  } catch {
    /* niente memoria del browser: pazienza */
  }
  renderSidebar();
  if (window.matchMedia('(max-width: 760px)').matches) setSidebar(false);
}

function focusTitle() {
  const t = $<HTMLInputElement>('page-title');
  t.focus();
  t.select();
}

async function addNotebook() {
  const title = await askText('Nuovo quaderno', 'Nome del quaderno', `Quaderno ${notebooks.length + 1}`);
  if (!title) return;
  const nb = newNotebook(title, Math.max(-1, ...notebooks.map((n) => n.order)) + 1);
  const page = newPage(nb.id, 'Pagina 1', 0);
  notebooks.push(nb);
  pages.push(page);
  await store.putMany([nb], [page]);
  expanded.add(nb.id);
  openPage(page);
  renderSidebar();
}

async function addPage(nb: Notebook) {
  const list = pagesOf(nb.id);
  const last = list[list.length - 1];
  const page = newPage(nb.id, `Pagina ${list.length + 1}`, (last?.order ?? -1) + 1, currentPage?.paper ?? 'quadretti');
  pages.push(page);
  await store.putPage(page);
  openPage(page);
  focusTitle();
}

async function duplicatePage(p: Page) {
  const copy: Page = {
    ...structuredClone(p),
    id: uid(),
    title: p.title + ' (copia)',
    order: p.order + 0.5,
    created: Date.now(),
    updated: Date.now(),
  };
  pages.push(copy);
  normalizeOrder(p.notebookId);
  await store.putMany([], pagesOf(p.notebookId));
  openPage(copy);
}

async function movePage(p: Page, dir: -1 | 1) {
  const list = pagesOf(p.notebookId);
  const i = list.findIndex((x) => x.id === p.id);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i].order, list[j].order] = [list[j].order, list[i].order];
  await store.putMany([], [list[i], list[j]]);
  renderSidebar();
}

function normalizeOrder(nbId: string) {
  pagesOf(nbId).forEach((p, i) => (p.order = i));
}

async function removePage(p: Page) {
  const ok = await openDialog('Eliminare la pagina?', `"${p.title}" verrà eliminata definitivamente.`, [
    { label: 'Annulla', value: 'cancel' },
    { label: 'Elimina', kind: 'danger', value: 'ok' },
  ]);
  if (ok !== 'ok') return;
  const nbId = p.notebookId;
  pages = pages.filter((x) => x.id !== p.id);
  await store.deletePage(p.id);
  let list = pagesOf(nbId);
  if (!list.length) {
    const fresh = newPage(nbId, 'Pagina 1', 0);
    pages.push(fresh);
    await store.putPage(fresh);
    list = [fresh];
  }
  if (currentPage?.id === p.id) {
    currentPage = null;
    openPage(list[0]);
  }
  renderSidebar();
  toast('Pagina eliminata');
}

async function renameNotebook(nb: Notebook) {
  const title = await askText('Rinomina quaderno', 'Nome del quaderno', nb.title);
  if (!title) return;
  nb.title = title;
  nb.updated = Date.now();
  await store.putNotebook(nb);
  if (currentPage && currentPage.notebookId === nb.id) $('crumb-notebook').textContent = title;
  renderSidebar();
}

async function cycleColor(nb: Notebook) {
  const i = NOTEBOOK_COLORS.indexOf(nb.color);
  nb.color = NOTEBOOK_COLORS[(i + 1) % NOTEBOOK_COLORS.length];
  await store.putNotebook(nb);
  renderSidebar();
}

async function removeNotebook(nb: Notebook) {
  const n = pagesOf(nb.id).length;
  const ok = await openDialog(
    'Eliminare il quaderno?',
    `"${nb.title}" e le sue ${n === 1 ? 'una pagina' : n + ' pagine'} verranno eliminati definitivamente. Se vuoi conservarne una copia, prima esportalo.`,
    [
      { label: 'Annulla', value: 'cancel' },
      { label: 'Elimina quaderno', kind: 'danger', value: 'ok' },
    ],
  );
  if (ok !== 'ok') return;
  const ids = pagesOf(nb.id).map((p) => p.id);
  notebooks = notebooks.filter((x) => x.id !== nb.id);
  pages = pages.filter((p) => p.notebookId !== nb.id);
  await store.deleteNotebook(nb.id, ids);
  if (!notebooks.length) await createWelcome();
  if (!currentPage || currentPage.notebookId === nb.id) {
    currentPage = null;
    const first = [...notebooks].sort((a, b) => a.order - b.order)[0];
    openPage(pagesOf(first.id)[0]);
  }
  renderSidebar();
  toast('Quaderno eliminato');
}

// ---------- Esportazione e importazione ----------

function demoBlocked(): boolean {
  if (!DEMO) return false;
  toast('In questa anteprima online il browser blocca i download: usa Libellus sul tuo computer per esportare.');
  return true;
}

async function doExportNotebook(nb: Notebook) {
  if (demoBlocked()) return;
  await flush();
  try {
    const saved = await saveFile(exportNotebook(nb, pagesOf(nb.id)), safeFilename(nb.title) + '.libellus', {
      name: 'Quaderno di Libellus',
      extensions: ['libellus'],
    });
    if (saved) toast(`Quaderno "${nb.title}" esportato`);
  } catch (e) {
    console.error(e);
    toast('Non sono riuscito a salvare il file. Prova a sceglierlo in un\'altra cartella.');
  }
}

async function doExportPng() {
  if (!currentPage) return;
  if (demoBlocked()) return;
  const blob = await exportPagePng(currentPage);
  if (!blob) {
    toast('La pagina è vuota: non c\'è niente da esportare.');
    return;
  }
  try {
    const saved = await saveFile(blob, safeFilename(currentPage.title) + '.png', { name: 'Immagine PNG', extensions: ['png'] });
    if (saved) toast('Pagina esportata come immagine');
  } catch (e) {
    console.error(e);
    toast('Non sono riuscito a salvare il file. Prova a sceglierlo in un\'altra cartella.');
  }
}

async function doImport(file: File) {
  try {
    const order = Math.max(-1, ...notebooks.map((n) => n.order)) + 1;
    const { notebook, pages: imported } = await importNotebook(file, order);
    if (!imported.length) imported.push(newPage(notebook.id, 'Pagina 1', 0));
    notebooks.push(notebook);
    pages.push(...imported);
    await store.putMany([notebook], imported);
    expanded.add(notebook.id);
    currentPage = null;
    openPage(imported.sort((a, b) => a.order - b.order)[0]);
    toast(`Quaderno "${notebook.title}" importato`);
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Importazione non riuscita.');
  }
}

function unlockPage(p: Page) {
  openPage(p);
  if (!board.lockedCount) {
    toast('In questa pagina non ci sono elementi fissati.');
    return;
  }
  board.unlockAll();
  toast('Elementi sbloccati e selezionati: ora puoi spostarli o ridimensionarli.');
}

// ---------- PDF ----------

let pdfBusy = false;
async function insertPdf(file: File) {
  if (pdfBusy) return;
  pdfBusy = true;
  const progress = $('progress');
  progress.textContent = 'Preparo il PDF…';
  progress.hidden = false;
  try {
    const { importPdf } = await import('./pdf');
    const origin = board.viewTopLeft;
    const items = await importPdf(file, origin, ({ page, total }) => {
      progress.textContent = `Importo il PDF: pagina ${page} di ${total}`;
    });
    if (!items.length) {
      toast('Il PDF non contiene pagine.');
      return;
    }
    board.addItems(items);
    board.showRect({ x: items[0].x, y: items[0].y, w: items[0].w, h: items[0].h });
    selectTool('pen');
    toast(
      `${items.length === 1 ? '1 pagina importata' : items.length + ' pagine importate'} e fissate al foglio: scrivici sopra. ` +
        'Per spostarle usa "Sblocca elementi fissati" nel menu della pagina.',
    );
  } catch (e) {
    console.error(e);
    toast(e instanceof Error ? e.message : 'Importazione del PDF non riuscita.');
  } finally {
    pdfBusy = false;
    progress.hidden = true;
  }
}

// ---------- Ricerca ----------

function renderResults(q: string) {
  const box = $('results');
  const nav = $('notebooks');
  if (!q.trim()) {
    box.hidden = true;
    nav.hidden = false;
    return;
  }
  const hits = search(q, notebooks, pages);
  box.hidden = false;
  nav.hidden = true;
  box.innerHTML = '';
  const head = document.createElement('p');
  head.className = 'results-head';
  head.textContent = hits.length
    ? hits.length === 1 ? '1 risultato' : `${hits.length}${hits.length >= 50 ? '+' : ''} risultati`
    : 'Nessun risultato. Cerco nei titoli, nei testi e nei PDF importati; la scrittura a mano non è ancora ricercabile.';
  box.appendChild(head);
  for (const h of hits) box.appendChild(resultRow(h, q));
}

function highlight(text: string, q: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const i = fold(text).indexOf(fold(q.trim()));
  if (i < 0) {
    frag.append(text);
    return frag;
  }
  const mark = document.createElement('mark');
  mark.textContent = text.slice(i, i + q.trim().length);
  frag.append(text.slice(0, i), mark, text.slice(i + q.trim().length));
  return frag;
}

function resultRow(h: SearchHit, q: string): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'result';
  const where = document.createElement('span');
  where.className = 'result-where';
  where.style.setProperty('--spine', h.notebook.color);
  where.textContent = `${h.notebook.title} › ${h.page.title || 'Senza titolo'}`;
  const snip = document.createElement('span');
  snip.className = 'result-snippet';
  if (h.kind === 'pdf') {
    const tag = document.createElement('span');
    tag.className = 'result-tag';
    tag.textContent = 'PDF';
    snip.append(tag, ' ');
  }
  snip.append(highlight(h.snippet, q));
  b.append(where, snip);
  b.addEventListener('click', () => {
    openPage(h.page);
    if (h.itemId) board.revealItem(h.itemId);
  });
  return b;
}

// ---------- Immagini ----------

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(file);
  });
}

/** Carica un'immagine riducendola a 2000 px sul lato lungo, per non appesantire il quaderno. */
async function loadImage(file: Blob): Promise<{ src: string; w: number; h: number }> {
  const url = await readAsDataUrl(file);
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Immagine non leggibile'));
    img.src = url;
  });
  const max = 2000;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 || file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return { src: url, w: img.naturalWidth, h: img.naturalHeight };
  }
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return { src: c.toDataURL(type, 0.88), w: c.width, h: c.height };
}

async function insertImageFile(file: File, at?: { x: number; y: number }) {
  try {
    const { src, w, h } = await loadImage(file);
    board.insertImage(src, w, h, at);
    renderTools();
    renderStyleControls();
  } catch {
    toast('Non riesco a leggere questa immagine.');
  }
}

// ---------- Collegamenti dell'interfaccia ----------

function setSidebar(open: boolean) {
  $('app').dataset.sidebar = open ? 'open' : 'closed';
}

function wireUi() {
  $('new-notebook').innerHTML = `${icons.plus}<span>Quaderno</span>`;
  $('import-notebook').innerHTML = `${icons.upload}<span>Importa</span>`;
  $('toggle-sidebar').innerHTML = icons.sidebar;
  $('zoom-out').innerHTML = icons.minus;
  $('zoom-in').innerHTML = icons.plus;
  $('zoom-fit').innerHTML = icons.fit;
  $('export-btn').innerHTML = `${icons.download}<span>Esporta</span>`;
  $('insert-image').innerHTML = icons.image;
  $('insert-pdf').innerHTML = icons.pdf;
  $('search-icon').innerHTML = icons.search;
  $('sel-lock').innerHTML = `${icons.lock}<span>Fissa al foglio</span>`;
  $('undo').innerHTML = icons.undo;
  $('redo').innerHTML = icons.redo;
  $('sel-duplicate').innerHTML = `${icons.copy}<span>Duplica</span>`;
  $('sel-delete').innerHTML = `${icons.trash}<span>Elimina</span>`;

  const paper = $<HTMLSelectElement>('paper');
  for (const p of PAPERS) paper.add(new Option(p.label, p.id));
  paper.addEventListener('change', () => {
    if (!currentPage) return;
    currentPage.paper = paper.value as Paper;
    board.setPaper(currentPage.paper);
    markDirty(currentPage);
  });

  const title = $<HTMLInputElement>('page-title');
  title.addEventListener('input', () => {
    if (!currentPage) return;
    currentPage.title = title.value;
    markDirty(currentPage);
  });
  title.addEventListener('change', () => {
    if (currentPage && !currentPage.title.trim()) {
      currentPage.title = 'Senza titolo';
      title.value = currentPage.title;
    }
    renderSidebar();
  });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') board.canvas.focus();
  });

  $('new-notebook').addEventListener('click', addNotebook);
  $('import-notebook').addEventListener('click', () => $('import-file').click());
  $<HTMLInputElement>('import-file').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void doImport(f);
    input.value = '';
  });
  $('toggle-sidebar').addEventListener('click', () => setSidebar($('app').dataset.sidebar !== 'open'));
  $('scrim').addEventListener('click', () => setSidebar(false));

  $('zoom-in').addEventListener('click', () => board.zoomAt(1.25));
  $('zoom-out').addEventListener('click', () => board.zoomAt(0.8));
  $('zoom-label').addEventListener('click', () => board.resetZoom());
  $('zoom-fit').addEventListener('click', () => board.fitContent());

  $('export-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentPage) return;
    const nb = notebookOf(currentPage);
    showMenu($('export-btn'), [
      { label: `Quaderno "${nb.title}" (.libellus)`, action: () => doExportNotebook(nb) },
      { label: 'Questa pagina come immagine PNG', action: doExportPng },
    ]);
  });

  $('insert-image').addEventListener('click', () => $('image-file').click());
  $<HTMLInputElement>('image-file').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void insertImageFile(f);
    input.value = '';
  });
  $('insert-pdf').addEventListener('click', () => $('pdf-file').click());
  $<HTMLInputElement>('pdf-file').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) void insertPdf(f);
    input.value = '';
  });
  $('sel-lock').addEventListener('click', () => {
    board.lockSelection();
    toast('Fissato al foglio: ora puoi scriverci sopra senza spostarlo.');
  });
  const searchInput = $<HTMLInputElement>('search');
  let searchTimer = 0;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => renderResults(searchInput.value), 120);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      renderResults('');
    } else if (e.key === 'Enter') ($('results').querySelector('.result') as HTMLButtonElement | null)?.click();
  });
  $('undo').addEventListener('click', () => board.undo());
  $('redo').addEventListener('click', () => board.redo());
  $('sel-duplicate').addEventListener('click', () => board.duplicateSelection());
  $('sel-delete').addEventListener('click', () => board.deleteSelection());
  $('show-shortcuts').addEventListener('click', showShortcuts);

  // Incolla immagini o testo.
  document.addEventListener('paste', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select') || board.isEditingText) return;
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      files.forEach((f) => void insertImageFile(f));
      return;
    }
    const text = e.clipboardData?.getData('text/plain');
    if (text?.trim()) {
      e.preventDefault();
      board.insertText(text.trim());
    }
  });

  // Trascina e rilascia.
  const host = $('board-host');
  const hint = $('drop-hint');
  host.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    hint.hidden = false;
  });
  host.addEventListener('dragleave', (e) => {
    if (!host.contains(e.relatedTarget as Node)) hint.hidden = true;
  });
  host.addEventListener('drop', (e) => {
    e.preventDefault();
    hint.hidden = true;
    const files = [...(e.dataTransfer?.files ?? [])];
    const at = board.clientToWorld(e.clientX, e.clientY);
    for (const f of files) {
      if (f.name.endsWith('.libellus') || f.type === 'application/zip') void doImport(f);
      else if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) void insertPdf(f);
      else if (f.type.startsWith('image/')) void insertImageFile(f, at);
    }
  });

  // Tastiera.
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (!$('dialog').hidden) return;
    if (target.closest('input, textarea, select') || board.isEditingText) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (mod) {
      if (k === 'z' && !e.shiftKey) board.undo();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) board.redo();
      else if (k === 'a') {
        selectTool('select');
        board.selectAll();
      } else if (k === 'd') board.duplicateSelection();
      else if (k === '0') board.resetZoom();
      else if (k === '1') board.fitContent();
      else if (k === '=' || k === '+') board.zoomAt(1.25);
      else if (k === '-') board.zoomAt(0.8);
      else if (k === 'f') {
        const si = $<HTMLInputElement>('search');
        setSidebar(true);
        si.focus();
        si.select();
      }
      else return;
      e.preventDefault();
      return;
    }
    if (e.key === ' ') {
      if (!e.repeat) board.setSpace(true);
      e.preventDefault();
      return;
    }
    if (e.altKey) return;
    const map: Record<string, Tool> = { p: 'pen', h: 'highlighter', e: 'eraser', t: 'text', s: 'shape', v: 'select' };
    if (map[k]) {
      selectTool(map[k]);
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      board.deleteSelection();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      board.clearSelection();
      hideMenu();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') board.setSpace(false);
  });
  window.addEventListener('blur', () => board.setSpace(false));
}

function showShortcuts() {
  const rows: [string, string][] = [
    ['P', 'Penna'],
    ['H', 'Evidenziatore'],
    ['E', 'Gomma'],
    ['T', 'Testo (clic sul foglio per scrivere)'],
    ['S', 'Forme: linea, freccia, rettangolo, ellisse'],
    ['V', 'Selezione: trascina per spostare, angoli per ridimensionare'],
    ['Tratto + fermo mezzo secondo', 'Diventa una forma (linea, cerchio, rettangolo, triangolo)'],
    ['Maiusc + forma', 'Linee a 45°, quadrati e cerchi'],
    ['Spazio + trascina', 'Sposta il foglio'],
    ['Rotella', 'Scorri; con Maiusc in orizzontale'],
    ['Ctrl + rotella', 'Zoom'],
    ['Ctrl 0 / Ctrl 1', 'Zoom 100% / mostra tutto'],
    ['Ctrl Z / Ctrl Y', 'Annulla / ripeti'],
    ['Ctrl A / Ctrl D', 'Seleziona tutto / duplica'],
    ['Canc', 'Elimina la selezione'],
    ['Ctrl V', 'Incolla un\'immagine o un testo'],
    ['Ctrl F', 'Cerca in tutti i quaderni'],
    ['Doppio clic su un testo', 'Modificalo (con la selezione)'],
  ];
  const dl = document.createElement('dl');
  dl.className = 'shortcuts';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    k.split(' / ').forEach((part, i) => {
      if (i) dt.append(' / ');
      const kbd = document.createElement('kbd');
      kbd.textContent = part;
      dt.appendChild(kbd);
    });
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  void openDialog('Scorciatoie da tastiera', dl, [{ label: 'Chiudi', kind: 'primary', value: 'ok' }]);
}

// ---------- Avvio ----------

async function createWelcome() {
  const { notebook, pages: ps } = seedWelcome(notebooks.length);
  notebooks.push(notebook);
  pages.push(...ps);
  await store.putMany([notebook], ps);
}

async function start() {
  wireUi();
  renderTools();
  renderStyleControls();
  board.setTool('pen');

  await store.initStore();
  const data = await store.loadAll();
  notebooks = data.notebooks;
  pages = data.pages;
  if (!notebooks.length) await createWelcome();
  // Ogni quaderno deve avere almeno una pagina.
  for (const nb of notebooks) {
    if (!pagesOf(nb.id).length) {
      const p = newPage(nb.id, 'Pagina 1', 0);
      pages.push(p);
      await store.putPage(p);
    }
  }

  let last: string | null = null;
  try {
    last = localStorage.getItem('libellus:last');
  } catch {
    last = null;
  }
  const first = [...notebooks].sort((a, b) => a.order - b.order)[0];
  const page = pages.find((p) => p.id === last) ?? pagesOf(first.id)[0];
  openPage(page);
  if (window.matchMedia('(max-width: 760px)').matches) setSidebar(false);
  showSaved();
}

void start();
