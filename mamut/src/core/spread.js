// Two-page spreads for the paginated view: how many pages sit side by side, and
// where. PURE (no DOM), unit-tested in test/unit/spread.test.mjs.

/** Most a page's side margin grows to in a spread (the gutter between the pages is twice this). */
export const INNER = 48;

/**
 * Pages per screen. spread: 'auto' | '1' | '2' (the reader's setting). Auto = two pages
 * when half the view holds a text column of the reader's line length (maxWidth) with its
 * margins on both sides; one page otherwise.
 */
export function spanFor(width, { spread = 'auto', maxWidth, margin }) {
  if (String(spread) === '1' || String(spread) === '2') return Number(spread);
  return width / 2 - 2 * margin >= maxWidth ? 2 : 1;
}

/**
 * Page geometry for a view `width` px wide -> { span, off, m }:
 *   span  pages side by side (1 or 2)
 *   off   blank px left on each outer side: a spread is centred and never wider than two
 *         pages of the line length, so a very wide window does not open a wide gutter
 *   m     each page's side margin (2m between two columns)
 * One page: the margins take whatever the line length leaves, as always.
 */
export function pageGeometry(width, style) {
  const margin = style.marginH ?? style.margin ?? 120;
  const span = spanFor(width, style);
  if (span === 1) return { span, off: 0, m: margin };
  const half = width / 2;
  const maxWidth = style.maxWidth ?? 1200;
  const m = Math.round(Math.max(margin, Math.min(INNER, (half - maxWidth) / 2)));
  const text = Math.max(0, Math.min(maxWidth, half - 2 * m));
  return { span, off: Math.max(0, Math.floor(half - text - 2 * m)), m };
}

/** First page of the spread holding page p: spreads pair pages 0-1, 2-3, ... (never shifted). */
export const spreadStart = (p, span) => Math.max(0, p - (p % span));
