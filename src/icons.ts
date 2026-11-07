// Icone a tratto (24×24), disegnate per Libellus. currentColor, spessore 1.8.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  pen: svg('<path d="M4 20l1.2-4.6L15.6 5a2.1 2.1 0 0 1 3 3L8.2 18.4z"/><path d="M13.8 6.8l3 3"/>'),
  highlighter: svg('<path d="M9 15l-3 3h-2.5l1.6-3.2"/><path d="M8.6 11.6l7.8-7.8a1.8 1.8 0 0 1 2.6 0l1.2 1.2a1.8 1.8 0 0 1 0 2.6l-7.8 7.8z"/><path d="M8.6 11.6L7 13.2l3.8 3.8 1.6-1.6"/>'),
  eraser: svg('<path d="M7 20h13"/><path d="M4.6 14.4l9.8-9.8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 18H8z"/><path d="M9.2 9.8l5 5"/>'),
  select: svg('<path d="M5 3.5l13 6.2-5.6 1.7-2.4 5.6z"/><path d="M12.6 11.6l5 5"/>'),
  text: svg('<path d="M5 6V4.5h14V6"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>'),
  hand: svg('<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v7.5c0 4-2.6 6.5-6 6.5-2.6 0-4-1.2-5.4-3.4L3.8 13.8a1.4 1.4 0 0 1 2.2-1.7L8 14.5"/>'),
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5L6 19.5"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  fit: svg('<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>'),
  sidebar: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/>'),
  more: svg('<circle cx="5.5" cy="12" r="0.9" fill="currentColor"/><circle cx="12" cy="12" r="0.9" fill="currentColor"/><circle cx="18.5" cy="12" r="0.9" fill="currentColor"/>'),
  trash: svg('<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.9 12.2a1 1 0 0 0 1 .8h7.2a1 1 0 0 0 1-.8L17.5 7"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>'),
  download: svg('<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19.5h14"/>'),
  upload: svg('<path d="M12 15V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M5 19.5h14"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
  keyboard: svg('<rect x="3" y="6.5" width="18" height="11" rx="2"/><path d="M7 10.5h.01M10.3 10.5h.01M13.6 10.5h.01M17 10.5h.01M8 14h8"/>'),
  shape: svg('<rect x="3.5" y="10.5" width="10" height="10" rx="1.5"/><circle cx="15.5" cy="8.5" r="5"/>'),
  line: svg('<path d="M5 19L19 5"/>'),
  arrow: svg('<path d="M5 19L19 5"/><path d="M10 5h9v9"/>'),
  rect: svg('<rect x="4" y="6" width="16" height="12" rx="1"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'),
  pdf: svg('<path d="M6.5 3.5h8l4 4v12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M14.5 3.5v4h4"/><path d="M8.5 16.5v-4h1.3a1.2 1.2 0 0 1 0 2.4H8.5M13 12.5v4h.8a2 2 0 0 0 0-4z"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  page: svg('<path d="M6.5 3.5h8l4 4v12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z"/><path d="M14.5 3.5v4h4"/>'),
};
