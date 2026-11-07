// Quaderno di benvenuto creato al primo avvio.

import { newNotebook, newPage, uid, type Item, type Notebook, type Page, type Point } from './model';

function text(x: number, y: number, t: string, size = 20, color = '#1b2230'): Item {
  return { type: 'text', id: uid(), x, y, text: t, size, color };
}

/** Un tratto "a mano" generato: una linea leggermente ondulata. */
function wavyLine(x0: number, y: number, x1: number, amp: number, size: number, color: string, tool: 'pen' | 'highlighter'): Item {
  const points: Point[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    points.push([x, y + Math.sin(t * Math.PI * 3) * amp, 0.5]);
  }
  return { type: 'stroke', id: uid(), tool, color, size, points, pressure: false };
}

function circle(cx: number, cy: number, rx: number, ry: number, color: string): Item {
  const points: Point[] = [];
  const n = 48;
  for (let i = 0; i <= n + 4; i++) {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    const wobble = 1 + Math.sin(i * 0.7) * 0.03;
    points.push([cx + Math.cos(a) * rx * wobble, cy + Math.sin(a) * ry * wobble, 0.5]);
  }
  return { type: 'stroke', id: uid(), tool: 'pen', color, size: 3, points, pressure: false };
}

export function seedWelcome(order: number): { notebook: Notebook; pages: Page[] } {
  const nb = newNotebook('Primo quaderno', order);
  const p1 = newPage(nb.id, 'Benvenuto', 0, 'righe');
  const ink = '#1b2230';
  const muted = '#4a5466';

  p1.items = [
    wavyLine(-6, 40, 350, 1.5, 26, '#ffd23f', 'highlighter'),
    text(0, 6, 'Benvenuto in Libellus', 40),
    text(0, 80, 'Un quaderno digitale libero: scrivi a mano, digita, incolla immagini.\nTutto resta su questo dispositivo. Nessun account, nessun cloud.', 20, muted),

    text(0, 172, 'Per cominciare', 26, '#1f7a73'),
    text(0, 216,
      'P   penna: scrivi o disegna col mouse o con la penna\n' +
      'H   evidenziatore\n' +
      'E   gomma: passa sui tratti per cancellarli\n' +
      'T   testo: clicca dove vuoi scrivere\n' +
      'S   forme: linee, frecce, rettangoli, ellissi\n' +
      'V   selezione: sposta, o ridimensiona dagli angoli', 20, ink),
    text(560, 216,
      'Spazio + trascina   sposta il foglio\n' +
      'Rotella   scorri il foglio\n' +
      'Ctrl + rotella   zoom\n' +
      'Ctrl Z   annulla\n' +
      'Ctrl V   incolla un\'immagine\n' +
      'Ctrl F   cerca in tutti i quaderni', 20, ink),

    text(0, 420, 'Il foglio è infinito: continua a scrivere in ogni direzione.', 20, muted),
    circle(98, 432, 116, 21, '#c8323a'),
    text(0, 476, 'Disegna un cerchio e tieni fermo il mouse alla fine: diventa un cerchio perfetto.\nCon il pulsante PDF della barra puoi importare un documento e scriverci sopra.', 20, muted),
    text(0, 560, 'Prova qui sotto ↓', 22, '#2b59c3'),
  ];
  p1.view = { x: -60, y: -50, zoom: 1 };

  const p2 = newPage(nb.id, 'Pagina a quadretti', 1, 'quadretti');
  p2.items = [text(0, 0, 'Una pagina a quadretti da 5 mm, pronta per i tuoi appunti.', 20, muted)];
  p2.view = { x: -60, y: -50, zoom: 1 };

  return { notebook: nb, pages: [p1, p2] };
}
