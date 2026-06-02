// @ts-check
// Pure per-signal similarity functions for the scored resolver.
// All return a value in [0,1]. No DOM, no deps.

/** Exact-equality similarity. @param {unknown} a @param {unknown} b @returns {number} */
export function equalitySim(a, b) { return String(a ?? "") === String(b ?? "") ? 1 : 0; }

/** Normalized Levenshtein similarity = 1 - dist/maxLen. Both empty -> 1. @param {unknown} a @param {unknown} b @returns {number} */
export function normLevenshtein(a, b) {
  const s = String(a ?? ""), t = String(b ?? "");
  if (s === t) return 1;
  const maxLen = Math.max(s.length, t.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(s, t) / maxLen;
}

/** Jaccard over the WORD sets of two string arrays. Both empty -> 1. @param {string[]} arrA @param {string[]} arrB @returns {number} */
export function wordSetJaccard(arrA, arrB) {
  const wa = wordSet(arrA), wb = wordSet(arrB);
  if (wa.size === 0 && wb.size === 0) return 1;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union === 0 ? 1 : inter / union;
}

/**
 * URL similarity = Jaccard over TYPED, percent-decoded tokens (path segments `p:`,
 * query pairs `q:`, fragment `h:`). Raw Levenshtein over-credits URLs that share a
 * long prefix (all `/wiki/%XX…` look ~0.54 similar), destroying nav-link discrimination.
 * Host is ignored (replay vs capture origin can differ; the path is the identity).
 * Both empty -> 1, one empty -> 0.
 * @param {unknown} a @param {unknown} b @returns {number}
 */
export function urlPathSim(a, b) {
  const ta = urlTokens(a), tb = urlTokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** @param {unknown} v @returns {Set<string>} */
function urlTokens(v) {
  const raw = String(v ?? "");
  const set = new Set();
  if (raw === "") return set;
  let u;
  try { u = new URL(raw, "http://_bf_base_/"); }
  catch { set.add("r:" + raw.toLowerCase()); return set; }
  for (const seg of u.pathname.split("/")) { const s = safeDecode(seg).toLowerCase(); if (s) set.add("p:" + s); }
  for (const [k, val] of u.searchParams) set.add("q:" + k.toLowerCase() + "=" + String(val).toLowerCase());
  if (u.hash) { const h = safeDecode(u.hash.replace(/^#/, "")).toLowerCase(); if (h) set.add("h:" + h); }
  return set;
}

/** @param {string} s @returns {string} */
function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

/** Viewport-normalized position similarity = 1 - euclidean(cx,cy)/diag. @param {{cx?:number,cy?:number}} p @param {{cx?:number,cy?:number}} q @param {{w?:number,h?:number}} viewport @returns {number} */
export function numericSim(p, q, viewport) {
  const vw = (viewport && viewport.w) || 1, vh = (viewport && viewport.h) || 1;
  const dx = ((p && p.cx) || 0) - ((q && q.cx) || 0);
  const dy = ((p && p.cy) || 0) - ((q && q.cy) || 0);
  const diag = Math.sqrt(vw * vw + vh * vh) || 1;
  const sim = 1 - Math.sqrt(dx * dx + dy * dy) / diag;
  return sim < 0 ? 0 : sim > 1 ? 1 : sim;
}

/** @param {string[]} arr */
function wordSet(arr) {
  const set = new Set();
  if (!Array.isArray(arr)) return set;
  for (const s of arr) for (const w of String(s ?? "").toLowerCase().split(/\s+/)) if (w) set.add(w);
  return set;
}

/** @param {string} s @param {string} t @returns {number} */
function levenshtein(s, t) {
  const m = s.length, n = t.length;
  if (m === 0) return n; if (n === 0) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}
