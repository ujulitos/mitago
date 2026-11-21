// Inline SVG icons (no icon fonts, no network). 20×20 grid, 1.75 stroke,
// currentColor, so they follow the theme and the element's text colour.

const NS = 'http://www.w3.org/2000/svg';

const PATHS = {
  settings: 'M3 6h8M15 6h2M3 14h2M9 14h8M13 4v4M7 12v4',
  chevron: 'M6 8l4 4 4-4',
  open: 'M3 6V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-5M3 8h14M3 12v4h4M3 16l5-5',
  trash: 'M4 6h12M8 6V4h4v2M6 6l.8 10.2a1 1 0 0 0 1 .8h4.4a1 1 0 0 0 1-.8L14 6',
  check: 'M4 10.5l4 4 8-9',
  alert: 'M10 3.5l7.5 13h-15zM10 8.5v3.5M10 14.6v.1',
  info: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 9v4.5M10 6.4v.1',
  minus: 'M5 10h10',
  plus: 'M5 10h10M10 5v10',
  close: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
  download: 'M10 3v9.5M6 9l4 4 4-4M4 16.5h12',
  search: 'M8.5 14a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM12.5 12.5L17 17',
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
  copy: 'M7 7h9.5v10.5H7zM4 13.5V3.5h9.5',
  scroll: 'M6 2.5h8v15H6zM8.5 6.5h3M8.5 10h3M8.5 13.5h3',
  pages: 'M2.5 4.5h6.8v11H2.5zM10.7 4.5h6.8v11h-6.8z',
  wsNormal: 'M3 8h5.5v4H3zM11.5 8H17v4h-5.5z',
  wsWide: 'M2 8h4.5v4H2zM13.5 8H18v4h-4.5z',
  wsWider: 'M1.5 8h3v4h-3zM15.5 8h3v4h-3z',
  alignStart: 'M3.5 5h13M3.5 8.5h9M3.5 12h13M3.5 15.5h7',
  alignCenter: 'M3.5 5h13M5.5 8.5h9M3.5 12h13M6.5 15.5h7',
  alignRight: 'M3.5 5h13M7.5 8.5h9M3.5 12h13M9.5 15.5h7',
  alignJustifyHyphen: 'M3.5 5h10M15.3 5h1.2M3.5 8.5h13M3.5 12h10M15.3 12h1.2M3.5 15.5h7',
  alignJustify: 'M3.5 5h13M3.5 8.5h13M3.5 12h13M3.5 15.5h7',
  clock: 'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM10 6.2v4.3l3 1.5',
  checkDouble: 'M3 11l3.5 3.5L14 7M8 11l3.5 3.5L19 7',
  books: 'M3.5 4.5h2.5v11h-2.5zM3.5 8h2.5M7.5 4.5h2.5v11h-2.5zM7.5 8h2.5M12 5.6l2.4-.7 3 10.3-2.4.7z',
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

const FILLED = new Set(['bookmarkOn']);

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
  img.src = 'icons/icon.svg';
  img.alt = '';
  img.width = size;
  img.height = size;
  img.className = 'logo';
  img.style.objectFit = 'contain';
  img.style.display = 'inline-block';
  img.style.verticalAlign = 'middle';
  return img;
}
