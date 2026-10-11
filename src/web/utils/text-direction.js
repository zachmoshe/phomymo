/** Keep older saved text automatic; never reverse strings or their digits. */
export function normalizeTextDirection(direction) {
  return direction === 'rtl' || direction === 'ltr' ? direction : 'auto';
}

/** Resolve a paragraph's base direction from its first strong letter. */
export function resolveTextDirection(text, direction = 'auto') {
  const normalized = normalizeTextDirection(direction);
  if (normalized !== 'auto') return normalized;
  for (const char of String(text || '')) {
    if (char === '\u200f' || char === '\u061c') return 'rtl';
    if (char === '\u200e') return 'ltr';
    // Digits, spaces, punctuation and combining marks do not choose direction.
    if (!/\p{Letter}/u.test(char)) continue;
    return /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff\u{10800}-\u{10fff}\u{1e800}-\u{1eeff}]/u.test(char) ? 'rtl' : 'ltr';
  }
  return 'ltr';
}
