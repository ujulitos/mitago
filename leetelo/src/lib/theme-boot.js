// Loaded as a classic script in <head>, before any CSS-dependent paint: apply
// the last theme choice ('sepia' | 'twilight' | 'fog' | 'contrast') so the page never flashes.
// The setting itself lives in IndexedDB; this is only a fast mirror.
(() => {
  const bg = { sepia: '#F0DEC6', twilight: '#2B2B2B', fog: '#313745', contrast: '#000000', wood: '#17181b' };
  let choice = 'sepia';
  try {
    let theme = localStorage.getItem('rp-setting:theme') || localStorage.getItem('rpTheme');
    if (theme && theme.startsWith('"')) {
      try { theme = JSON.parse(theme); } catch {}
    }
    if (theme === 'sepia' || theme === 'twilight' || theme === 'fog' || theme === 'contrast' || theme === 'wood') choice = theme;
    else if (theme === 'crepusculo') choice = 'twilight';
    else if (theme === 'niebla' || theme === 'mist') choice = 'fog';
    else if (theme === 'madera') choice = 'wood';
    else if (theme === 'contraste' || theme === 'dark') choice = 'contrast';
    else if (theme === 'light') choice = 'sepia';
    else if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) choice = 'contrast';
  } catch {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) choice = 'contrast';
  }
  document.documentElement.dataset.theme = choice;
  delete document.documentElement.dataset.paper;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg[choice]);
})();
