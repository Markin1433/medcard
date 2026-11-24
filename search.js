/* Поиск: русская морфология (Snowball), синонимы и сокращения, опечатки, раскладка, даты, фразы. */
'use strict';
(function () {
const MC = window.MC = window.MC || {};

/* ---------- нормализация и токены ---------- */
function norm(s) {
  return (s || '').toLowerCase().replace(/ё/g, 'е').replace(/[   ]/g, ' ').replace(/­/g, '');
}
const TOKEN_RE = /[a-zа-я0-9]+(?:[.,][0-9]+)*/g;

/* ---------- стеммер Snowball (русский) ---------- */
const PERF = /((ив|ивши|ившись|ыв|ывши|ывшись)|((?<=[ая])(в|вши|вшись)))$/;
const REFL = /(с[яь])$/;
const ADJ = /(ее|ие|ые|ое|ими|ыми|ей|ий|ый|ой|ем|им|ым|ом|его|ого|ему|ому|их|ых|ую|юю|ая|яя|ою|ею)$/;
const PART = /((ивш|ывш|ующ)|((?<=[ая])(ем|нн|вш|ющ|щ)))$/;
const VERB = /((ила|ыла|ена|ейте|уйте|ите|или|ыли|ей|уй|ил|ыл|им|ым|ен|ило|ыло|ено|ят|ует|уют|ит|ыт|ены|ить|ыть|ишь|ую|ю)|((?<=[ая])(ла|на|ете|йте|ли|й|л|ем|н|ло|но|ет|ют|ны|ть|ешь|нно)))$/;
const NOUN = /(а|ев|ов|ие|ье|е|иями|ями|ами|еи|ии|и|ией|ей|ой|ий|й|иям|ям|ием|ем|ам|ом|о|у|ах|иях|ях|ы|ь|ию|ью|ю|ия|ья|я)$/;
const RVRE = /^(.*?[аеиоуыэюя])(.*)$/;
const DERIV = /.*[^аеиоуыэюя]+[аеиоуыэюя].*ость?$/;
const stemCache = new Map();
function stem(w) {
  if (w.length < 3 || !/[а-я]/.test(w) || /[0-9a-z]/.test(w)) return w;
  let c = stemCache.get(w); if (c) return c;
  const m = RVRE.exec(w); if (!m) { stemCache.set(w, w); return w; }
  const pre = m[1]; let rv = m[2]; let t = rv.replace(PERF, '');
  if (t === rv) {
    rv = rv.replace(REFL, ''); t = rv.replace(ADJ, '');
    if (t !== rv) { rv = t.replace(PART, ''); }
    else { t = rv.replace(VERB, ''); rv = (t === rv) ? rv.replace(NOUN, '') : t; }
  } else rv = t;
  rv = rv.replace(/и$/, '');
  if (DERIV.test(rv)) rv = rv.replace(/ость?$/, '');
  t = rv.replace(/ь$/, '');
  if (t === rv) { rv = rv.replace(/(ейше|ейш)$/, ''); rv = rv.replace(/нн$/, 'н'); } else rv = t;
  let out = pre + rv; if (out.length < 3) out = w; // «отит» не должен совпасть с предлогом «от»
  stemCache.set(w, out); return out;
}

/* ---------- синонимы и сокращения (группы равнозначных выражений) ---------- */
/* словари синонимов приходят из зашифрованных данных (MC.search.setDict) */
let SYN_GROUPS = [];
/* широкие понятия → конкретные термины (только в одну сторону) */
let ONEWAY = [];
const MONTHS = { 'январ': '01', 'феврал': '02', 'март': '03', 'апрел': '04', 'ма': '05', 'мая': '05', 'май': '05', 'июн': '06', 'июл': '07', 'август': '08', 'сентябр': '09', 'октябр': '10', 'ноябр': '11', 'декабр': '12' };

/* раскладка: латиница, набранная вместо кириллицы */
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`", RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';
function fixLayout(s) { return s.toLowerCase().split('').map(ch => { const i = EN.indexOf(ch); return i >= 0 ? RU[i] : ch; }).join(''); }

function tokens(text) {
  const out = []; const n = norm(text); let m; TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(n))) {
    const raw = m[0].replace(/,/g, '.'); out.push({ raw, pos: m.index, len: m[0].length });
  }
  return out;
}
function termsOf(raw) {
  const t = [stem(raw)];
  const dm = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(raw);
  if (dm) { t.push(dm[2].padStart(2, '0') + '.' + dm[3]); t.push(dm[3]); }
  const my = /^(\d{1,2})\.(\d{4})$/.exec(raw); if (my) t.push(my[2]);
  return t;
}

/* ---------- индекс ---------- */
class Index {
  constructor() { this.items = []; this.post = new Map(); this.vocab = null; this.synIndex = null; this.k1 = 1.2; this.b = 0.6; this.avgLen = 1; }
  add(item) { // item: {id, kind, title, text, date, sections, ...}
    const idx = this.items.length;
    const fields = [['title', 4], ['text', 1], ['extra', 2]];
    let len = 0;
    for (const [f, w] of fields) {
      for (const tk of tokens(item[f] || '')) {
        for (const term of termsOf(tk.raw)) {
          let p = this.post.get(term); if (!p) { p = new Map(); this.post.set(term, p); }
          p.set(idx, (p.get(idx) || 0) + w);
        }
        len++;
      }
    }
    item._len = len; item._norm = norm((item.title || '') + '\n' + (item.text || '') + '\n' + (item.extra || ''));
    this.items.push(item); this.vocab = null; return idx;
  }
  finalize() {
    this.avgLen = this.items.reduce((a, b) => a + b._len, 0) / Math.max(1, this.items.length);
    this.vocab = [...this.post.keys()];
    this.byFirst = new Map();
    for (const v of this.vocab) { const k = v.slice(0, 1); if (!this.byFirst.has(k)) this.byFirst.set(k, []); this.byFirst.get(k).push(v); }
    // синонимы: термин → список вариантов (каждый вариант = список терминов)
    this.syn = new Map(); this._ow = true;
    for (const g of SYN_GROUPS) {
      const variants = g.map(p => tokens(p).map(t => stem(t.raw)));
      for (const v of variants) if (v.length === 1) {
        const key = v[0]; if (!this.syn.has(key)) this.syn.set(key, []);
        for (const o of variants) if (o.join(' ') !== key) this.syn.get(key).push(o);
      }
      // многословная фраза из группы, найденная в запросе, тоже ведёт к остальным (см. ниже)
      for (const v of variants) if (v.length > 1) {
        const key = v.join(' '); if (!this.syn.has(key)) this.syn.set(key, []);
        for (const o of variants) if (o.join(' ') !== key) this.syn.get(key).push(o);
      }
    }
    this.addOneWay();
  }
  addOneWay() {
    for (const [from, tos] of ONEWAY) {
      const key = tokens(from).map(t => stem(t.raw)).join(' ');
      if (!this.syn.has(key)) this.syn.set(key, []);
      for (const to of tos) this.syn.get(key).push(tokens(to).map(t => stem(t.raw)));
    }
  }
  idf(term) { const p = this.post.get(term); const n = p ? p.size : 0; return Math.log(1 + (this.items.length - n + 0.5) / (n + 0.5)); }
  termScores(term, factor, acc) {
    const p = this.post.get(term); if (!p) return 0;
    const idf = this.idf(term);
    for (const [i, tf] of p) {
      const it = this.items[i];
      const s = idf * (tf * (this.k1 + 1)) / (tf + this.k1 * (1 - this.b + this.b * it._len / this.avgLen));
      acc.set(i, Math.max(acc.get(i) || 0, s * factor));
    }
    return p.size;
  }
  fuzzy(term, maxD) {
    const out = []; const cands = this.byFirst.get(term[0]) || [];
    const pool = maxD > 1 ? this.vocab : cands.concat(this.byFirst.get(fixFirst(term[0])) || []);
    for (const v of pool) {
      if (Math.abs(v.length - term.length) > maxD) continue;
      const d = dist(term, v, maxD); if (d <= maxD && d > 0) out.push([v, d]);
    }
    return out.sort((a, b) => a[1] - b[1]).slice(0, 12);
  }
  prefix(term) {
    const out = []; for (const v of (this.byFirst.get(term[0]) || [])) if (v.length > term.length && v.startsWith(term)) out.push(v);
    return out.sort((a, b) => (this.post.get(b).size - this.post.get(a).size)).slice(0, 40);
  }

  /* основной поиск */
  search(query, opts = {}) {
    if (!this.vocab) this.finalize();
    const res = { results: [], used: query, fixed: null, terms: new Set(), phrases: [] };
    let q = (query || '').trim(); if (!q) return res;
    // фразы в кавычках
    const phrases = []; q = q.replace(/["«»“”]([^"«»“”]+)["«»“”]/g, (_, p) => { phrases.push(norm(p).trim()); return ' ' + p + ' '; });
    res.phrases = phrases;
    let attempt = this._run(q, phrases, opts, res);
    // раскладка
    if (/[a-z]/i.test(q) && (!attempt.length || attempt[0].score < 1)) {
      const fq = fixLayout(q); const res2 = { results: [], terms: new Set(), phrases };
      const alt = this._run(fq, phrases, opts, res2);
      if (alt.length && (!attempt.length || alt[0].score > attempt[0].score * 1.5)) { attempt = alt; res.fixed = fq; res.terms = res2.terms; }
    }
    res.results = attempt; return res;
  }
  _run(q, phrases, opts, res) {
    const all = tokens(q).map(t => t.raw);
    // даты в запросе: «июль 2024», «07.2024», «2024»
    const dateHints = []; const toks = [];
    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      const mk = /^[а-я]+$/.test(t) && t.length >= 3 && Object.keys(MONTHS).filter(k => k.length > 2).find(k => t.startsWith(k));
      if (mk) {
        const yr = all[i + 1] && /^\d{4}$/.test(all[i + 1]) ? all[i + 1] : null;
        dateHints.push({ month: MONTHS[mk], year: yr }); if (yr) i++; continue;
      }
      toks.push(t);
      if (/^\d{4}$/.test(t) && +t > 2015 && +t < 2040) dateHints.push({ year: t });
      const my = /^(\d{1,2})\.(\d{4})$/.exec(t); if (my) dateHints.push({ month: my[1].padStart(2, '0'), year: my[2] });
      const dmy = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t); if (dmy) dateHints.push({ day: dmy[1].padStart(2, '0'), month: dmy[2].padStart(2, '0'), year: dmy[3] });
    }
    const groups = []; // каждая группа — одно слово запроса и его варианты: [{terms:[...], f}]
    const used = new Set();
    // многословные синонимы (например «общий анализ крови»)
    const stems = toks.map(stem);
    for (let L = 4; L >= 2; L--) for (let i = 0; i + L <= stems.length; i++) {
      if ([...Array(L).keys()].some(k => used.has(i + k))) continue;
      const key = stems.slice(i, i + L).join(' ');
      if (this.syn.has(key)) {
        const vars = [{ terms: stems.slice(i, i + L), f: 1 }].concat(this.syn.get(key).map(v => ({ terms: v, f: 0.95 })));
        groups.push({ word: toks.slice(i, i + L).join(' '), vars }); for (let k = 0; k < L; k++) used.add(i + k);
      }
    }
    stems.forEach((st, i) => {
      if (used.has(i)) return;
      const raw = toks[i]; const vars = [];
      const extra = termsOf(raw).slice(1);
      vars.push({ terms: [st], f: 1 }); if (raw !== st) vars.push({ terms: [raw], f: 1 });
      for (const e of extra) vars.push({ terms: [e], f: 0.9 });
      for (const v of (this.syn.get(st) || [])) vars.push({ terms: v, f: 0.95 });
      const isLast = i === stems.length - 1;
      const exists = this.post.has(st) || this.post.has(raw);
      const pf = !exists ? (isLast ? 0.85 : 0.7) : (st.length <= 4 ? (isLast ? 0.3 : 0) : 0.45); // «вес» не должен находить «Вестергрен»
      if (st.length >= 2 && pf > 0) for (const p of this.prefix(st)) vars.push({ terms: [p], f: pf });
      if (!this.post.has(st) && st.length >= 4 && !/^\d/.test(st)) {
        for (const [v, d] of this.fuzzy(st, st.length >= 7 ? 2 : 1)) vars.push({ terms: [v], f: d === 1 ? 0.6 : 0.4 });
      }
      groups.push({ word: raw, vars });
    });
    if (!groups.length && !dateHints.length && !phrases.length) return [];
    // подсчёт
    const per = groups.map(g => {
      const acc = new Map();
      for (const v of g.vars) {
        if (v.terms.length === 1) { if (this.termScores(v.terms[0], v.f, acc)) res.terms.add(v.terms[0]); }
        else { // фраза из нескольких терминов: требуем все
          const maps = v.terms.map(t => { const m = new Map(); this.termScores(t, v.f, m); return m; });
          if (maps.some(m => !m.size)) continue;
          for (const [i] of maps[0]) if (maps.every(m => m.has(i))) acc.set(i, Math.max(acc.get(i) || 0, maps.reduce((a, m) => a + m.get(i), 0) / maps.length * 1.3));
          v.terms.forEach(t => res.terms.add(t));
        }
      }
      return acc;
    });
    const total = new Map(); const hits = new Map();
    per.forEach(acc => { for (const [i, s] of acc) { total.set(i, (total.get(i) || 0) + s); hits.set(i, (hits.get(i) || 0) + 1); } });
    if (!groups.length) this.items.forEach((_, i) => total.set(i, 0.01));
    const out = [];
    for (const [i, s] of total) {
      const it = this.items[i];
      let score = s; const cov = groups.length ? (hits.get(i) || 0) / groups.length : 1;
      score *= (0.35 + 0.65 * cov * cov);
      if (cov === 1 && groups.length > 1) score *= 1.5;
      // фразы
      let phraseOk = true; for (const p of phrases) { if (it._norm.includes(p)) score *= 2.5; else phraseOk = false; }
      if (phrases.length && !phraseOk && cov < 1) score *= 0.3;
      // даты
      if (dateHints.length) {
        const d = it.date || ''; let ok = false;
        for (const h of dateHints) if ((!h.year || d.startsWith(h.year)) && (!h.month || d.slice(5, 7) === h.month) && (!h.day || d.slice(8, 10) === h.day)) ok = true;
        if (ok) score = score * 2 + 3; else if (!groups.length) continue; else score *= 0.6;
      }
      // фильтры
      if (opts.section && !(it.sections || []).includes(opts.section)) continue;
      if (opts.year && !(it.date || '').startsWith(opts.year)) continue;
      if (opts.kind && it.kind !== opts.kind) continue;
      out.push({ item: it, score, cov });
    }
    out.sort((a, b) => b.score - a.score || (b.item.date || '').localeCompare(a.item.date || ''));
    return out;
  }
}

/* расстояние Дамерау-Левенштейна с ограничением */
function dist(a, b, max) {
  const la = a.length, lb = b.length; if (Math.abs(la - lb) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v); if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[lb];
}
function fixFirst(ch) { const i = EN.indexOf(ch); return i >= 0 ? RU[i] : ch; }

/* ---------- подсветка и фрагменты ---------- */
function matchesTerm(word, terms) {
  const w = norm(word).replace(/,/g, '.'); const s = stem(w);
  for (const t of terms) { if (t === s || t === w) return true; if (t.length >= 3 && s.startsWith(t)) return true; }
  return false;
}
function snippets(item, terms, phrases, max = 2, width = 220) {
  const text = item.text || ''; if (!text) return [];
  const lines = text.split(/\n+/).map(s => s.replace(/[*#|`>]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const scored = lines.map((l, i) => {
    let sc = 0; const seen = new Set();
    l.replace(/[A-Za-zА-Яа-яЁё0-9]+(?:[.,][0-9]+)*/g, w => { if (matchesTerm(w, terms)) { const k = stem(norm(w)); sc += seen.has(k) ? 0.3 : 1; seen.add(k); } return w; });
    for (const p of phrases) if (norm(l).includes(p)) sc += 3;
    return { l, i, sc };
  }).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, max).sort((a, b) => a.i - b.i);
  return scored.map(x => {
    let l = x.l;
    if (l.length > width) { // окно вокруг первого совпадения
      let pos = 0; const m = /[A-Za-zА-Яа-яЁё0-9]+/g; let mm;
      while ((mm = m.exec(l))) if (matchesTerm(mm[0], terms)) { pos = mm.index; break; }
      const st = Math.max(0, pos - 70); l = (st > 0 ? '…' : '') + l.slice(st, st + width) + (st + width < l.length ? '…' : '');
    }
    return l;
  });
}
function highlightHTML(escapedText, terms, phrases) {
  let html = escapedText.replace(/[A-Za-zА-Яа-яЁё0-9]+(?:[.,][0-9]+)*/g, w => matchesTerm(w, terms) ? '<mark>' + w + '</mark>' : w);
  return html;
}
/* подсветка внутри уже отрисованного HTML-узла */
function highlightNode(root, terms, phrases) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentNode && /^(SCRIPT|STYLE|MARK)$/.test(n.parentNode.nodeName)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  let count = 0;
  for (const n of nodes) {
    const t = n.nodeValue; const re = /[A-Za-zА-Яа-яЁё0-9]+(?:[.,][0-9]+)*/g; let m, last = 0; const frag = document.createDocumentFragment(); let any = false;
    while ((m = re.exec(t))) {
      if (matchesTerm(m[0], terms)) {
        any = true; frag.appendChild(document.createTextNode(t.slice(last, m.index)));
        const mk = document.createElement('mark'); mk.textContent = m[0]; frag.appendChild(mk); last = m.index + m[0].length; count++;
      }
    }
    if (any) { frag.appendChild(document.createTextNode(t.slice(last))); n.parentNode.replaceChild(frag, n); }
  }
  return count;
}

function setDict(d) { SYN_GROUPS = (d && d.groups) || []; ONEWAY = (d && d.oneway) || []; }
MC.search = { setDict, Index, norm, stem, tokens, snippets, highlightHTML, highlightNode, matchesTerm, fixLayout };
})();
