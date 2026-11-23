// Theme choices: the 5 reading palettes (Sepia, Crepúsculo, Niebla, Contraste, Madera).
export const THEMES = Object.freeze(['sepia', 'twilight', 'fog', 'wood', 'contrast']);

const THEME_BG = {
  sepia: '#F0DEC6',
  twilight: '#2B2B2B',
  fog: '#313745',
  wood: '#17181b',
  contrast: '#000000',
};

export function resolveTheme(theme) {
  if (THEMES.includes(theme)) return theme;
  if (theme === 'crepusculo') return 'twilight';
  if (theme === 'niebla' || theme === 'mist') return 'fog';
  if (theme === 'madera') return 'wood';
  if (theme === 'contraste' || theme === 'dark') return 'contrast';
  if (theme === 'light') return 'sepia';
  try {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'contrast';
    }
  } catch { /* ignore */ }
  return 'sepia';
}

const HOME_BG = {
  sepia: '#F0DEC6',
  twilight: '#17181b',
  fog: '#313745',
  wood: '#2B2B2B',
  contrast: '#000000',
};

let themeRaf = 0;
let restoreUrl = null;
let lastRepaintTarget = null;
let lastDrawerTarget = null;

export function syncThemeColorMeta(choice) {
  cancelAnimationFrame(themeRaf);
  if (lastRepaintTarget) {
    lastRepaintTarget.style.transform = '';
    lastRepaintTarget = null;
  }
  if (lastDrawerTarget) {
    lastDrawerTarget.style.opacity = '';
    lastDrawerTarget = null;
  }
  const resolved = resolveTheme(choice ?? document.documentElement.dataset.theme);
  const root = document.documentElement;
  const readingEl = document.getElementById('reading');
  const inReading = Boolean(readingEl && !readingEl.hidden);
  const color = (inReading ? THEME_BG[resolved] : HOME_BG[resolved]) || THEME_BG[resolved];
  const isDark = resolved !== 'sepia';

  root.style.colorScheme = isDark ? 'dark' : 'light';
  root.style.backgroundColor = color;
  if (document.body) document.body.style.backgroundColor = color;

  const activeLayer = inReading ? readingEl : document.getElementById('library');
  if (activeLayer && !activeLayer.hidden) {
    activeLayer.style.backgroundColor = color;
  }

  const head = document.head;
  if (!head) return;
  for (const old of head.querySelectorAll('meta[name="theme-color"]')) old.remove();
  const immediate = document.createElement('meta');
  immediate.name = 'theme-color';
  immediate.content = color;
  head.append(immediate);

  if (typeof requestAnimationFrame !== 'function') return;
  const drawerEl = !inReading ? document.getElementById('lib-drawer') : null;
  const drawerOpen = Boolean(drawerEl && !drawerEl.hidden);
  const repaintTarget = inReading
    ? readingEl
    : (drawerOpen || document.body?.classList.contains('home-scroll-locked'))
      ? activeLayer
      : (document.querySelector('#library .lib-head') || activeLayer);
  if (restoreUrl === null && location.hash !== '#_') {
    restoreUrl = `${location.pathname}${location.search}${location.hash}`;
  }
  themeRaf = requestAnimationFrame(() => {
    for (const old of head.querySelectorAll('meta[name="theme-color"]')) old.remove();
    if (repaintTarget && !repaintTarget.hidden && (!activeLayer || !activeLayer.hidden)) {
      repaintTarget.style.transform = 'translateZ(0)';
      lastRepaintTarget = repaintTarget;
    }
    if (drawerOpen && drawerEl) {
      drawerEl.style.opacity = '0.999';
      lastDrawerTarget = drawerEl;
    }
    void root.offsetHeight;
    if (restoreUrl !== null) {
      try { history.replaceState(history.state, '', `${location.pathname}${location.search}#_`); } catch { /* ignore */ }
    }
    themeRaf = requestAnimationFrame(() => {
      if (repaintTarget) repaintTarget.style.transform = '';
      if (lastRepaintTarget === repaintTarget) lastRepaintTarget = null;
      if (drawerEl) drawerEl.style.opacity = '';
      if (lastDrawerTarget === drawerEl) lastDrawerTarget = null;
      for (const old of head.querySelectorAll('meta[name="theme-color"]')) old.remove();
      const fresh = document.createElement('meta');
      fresh.name = 'theme-color';
      fresh.content = color;
      head.append(fresh);
      void root.offsetHeight;
      themeRaf = requestAnimationFrame(() => {
        if (restoreUrl !== null) {
          const cleanUrl = restoreUrl;
          restoreUrl = null;
          try { history.replaceState(history.state, '', cleanUrl); } catch { /* ignore */ }
        }
      });
    });
  });
}

// Apply a theme choice ('sepia' | 'twilight' | 'fog' | 'contrast' | 'wood') and mirror it for theme-boot.js.
export function applyTheme(theme) {
  const choice = resolveTheme(theme);
  const root = document.documentElement.dataset;
  root.theme = choice;
  delete root.paper;
  syncThemeColorMeta(choice);
  try {
    localStorage.setItem('rpTheme', choice);
  } catch { /* storage unavailable */ }
  return choice;
}
