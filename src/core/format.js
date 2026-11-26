// Text helpers for natural spoken output.

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return plural(r, 'second');
  if (r === 0) return plural(m, 'minute');
  return `${plural(m, 'minute')} ${plural(r, 'second')}`;
}

/** "m:ss" for logs and visual display. */
export function clockString(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function listWords(items, conj = 'and') {
  const a = items.filter(Boolean);
  if (a.length === 0) return '';
  if (a.length === 1) return a[0];
  if (a.length === 2) return `${a[0]} ${conj} ${a[1]}`;
  return `${a.slice(0, -1).join(', ')}, ${conj} ${a[a.length - 1]}`;
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function withArticle(name) {
  if (/^(the|a|an|your|some)\s/i.test(name)) return name;
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

/** Simple {placeholder} templating for story text. */
export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

/** Split text into chunks of at most `maxSentences` sentences for the speech queue. */
export function chunkSentences(text, maxSentences = 3) {
  const clean = String(text).replace(/\bDr\.\s/g, 'Doctor ').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [clean];
  for (let i = 0; i < sentences.length; i++) sentences[i] = sentences[i].trim();
  const out = [];
  for (let i = 0; i < sentences.length; i += maxSentences) {
    out.push(sentences.slice(i, i + maxSentences).join(' ').trim());
  }
  return out.filter(Boolean);
}

export function stepsWords(n) {
  return plural(n, 'step');
}
