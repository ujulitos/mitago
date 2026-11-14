// Inline SVG icons (no icon fonts, no network). 20×20 grid, 1.75 stroke,
// currentColor, so they follow the theme and the element's text colour.

const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  settings: 'M3 6h8M15 6h2M3 14h2M9 14h8M13 4v4M7 12v4',
  chevron: 'M6 8l4 4 4-4',
  merge: 'M3 6l4 4-4 4M17 6l-4 4 4 4M10 3v14',
  swap: 'M4 7h11M12 4l3 3-3 3M16 13H5M8 10l-3 3 3 3',
  save: 'M6 3h8a1 1 0 0 1 1 1v13l-5-3.2L5 17V4a1 1 0 0 1 1-1z',
  open: 'M3 6V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-5M3 8h14M3 12v4h4M3 16l5-5',
  trash: 'M4 6h12M8 6V4h4v2M6 6l.8 10.2a1 1 0 0 0 1 .8h4.4a1 1 0 0 0 1-.8L14 6',
  eye: 'M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10zM10 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z',
  check: 'M4 10.5l4 4 8-9',
  alert: 'M10 3.5l7.5 13h-15zM10 8.5v3.5M10 14.6v.1',
  info: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 9v4.5M10 6.4v.1',
  minus: 'M5 10h10',
  plus: 'M5 10h10M10 5v10',
  close: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
  pin: 'M7.5 3h5l-.7 5 2.7 2.6V12H5.5v-1.4L8.2 8zM10 12v5',
  drag: 'M7 5.5h.1M13 5.5h.1M7 10h.1M13 10h.1M7 14.5h.1M13 14.5h.1',
  list: 'M7 5.5h10M7 10h10M7 14.5h10M3.5 5.5h.1M3.5 10h.1M3.5 14.5h.1',
  screen: 'M3 4.5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM10 4.5v10M7 17.5h6',
  reset: 'M4 10a6 6 0 1 0 1.8-4.3M4 3.5v3h3',
  monitor: 'M3 4h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM7.5 17h5M10 14v3',
  keyboard: 'M3 5.5h14a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM5.5 8.5h.1M8.5 8.5h.1M11.5 8.5h.1M14.5 8.5h.1M6.5 11.5h7',
  shield: 'M10 2.8l6 2.4v4.5c0 3.7-2.5 6.3-6 7.5-3.5-1.2-6-3.8-6-7.5V5.2zM7.3 10l1.9 1.9 3.6-3.8',
  download: 'M10 3v9.5M6 9l4 4 4-4M4 16.5h12',
  upload: 'M10 13.5V4M6 7.5l4-4 4 4M4 16.5h12',
  gap: 'M3 4h5v12H3zM12 4h5v12h-5z',
  sun: 'M10 13.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zM10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1',
  moon: 'M16.5 12.2A6.8 6.8 0 0 1 7.8 3.5a6.8 6.8 0 1 0 8.7 8.7z',
  heart: 'M10 16.8s-6.6-3.9-6.6-8.5A3.7 3.7 0 0 1 10 6.1a3.7 3.7 0 0 1 6.6 2.2c0 4.6-6.6 8.5-6.6 8.5z',
  help: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM7.9 8.1a2.1 2.1 0 1 1 2.9 1.9c-.5.3-.8.7-.8 1.2v.4M10 13.9v.1',
  play: 'M7 4.6v10.8l8.6-5.4z',
  pause: 'M7.2 4.5v11M12.8 4.5v11',
  sparkle: 'M10 2.5l1.6 4.6 4.6 1.6-4.6 1.6L10 15l-1.6-4.7L3.8 8.7l4.6-1.6zM15.5 13l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6z',
  star: 'M10 2.6l2.3 4.7 5.1.7-3.7 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1L2.6 8l5.1-.7z',
  blocked: 'M10 17.2a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4zM4.9 4.9l10.2 10.2',
  running: 'M10 17.2a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4zM6.7 10.2l2.3 2.3 4.3-4.7',
  lock: 'M6.5 9V6.8a3.5 3.5 0 0 1 7 0V9M5 9h10v8H5z',
  search: 'M8.5 14a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM12.5 12.5L17 17',
  globe: 'M10 17.2a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4zM2.8 10h14.4M10 2.8c2 2 2.9 4.4 2.9 7.2s-.9 5.2-2.9 7.2c-2-2-2.9-4.4-2.9-7.2s.9-5.2 2.9-7.2z',
  tab: 'M1.5 16h17M3.5 16l1.6-8.6A1.8 1.8 0 0 1 6.9 6h6.2a1.8 1.8 0 0 1 1.8 1.4L16.5 16',
  // Readpane
  back: 'M16 10H4M9 5l-5 5 5 5',
  prev: 'M12 4.5L6.5 10l5.5 5.5',
  next: 'M8 4.5l5.5 5.5L8 15.5',
  contents: 'M3.5 5h13M6.5 10h10M6.5 15h10M3.5 10h.1M3.5 15h.1',
  bookmark: 'M6 3h8a1 1 0 0 1 1 1v13l-5-3.2L5 17V4a1 1 0 0 1 1-1z',
  bookmarkOn: 'M6 3h8a1 1 0 0 1 1 1v13l-5-3.2L5 17V4a1 1 0 0 1 1-1z',
  bookmarks: 'M7 2.8h8a1 1 0 0 1 1 1V15M4.5 5.5h7.5a1 1 0 0 1 1 1V17l-4.2-2.7L4.5 17V5.5z',
  highlighter: 'M12.3 3.2l4.5 4.5-7.6 7.6H4.7v-4.5zM10 5.5l4.5 4.5M3 17.6h14',
  note: 'M4 3.5h12v8.8L12.3 16H4zM12.3 16v-3.7H16M7 7.5h6M7 10.3h3.5',
  text: 'M2.5 15.5l4.2-11 4.2 11M4.1 11.5h5.2M12 15.5l2.7-7 2.8 7M13 13h3.4',
  book: 'M10 5.5C8.5 4.3 6.3 3.8 3 4v11c3.3-.2 5.5.3 7 1.5 1.5-1.2 3.7-1.7 7-1.5V4c-3.3-.2-5.5.3-7 1.5zM10 5.5v11',
  file: 'M5 2.5h7l3.5 3.5v11.5H5zM12 2.5V6h3.5',
  copy: 'M7 7h9.5v10.5H7zM4 13.5V3.5h9.5',
  lhTight: 'M4 7h12M4 10h12M4 13h12',
  lhNormal: 'M4 5.5h12M4 10h12M4 14.5h12',
  lhLoose: 'M4 3.5h12M4 10h12M4 16.5h12',
  wNarrow: 'M7 6h6M7 10h6M7 14h6',
  wMedium: 'M5 6h10M5 10h10M5 14h10',
  wWide: 'M2.5 6h15M2.5 10h15M2.5 14h15',
  scroll: 'M6 2.5h8v15H6zM8.5 6.5h3M8.5 10h3M8.5 13.5h3',
  pages: 'M2.5 4.5h6.8v11H2.5zM10.7 4.5h6.8v11h-6.8z',
  lsNormal: 'M6.5 6v8M10 6v8M13.5 6v8',
  lsWide: 'M4.5 6v8M10 6v8M15.5 6v8',
  lsWider: 'M2.5 6v8M10 6v8M17.5 6v8',
  wsNormal: 'M3 8h5.5v4H3zM11.5 8H17v4h-5.5z',
  wsWide: 'M2 8h4.5v4H2zM13.5 8H18v4h-4.5z',
  wsWider: 'M1.5 8h3v4h-3zM15.5 8h3v4h-3z',
  alignStart: 'M3.5 5h13M3.5 8.5h9M3.5 12h13M3.5 15.5h7',
  alignJustify: 'M3.5 5h13M3.5 8.5h13M3.5 12h13M3.5 15.5h7',
  clock: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6.2v4.3l3 1.5',
  checkDouble: 'M3 11l3.5 3.5L14 7M8 11l3.5 3.5L19 7',
  books: 'M3.5 4.5h2.5v11h-2.5zM3.5 8h2.5M7.5 4.5h2.5v11h-2.5zM7.5 8h2.5M12 5.6l2.4-.7 3 10.3-2.4.7z',
  dots: 'M10 4.5h.01M10 10h.01M10 15.5h.01',
  menu: 'M3 5.5h14M3 10h14M3 14.5h14',
};

function svg(width, height, viewBox) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('width', width);
  el.setAttribute('height', height);
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  return el;
}

const FILLED = new Set(['heart', 'play', 'bookmarkOn']);

export function icon(name, size = 18) {
  const el = svg(size, size, '0 0 20 20');
  el.classList.add('icon');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name]);
  path.setAttribute('fill', FILLED.has(name) ? 'currentColor' : 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.75');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  el.append(path);
  return el;
}

/**
 * The product mark: a small open book with warm sepia and clean white pages and a coral ribbon.
 * Same drawing as icons/icon.svg.
 */
export function logo(size = 28) {
  const img = document.createElement('img');
  img.src = 'icons/libro.jpg';
  img.alt = '';
  img.width = size;
  img.height = size;
  img.className = 'logo';
  img.style.borderRadius = '6px';
  img.style.objectFit = 'cover';
  img.style.display = 'inline-block';
  img.style.verticalAlign = 'middle';
  return img;
}
