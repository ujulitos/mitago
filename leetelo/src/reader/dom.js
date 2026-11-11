// Tiny DOM helpers shared by the reader page modules.

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style') node.style.cssText = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k in node && !k.startsWith('aria')) node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

/** An icon-only button: the label is both its accessible name and its tooltip. */
export function labelled(button, label) {
  button.setAttribute('aria-label', label);
  button.title = label;
  return button;
}

/** Megabytes in the reader's language ("12.4 MB"). */
export function formatSize(bytes, lang) {
  const mb = bytes / (1024 * 1024);
  const unit = mb >= 1024 ? 'gigabyte' : 'megabyte';
  const n = mb >= 1024 ? mb / 1024 : mb;
  return new Intl.NumberFormat(lang, { style: 'unit', unit, maximumFractionDigits: n < 10 ? 1 : 0 }).format(n);
}

/**
 * A radiogroup of buttons (segmented control / swatches) with arrow-key
 * movement. options: [{ value, label, content }]; onPick(value).
 */
export function radioGroup(container, options, onPick) {
  const buttons = options.map((o) => {
    const b = el('button', { type: 'button', role: 'radio', dataset: { value: String(o.value) }, title: o.label, 'aria-label': o.label }, ...(o.content ?? [o.label]));
    b.addEventListener('click', () => onPick(o.value));
    return b;
  });
  container.replaceChildren(...buttons);
  container.addEventListener('keydown', (e) => {
    const i = buttons.indexOf(document.activeElement);
    if (i < 0) return;
    const rtl = document.dir === 'rtl';
    const d = { ArrowRight: rtl ? -1 : 1, ArrowDown: 1, ArrowLeft: rtl ? 1 : -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const next = buttons[(i + d + buttons.length) % buttons.length];
    next.focus();
    next.click();
  });
  return {
    set(value) {
      for (const b of buttons) {
        const on = b.dataset.value === String(value);
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      }
    },
  };
}
