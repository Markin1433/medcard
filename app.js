/* Медкарта — приложение. Медицинские данные приходят только из зашифрованного data.enc и записей на устройстве. */
'use strict';
(function () {
const MC = window.MC;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { data: null, key: null, notes: [], index: null, author: '', lockedAt: 0, pinSet: false, fontScale: 1 };
const LOCK_AFTER_MS = 5 * 60 * 1000;
const NOTE_TYPES = {
  note: { name: 'Заметка', icon: '🗒' },
  visit: { name: 'Приём у врача', icon: '👩‍⚕️' },
  result: { name: 'Результат анализа / обследования', icon: '🧾' },
  measure: { name: 'Рост и вес', icon: '📐' },
  med: { name: 'Лекарство', icon: '💊' },
  plan: { name: 'Запланировано', icon: '📅' },
  question: { name: 'Вопрос врачу', icon: '❓' },
  symptom: { name: 'Симптом / самочувствие', icon: '🌡' },
  vacc: { name: 'Прививка', icon: '💉' },
};
const V_STATUS = { done: '✔ сделана', indicated: '• показана', plan: '📅 запланирована', exempt: '⛔ медотвод' };

/* ---------- даты ---------- */
const MONTHS_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_N = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fmtDate = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };
const fmtLong = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+d} ${MONTHS_G[+m - 1]} ${y}`; };
function ageAt(iso) {
  const b = S.data.child.birth.split('-').map(Number); const d = iso.split('-').map(Number);
  let months = (d[0] - b[0]) * 12 + (d[1] - b[1]); if (d[2] < b[2]) months--;
  if (months < 0) return '';
  if (months < 12) return months + ' мес';
  const y = Math.floor(months / 12), m = months % 12;
  const yw = y % 10 === 1 && y % 100 !== 11 ? 'год' : (y % 10 >= 2 && y % 10 <= 4 && (y % 100 < 10 || y % 100 >= 20) ? 'года' : 'лет');
  return `${y} ${yw}` + (m ? ` ${m} мес` : '');
}
const plural = (n, a, b, c) => { const n10 = n % 10, n100 = n % 100; return n10 === 1 && n100 !== 11 ? a : (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20) ? b : c); };

/* ---------- мини-markdown ---------- */
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>');
  s = s.replace(/\[([^\]]+)\]\((#[^)]*)\)/g, '$1');
  return s;
}
function md(text) {
  const lines = (text || '').replace(/<a id="[^"]*"><\/a>\n?/g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  let out = '', i = 0, para = [];
  const flush = () => { if (para.length) { out += '<p>' + para.map(inline).join('<br>') + '</p>'; para = []; } };
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { flush(); i++; continue; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { flush(); const lvl = Math.min(4, m[1].length + 1); out += `<h${lvl}>${inline(m[2])}</h${lvl}>`; i++; continue; }
    if (/^---+\s*$/.test(l)) { flush(); out += '<hr>'; i++; continue; }
    if (l.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      flush(); const row = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(l); i += 2; let body = '';
      while (i < lines.length && lines[i].startsWith('|')) { body += '<tr>' + row(lines[i]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'; i++; }
      out += `<div class="tw"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`; continue;
    }
    if (/^>\s?/.test(l)) { flush(); let q = []; while (i < lines.length && /^>/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; } out += '<blockquote>' + md(q.join('\n')) + '</blockquote>'; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      flush(); const ordered = /^\s*\d+\./.test(l); let items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const depth = lines[i].match(/^\s*/)[0].length; let item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''); i++;
        while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && /^\s{2,}/.test(lines[i])) { item += '\n' + lines[i].trim(); i++; }
        items.push({ depth, html: inline(item).replace(/\n/g, '<br>') });
      }
      const base = items[0].depth; let html = '';
      for (const it of items) html += `<li${it.depth > base ? ' class="sub"' : ''}>${it.html}</li>`;
      out += ordered ? `<ol>${html}</ol>` : `<ul>${html}</ul>`; continue;
    }
    para.push(l); i++;
  }
  flush(); return out;
}

/* ---------- графики (SVG) ---------- */
function lineChart({ series, unit, height = 200, yMin, yMax, band }) {
  const pts = series.flatMap(s => s.points); if (!pts.length) return '<p class="muted">Нет данных</p>';
  const t = d => new Date(d + 'T00:00:00').getTime();
  let x0 = Math.min(...pts.map(p => t(p.x))), x1 = Math.max(...pts.map(p => t(p.x)));
  if (x0 === x1) { x0 -= 864e5 * 30; x1 += 864e5 * 30; }
  let y0 = yMin != null ? yMin : Math.min(...pts.map(p => p.y)), y1 = yMax != null ? yMax : Math.max(...pts.map(p => p.y));
  if (band) { y0 = Math.min(y0, band[0]); y1 = Math.max(y1, band[1]); }
  const pad = (y1 - y0) * 0.12 || 1; y0 -= pad; y1 += pad;
  const W = 640, H = height, L = 44, R = 12, T = 12, B = 28;
  const X = v => L + (t(v) - x0) / (x1 - x0) * (W - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  let g = '';
  // сетка по годам
  const ya = new Date(x0).getFullYear(), yb = new Date(x1).getFullYear();
  for (let yr = ya; yr <= yb + 1; yr++) { const xx = X(`${yr}-01-01`); if (xx >= L && xx <= W - R) g += `<line x1="${xx}" y1="${T}" x2="${xx}" y2="${H - B}" class="grid"/><text x="${xx + 3}" y="${H - 10}" class="axis">${yr}</text>`; }
  for (let k = 0; k <= 4; k++) { const v = y0 + (y1 - y0) * k / 4; const yy = Y(v); g += `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" class="grid"/><text x="${L - 6}" y="${yy + 4}" class="axis" text-anchor="end">${+v.toFixed(v < 10 ? 1 : 0)}</text>`; }
  if (band) g += `<rect x="${L}" y="${Y(band[1])}" width="${W - L - R}" height="${Y(band[0]) - Y(band[1])}" class="band"/>`;
  series.forEach((s, si) => {
    const ps = s.points.slice().sort((a, b) => t(a.x) - t(b.x));
    if (s.line !== false && ps.length > 1) g += `<polyline points="${ps.map(p => X(p.x) + ',' + Y(p.y)).join(' ')}" class="ln c${si}"/>`;
    for (const p of ps) { const tip = `${fmtDate(p.x)}: ${p.y} ${unit || ''}${p.note ? ' — ' + p.note : ''}`; g += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${s.r || 4}" class="pt c${si}" data-tip="${esc(tip)}"><title>${esc(tip)}</title></circle><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="12" class="hit" data-tip="${esc(tip)}"/>`; }
  });
  const legend = series.length > 1 ? `<div class="legend">${series.map((s, i) => `<span><i class="c${i}"></i>${esc(s.name)}</span>`).join('')}</div>` : '';
  return `<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img">${g}</svg>${legend}</figure>`;
}

/* ---------- данные ---------- */
const SEC = id => S.data.sections.find(s => s.id === id) || { id, name: id, icon: '•' };
const docByN = n => S.data.docs.find(d => d.n === +n);
const liveNotes = () => S.notes.filter(n => !n.deleted);

function buildIndex() {
  MC.search.setDict(S.data.searchdict);
  const ix = new MC.search.Index();
  for (const d of S.data.docs) ix.add({ kind: 'doc', id: 'd' + d.n, n: d.n, title: d.title, text: d.body, extra: d.source + ' ' + d.sections.map(s => SEC(s).name).join(' '), date: d.date, sections: d.sections });
  for (const n of liveNotes()) ix.add({ kind: 'note', id: 'n' + n.id, note: n.id, title: n.title || NOTE_TYPES[n.type]?.name, text: [n.text, n.height && `рост ${n.height} см`, n.weight && `вес ${n.weight} кг`, n.type === 'vacc' && vaccNoteText(n), n.author].filter(Boolean).join('\n'), extra: (NOTE_TYPES[n.type]?.name || '') + ' ' + (SEC(n.section).name || ''), date: n.date, sections: n.section ? [n.section] : [] });
  for (const [k, v] of Object.entries(S.data.summary)) ix.add({ kind: 'summary', id: 's' + k, key: k, title: 'Сводка: ' + v.title, text: v.md, date: S.data.built, sections: [] });
  for (const s of S.data.sections) ix.add({ kind: 'section', id: 'sec' + s.id, sec: s.id, title: 'Раздел: ' + s.name, text: S.data.keyfacts.sections[s.id] || '', date: S.data.built, sections: [s.id] });
  for (const il of S.data.illustrations) ix.add({ kind: 'ill', id: 'i' + il.id, ill: il.id, title: il.title, text: il.desc, date: '', sections: illSections(il) });
  if (S.data.vacc) {
    S.data.vacc.records.forEach((r, i) => ix.add({ kind: 'vacc', id: 'vr' + i, dateLabel: r.approx ? vShort(r) : '', title: 'Прививка: ' + vaccLabel(r), text: [r.dateText, r.dose, V_STATUS[r.status], r.src].filter(Boolean).join('\n'), extra: 'прививка вакцинация вакцина', date: r.date, sections: [] }));
    S.data.vacc.history.forEach((h, i) => ix.add({ kind: 'vacc', id: 'vh' + i, dateLabel: h.dateText || '', title: 'Прививки: ' + ({ exempt: 'медотвод', allowed: 'разрешение', note: 'рекомендация' }[h.kind] || ''), text: h.text, extra: 'прививка вакцинация медотвод', date: h.date, sections: [] }));
  }
  ix.finalize(); S.index = ix;
}
function illSections(il) {
  const t = MC.search.norm(il.title + ' ' + il.desc);
  if (/экг|кардио/.test(t)) return ['cardio']; if (/ээг/.test(t)) return ['neuro']; if (/кариограм|кариотип/.test(t)) return ['genetics'];
  return ['endo'];
}

/* ---------- заметки (зашифрованы на устройстве) ---------- */
async function loadNotes() {
  const recs = await MC.db.all('notes'); const out = [];
  for (const r of recs) { try { out.push(await MC.crypto.decJSON(S.key, r)); } catch (e) { /* другой ключ */ } }
  S.notes = out;
}
async function saveNote(n) {
  n.updated = Date.now(); if (!n.created) n.created = n.updated;
  await MC.db.put('notes', n.id, await MC.crypto.encJSON(S.key, n, 'medcard-note'));
  const i = S.notes.findIndex(x => x.id === n.id); if (i >= 0) S.notes[i] = n; else S.notes.push(n);
  buildIndex();
}
const uid = () => Date.now().toString(36) + '-' + crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 10);

/* ---------- разблокировка ---------- */
async function fetchBlob() {
  const r = await fetch('data.enc', { cache: 'no-cache' }).catch(() => null) || await caches.match('data.enc');
  if (!r || !r.ok) throw new Error('Не удалось загрузить данные. Откройте медкарту хотя бы раз с интернетом.');
  return r.json();
}
async function openWithKey(key, blob) {
  const plain = await MC.crypto.decryptBlob(key, blob);
  const txt = await MC.crypto.gunzipToText(plain);
  S.data = JSON.parse(txt); S.key = key;
  await loadNotes(); buildIndex();
  S.author = (await MC.db.get('kv', 'author')) || '';
  S.fontScale = (await MC.db.get('kv', 'fontScale')) || 1; applyFont();
  S.lockedAt = 0;
  $('#lock').hidden = true; $('#app').hidden = false;
  render();
}
function lockScreen(html) { const l = $('#lock'); l.innerHTML = `<div class="lockbox"><div class="logo">✚</div>${html}</div>`; l.hidden = false; $('#app').hidden = true; }

async function boot() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  let blob;
  try { blob = await fetchBlob(); } catch (e) { lockScreen(`<h1>Медкарта</h1><p class="err">${esc(e.message)}</p>`); return; }
  S.blob = blob;
  const devKey = await MC.db.get('kv', 'deviceKey').catch(() => null);
  const pin = await MC.db.get('kv', 'pin').catch(() => null);
  S.pinSet = !!pin;
  if (devKey && pin) return showPin();
  if (devKey) { try { return await openWithKey(devKey, blob); } catch (e) { await MC.db.del('kv', 'deviceKey'); } }
  showPassword();
}
function showPassword(msg) {
  lockScreen(`<h1>Медкарта</h1><p class="muted">Данные зашифрованы. Введите пароль.</p>
    <form id="pwf" autocomplete="off"><input id="pw" type="password" placeholder="Пароль" autocomplete="current-password" autofocus>
    <label class="chk"><input type="checkbox" id="remember" checked> Запомнить на этом устройстве</label>
    <button class="btn primary" type="submit">Открыть</button><p class="err" id="pwerr">${esc(msg || '')}</p></form>
    <p class="hint">Пароль знаете только вы. Если его забыть, данные не восстановить.</p>`);
  $('#pwf').onsubmit = async e => {
    e.preventDefault(); const pw = $('#pw').value; if (!pw) return;
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Проверяю…'; $('#pwerr').textContent = '';
    try {
      const key = await MC.crypto.deriveKey(pw, S.blob.salt, S.blob.iter);
      await MC.crypto.decryptBlob(key, S.blob);
      if ($('#remember').checked) { await MC.db.put('kv', 'deviceKey', key); await openWithKey(key, S.blob); if (!S.pinSet) offerPin(); }
      else await openWithKey(key, S.blob);
    } catch (err) { btn.disabled = false; btn.textContent = 'Открыть'; $('#pwerr').textContent = 'Неверный пароль'; }
  };
}
function showPin(msg) {
  lockScreen(`<h1>Медкарта</h1><p class="muted">Введите PIN-код</p>
    <form id="pinf"><input id="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" autofocus class="pin">
    <button class="btn primary" type="submit">Войти</button><p class="err">${esc(msg || '')}</p></form>
    <button class="link" id="usepw">Войти по паролю</button>`);
  setTimeout(() => $('#pin') && $('#pin').focus(), 50);
  $('#usepw').onclick = () => showPassword();
  $('#pinf').onsubmit = async e => {
    e.preventDefault(); const p = await MC.db.get('kv', 'pin'); const h = await MC.crypto.pinHash($('#pin').value, p.salt);
    if (h === p.hash) {
      await MC.db.put('kv', 'pinFails', 0);
      if (S.data) { S.lockedAt = 0; $('#lock').hidden = true; $('#app').hidden = false; render(); }
      else { const k = await MC.db.get('kv', 'deviceKey'); try { await openWithKey(k, S.blob); } catch (err) { await forgetDevice(); showPassword('Данные обновлены — введите пароль ещё раз.'); } }
    } else {
      const f = ((await MC.db.get('kv', 'pinFails')) || 0) + 1; await MC.db.put('kv', 'pinFails', f);
      if (f >= 5) { await forgetDevice(); showPassword('PIN введён неверно 5 раз. Войдите по паролю.'); }
      else showPin(`Неверный PIN. Осталось попыток: ${5 - f}`);
    }
  };
}
async function forgetDevice() { await MC.db.del('kv', 'deviceKey'); await MC.db.del('kv', 'pin'); await MC.db.put('kv', 'pinFails', 0); S.pinSet = false; }
function offerPin() {
  sheet(`<h2>Быстрый вход по PIN-коду</h2><p>Пароль больше не понадобится на этом устройстве — для входа хватит PIN-кода (4–8 цифр). После 5 ошибок понадобится пароль.</p>
    <form id="setpin"><input id="p1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="Новый PIN" class="pin"><input id="p2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" placeholder="Повторите PIN" class="pin">
    <p class="err" id="perr"></p><div class="row"><button class="btn primary" type="submit">Сохранить PIN</button><button class="btn" type="button" id="skip">Не сейчас</button></div></form>`);
  $('#skip').onclick = closeSheet;
  $('#setpin').onsubmit = async e => {
    e.preventDefault(); const a = $('#p1').value, b = $('#p2').value;
    if (!/^\d{4,8}$/.test(a)) return $('#perr').textContent = 'PIN — от 4 до 8 цифр';
    if (a !== b) return $('#perr').textContent = 'PIN-коды не совпадают';
    const salt = MC.b64.enc(crypto.getRandomValues(new Uint8Array(16)));
    await MC.db.put('kv', 'pin', { salt, hash: await MC.crypto.pinHash(a, salt) }); S.pinSet = true; closeSheet(); toast('PIN-код сохранён');
  };
}
document.addEventListener('visibilitychange', () => {
  if (!S.data || !S.pinSet) return;
  if (document.hidden) S.hiddenAt = Date.now();
  else if (S.hiddenAt && Date.now() - S.hiddenAt > LOCK_AFTER_MS) showPin();
});

/* ---------- UI helpers ---------- */
function sheet(html) { const s = $('#sheet'); s.innerHTML = `<div class="sheet-bg"></div><div class="sheet-box">${html}</div>`; s.hidden = false; s.querySelector('.sheet-bg').onclick = closeSheet; }
function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; }
let toastT; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600); }
function applyFont() { document.documentElement.style.setProperty('--fs', S.fontScale); }
const secChip = id => `<a class="chip sec-${id}" href="#/s/${id}">${SEC(id).icon} ${esc(SEC(id).name)}</a>`;
function parseHash() {
  const h = location.hash.replace(/^#\/?/, ''); const [path, qs] = h.split('?'); const parts = path.split('/').filter(Boolean);
  const q = new URLSearchParams(qs || ''); return { parts, q };
}
function go(h) { location.hash = h; }

/* ---------- каркас ---------- */
const NAV = [
  ['', '🏠', 'Главная'], ['q', '🔍', 'Поиск'], ['t', '🗓', 'Хронология'], ['n', '✍️', 'Записи'], ['more', '☰', 'Ещё']
];
function frame(title, opts = {}) {
  const { parts } = parseHash(); const cur = parts[0] || '';
  $('#tabs').innerHTML = NAV.map(([h, ic, nm]) => `<a href="#/${h}" class="${cur === h || (h === 'more' && ['sum', 'doctor', 'i', 'set', 'v'].includes(cur)) || (h === '' && cur === 's') ? 'on' : ''}"><span>${ic}</span>${nm}</a>`).join('');
  $('#side').innerHTML = `<div class="brand">✚ Медкарта</div>
    <nav>${NAV.map(([h, ic, nm]) => `<a href="#/${h}" class="${cur === h ? 'on' : ''}">${ic} ${nm}</a>`).join('')}
    <a href="#/v" class="${cur === 'v' ? 'on' : ''}">💉 Прививки</a>
    <a href="#/doctor" class="${cur === 'doctor' ? 'on' : ''}">🩺 Для врача</a></nav>
    <div class="side-h">Разделы</div><nav>${S.data.sections.map(s => `<a href="#/s/${s.id}" class="${cur === 's' && parts[1] === s.id ? 'on' : ''}">${s.icon} ${esc(s.name)}</a>`).join('')}</nav>`;
  $('#top').innerHTML = `${opts.back !== false && cur ? '<button class="back" onclick="history.length>1?history.back():location.hash=\'#/\'" aria-label="Назад">‹</button>' : ''}
    <h1>${esc(title)}</h1>${cur !== 'q' ? '<a class="topsearch" href="#/q" aria-label="Поиск">🔍</a>' : ''}`;
  document.title = title === 'Медкарта' ? 'Медкарта' : title + ' — Медкарта';
}
function render() {
  if (!S.data) return;
  closeSheet(); document.body.classList.remove('doctor-mode');
  const { parts, q } = parseHash(); const v = $('#view'); const r = parts[0] || '';
  window.scrollTo(0, 0);
  try {
    if (r === '') viewHome(v);
    else if (r === 's') viewSection(v, parts[1]);
    else if (r === 'd') viewDoc(v, parts[1], q.get('q'));
    else if (r === 't') viewTimeline(v, q);
    else if (r === 'q') viewSearch(v, q.get('q') || '');
    else if (r === 'n' && parts[1]) viewNote(v, parts[1]);
    else if (r === 'n') viewNotes(v, q);
    else if (r === 'new' || r === 'edit') viewEdit(v, parts[1], q);
    else if (r === 'doctor') viewDoctor(v);
    else if (r === 'v') viewVacc(v);
    else if (r === 'sum') viewSummary(v, parts[1]);
    else if (r === 'i') viewIll(v, parts[1]);
    else if (r === 'more') viewMore(v);
    else if (r === 'set') viewSettings(v);
    else viewHome(v);
  } catch (e) { console.error(e); v.innerHTML = `<p class="err">Ошибка: ${esc(e.message)}</p>`; }
}
window.addEventListener('hashchange', render);
document.addEventListener('click', e => { const c = e.target.closest && e.target.closest('circle[data-tip]'); if (c) toast(c.getAttribute('data-tip')); });

/* ---------- Главная ---------- */
function viewHome(v) {
  frame('Медкарта', { back: false });
  const c = S.data.child, kf = S.data.keyfacts, td = today();
  const plans = liveNotes().filter(n => ((n.type === 'plan' && !n.done) || (n.type === 'vacc' && n.vStatus === 'plan')) && n.date >= addDays(td, -1)).sort((a, b) => a.date.localeCompare(b.date));
  const recent = liveNotes().slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updated - a.updated).slice(0, 5);
  const counts = {}; for (const d of S.data.docs) for (const s of d.sections) counts[s] = (counts[s] || 0) + 1;
  for (const n of liveNotes()) if (n.section) counts[n.section] = (counts[n.section] || 0) + 1;
  v.innerHTML = `
  <section class="card hero">
    <div class="who"><div class="ava">${esc(c.short[0])}</div><div><h2>${esc(c.name)}</h2>
    <p>${fmtLong(c.birth)} · <b>${ageAt(td)}</b></p><p class="muted">Группа крови: ${esc(c.blood)}</p></div></div>
    <a class="searchbox" href="#/q">🔍 <span>Поиск по всем документам и записям…</span></a>
    <div class="quick"><a class="btn primary" href="#/new?type=note">＋ Добавить запись</a><a class="btn" href="#/v">💉 Прививки</a><a class="btn" href="#/doctor">🩺 Показать врачу</a></div>
  </section>
  ${plans.length || kf.alerts.length ? `<section class="card"><h3>📌 Важно и предстоящее</h3><ul class="alerts">
    ${plans.map(n => `<li class="plan"><a href="#/n/${n.id}"><b>${fmtDate(n.date)}${n.date === td ? ' · сегодня' : ''}</b> — ${n.type === 'vacc' ? '💉 Прививка: ' : ''}${esc(n.title)}</a></li>`).join('')}
    ${kf.alerts.map(a => `<li><a href="#/s/${a.section}"><b>${esc(a.title)}</b><span>${esc(a.text)}</span></a></li>`).join('')}
  </ul></section>` : ''}
  <section class="card"><h3>Главное о здоровье</h3><ul class="facts">${kf.headline.map(h => `<li><a href="#/s/${h.section}">${SEC(h.section).icon} ${esc(h.text)}</a></li>`).join('')}</ul>
    <div class="two"><div><h4>Аллергия</h4><p>${esc(kf.allergy)}</p></div><div><h4>Лекарства сейчас</h4><p>${esc(kf.meds_now)}</p>${activeMeds()}</div></div>
    <p><a href="#/sum">Полная сводка по документам →</a></p></section>
  <section class="card"><h3>Разделы</h3><div class="grid">${S.data.sections.map(s => `<a class="tile" href="#/s/${s.id}"><span class="ic">${s.icon}</span><span>${esc(s.name)}</span><small>${counts[s.id] || 0}</small></a>`).join('')}</div></section>
  <section class="card"><h3>Последние записи</h3>${recent.length ? `<ul class="list">${recent.map(noteRow).join('')}</ul>` : '<p class="muted">Пока нет записей. Добавляйте сюда приёмы у врачей в Финляндии, результаты анализов, рост и вес, лекарства и вопросы к врачу.</p>'}
    <p><a href="#/n">Все записи →</a></p></section>`;
}
function activeMeds() {
  const m = liveNotes().filter(n => n.type === 'med' && !n.done && (!n.endDate || n.endDate >= today()));
  return m.length ? `<ul class="meds">${m.map(n => `<li><a href="#/n/${n.id}">💊 <b>${esc(n.title)}</b>${n.text ? ' — ' + esc(n.text.split('\n')[0]) : ''}</a></li>`).join('')}</ul>` : '';
}
const addDays = (iso, d) => { const t = new Date(iso + 'T00:00:00'); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); };
function noteRow(n) {
  const T = NOTE_TYPES[n.type] || NOTE_TYPES.note;
  return `<li><a href="#/n/${n.id}"><span class="date">${fmtDate(n.date)}</span><span class="ttl">${T.icon} ${esc(n.title || T.name)}</span>
    <span class="meta">${esc(T.name)}${n.section ? ' · ' + esc(SEC(n.section).name) : ''}${n.author ? ' · ' + esc(n.author) : ''}${n.doctor ? ' · 🩺' : ''}</span></a></li>`;
}
function docRow(d, q) {
  return `<li><a href="#/d/${d.n}${q ? '?q=' + encodeURIComponent(q) : ''}"><span class="date">${fmtDate(d.date)}</span><span class="ttl">${esc(d.title)}</span>
    <span class="meta">${esc(d.age)} · ${d.sections.map(s => SEC(s).icon).join(' ')}</span></a></li>`;
}

/* ---------- Раздел ---------- */
const SEC_SUMMARY = { cardio: ['Сердце', 'Ритм'], endo: ['Гормоны и рост'], labs: ['Общий анализ крови', 'Железо'], genetics: ['Генетика'], neuro: ['Нервная система'] };
function summaryPart(title) {
  const md17 = S.data.summary['1.7'] ? S.data.summary['1.7'].md : '';
  const m = new RegExp('### ' + title + '[^\\n]*\\n([\\s\\S]*?)(?=\\n### |$)').exec(md17);
  return m ? `<h4>${esc(title === 'Железо' ? 'Железо, витамин D, свёртываемость, биохимия' : title)}</h4>` + md(m[1]) : '';
}
function viewSection(v, id) {
  const s = SEC(id); frame(s.name);
  const docs = S.data.docs.filter(d => d.sections.includes(id)).sort((a, b) => b.date.localeCompare(a.date));
  const notes = liveNotes().filter(n => n.section === id).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const ills = S.data.illustrations.filter(i => illSections(i).includes(id));
  const alerts = S.data.keyfacts.alerts.filter(a => a.section === id);
  let charts = '';
  if (id === 'endo') charts = growthCharts();
  if (id === 'labs') charts = cbcCharts();
  v.innerHTML = `
  <section class="card"><p class="lead">${esc(S.data.keyfacts.sections[id] || '')}</p>
    ${alerts.map(a => `<div class="alert"><b>${esc(a.title)}</b><br>${esc(a.text)}</div>`).join('')}
    <div class="quick"><a class="btn primary" href="#/new?type=note&sec=${id}">＋ Запись в раздел</a>${id === 'peds' ? '<a class="btn" href="#/v">💉 Дневник прививок</a>' : ''}<a class="btn" href="#/q?sec=${id}">🔍 Искать в разделе</a></div></section>
  ${charts ? `<section class="card">${charts}</section>` : ''}
  ${(SEC_SUMMARY[id] || []).length ? `<section class="card collapsible"><details${id === 'cardio' ? ' open' : ''}><summary>Динамика по документам</summary>${SEC_SUMMARY[id].map(summaryPart).join('')}</details></section>` : ''}
  ${ills.length ? `<section class="card"><h3>Снимки и изображения</h3><div class="thumbs">${ills.map(i => `<a href="#/i/${i.id}"><img src="${i.img}" alt="" loading="lazy"><span>${esc(i.title)}</span></a>`).join('')}</div></section>` : ''}
  ${notes.length ? `<section class="card"><h3>Записи родителей (${notes.length})</h3><ul class="list">${notes.map(noteRow).join('')}</ul></section>` : ''}
  <section class="card"><h3>Документы (${docs.length})</h3><ul class="list">${docs.map(d => docRow(d)).join('')}</ul></section>`;
}
function growthCharts() {
  const g = S.data.growth.filter(x => x.height); const w = S.data.growth.filter(x => x.weight);
  const nh = liveNotes().filter(n => n.type === 'measure' && n.height), nw = liveNotes().filter(n => n.type === 'measure' && n.weight);
  return `<h3>Рост, см</h3>${lineChart({ unit: 'см', series: [{ name: 'по документам', points: g.map(x => ({ x: x.date, y: x.height, note: x.src })) }, ...(nh.length ? [{ name: 'записи родителей', line: false, r: 5, points: nh.map(n => ({ x: n.date, y: +n.height })) }] : [])] })}
    <h3>Вес, кг</h3>${lineChart({ unit: 'кг', series: [{ name: 'по документам', points: w.map(x => ({ x: x.date, y: x.weight, note: x.src })) }, ...(nw.length ? [{ name: 'записи родителей', line: false, r: 5, points: nw.map(n => ({ x: n.date, y: +n.weight })) }] : [])] })}
    <p class="muted small">Точки — измерения из документов${nh.length || nw.length ? ' и ваши записи «Рост и вес»' : ''}. Нажмите на точку, чтобы увидеть значение.</p>`;
}
function cbcCharts() {
  const c = S.data.cbc; const ser = (k, name) => ({ name, points: c.filter(x => x[k] != null).map(x => ({ x: x.date, y: x[k], note: x.label })) });
  return `<h3>Гемоглобин, г/л</h3>${lineChart({ unit: 'г/л', series: [ser('hb', 'Hb')] })}
    <h3>Тромбоциты, ×10⁹/л</h3>${lineChart({ unit: '×10⁹/л', series: [ser('plt', 'PLT')] })}
    <h3>Средний объём эритроцита (MCV), фл</h3>${lineChart({ unit: 'фл', series: [ser('mcv', 'MCV')] })}
    <h3>Лейкоциты, ×10⁹/л</h3>${lineChart({ unit: '×10⁹/л', series: [ser('wbc', 'WBC')] })}
    <p class="muted small">Нормы в разных лабораториях отличаются — смотрите полный текст анализа.</p>`;
}

/* ---------- Документ ---------- */
function viewDoc(v, n, q) {
  const d = docByN(n); if (!d) return v.innerHTML = '<p>Документ не найден</p>';
  frame(fmtDate(d.date));
  const sorted = S.data.docs.slice().sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n); const i = sorted.indexOf(d);
  const prev = sorted[i - 1], next = sorted[i + 1];
  const related = liveNotes().filter(x => x.doc === d.n);
  v.innerHTML = `<article class="card doc">
    <div class="dochead"><div class="chips">${d.sections.map(secChip).join('')}</div>
    <h2>${esc(d.title)}</h2><p class="muted">${fmtLong(d.date)} · возраст ${esc(d.age)}</p><p class="muted small">Исходный файл: ${esc(d.source)}</p></div>
    <div class="mdbody" id="mdbody">${md(d.body)}</div></article>
    ${related.length ? `<section class="card"><h3>Ваши записи к этому документу</h3><ul class="list">${related.map(noteRow).join('')}</ul></section>` : ''}
    <div class="pager">${prev ? `<a class="btn" href="#/d/${prev.n}${q ? '?q=' + encodeURIComponent(q) : ''}">‹ ${fmtDate(prev.date)}</a>` : '<span></span>'}
    <a class="btn" href="#/new?type=note&doc=${d.n}&sec=${d.sections[0]}">＋ Заметка</a>
    ${next ? `<a class="btn" href="#/d/${next.n}${q ? '?q=' + encodeURIComponent(q) : ''}">${fmtDate(next.date)} ›</a>` : '<span></span>'}</div>`;
  if (q) hitNavigator(q);
}
function hitNavigator(q) {
  const r = S.index.search(q); const body = $('#mdbody'); if (!body) return;
  const n = MC.search.highlightNode(body, [...r.terms], r.phrases);
  if (!n) return;
  const marks = [...body.querySelectorAll('mark')]; let cur = 0;
  const bar = document.createElement('div'); bar.className = 'hitbar';
  bar.innerHTML = `<span>«${esc(q)}» — ${n}</span><button aria-label="Предыдущее">↑</button><button aria-label="Следующее">↓</button><button aria-label="Закрыть">✕</button>`;
  document.body.appendChild(bar);
  const show = k => { marks.forEach(m => m.classList.remove('cur')); cur = (k + marks.length) % marks.length; marks[cur].classList.add('cur'); marks[cur].scrollIntoView({ block: 'center', behavior: 'smooth' }); bar.querySelector('span').textContent = `«${q}» — ${cur + 1} из ${n}`; };
  const [b1, b2, b3] = bar.querySelectorAll('button'); b1.onclick = () => show(cur - 1); b2.onclick = () => show(cur + 1); b3.onclick = () => { bar.remove(); marks.forEach(m => m.replaceWith(m.textContent)); };
  window.addEventListener('hashchange', () => bar.remove(), { once: true });
  setTimeout(() => show(0), 120);
}

/* ---------- Поиск ---------- */
let searchT;
function viewSearch(v, initial) {
  frame('Поиск'); const p = parseHash().q;
  const years = [...new Set(S.data.docs.map(d => d.date.slice(0, 4)))].sort().reverse();
  v.innerHTML = `<section class="card searchcard">
    <div class="sbox"><input id="sq" type="search" placeholder="Например: анализ крови, ЭКГ, прививки, июль 2024" value="${esc(initial)}" autocomplete="off" enterkeyhint="search"><button id="sclear" aria-label="Очистить">✕</button></div>
    <div class="filters">
      <select id="fkind"><option value="">Всё</option><option value="doc">Документы</option><option value="note">Мои записи</option><option value="vacc">Прививки</option></select>
      <select id="fsec"><option value="">Все разделы</option>${S.data.sections.map(s => `<option value="${s.id}"${p.get('sec') === s.id ? ' selected' : ''}>${s.icon} ${esc(s.name)}</option>`).join('')}</select>
      <select id="fyear"><option value="">Все годы</option>${years.map(y => `<option>${y}</option>`).join('')}</select>
      <select id="fsort"><option value="rel">По точности</option><option value="new">Сначала новые</option><option value="old">Сначала старые</option></select>
    </div></section>
    <div id="sres"></div>`;
  const inp = $('#sq');
  const run = () => {
    const qv = inp.value.trim();
    history.replaceState(null, '', '#/q' + (qv ? '?q=' + encodeURIComponent(qv) : '') + (p.get('sec') && !qv ? '?sec=' + p.get('sec') : ''));
    const out = $('#sres');
    if (!qv) {
      out.innerHTML = `<section class="card"><h3>Подсказки</h3><p class="muted">Ищет по всем 177 документам, сводке и вашим записям. Понимает падежи и окончания («гемоглобина» = «гемоглобин»), сокращения (ОАК, ЭКГ, УЗИ, ТТГ…), опечатки, английскую раскладку («ghbdbdrb» → «прививки»), даты («июль 2024», «05.2026»). Точная фраза — в кавычках.</p>
        <div class="chips">${(S.data.searchdict.examples || []).map(x => `<button class="chip ex">${esc(x)}</button>`).join('')}</div></section>`;
      out.querySelectorAll('.ex').forEach(b => b.onclick = () => { inp.value = b.textContent; run(); });
      return;
    }
    const t0 = performance.now();
    const r = S.index.search(qv, { kind: $('#fkind').value || null, section: $('#fsec').value || null, year: $('#fyear').value || null });
    let list = r.results; const sort = $('#fsort').value;
    if (sort === 'new') list = list.slice().sort((a, b) => (b.item.date || '').localeCompare(a.item.date || ''));
    if (sort === 'old') list = list.slice().sort((a, b) => (a.item.date || '').localeCompare(b.item.date || ''));
    const terms = [...r.terms]; const full = list.filter(x => x.cov >= 1), part = list.filter(x => x.cov < 1);
    const ms = Math.round(performance.now() - t0);
    const card = x => resultCard(x, terms, r.phrases, qv);
    out.innerHTML = `<p class="muted small rescount">${list.length ? `Найдено: ${list.length}` : 'Ничего не найдено'} · ${ms} мс${r.fixed ? ` · исправлена раскладка: «${esc(r.fixed)}»` : ''}</p>
      ${full.map(card).join('')}${part.length ? `<p class="muted small sep">Частичные совпадения (не все слова запроса)</p>${part.slice(0, 40).map(card).join('')}` : ''}
      ${!list.length ? '<section class="card"><p>Попробуйте другое слово, сокращение или уберите фильтры.</p></section>' : ''}`;
  };
  inp.oninput = () => { clearTimeout(searchT); searchT = setTimeout(run, 140); };
  inp.onkeydown = e => { if (e.key === 'Enter') { inp.blur(); run(); } };
  $('#sclear').onclick = () => { inp.value = ''; inp.focus(); run(); };
  ['#fkind', '#fsec', '#fyear', '#fsort'].forEach(s => $(s).onchange = run);
  run(); if (!initial) setTimeout(() => inp.focus(), 60);
}
function resultCard(x, terms, phrases, q) {
  const it = x.item; const hl = s => MC.search.highlightHTML(esc(s), terms, phrases);
  const sn = MC.search.snippets(it, terms, phrases).map(s => `<p class="snip">${hl(s)}</p>`).join('');
  let href, kind;
  if (it.kind === 'doc') { href = `#/d/${it.n}?q=${encodeURIComponent(q)}`; kind = '📄 Документ'; }
  else if (it.kind === 'note') { href = `#/n/${it.note}`; kind = '✍️ Запись родителей'; }
  else if (it.kind === 'summary') { href = `#/sum/${it.key}`; kind = '📋 Сводка'; }
  else if (it.kind === 'section') { href = `#/s/${it.sec}`; kind = '📁 Раздел'; }
  else if (it.kind === 'vacc') { href = '#/v'; kind = '💉 Прививки'; }
  else { href = `#/i/${it.ill}`; kind = '🖼 Изображение'; }
  return `<a class="card result" href="${href}"><div class="rmeta"><span>${kind}</span>${it.date && it.kind !== 'summary' && it.kind !== 'section' ? `<span>${esc(it.dateLabel || fmtDate(it.date))}</span>` : ''}${(it.sections || []).map(s => `<span>${SEC(s).icon}</span>`).join('')}</div>
    <h4>${hl(it.title || '')}</h4>${sn}</a>`;
}

/* ---------- Хронология ---------- */
function viewTimeline(v, q) {
  frame('Хронология');
  const sec = q.get('sec') || '', only = q.get('only') || '';
  let items = [];
  if (only !== 'notes') items = items.concat(S.data.docs.filter(d => !sec || d.sections.includes(sec)).map(d => ({ date: d.date, html: docRow(d) })));
  if (only !== 'docs') items = items.concat(liveNotes().filter(n => !sec || n.section === sec).map(n => ({ date: n.date, html: noteRow(n), note: true })));
  items.sort((a, b) => b.date.localeCompare(a.date));
  let html = '', curY = '', curM = '';
  for (const it of items) {
    const y = it.date.slice(0, 4), m = it.date.slice(5, 7);
    if (y !== curY) { if (curY) html += '</ul>'; html += `<h3 class="year">${y}</h3><ul class="list">`; curY = y; curM = ''; }
    if (m !== curM) { html += `<li class="month">${MONTHS_N[+m - 1]}</li>`; curM = m; }
    html += it.html.replace('<li>', `<li${it.note ? ' class="isnote"' : ''}>`);
  }
  if (curY) html += '</ul>';
  const opt = (k, val, label, cur) => `<option value="${val}"${cur === val ? ' selected' : ''}>${label}</option>`;
  v.innerHTML = `<section class="card filters"><select id="tsec">${opt('sec', '', 'Все разделы', sec)}${S.data.sections.map(s => opt('sec', s.id, s.icon + ' ' + esc(s.name), sec)).join('')}</select>
    <select id="tonly">${opt('o', '', 'Документы и записи', only)}${opt('o', 'docs', 'Только документы', only)}${opt('o', 'notes', 'Только записи родителей', only)}</select></section>
    <section class="card timeline">${html || '<p class="muted">Пусто</p>'}</section>`;
  const upd = () => go(`#/t?sec=${$('#tsec').value}&only=${$('#tonly').value}`);
  $('#tsec').onchange = upd; $('#tonly').onchange = upd;
}

/* ---------- Записи ---------- */
function viewNotes(v, q) {
  frame('Записи'); const type = q.get('type') || '';
  const list = liveNotes().filter(n => !type || n.type === type).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updated - a.updated);
  v.innerHTML = `<section class="card"><p class="muted">Ваши записи хранятся на этом устройстве в зашифрованном виде. Чтобы записи появились у второго родителя — «Ещё» → «Передать записи».</p>
    <div class="typegrid">${Object.entries(NOTE_TYPES).map(([k, t]) => `<a class="tile small" href="#/new?type=${k}"><span class="ic">${t.icon}</span><span>${t.name}</span></a>`).join('')}</div></section>
    <section class="card"><div class="filters"><select id="ntype"><option value="">Все типы</option>${Object.entries(NOTE_TYPES).map(([k, t]) => `<option value="${k}"${k === type ? ' selected' : ''}>${t.icon} ${t.name}</option>`).join('')}</select></div>
    ${list.length ? `<ul class="list">${list.map(noteRow).join('')}</ul>` : '<p class="muted">Записей пока нет — нажмите на нужный тип выше.</p>'}</section>`;
  $('#ntype').onchange = e => go('#/n' + (e.target.value ? '?type=' + e.target.value : ''));
}
function viewNote(v, id) {
  const n = S.notes.find(x => x.id === id); if (!n || n.deleted) return v.innerHTML = '<p>Запись не найдена</p>';
  const T = NOTE_TYPES[n.type] || NOTE_TYPES.note; frame(T.name);
  const d = n.doc ? docByN(n.doc) : null;
  v.innerHTML = `<article class="card note">
    <div class="chips">${n.section ? secChip(n.section) : ''}${n.doctor ? '<span class="chip">🩺 показывать врачу</span>' : ''}${n.done ? '<span class="chip">✔ выполнено</span>' : ''}</div>
    <h2>${T.icon} ${esc(n.title || T.name)}</h2>
    <p class="muted">${fmtLong(n.date)}${n.endDate ? ' — ' + fmtLong(n.endDate) : ''} · возраст ${ageAt(n.date)}${n.author ? ' · записал(а): ' + esc(n.author) : ''}</p>
    ${n.height || n.weight ? `<p class="big">${n.height ? `Рост <b>${esc(n.height)}</b> см` : ''}${n.height && n.weight ? ' · ' : ''}${n.weight ? `Вес <b>${esc(n.weight)}</b> кг` : ''}</p>` : ''}
    ${n.type === 'vacc' ? `<p class="big">${esc(V_STATUS[n.vStatus || 'done'])}${n.vDose ? ' · доза <b>' + esc(n.vDose) + '</b>' : ''}</p>${(n.vInf || []).length ? `<p>От: ${esc(n.vInf.map(infName).join(', '))}</p>` : ''}${n.vLot ? `<p class="muted">Серия: ${esc(n.vLot)}</p>` : ''}<p><a href="#/v">💉 Весь дневник прививок →</a></p>` : ''}
    ${n.text ? `<div class="mdbody">${md(n.text)}</div>` : ''}
    ${(n.photos || []).length ? `<div class="photos">${n.photos.map((p, i) => `<a href="#" data-i="${i}"><img src="${p}" alt=""></a>`).join('')}</div>` : ''}
    ${d ? `<p>Относится к документу: <a href="#/d/${d.n}">${fmtDate(d.date)} — ${esc(d.title)}</a></p>` : ''}
    <p class="muted small">Изменено: ${new Date(n.updated).toLocaleString('ru-RU')}</p>
    <div class="row"><a class="btn primary" href="#/edit/${n.id}">✏️ Изменить</a><button class="btn danger" id="del">Удалить</button></div></article>`;
  v.querySelectorAll('.photos a').forEach(a => a.onclick = e => { e.preventDefault(); sheet(`<img class="full" src="${n.photos[+a.dataset.i]}" alt=""><button class="btn" onclick="this.closest('.sheet').hidden=true">Закрыть</button>`); });
  $('#del').onclick = async () => { if (!confirm('Удалить эту запись? (Её можно будет вернуть только из резервной копии.)')) return; n.deleted = true; await saveNote(n); toast('Запись удалена'); go('#/n'); };
}
function viewEdit(v, id, q) {
  const isNew = !id; const n = isNew ? { id: uid(), type: q.get('type') || 'note', date: today(), section: q.get('sec') || '', doc: q.get('doc') ? +q.get('doc') : null, author: S.author, photos: [] } : JSON.parse(JSON.stringify(S.notes.find(x => x.id === id)));
  frame(isNew ? 'Новая запись' : 'Изменить запись');
  const typeOpts = Object.entries(NOTE_TYPES).map(([k, t]) => `<option value="${k}"${n.type === k ? ' selected' : ''}>${t.icon} ${t.name}</option>`).join('');
  v.innerHTML = `<form class="card form" id="nf">
    <label>Тип записи<select name="type">${typeOpts}</select></label>
    <div class="row2"><label>Дата<input type="date" name="date" value="${esc(n.date)}" required></label>
      <label class="f-end">До (необязательно)<input type="date" name="endDate" value="${esc(n.endDate || '')}"></label></div>
    <label>Раздел<select name="section"><option value="">— без раздела —</option>${S.data.sections.map(s => `<option value="${s.id}"${n.section === s.id ? ' selected' : ''}>${s.icon} ${esc(s.name)}</option>`).join('')}</select></label>
    <label class="f-title">Заголовок<input name="title" value="${esc(n.title || '')}" placeholder="Например: Приём кардиолога в Финляндии"></label>
    <div class="f-vacc">
      <label>Статус<select name="vStatus">${Object.entries({ done: 'Сделана', plan: 'Запланирована', exempt: 'Медотвод' }).map(([k, t]) => `<option value="${k}"${(n.vStatus || 'done') === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
      <fieldset class="vinf"><legend>От каких инфекций</legend>${(S.data.vacc ? S.data.vacc.infections : []).map(i => `<label class="chk"><input type="checkbox" name="vInf" value="${i.id}"${(n.vInf || []).includes(i.id) ? ' checked' : ''}> ${esc(i.name)}</label>`).join('')}</fieldset>
      <div class="row2"><label>Доза<input name="vDose" list="vdoses" value="${esc(n.vDose || '')}" placeholder="V1, V2, RV1…"></label><label>Серия вакцины<input name="vLot" value="${esc(n.vLot || '')}" placeholder="с упаковки / из справки"></label></div>
      <datalist id="vdoses"><option>V1</option><option>V2</option><option>V3</option><option>V4</option><option>RV1</option><option>RV2</option><option>RV3</option></datalist>
    </div>
    <div class="row2 f-measure"><label>Рост, см<input name="height" inputmode="decimal" value="${esc(n.height || '')}"></label><label>Вес, кг<input name="weight" inputmode="decimal" value="${esc(n.weight || '')}"></label></div>
    <label>Текст<textarea name="text" rows="8" placeholder="Что сказал врач, назначения, результаты, наблюдения…">${esc(n.text || '')}</textarea></label>
    <div class="photos edit" id="ph">${(n.photos || []).map((p, i) => `<span><img src="${p}"><button type="button" data-i="${i}">✕</button></span>`).join('')}</div>
    <label class="filebtn">📷 Добавить фото документа<input type="file" accept="image/*" multiple id="phin"></label>
    <label class="chk"><input type="checkbox" name="doctor"${n.doctor ? ' checked' : ''}> Показывать в режиме «Для врача»</label>
    <label class="chk f-done"><input type="checkbox" name="done"${n.done ? ' checked' : ''}> <span>Выполнено / неактуально</span></label>
    <label>Кто записал<input name="author" value="${esc(n.author || '')}" placeholder="Мама / Папа"></label>
    ${n.doc ? `<p class="muted small">Привязано к документу от ${fmtDate(docByN(n.doc).date)}</p>` : ''}
    <div class="row"><button class="btn primary" type="submit">Сохранить</button><button class="btn" type="button" onclick="history.back()">Отмена</button></div></form>`;
  const f = $('#nf');
  const sync = () => { const t = f.type.value; f.classList.toggle('t-measure', t === 'measure'); f.classList.toggle('t-vacc', t === 'vacc'); f.classList.toggle('t-end', t === 'med' || t === 'plan'); f.classList.toggle('t-done', ['med', 'plan', 'question'].includes(t));
    const lbl = { med: 'Не принимает', plan: 'Выполнено', question: 'Есть ответ' }[t]; if (lbl) f.querySelector('.f-done span').textContent = lbl;
    f.title.placeholder = { vacc: 'Название вакцины, например: Пентаксим', med: 'Название лекарства и дозировка', plan: 'Что запланировано (приём, анализ, операция)', question: 'Вопрос к врачу', measure: 'Например: измерили дома', visit: 'Например: приём кардиолога', result: 'Например: общий анализ крови' }[t] || 'Заголовок'; };
  f.type.onchange = sync; sync();
  const drawPh = () => { $('#ph').innerHTML = n.photos.map((p, i) => `<span><img src="${p}"><button type="button" data-i="${i}">✕</button></span>`).join(''); $('#ph').querySelectorAll('button').forEach(b => b.onclick = () => { n.photos.splice(+b.dataset.i, 1); drawPh(); }); };
  drawPh();
  $('#phin').onchange = async e => { for (const file of e.target.files) n.photos.push(await shrink(file)); drawPh(); e.target.value = ''; };
  f.onsubmit = async e => {
    e.preventDefault(); const fd = new FormData(f);
    Object.assign(n, { type: fd.get('type'), date: fd.get('date'), endDate: fd.get('endDate') || '', section: fd.get('section'), title: fd.get('title').trim(), text: fd.get('text'), height: (fd.get('height') || '').replace(',', '.').trim(), weight: (fd.get('weight') || '').replace(',', '.').trim(), doctor: !!fd.get('doctor'), done: !!fd.get('done'), author: fd.get('author').trim() });
    if (n.type !== 'measure') { n.height = ''; n.weight = ''; }
    if (n.type === 'vacc') Object.assign(n, { vStatus: fd.get('vStatus') || 'done', vInf: fd.getAll('vInf'), vDose: (fd.get('vDose') || '').trim(), vLot: (fd.get('vLot') || '').trim() });
    else { delete n.vStatus; delete n.vInf; delete n.vDose; delete n.vLot; }
    if (n.author) { S.author = n.author; MC.db.put('kv', 'author', n.author); }
    await saveNote(n); toast('Сохранено'); location.replace('#/n/' + n.id);
  };
}
function shrink(file, max = 1600) {
  return new Promise((res, rej) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.8)); };
    img.onerror = rej; img.src = url;
  });
}

/* ---------- Сводка, изображения ---------- */
function viewSummary(v, key) {
  const sm = S.data.summary;
  if (key && sm[key]) { frame(sm[key].title); v.innerHTML = `<article class="card mdbody">${md(sm[key].md)}</article>`; return; }
  frame('Сводка');
  v.innerHTML = `<section class="card"><p class="muted">Краткая выжимка по всем документам: только факты, без выводов.</p><ul class="list">${Object.entries(sm).map(([k, s]) => `<li><a href="#/sum/${k}"><span class="ttl">${k}. ${esc(s.title)}</span></a></li>`).join('')}</ul></section>
    <section class="card mdbody">${md(S.data.intro.replace(/^# .*\n/, ''))}</section>`;
}
function viewIll(v, id) {
  const il = S.data.illustrations.find(i => i.id === id); if (!il) return;
  frame('Изображение');
  v.innerHTML = `<article class="card"><h2>${esc(il.title)}</h2><p class="muted">${esc(il.desc)}</p><div class="zoom"><img src="${il.img}" alt=""></div><p class="muted small">На телефоне изображение можно увеличить двумя пальцами.</p></article>`;
}

/* ---------- Дневник прививок ---------- */
const infName = id => ((S.data.vacc && S.data.vacc.infections.find(i => i.id === id)) || { name: id }).name;
const vaccLabel = r => r.vaccine || (r.inf || []).map(infName).join(', ');
const vaccNoteText = n => [V_STATUS[n.vStatus || 'done'], n.vDose && 'доза ' + n.vDose, (n.vInf || []).map(infName).join(', '), n.vLot && 'серия ' + n.vLot].filter(Boolean).join(' · ');
function vaccItems() {
  const V = S.data.vacc; if (!V) return [];
  const recs = V.records.map((r, i) => Object.assign({}, r, { key: 'r' + i, from: 'doc' }));
  const notes = liveNotes().filter(n => n.type === 'vacc').map(n => ({ key: 'n' + n.id, date: n.date, dateText: fmtDate(n.date), approx: false, inf: n.vInf || [], vaccine: n.title, dose: n.vDose || '', status: n.vStatus || 'done', src: [n.vLot && 'Серия: ' + n.vLot, n.text].filter(Boolean).join('\n'), note: n.id, author: n.author, from: 'note' }));
  return recs.concat(notes).sort((a, b) => a.date.localeCompare(b.date));
}
const vShort = r => r.short || fmtDate(r.date);
function vaccTable(print) {
  const items = vaccItems(); const V = S.data.vacc;
  const used = new Set(items.flatMap(r => r.inf));
  const rows = V.infections.filter(i => used.has(i.id) || (!print && i.id !== 'other' && V.infections.indexOf(i) < 11)).map(i => {
    const its = items.filter(r => r.inf.includes(i.id));
    const cells = its.map(r => print
      ? `${esc(vShort(r))}${r.dose ? ' (' + esc(r.dose) + ')' : ''}${r.status !== 'done' && !vShort(r).includes(V_STATUS[r.status].replace(/^\S+\s/, '')) ? ' — ' + esc(V_STATUS[r.status].replace(/^\S+\s/, '')) : ''}`
      : `<button class="vd s-${r.status}${r.approx ? ' approx' : ''}${r.from === 'note' ? ' mine' : ''}" data-k="${r.key}">${esc(vShort(r))}${r.dose ? ' · ' + esc(r.dose) : ''}</button>`);
    return `<tr><th>${esc(i.name)}</th><td>${cells.length ? cells.join(print ? '; ' : ' ') : '<span class="muted">нет данных</span>'}</td></tr>`;
  }).join('');
  return `<div class="tw"><table class="vtab"><tbody>${rows}</tbody></table></div>`;
}
function viewVacc(v) {
  frame('Дневник прививок');
  const V = S.data.vacc; if (!V) { v.innerHTML = '<p>Нет данных о прививках</p>'; return; }
  const items = vaccItems(); const exact = items.filter(r => !r.approx && r.status === 'done').length;
  const docLinks = ds => (ds || []).map(n => docByN(n)).filter(Boolean).map(d => `<a href="#/d/${d.n}">📄 ${d.date ? fmtDate(d.date) : 'документ без даты'}</a>`).join(' ');
  const H_IC = { exempt: '⛔', allowed: '✅', note: 'ℹ️' };
  v.innerHTML = `
  <section class="card"><p class="lead">Все прививки, которые упоминаются в документах, плюс те, что вы добавите сами (например, сделанные в Финляндии).</p>
    <p class="muted small">Известно записей: <b>${items.length}</b>, из них с точной датой: <b>${exact}</b>. ≈ — дата приблизительная (известно только из анамнеза).</p>
    <div class="quick"><a class="btn primary" href="#/new?type=vacc">＋ Добавить прививку</a><a class="btn" href="#/doctor">🩺 Показать врачу</a></div></section>
  <section class="card"><h3>По инфекциям</h3>${vaccTable(false)}
    <div class="legend vleg"><span><i class="vd s-done"></i>сделана</span><span><i class="vd s-done approx"></i>дата приблизительная</span><span><i class="vd s-indicated"></i>показана / назначена</span><span><i class="vd s-plan"></i>запланирована</span><span><i class="vd mine"></i>добавлено вами</span></div></section>
  <section class="card"><h3>Все прививки по датам</h3><ul class="list vlist">${items.slice().reverse().map(r => `<li id="v-${r.key}"><div class="vrow">
    <span class="date">${esc(r.dateText || fmtDate(r.date))}</span>
    <span class="ttl">💉 ${esc(vaccLabel(r))}${r.dose ? ' · ' + esc(r.dose) : ''} <span class="chip">${esc(V_STATUS[r.status] || r.status)}</span></span>
    ${r.vaccine ? `<span class="meta">От: ${esc(r.inf.map(infName).join(', '))}</span>` : ''}
    ${r.src ? `<span class="meta">${esc(r.src)}</span>` : ''}
    <span class="meta">${r.from === 'note' ? `<a href="#/n/${r.note}">✍️ Запись родителей${r.author ? ' (' + esc(r.author) + ')' : ''} — открыть</a>` : docLinks(r.docs)}</span></div></li>`).join('')}</ul></section>
  <section class="card"><h3>Медотводы и разрешения</h3><ul class="list vlist">${V.history.map(h => `<li><div class="vrow"><span class="date">${esc(h.dateText || fmtDate(h.date))}</span>
    <span class="ttl">${H_IC[h.kind] || ''} ${esc(h.text)}</span><span class="meta">${docLinks(h.docs)}</span></div></li>`).join('')}</ul></section>
  <section class="card"><h3>Чего не хватает</h3><ul>${V.gaps.map(g => `<li>${esc(g)}</li>`).join('')}</ul></section>`;
  v.querySelectorAll('.vtab .vd').forEach(b => b.onclick = () => { const el = document.getElementById('v-' + b.dataset.k); if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } });
}

/* ---------- Для врача ---------- */
function viewDoctor(v) {
  frame('Для врача'); document.body.classList.add('doctor-mode');
  const c = S.data.child, kf = S.data.keyfacts, td = today();
  const dn = liveNotes().filter(n => n.doctor).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const meds = liveNotes().filter(n => n.type === 'med' && !n.done && (!n.endDate || n.endDate >= td));
  const qs = liveNotes().filter(n => n.type === 'question' && !n.done);
  v.innerHTML = `<div class="doctorbar"><button class="btn" id="fsm">А−</button><button class="btn" id="fsp">А+</button><button class="btn" onclick="window.print()">🖨 Печать</button><a class="btn" href="#/">✕ Выйти</a></div>
  <article class="card dr">
    <h2>${esc(c.name)}</h2><p class="big">Дата рождения: <b>${fmtDate(c.birth)}</b> · возраст <b>${ageAt(td)}</b> · пол ${esc(c.sex)}</p>
    <p>Группа крови: <b>${esc(c.blood)}</b></p>
    <p class="muted small">Документы получены в России до переезда в Финляндию (08.2022 – 11.2026). Ниже — факты из документов.</p>
    <h3>Диагнозы</h3><ul>${kf.headline.map(h => `<li>${esc(h.text)}</li>`).join('')}</ul>
    <h3>Аллергия</h3><p>${esc(kf.allergy)}</p>
    <h3>Лекарства</h3><p>${esc(kf.meds_now)}</p>${meds.length ? `<ul>${meds.map(n => `<li><b>${esc(n.title)}</b>${n.text ? ' — ' + esc(n.text) : ''} <span class="muted">(с ${fmtDate(n.date)})</span></li>`).join('')}</ul>` : ''}
    <h3>Важно</h3><ul>${kf.alerts.map(a => `<li><b>${esc(a.title)}.</b> ${esc(a.text)}</li>`).join('')}</ul>
    ${S.data.summary['1.2'] ? `<h3>Операции и госпитализации</h3>${md(S.data.summary['1.2'].md)}` : ''}
    <h3>Рост и вес</h3>${growthCharts()}
    ${S.data.vacc ? `<h3>Прививки</h3>${vaccTable(true)}<p class="muted small">${esc(S.data.vacc.gaps[0])}</p>` : ''}
    ${dn.length ? `<h3>Записи родителей</h3>${dn.map(n => `<div class="drnote"><b>${fmtDate(n.date)} — ${esc(n.title || NOTE_TYPES[n.type].name)}</b>${n.height || n.weight ? `<p>${n.height ? 'Рост ' + esc(n.height) + ' см ' : ''}${n.weight ? 'Вес ' + esc(n.weight) + ' кг' : ''}</p>` : ''}${n.text ? md(n.text) : ''}</div>`).join('')}` : ''}
    ${qs.length ? `<h3>Наши вопросы</h3><ol>${qs.map(n => `<li>${esc(n.title)}${n.text ? '<br><span class="muted">' + esc(n.text) + '</span>' : ''}</li>`).join('')}</ol>` : ''}
    <p class="muted small">Полные тексты всех 177 документов — в разделах медкарты и через поиск.</p>
  </article>`;
  $('#fsp').onclick = () => { S.fontScale = Math.min(1.6, S.fontScale + 0.1); applyFont(); MC.db.put('kv', 'fontScale', S.fontScale); };
  $('#fsm').onclick = () => { S.fontScale = Math.max(0.8, S.fontScale - 0.1); applyFont(); MC.db.put('kv', 'fontScale', S.fontScale); };
}

/* ---------- Ещё / настройки ---------- */
function viewMore(v) {
  frame('Ещё');
  v.innerHTML = `<section class="card"><ul class="list menu">
    <li><a href="#/doctor"><span class="ttl">🩺 Для врача</span><span class="meta">Короткая страница, крупный шрифт, печать</span></a></li>
    <li><a href="#/sum"><span class="ttl">📋 Сводка по документам</span><span class="meta">Диагнозы, операции, лекарства, рост, анализы, расхождения</span></a></li>
    <li><a href="#/t"><span class="ttl">🗓 Хронология</span><span class="meta">Все документы и записи по датам</span></a></li>
    <li><a href="#/v"><span class="ttl">💉 Дневник прививок</span><span class="meta">Сделанные прививки, медотводы, добавление новых</span></a></li>
    ${S.data.illustrations.map(i => `<li><a href="#/i/${i.id}"><span class="ttl">🖼 ${esc(i.title)}</span></a></li>`).join('')}
    <li><a href="#/set"><span class="ttl">⚙️ Настройки, передача записей, резервная копия</span></a></li>
  </ul></section>`;
}
function viewSettings(v) {
  frame('Настройки');
  const cnt = liveNotes().length;
  v.innerHTML = `<section class="card"><h3>Передать записи второму родителю / резервная копия</h3>
    <p>Записи, которые вы добавляете, хранятся только на этом устройстве (зашифрованно). Чтобы они появились у жены/мужа или сохранились при смене телефона:</p>
    <ol><li>Нажмите «Сохранить записи в файл» — файл зашифрован тем же паролем.</li><li>Отправьте файл себе или второму родителю (Telegram, AirDrop, почта).</li><li>На другом устройстве: «Загрузить записи из файла». Записи объединятся, ничего не пропадёт.</li></ol>
    <p class="muted">Сейчас записей: ${cnt}</p>
    <div class="row"><button class="btn primary" id="exp">⬇️ Сохранить записи в файл</button><label class="btn filebtn">⬆️ Загрузить записи из файла<input type="file" id="imp" accept=".json,application/json"></label></div></section>
    <section class="card"><h3>Безопасность</h3>
    <div class="row"><button class="btn" id="setpin">${S.pinSet ? 'Сменить PIN-код' : 'Включить вход по PIN-коду'}</button><button class="btn" id="lock">🔒 Заблокировать сейчас</button></div>
    <p class="muted small">Через 5 минут в фоне медкарта блокируется (если задан PIN). После 5 неверных PIN нужен пароль.</p>
    <button class="btn danger" id="forget">Забыть это устройство</button>
    <p class="muted small">«Забыть устройство» удаляет сохранённый ключ и PIN. Записи останутся, но для входа понадобится пароль.</p></section>
    <section class="card"><h3>Как поставить на iPhone</h3><ol><li>Откройте адрес медкарты в Safari.</li><li>Нажмите «Поделиться» → «На экран „Домой“».</li><li>Откройте с иконки и войдите паролем — дальше работает и без интернета.</li></ol></section>
    <section class="card"><h3>О данных</h3><p class="muted small">Версия данных: ${esc(S.data.built)}. Документов: ${S.data.docs.length}. Медицинские данные зашифрованы (AES-256-GCM, ключ из пароля PBKDF2 600 000 итераций). Без пароля их прочитать нельзя.</p></section>`;
  $('#exp').onclick = exportNotes; $('#imp').onchange = importNotes;
  $('#setpin').onclick = offerPin;
  $('#lock').onclick = () => S.pinSet ? showPin() : showPassword();
  $('#forget').onclick = async () => { if (!confirm('Забыть ключ и PIN на этом устройстве?')) return; await forgetDevice(); location.reload(); };
}
async function exportNotes() {
  const rec = await MC.crypto.encJSON(S.key, { v: 1, exported: new Date().toISOString(), notes: S.notes }, 'medcard-backup');
  const blob = new Blob([JSON.stringify({ type: 'medcard-backup', v: 1, salt: S.blob.salt, ...rec })], { type: 'application/json' });
  const name = `medcard-zapisi-${today()}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Медкарта — записи' }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Файл сохранён');
}
async function importNotes(e) {
  const f = e.target.files[0]; if (!f) return;
  try {
    const j = JSON.parse(await f.text()); if (j.type !== 'medcard-backup') throw new Error('Это не файл записей медкарты');
    const data = await MC.crypto.decJSON(S.key, j);
    let added = 0, updated = 0;
    for (const n of data.notes) {
      const mine = S.notes.find(x => x.id === n.id);
      if (!mine) { await MC.db.put('notes', n.id, await MC.crypto.encJSON(S.key, n, 'medcard-note')); S.notes.push(n); if (!n.deleted) added++; }
      else if ((n.updated || 0) > (mine.updated || 0)) { await MC.db.put('notes', n.id, await MC.crypto.encJSON(S.key, n, 'medcard-note')); Object.assign(mine, n); updated++; }
    }
    buildIndex(); toast(`Добавлено: ${added}, обновлено: ${updated}`); render();
  } catch (err) { alert('Не удалось загрузить: ' + (err.name === 'OperationError' ? 'файл зашифрован другим паролем' : err.message)); }
  e.target.value = '';
}

if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') window.__S = S; // только для локальной проверки
boot();
})();
