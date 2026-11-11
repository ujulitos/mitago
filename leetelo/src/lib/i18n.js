// Localization (51 languages, chrome.i18n). Works in extension pages, the
// service worker, and Node unit tests. When chrome.i18n has no message (Node,
// or Chrome briefly serving an empty catalog after an install) t() falls back
// to the bundled English, so the UI never shows a raw key.
//
//   t('key', 'sub1', 'sub2')   localized string ($1, $2 substituted)
//   tn('key', n, ...subs)      plural: key_one / key_other picked with Intl.PluralRules
//   localizeDom(root)          fills [data-i18n], [data-i18n-title], [data-i18n-aria],
//                              [data-i18n-placeholder]; sets <html lang dir>
//
// Strings live in i18n/<lang>.json; i18n/build_locales.py turns them into
// _locales/<lang>/messages.json (plus i18n-en.js) and checks every language
// against English.

import './chrome-shim.js';
import EN from './i18n-en.js';
import ES from './i18n-es.js';

const FALLBACKS = { en: EN, es: ES };

export function uiLanguage() {
  try {
    return chrome.i18n.getUILanguage() || 'es';
  } catch {
    return 'es';
  }
}

export const isRtl = (lang = uiLanguage()) => /^(ar|fa|he|ur)\b/i.test(lang);

export function t(key, ...subs) {
  const strings = subs.map(String);
  try {
    const msg = chrome.i18n.getMessage(key, strings);
    if (msg && msg !== key) return msg;
  } catch { /* no extension context: tests, or after an update */ }
  const lang = uiLanguage();
  const map = FALLBACKS[lang] ?? EN;
  const text = map[key] ?? EN[key];
  if (text === undefined) return key;
  return text.replace(/\$(?:P)?(\d)\$?/g, (_, n) => strings[Number(n) - 1] ?? '');
}

let rules;
export function tn(key, n, ...subs) {
  rules ??= new Intl.PluralRules(uiLanguage());
  const form = rules.select(n) === 'one' ? 'one' : 'other';
  return t(`${key}_${form}`, n, ...subs);
}

export function localizeDom(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  if (root === document) {
    const lang = uiLanguage();
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
  }
}
