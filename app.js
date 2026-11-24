/* ServiceNotes v0.1 – Offline-Doku für den Außendienst.
   Alle Daten bleiben lokal auf dem Gerät (IndexedDB). Kein Server, keine Cloud. */
'use strict';
const APP_VERSION = '0.1.0';

/* ------------------------------------------------------------ Helfer */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const fmtT = ts => { if (!ts) return '–'; const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtD = ts => { const d = new Date(ts); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
const fmtDT = ts => `${fmtD(ts)}, ${fmtT(ts)}`;
const fmtDur = ms => { if (ms == null || ms < 0) return '–'; const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}:${pad(m % 60)} h`; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
const fmtN = n => n == null ? '–' : String(n).replace('.', ',');
const ICON = {
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  lock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  cam: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1D4ED8" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5"/><path d="M12 18v.5"/></svg>'
};
function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

/* ------------------------------------------------------------ Speicher (IndexedDB) */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('servicenotes', 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('cases', { keyPath: 'id' }); d.createObjectStore('photos', { keyPath: 'id' }); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = this.db.transaction(store, mode); const req = fn(t.objectStore(store));
      t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error);
    });
  },
  all(s) { return this.tx(s, 'readonly', o => o.getAll()); },
  put(s, v) { return this.tx(s, 'readwrite', o => o.put(v)); },
  del(s, id) { return this.tx(s, 'readwrite', o => o.delete(id)); }
};

/* ------------------------------------------------------------ Checklisten (DEMO – werden durch echte ersetzt) */
const TEMPLATES = {
  kal: {
    name: 'Kalibrierung', flow: { ok: 'Gerät erfolgreich kalibriert', rep: 'Gerät repariert und kalibriert', def: 'Gerät defekt – Angebot folgt' },
    steps: [
      { id: 'sicht', type: 'yesno', q: 'Sichtprüfung: Gerät äußerlich in Ordnung?', reasons: ['Gehäuse beschädigt', 'verschmutzt', 'Kabel beschädigt', 'Sonstiges'], photos: 1 },
      { id: 'null', type: 'measure', q: 'Messwert Nullpunkt', soll: 0, tol: 0.05 },
      { id: 'ref', type: 'measure', q: 'Messwert Referenzpunkt', soll: 100, tol: 0.5 },
      { id: 'dicht', type: 'yesno', q: 'Dichtungen in Ordnung?', reasons: ['porös', 'undicht', 'fehlt', 'Sonstiges'], photos: 2, photoHint: 'vorher + nachher' },
      { id: 'funk', type: 'yesno', q: 'Funktionstest am Gerät bestanden?', reasons: ['keine Funktion', 'Fehlermeldung', 'Werte instabil', 'Sonstiges'], photos: 1 }
    ]
  },
  wart: {
    name: 'Wartung', flow: { ok: 'Wartung erfolgreich durchgeführt', rep: 'Wartung durchgeführt, Reparatur erfolgt', def: 'Gerät defekt – Angebot folgt' },
    steps: [
      { id: 'sicht', type: 'yesno', q: 'Sichtprüfung: Gerät äußerlich in Ordnung?', reasons: ['Gehäuse beschädigt', 'verschmutzt', 'Kabel beschädigt', 'Sonstiges'], photos: 1 },
      { id: 'rein', type: 'yesno', q: 'Reinigung durchgeführt und Gerät sauber?', reasons: ['starke Verschmutzung bleibt', 'Bauteil korrodiert', 'Sonstiges'], photos: 1 },
      { id: 'dicht', type: 'yesno', q: 'Dichtungen in Ordnung?', reasons: ['porös', 'undicht', 'fehlt', 'Sonstiges'], photos: 2, photoHint: 'vorher + nachher' },
      { id: 'funk', type: 'yesno', q: 'Funktionstest am Gerät bestanden?', reasons: ['keine Funktion', 'Fehlermeldung', 'Werte instabil', 'Sonstiges'], photos: 1 }
    ]
  },
  ibn: {
    name: 'Inbetriebnahme', flow: { ok: 'Gerät erfolgreich in Betrieb genommen', rep: 'In Betrieb genommen nach Nacharbeit', def: 'Inbetriebnahme nicht möglich' },
    steps: [
      { id: 'einbau', type: 'photo', q: 'Foto der Einbausituation', photos: 1 },
      { id: 'anschl', type: 'yesno', q: 'Anschlüsse korrekt und fest?', reasons: ['falsch verdrahtet', 'lose', 'fehlt', 'Sonstiges'], photos: 1 },
      { id: 'param', type: 'yesno', q: 'Parameter eingestellt und gespeichert?', reasons: ['Vorgabe fehlt', 'Gerät nimmt Werte nicht an', 'Sonstiges'], photos: 1 },
      { id: 'ref', type: 'measure', q: 'Messwert Referenzpunkt', soll: 100, tol: 0.5 },
      { id: 'funk', type: 'yesno', q: 'Funktionstest am Gerät bestanden?', reasons: ['keine Funktion', 'Fehlermeldung', 'Werte instabil', 'Sonstiges'], photos: 1 }
    ]
  }
};
const PROD_REASONS = ['Keine Produktion am Einsatztag', 'Produktionsmaterial fehlte', 'Kunde wollte nicht warten', 'Sonstiges'];
const MASSNAHMEN = ['Behoben', 'Nicht behebbar'];

/* ------------------------------------------------------------ Zustand */
let cases = [];
const photoURL = new Map();   // photoId -> objectURL
const photoMeta = new Map();  // photoId -> {ts, label}
const ui = { view: 'home', caseId: null, sn: null, search: '', filter: 'alle', selecting: false, selected: new Set() };
const settings = JSON.parse(localStorage.getItem('sn-settings') || '{"name":"","firma":""}');
const cur = () => cases.find(c => c.id === ui.caseId);
const curDev = () => cur()?.devices.find(d => d.sn === ui.sn);

let saveTimer = null;
function save(c = cur(), now = false) {
  if (!c) return;
  c.updatedAt = Date.now();
  clearTimeout(saveTimer);
  const doIt = () => DB.put('cases', JSON.parse(JSON.stringify(c))).catch(e => alert('Speichern fehlgeschlagen: ' + e));
  if (now) return doIt();
  saveTimer = setTimeout(doIt, 250);
}

/* ------------------------------------------------------------ Fachlogik */
const tolOk = (step, v) => v != null && Math.abs(v - step.soll) <= step.tol + 1e-9;
const photoNeed = (step, a) => {
  if (step.type === 'photo') return step.photos;
  if (step.type === 'yesno' && a.ans === 'nein') return step.photos || 1;
  if (step.type === 'measure' && num(a.value) != null && !tolOk(step, num(a.value))) return 1;
  return 0;
};

function stepMissing(step, a) {
  const m = [];
  if (step.type === 'yesno') {
    if (!a.ans) return ['Ja oder Nein wählen'];
    if (a.ans === 'nein') {
      if (!a.reason) m.push('„Was ist los?“ auswählen');
      else if (a.reason === 'Sonstiges' && !(a.reasonText || '').trim()) m.push('„Sonstiges“ kurz beschreiben');
      if (!a.massnahme) m.push('Maßnahme wählen: behoben oder nicht behebbar');
      if (!(a.massnahmeText || '').trim()) m.push('Kurz beschreiben, was gemacht wurde');
    }
  }
  if (step.type === 'measure') {
    const v = num(a.value);
    if (v == null) return ['Messwert eintragen'];
    if (!tolOk(step, v)) {
      if (!a.adjusted) m.push('Nachfrage beantworten: Gerät justiert?');
      if (a.adjusted === 'ja') {
        const af = num(a.after);
        if (af == null) m.push('Wert nach der Justage eintragen');
        else if (!tolOk(step, af)) m.push('Wert nach Justage noch außerhalb – weiter justieren oder „Nein“ wählen');
      }
      if (a.adjusted === 'nein' && !(a.massnahmeText || '').trim()) m.push('Kurz beschreiben, warum nicht justierbar');
    }
  }
  const need = photoNeed(step, a), have = (a.photos || []).length;
  if (need > have) {
    if (a.noPhoto?.on) { if (!(a.noPhoto.reason || '').trim()) m.push('Grund angeben, warum kein Foto möglich ist'); }
    else m.push(need - have === 1 ? 'Noch 1 Pflichtfoto' : `Noch ${need - have} Pflichtfotos`);
  }
  return m;
}

function devResult(dev) {
  const t = TEMPLATES[dev.tpl]; let r = 'ok';
  t.steps.forEach(s => {
    const a = dev.ans[s.id] || {};
    if (s.type === 'yesno' && a.ans === 'nein') r = a.massnahme === 'Nicht behebbar' ? 'def' : (r === 'def' ? r : 'rep');
    if (s.type === 'measure' && num(a.value) != null && !tolOk(s, num(a.value))) r = a.adjusted === 'nein' ? 'def' : (r === 'def' ? r : 'rep');
  });
  return r;
}
const devDone = d => TEMPLATES[d.tpl].steps.every(s => d.ans[s.id]?.doneAt);
const devStarted = d => TEMPLATES[d.tpl].steps.some(s => d.ans[s.id]?.doneAt);
const devStatus = d => d.copiedFrom || devDone(d) ? devResult(d) : (devStarted(d) ? 'run' : 'open');
const STATUS = { ok: ['OK', 'b-ok'], rep: ['Repariert', 'b-rep'], def: ['Defekt', 'b-def'], open: ['Offen', 'b-open'], run: ['In Arbeit', 'b-run'] };
const badge = st => `<span class="badge ${STATUS[st][1]}">${STATUS[st][0]}</span>`;
const isDone = d => devDone(d) || !!d.copiedFrom;
const tv = t => t ? (t.korr ?? t.t) : null;  // gültiger Zeitpunkt (korrigiert oder erfasst)

function workMs(c) {
  const b = tv(c.times.beginn), e = tv(c.times.ende);
  if (!b || !e) return null;
  const p = (c.times.pausen || []).reduce((s, x) => s + ((x.ende || 0) - (x.start || 0) > 0 ? x.ende - x.start : 0), 0);
  return e - b - p;
}
function stage(c) {
  if (c.sign?.at) return 4;
  if (c.ue?.doneAt) return 3;
  if (c.devices.length && c.devices.every(isDone)) return 2;
  return 1;
}
function ueMissing(u) {
  const m = [];
  if (!u.funk) m.push('Funktionstest: Ja oder Nein');
  if (u.funk === 'nein' && !(u.funkText || '').trim()) m.push('Grund, warum kein Funktionstest');
  if (!u.prod) m.push('Produktionsbedingungen: Ja oder Nein');
  if (u.prod === 'nein') {
    if (!u.prodReason) m.push('Grund wählen, warum kein Produktionstest');
    else if (u.prodReason === 'Sonstiges' && !(u.prodText || '').trim()) m.push('„Sonstiges“ beschreiben');
    if (!(u.ersatz || '').trim()) m.push('Beschreiben, wie ersatzweise getestet wurde');
  }
  if (!(u.photos || []).length) {
    if (u.noPhoto?.on) { if (!(u.noPhoto.reason || '').trim()) m.push('Grund angeben, warum kein Foto möglich ist'); }
    else m.push('Pflichtfoto vom laufenden Gerät');
  }
  return m;
}
function ueSentence(c) {
  const u = c.ue || {}; const d = fmtD(c.createdAt); const parts = [];
  if (u.funk === 'ja') parts.push('Ein Funktionstest wurde durchgeführt.');
  if (u.funk === 'nein') parts.push(`Ein Funktionstest war nicht möglich: ${u.funkText || '…'}.`);
  if (u.prod === 'ja') parts.push(`Die Geräte wurden am ${d} unter realen Produktionsbedingungen getestet.`);
  if (u.prod === 'nein') {
    const g = u.prodReason === 'Sonstiges' ? (u.prodText || '…') : (u.prodReason || '…');
    parts.push(`Ein Test unter realen Produktionsbedingungen war am ${d} nicht möglich (Grund: ${g}). Ersatzweise: ${u.ersatz || '…'}.`);
  }
  parts.push('Die Geräte wurden im dokumentierten Zustand übergeben.');
  return parts.join(' ');
}

/* ------------------------------------------------------------ Fotos */
async function addPhoto(file, label) {
  const ts = Date.now();
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const max = 1600, sc = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
  const g = cv.getContext('2d'); g.drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(img.src);
  // Zeitstempel ins Bild einbrennen
  const txt = `${fmtDT(ts)} · ${label}`; const fs = Math.max(18, Math.round(cv.width / 45));
  g.font = `600 ${fs}px -apple-system, sans-serif`; const w = g.measureText(txt).width;
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, cv.height - fs * 1.8, w + fs * 1.2, fs * 1.8);
  g.fillStyle = '#fff'; g.fillText(txt, fs * 0.6, cv.height - fs * 0.6);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.8));
  const id = uid();
  await DB.put('photos', { id, blob, ts, label, caseId: ui.caseId });
  photoURL.set(id, URL.createObjectURL(blob)); photoMeta.set(id, { ts, label });
  return id;
}
async function loadPhotos() {
  for (const p of await DB.all('photos')) { photoURL.set(p.id, URL.createObjectURL(p.blob)); photoMeta.set(p.id, { ts: p.ts, label: p.label }); }
}
function photoGrid(list, need, ctx, locked) {
  const items = (list || []).map(id => `<div class="ph"><img src="${photoURL.get(id) || ''}" alt="Foto ${esc(photoMeta.get(id)?.label)}">${locked ? '' : `<button class="x" data-act="delPhoto" data-ctx="${ctx}" data-id="${id}" aria-label="Foto löschen">×</button>`}</div>`);
  if (!locked) {
    const missing = Math.max(0, need - (list || []).length);
    for (let i = 0; i < Math.max(missing, 1); i++) {
      const req = i < missing;
      items.push(`<label class="slot ${req ? 'req' : ''}">${ICON.cam}${req ? 'Pflichtfoto' : 'weiteres Foto'}<input type="file" accept="image/*" capture="environment" data-photo="${ctx}"></label>`);
    }
  }
  return `<div class="photos">${items.join('')}</div>`;
}
function noPhotoBox(obj, ctx) {
  if (!obj?.on) return `<button class="btn ghost small" data-act="noPhoto" data-ctx="${ctx}">Foto nicht möglich?</button>`;
  return `<div class="followup"><div class="h">Foto nicht möglich – wird im Bericht deutlich markiert</div>
    <label class="field">Warum? (Pflicht)<textarea class="inp" data-bind="${ctx}.noPhoto.reason" placeholder="z. B. Fotoverbot im Reinraum">${esc(obj.reason)}</textarea></label>
    <button class="btn sec" data-act="noPhoto" data-ctx="${ctx}">Doch ein Foto machen</button></div>`;
}

/* ------------------------------------------------------------ Views */
const topbar = (title, back) => `<header class="top">${back ? `<button class="back" data-act="go" data-view="${back}">‹ Zurück</button>` : ''}<div class="title">${esc(title)}</div><div class="net ${navigator.onLine ? 'on' : ''}"><i></i>${navigator.onLine ? 'Online' : 'Offline'} · lokal gespeichert</div></header>`;

const V = {};
V.home = () => {
  const list = [...cases].sort((a, b) => b.createdAt - a.createdAt).map(c => {
    const st = c.sign?.at ? '<span class="badge b-ok">Abgeschlossen</span>' : '<span class="badge b-run">In Arbeit</span>';
    const done = c.devices.filter(isDone).length;
    return `<div class="card case" data-act="open" data-id="${c.id}"><div class="main"><b>${esc(c.kunde)}</b><div class="small muted">${esc(c.nr || 'ohne Case-Nr.')} · ${fmtD(c.createdAt)} · ${done}/${c.devices.length} Geräte</div></div>${st}</div>`;
  }).join('');
  return topbar('ServiceNotes') + `<main class="wrap">
    <div><h1>Einsätze</h1><div class="muted small">Alles bleibt auf diesem Gerät. Version ${APP_VERSION}</div></div>
    <button class="btn pri big" data-act="go" data-view="newcase">+ Neuer Einsatz</button>
    ${list || '<div class="card muted">Noch keine Einsätze. Leg oben einen an – für Tests am besten mit erfundenen Daten.</div>'}
    <div class="card stack"><div class="lbl">Einstellungen</div>
      <label class="field">Dein Name (steht im Bericht)<input class="inp" data-bind="set.name" value="${esc(settings.name)}" placeholder="Vorname Nachname"></label>
      <label class="field">Firma<input class="inp" data-bind="set.firma" value="${esc(settings.firma)}" placeholder="Firmenname"></label>
    </div></main>`;
};

V.newcase = () => topbar('Neuer Einsatz', 'home') + `<main class="wrap">
  <div class="card stack">
    <label class="field">Kunde (Pflicht)<input class="inp" id="nc-kunde" placeholder="Firmenname"></label>
    <label class="field">Adresse<input class="inp" id="nc-adr"></label>
    <div class="grid2"><label class="field">Ansprechpartner vor Ort<input class="inp" id="nc-ap"></label>
    <label class="field">CE-Case-Nr.<input class="inp" id="nc-nr"></label></div>
    <div class="field">Standard-Checkliste für die Geräte<div class="chips" id="nc-tpl">${Object.entries(TEMPLATES).map(([k, t], i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-act="pickTpl" data-k="${k}">${t.name}</button>`).join('')}</div></div>
  </div>
  <button class="btn pri big" data-act="createCase">Einsatz anlegen</button></main>`;

function timeTile(c, key, label) {
  const t = c.times[key];
  const btnLbl = { ankunft: 'Angekommen', beginn: 'Arbeit beginnen', ende: 'Arbeit beenden' }[key];
  const can = !c.sign?.at && (key !== 'beginn' || c.times.ankunft) && (key !== 'ende' || stage(c) >= 3);
  return `<div class="time"><span class="k">${label}</span>${t ? `<span class="v">${fmtT(tv(t))}</span>${t.korr != null ? `<span class="c">korrigiert · erfasst ${fmtT(t.t)}</span>` : ''}${c.sign?.at ? '' : `<button class="btn ghost small" style="min-height:36px;justify-content:flex-start;padding:0" data-act="korr" data-k="${key}">korrigieren</button>`}`
    : `<button class="btn ${can ? 'pri' : ''}" ${can ? '' : 'disabled'} data-act="stamp" data-k="${key}">${btnLbl}</button>`}</div>`;
}

V.case = () => {
  const c = cur(); const sg = stage(c);
  const pausen = c.times.pausen || []; const inPause = pausen.length && !pausen[pausen.length - 1].ende;
  const pauseMs = pausen.reduce((s, p) => s + (p.ende ? p.ende - p.start : 0), 0);
  const done = c.devices.filter(isDone).length, n = c.devices.length;
  const st = (i, name, sub) => {
    const cls = sg > i ? 'done' : sg === i ? 'now' : 'lock';
    return `<button class="stage ${cls}" ${cls === 'lock' ? 'disabled' : ''} data-act="${i === 1 ? 'noop' : i === 2 ? 'goUe' : 'goSign'}"><b>${cls === 'lock' ? ICON.lock + ' ' : cls === 'done' ? '✓ ' : ''}${name}</b><span>${sub}</span></button>`;
  };
  const q = ui.search.trim();
  let devs = c.devices.filter(d => !q || d.sn.replace(/\D/g, '').endsWith(q.replace(/\D/g, '')) || d.sn.toLowerCase().includes(q.toLowerCase()));
  if (ui.filter === 'offen') devs = devs.filter(d => !isDone(d));
  if (ui.filter === 'erledigt') devs = devs.filter(isDone);
  if (ui.filter === 'probleme') devs = devs.filter(d => isDone(d) && devResult(d) !== 'ok');
  const rows = devs.map(d => {
    const s = devStatus(d); const sel = ui.selected.has(d.sn);
    return `<div class="dev">${ui.selecting ? `<button class="cb ${sel ? 'on' : ''}" data-act="sel" data-sn="${esc(d.sn)}" aria-label="auswählen">${sel ? '<span style="color:#fff">' + ICON.check + '</span>' : ''}</button>` : ''}
      <div class="main" data-act="openDev" data-sn="${esc(d.sn)}"><div class="sn">${esc(d.sn)}</div><div class="meta">${esc(d.typ || 'ohne Typ')} · ${esc(d.ort || '–')} · ${TEMPLATES[d.tpl].name}${d.copiedFrom ? ' · übernommen von ' + esc(d.copiedFrom) : ''}</div></div>${badge(s)}</div>`;
  }).join('');
  const nextHint = sg === 1 ? (n ? `${ICON.warn} Noch ${n - done} Gerät${n - done === 1 ? '' : 'e'} offen` : `${ICON.warn} Noch keine Geräte`) : '';
  return topbar(c.kunde, 'home') + `<main class="wrap">
    <div class="card stack"><div class="row"><div class="grow"><h2>${esc(c.kunde)}</h2><div class="small muted">${esc(c.adresse || '')}${c.ap ? ' · ' + esc(c.ap) : ''}</div></div><span class="badge b-open">${esc(c.nr || 'ohne Case-Nr.')}</span></div></div>
    <div class="card"><div class="lbl">Zeiten · automatisch erfasst</div><div class="times">
      ${timeTile(c, 'ankunft', 'Ankunft')}${timeTile(c, 'beginn', 'Arbeitsbeginn')}
      <div class="time"><span class="k">Pausen</span><span class="v">${pausen.length ? fmtDur(pauseMs).replace(' h', ' h') : '–'}</span>${c.times.beginn && !c.sign?.at && !c.times.ende ? `<button class="btn ${inPause ? 'warn' : 'sec'}" data-act="pause">${inPause ? 'Pause beenden' : 'Pause starten'}</button>` : ''}</div>
      ${timeTile(c, 'ende', 'Arbeitsende')}</div></div>
    <div class="stages">${st(1, 'Geräte', `${done} / ${n} erledigt`)}${st(2, 'Übergabe-Check', sg >= 2 ? (c.ue?.doneAt ? 'erledigt' : 'jetzt dran') : 'nach allen Geräten')}${st(3, 'Unterschrift', sg >= 3 ? (c.sign?.at ? 'erledigt' : 'jetzt dran') : 'nach Übergabe')}</div>
    ${c.sign?.at ? `<button class="btn ok big" data-act="go" data-view="done">Bericht ansehen &amp; teilen</button>` : ''}
    <div class="card stack">
      <div class="row"><h2 class="grow">Geräte</h2>${c.sign?.at ? '' : `<button class="btn sec small" data-act="addDev">+ Gerät</button>`}</div>
      ${!c.times.beginn && !c.sign?.at ? `<div class="lockinfo">${ICON.lock}<span>Checklisten sind gesperrt, bis du „Angekommen“ und „Arbeit beginnen“ getippt hast.</span></div>` : ''}
      ${n ? `<div class="progress"><i style="width:${Math.round(done / n * 100)}%"></i></div>` : ''}
      ${n === 0 ? `<div class="stack"><div class="muted small">Lade die Geräteliste aus CE (Excel oder CSV) oder füg Geräte einzeln hinzu.</div>
        <label class="btn pri">Geräteliste importieren<input type="file" accept=".xlsx,.csv,text/csv" data-import hidden></label>
        <button class="btn sec" data-act="demoDevs">Demo-Geräte laden (zum Ausprobieren)</button></div>` : `
      <div class="search">${ICON.search}<input inputmode="search" placeholder="Letzte Ziffern der Seriennummer …" data-bind="search" value="${esc(ui.search)}"></div>
      <div class="row wrap-r">${['alle', 'offen', 'erledigt', 'probleme'].map(f => `<button class="chip ${ui.filter === f ? 'on' : ''}" data-act="filter" data-f="${f}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}<span class="grow"></span>
        ${c.sign?.at ? '' : `<button class="btn ghost" data-act="selMode">${ui.selecting ? 'Fertig' : 'Auswählen'}</button>`}</div>
      ${ui.selecting ? `<div class="followup" style="background:var(--accentbg)"><b style="color:var(--accentfg)">${ui.selected.size} ausgewählt</b>
        <div class="small">Sammel-Abschluss: Ergebnis eines fertigen, fehlerfreien Geräts auf identische Geräte übernehmen. Geht nur bei Checklisten ohne Messwerte – Messwerte müssen pro Gerät erfasst werden.</div>
        <button class="btn pri" data-act="bulk" ${ui.selected.size ? '' : 'disabled'}>Ergebnis übernehmen …</button></div>` : ''}
      <div id="devlist">${rows || '<div class="muted small">Keine Treffer.</div>'}</div>`}
    </div>
    ${c.sign?.at ? '' : `<button class="btn ghost" style="color:var(--bad)" data-act="delCase">Einsatz löschen</button>`}
  </main>
  ${sg === 1 ? `<div class="bar"><div class="in"><span class="hint bad">${nextHint}</span><button class="btn" disabled>${ICON.lock} Zum Übergabe-Check</button></div></div>`
    : !c.sign?.at ? `<div class="bar"><div class="in"><span class="hint ok">${ICON.check} Alle Geräte erledigt</span><button class="btn pri" data-act="${sg === 2 ? 'goUe' : 'goSign'}">${sg === 2 ? 'Zum Übergabe-Check' : 'Zur Unterschrift'}</button></div></div>` : ''}`;
};

function stepBody(step, a, locked) {
  const ctx = 'ans';
  let h = `<div class="row"><span class="dot now">${TEMPLATES[curDev().tpl].steps.indexOf(step) + 1}</span><h2 class="grow">${esc(step.q)}</h2></div>`;
  if (step.type === 'yesno') {
    h += `<div class="yn"><button class="btn ${a.ans === 'ja' ? 'ok' : 'sec'}" data-act="ans" data-f="ans" data-v="ja">Ja</button><button class="btn ${a.ans === 'nein' ? 'bad' : 'sec'}" data-act="ans" data-f="ans" data-v="nein">Nein</button></div>`;
    if (a.ans === 'nein') {
      h += `<div class="followup"><div class="h">Nachfrage, weil „Nein“</div>
        <div class="field">Was ist los? (Pflicht)<div class="chips">${step.reasons.map(r => `<button class="chip ${a.reason === r ? 'on' : ''}" data-act="ans" data-f="reason" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>
        ${a.reason === 'Sonstiges' ? `<label class="field">Beschreibung<input class="inp" data-bind="ans.reasonText" value="${esc(a.reasonText)}"></label>` : ''}
        <div class="field">Maßnahme (Pflicht)<div class="chips">${MASSNAHMEN.map(r => `<button class="chip ${a.massnahme === r ? 'on' : ''}" data-act="ans" data-f="massnahme" data-v="${r}">${r}</button>`).join('')}</div></div>
        <label class="field">Was wurde gemacht? (Pflicht)<input class="inp" data-bind="ans.massnahmeText" value="${esc(a.massnahmeText)}" placeholder="z. B. Dichtung getauscht"></label>
        <label class="field">Material (optional)<input class="inp" data-bind="ans.material" value="${esc(a.material)}" placeholder="z. B. Dichtungssatz DS-12 × 1"></label></div>`;
    }
  }
  if (step.type === 'measure') {
    const v = num(a.value), ok = v != null && tolOk(step, v);
    h += `<div class="vals"><div class="val"><small>Soll</small><b>${fmtN(step.soll)}</b></div><div class="val"><small>Toleranz</small><b>± ${fmtN(step.tol)}</b></div>
      <div class="val ${v == null ? '' : ok ? 'ok' : 'bad'}"><small>${v == null ? 'Ist' : ok ? 'Ist · in Toleranz' : 'Ist · außerhalb'}</small><b>${v == null ? '–' : fmtN(v)}</b></div></div>
      <label class="field">Gemessener Wert<input class="inp" inputmode="decimal" data-bind="ans.value" data-rerender value="${esc(a.value)}" placeholder="z. B. 100,1"></label>`;
    if (v != null && !ok) {
      const af = num(a.after);
      h += `<div class="followup"><div class="h">Wert außerhalb der Toleranz – Nachfrage</div>
        <div class="field">Gerät justiert?<div class="yn"><button class="btn ${a.adjusted === 'ja' ? 'ok' : 'sec'}" data-act="ans" data-f="adjusted" data-v="ja">Ja</button><button class="btn ${a.adjusted === 'nein' ? 'bad' : 'sec'}" data-act="ans" data-f="adjusted" data-v="nein">Nein, nicht möglich</button></div></div>
        ${a.adjusted === 'ja' ? `<label class="field">Wert nach Justage${af != null ? (tolOk(step, af) ? ' · <span style="color:var(--okfg)">in Toleranz ✓</span>' : ' · <span style="color:var(--badfg)">noch außerhalb</span>') : ''}<input class="inp" inputmode="decimal" data-bind="ans.after" data-rerender value="${esc(a.after)}"></label>` : ''}
        ${a.adjusted === 'nein' ? `<label class="field">Warum nicht? (Pflicht)<input class="inp" data-bind="ans.massnahmeText" value="${esc(a.massnahmeText)}"></label>` : ''}</div>`;
    }
  }
  const need = photoNeed(step, a);
  if (need || (a.photos || []).length) {
    h += `<div class="field">Foto${need > 1 ? 's' : ''}${step.photoHint && step.type !== 'measure' ? ' ' + esc(step.photoHint) : step.type === 'measure' ? ' vom Display / Messwert' : ''} · Pflicht${photoGrid(a.photos, a.noPhoto?.on ? 0 : need, ctx, locked)}</div>`;
    if (need > (a.photos || []).length || a.noPhoto?.on) h += noPhotoBox(a.noPhoto, ctx);
  }
  const miss = stepMissing(step, a);
  h += `<div class="row" style="border-top:1px solid var(--line);padding-top:12px"><div class="missing grow ${miss.length ? '' : 'okk'}">${miss.length ? miss.map(x => `<span>${ICON.warn} ${esc(x)}</span>`).join('') : `<span>${ICON.check} Alle Pflichtangaben vollständig</span>`}</div>
    <button class="btn ${miss.length ? '' : 'ok'}" ${miss.length ? 'disabled' : ''} data-act="doneStep">${miss.length ? ICON.lock : ICON.check} Schritt abschließen</button></div>`;
  return h;
}
function stepSummary(step, a) {
  if (step.type === 'yesno') return a.ans === 'ja' ? 'Ja' : `Nein · ${a.reason === 'Sonstiges' ? a.reasonText : a.reason} · ${a.massnahme}: ${a.massnahmeText}`;
  if (step.type === 'measure') { const v = num(a.value); return tolOk(step, v) ? `${fmtN(v)} (in Toleranz)` : `${fmtN(v)} → ${a.adjusted === 'ja' ? 'justiert auf ' + fmtN(num(a.after)) : 'nicht justierbar'}`; }
  return `${(a.photos || []).length} Foto(s)`;
}

V.device = () => {
  const c = cur(), d = curDev(), t = TEMPLATES[d.tpl]; const locked = !!c.sign?.at;
  const idx = t.steps.findIndex(s => !d.ans[s.id]?.doneAt);
  const pills = t.steps.map((s, i) => `<span class="pill ${d.ans[s.id]?.doneAt ? 'done' : i === idx ? 'now' : ''}"></span>`).join('');
  const lastDone = idx === -1 ? t.steps.length - 1 : idx - 1;
  const cards = t.steps.map((s, i) => {
    const a = d.ans[s.id] || {};
    if (a.doneAt) return `<div class="card step-done"><span class="dot ok">${ICON.check}</span><div class="grow"><b>${i + 1} · ${esc(s.q)}</b><div class="small muted">${esc(stepSummary(s, a))}${(a.photos || []).length ? ` · ${a.photos.length} Foto(s)` : ''}${a.noPhoto?.on ? ' · Foto nicht möglich' : ''}</div></div>
      <div class="small muted" style="text-align:right">erledigt ${fmtT(a.doneAt)}${i === lastDone && !locked && !d.copiedFrom ? `<br><button class="btn ghost small" style="min-height:34px;padding:0" data-act="undoStep" data-id="${s.id}">rückgängig</button>` : ''}</div></div>`;
    if (i === idx && !d.copiedFrom) return `<div class="card step-now">${stepBody(s, a, locked)}</div>`;
    return `<div class="card step-lock">${ICON.lock}<span>${i + 1} · ${esc(s.q)} – ${d.copiedFrom ? 'übernommen' : `freigeschaltet nach Schritt ${i}`}</span></div>`;
  }).join('');
  const res = isDone(d) ? devResult(d) : null;
  const nextOpen = c.devices.find(x => !isDone(x) && x.sn !== d.sn);
  return topbar(`SN ${d.sn}`, 'case') + `<main class="wrap">
    <div class="card stack"><div class="row"><div class="grow"><h2>${esc(d.sn)}</h2><div class="small muted">${esc(d.typ || '')} · ${esc(d.ort || '')}</div></div><span class="badge b-run">${t.name}</span></div>
      <div class="pills">${pills}</div><div class="small muted">${idx === -1 ? 'Alle Schritte erledigt' : `Schritt ${idx + 1} von ${t.steps.length}`}</div></div>
    ${d.copiedFrom ? `<div class="lockinfo">${ICON.lock}<span>Ergebnis per Sammel-Abschluss von SN ${esc(d.copiedFrom)} übernommen (${fmtT(d.copiedAt)}). Steht so im Bericht.</span></div>` : ''}
    ${cards}
    ${res ? `<div class="card stack"><div class="row"><b class="grow">Ergebnis</b>${badge(res)}</div><div class="small">Status für den CE-Flow: <b>„${esc(t.flow[res])}“</b></div>
      ${nextOpen ? `<button class="btn pri" data-act="openDev" data-sn="${esc(nextOpen.sn)}">Nächstes offenes Gerät: ${esc(nextOpen.sn)}</button>` : `<button class="btn pri" data-act="go" data-view="case">Zurück zur Geräteliste</button>`}</div>` : ''}
  </main>`;
};

V.ue = () => {
  const c = cur(); const u = c.ue; const locked = !!u.doneAt;
  const yn = (f, val) => `<div class="yn"><button class="btn ${val === 'ja' ? 'ok' : 'sec'}" ${locked ? 'disabled' : ''} data-act="ue" data-f="${f}" data-v="ja">Ja</button><button class="btn ${val === 'nein' ? 'warn' : 'sec'}" ${locked ? 'disabled' : ''} data-act="ue" data-f="${f}" data-v="nein">Nein</button></div>`;
  const miss = ueMissing(u);
  return topbar('Übergabe-Check', 'case') + `<main class="wrap">
    <div><h1>Übergabe-Check</h1><div class="muted small">Pflicht vor der Unterschrift. Daraus wird der Satz, den der Kunde bestätigt.</div></div>
    <div class="card stack"><h2>Funktionstest durchgeführt?</h2>${yn('funk', u.funk)}
      ${u.funk === 'nein' ? `<label class="field">Warum nicht? (Pflicht)<input class="inp" data-bind="ue.funkText" value="${esc(u.funkText)}" ${locked ? 'disabled' : ''}></label>` : ''}</div>
    <div class="card stack" style="outline:2px solid var(--warn)"><h2>Unter realen Produktionsbedingungen getestet?</h2>${yn('prod', u.prod)}
      ${u.prod === 'nein' ? `<div class="field">Warum nicht? (Pflicht)<div class="chips">${PROD_REASONS.map(r => `<button class="chip ${u.prodReason === r ? 'on' : ''}" ${locked ? 'disabled' : ''} data-act="ue" data-f="prodReason" data-v="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>
      ${u.prodReason === 'Sonstiges' ? `<label class="field">Beschreibung<input class="inp" data-bind="ue.prodText" value="${esc(u.prodText)}"></label>` : ''}
      <label class="field">Ersatzweise getestet als (Pflicht)<input class="inp" data-bind="ue.ersatz" value="${esc(u.ersatz)}" placeholder="z. B. Probelauf im Leerlauf, 15 Min., ohne Störung" ${locked ? 'disabled' : ''}></label>` : ''}</div>
    <div class="card stack"><h2>Nachweis vom laufenden Gerät</h2><div class="small muted">Am besten mit Display oder Messwerten im Bild.</div>
      ${photoGrid(u.photos, u.noPhoto?.on ? 0 : 1, 'ue', locked)}${!locked && (!(u.photos || []).length || u.noPhoto?.on) ? noPhotoBox(u.noPhoto, 'ue') : ''}</div>
    <div class="card stack"><div class="lbl" style="color:var(--accentfg)">So steht's im Bericht</div><div class="quote" id="ue-sentence">„${esc(ueSentence(c))}“</div></div>
  </main>
  <div class="bar"><div class="in"><span class="hint ${miss.length ? 'bad' : 'ok'}" id="ue-hint">${locked ? ICON.check + ' Abgeschlossen ' + fmtT(u.doneAt) : miss.length ? ICON.warn + ' ' + esc(miss[0]) + (miss.length > 1 ? ` (+${miss.length - 1})` : '') : ICON.check + ' Alles vollständig'}</span>
    ${locked ? `<button class="btn sec" data-act="ueReopen">Bearbeiten</button><button class="btn pri" data-act="goSign">Zur Unterschrift</button>` : `<button class="btn ${miss.length ? '' : 'ok'}" ${miss.length ? 'disabled' : ''} data-act="ueDone" id="ue-btn">Übergabe abschließen</button>`}</div></div>`;
};

function materials(c) {
  const out = [];
  c.devices.forEach(d => Object.values(d.ans).forEach(a => { if ((a.material || '').trim()) out.push({ sn: d.sn, m: a.material.trim() }); }));
  return out;
}
const counts = c => { const r = { ok: 0, rep: 0, def: 0 }; c.devices.forEach(d => r[devResult(d)]++); return r; };
const CONFIRM = 'Ich bestätige die in diesem Bericht aufgeführten Arbeiten, Zeiten und das verbaute Material sowie den beschriebenen Zustand der Geräte bei Übergabe.';

V.sign = () => {
  const c = cur(); const k = counts(c); const mats = materials(c);
  const needEnd = !c.times.ende;
  return topbar('Unterschrift', 'case') + `<main class="wrap">
    <div><h1>Abschluss beim Kunden</h1><div class="muted small">Bitte dem Kunden zeigen. Nach der Unterschrift ist der Bericht gesperrt.</div></div>
    <div class="card stack"><div class="lbl">Zusammenfassung</div>
      <div class="grid3"><div class="val ok" style="outline:0"><b>${k.ok}</b><small>OK</small></div><div class="val" style="background:var(--warnbg)"><b style="color:var(--warnfg)">${k.rep}</b><small>repariert</small></div><div class="val bad" style="outline:0"><b>${k.def}</b><small>defekt</small></div></div>
      <div class="small">Ankunft ${fmtT(tv(c.times.ankunft))} · Arbeit ${fmtT(tv(c.times.beginn))}–${fmtT(tv(c.times.ende))} · Arbeitszeit <b>${fmtDur(workMs(c))}</b></div>
      ${mats.length ? `<div class="small">Material: ${mats.map(x => esc(x.m)).join(', ')}</div>` : ''}
      <div class="quote small">${esc(ueSentence(c))}</div></div>
    ${needEnd ? `<div class="card stack"><div class="lockinfo">${ICON.lock}<span>Vor der Unterschrift muss das Arbeitsende gestempelt sein.</span></div><button class="btn pri" data-act="stamp" data-k="ende">Arbeit jetzt beenden</button></div>` : `
    <div class="card stack" style="outline:2px solid var(--accent)"><h2>Bestätigung durch den Kunden</h2><div class="quote">${CONFIRM}</div>
      <label class="field">Name in Druckbuchstaben (Pflicht)<input class="inp" id="sig-name" value="${esc(c.ap || '')}"></label>
      <div class="sig"><canvas id="sig"></canvas><span class="hint">Hier mit Finger oder Stift unterschreiben</span></div>
      <div class="row"><button class="btn ghost" data-act="sigClear">Unterschrift löschen</button><span class="grow"></span></div></div>`}
  </main>
  ${needEnd ? '' : `<div class="bar"><div class="in"><span class="hint muted small">Danach: PDF + Excel für den Flow</span><button class="btn ok" data-act="doSign">Unterschreiben &amp; sperren</button></div></div>`}`;
};

V.done = () => {
  const c = cur(); const k = counts(c);
  return topbar('Bericht', 'case') + `<main class="wrap">
    <div class="card stack" style="outline:2px solid var(--ok)"><div class="row"><span class="dot ok">${ICON.check}</span><h2 class="grow">Bericht unterschrieben &amp; gesperrt</h2></div>
      <div class="small muted">Unterschrieben von ${esc(c.sign.name)} am ${fmtDT(c.sign.at)} · ${k.ok} OK, ${k.rep} repariert, ${k.def} defekt</div></div>
    <button class="btn pri big" data-act="pdf">PDF-Bericht teilen / speichern</button>
    <button class="btn sec big" data-act="csv">Excel (CSV) für den CE-Flow</button>
    <div class="lockinfo">${ICON.lock}<span>Mit „Teilen“ kannst du das PDF per Mail an den Kunden schicken oder in der Dateien-App speichern, um es später in CE anzuhängen.</span></div>
    <div class="card stack"><div class="lbl">Nachträge</div>
      ${(c.nachtraege || []).map(n => `<div class="small"><b>${fmtDT(n.at)}</b> · ${esc(n.text)}</div>`).join('') || '<div class="small muted">Keine. Nachträge erscheinen im PDF mit eigenem Zeitstempel, das Original bleibt unverändert.</div>'}
      <button class="btn sec" data-act="nachtrag">+ Nachtrag hinzufügen</button></div>
  </main>`;
};

/* ------------------------------------------------------------ Render */
function render() {
  if (ui.view !== 'home' && ui.view !== 'newcase' && !cur()) ui.view = 'home';
  if (ui.view === 'device' && !curDev()) ui.view = 'case';
  $('#app').innerHTML = V[ui.view]();
  if (ui.view === 'sign') setupSig();
}
function go(view) { ui.view = view; render(); window.scrollTo(0, 0); }

/* ------------------------------------------------------------ Modal */
function modal(html) {
  const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false;
  return new Promise(res => {
    m.onclick = e => {
      const b = e.target.closest('[data-m]'); if (e.target === m) { m.hidden = true; res(null); }
      if (!b) return;
      if (b.dataset.m === 'cancel') { m.hidden = true; res(null); return; }
      const vals = {}; m.querySelectorAll('[name]').forEach(i => vals[i.name] = i.value);
      const err = b.dataset.req && b.dataset.req.split(',').find(n => !(vals[n] || '').trim());
      if (err) { const el = m.querySelector(`[name=${err}]`); el.focus(); el.style.outline = '2px solid #B42318'; return; }
      m.hidden = true; res({ action: b.dataset.m, ...vals });
    };
  });
}

/* ------------------------------------------------------------ Aktionen */
const ACT = {
  noop() { },
  go(ds) { if (ds.view === 'case') ui.sn = null; go(ds.view); },
  open(ds) { ui.caseId = ds.id; ui.search = ''; ui.filter = 'alle'; ui.selecting = false; ui.selected.clear(); go('case'); },
  pickTpl(ds) { document.querySelectorAll('#nc-tpl .chip').forEach(b => b.classList.toggle('on', b.dataset.k === ds.k)); },
  async createCase() {
    const kunde = $('#nc-kunde').value.trim(); if (!kunde) { $('#nc-kunde').focus(); toast('Bitte Kunden eintragen'); return; }
    const c = {
      id: uid(), createdAt: Date.now(), kunde, adresse: $('#nc-adr').value.trim(), ap: $('#nc-ap').value.trim(), nr: $('#nc-nr').value.trim(),
      tpl: document.querySelector('#nc-tpl .chip.on').dataset.k, times: { pausen: [] }, devices: [], ue: {}, sign: null, korrekturen: [], nachtraege: []
    };
    cases.push(c); await save(c, true); ui.caseId = c.id; go('case');
  },
  stamp(ds) { const c = cur(); c.times[ds.k] = { t: Date.now() }; save(); render(); },
  pause() {
    const c = cur(); const p = c.times.pausen; const last = p[p.length - 1];
    if (last && !last.ende) last.ende = Date.now(); else p.push({ start: Date.now() });
    save(); render();
  },
  async korr(ds) {
    const c = cur(); const t = c.times[ds.k];
    const r = await modal(`<h2>Zeit korrigieren</h2><div class="small muted">Erfasst: ${fmtT(t.t)}. Die erfasste Zeit bleibt erhalten und steht mit Grund im Bericht. Der Kunde bestätigt die korrigierte Zeit mit seiner Unterschrift.</div>
      <label class="field">Neue Uhrzeit<input class="inp" type="time" name="time" value="${fmtT(tv(t))}"></label>
      <label class="field">Grund (Pflicht)<input class="inp" name="grund" placeholder="z. B. Knopf vergessen, Ankunft war 08:05"></label>
      <div class="grid2"><button class="btn sec" data-m="cancel">Abbrechen</button><button class="btn pri" data-m="ok" data-req="time,grund">Speichern</button></div>`);
    if (!r) return;
    const [h, m] = r.time.split(':').map(Number); const d = new Date(t.t); d.setHours(h, m, 0, 0);
    t.korr = d.getTime(); t.grund = r.grund.trim();
    c.korrekturen.push({ at: Date.now(), feld: ds.k, von: t.t, auf: t.korr, grund: t.grund });
    save(); render();
  },
  async addDev() {
    const c = cur();
    const r = await modal(`<h2>Gerät hinzufügen</h2><label class="field">Seriennummer (Pflicht)<input class="inp" name="sn"></label>
      <div class="grid2"><label class="field">Typ<input class="inp" name="typ"></label><label class="field">Standort<input class="inp" name="ort"></label></div>
      <label class="field">Checkliste<select class="inp" name="tpl">${Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}" ${k === c.tpl ? 'selected' : ''}>${t.name}</option>`).join('')}</select></label>
      <div class="grid2"><button class="btn sec" data-m="cancel">Abbrechen</button><button class="btn pri" data-m="ok" data-req="sn">Hinzufügen</button></div>`);
    if (!r) return;
    if (c.devices.some(d => d.sn === r.sn.trim())) { toast('Seriennummer gibt es schon'); return; }
    c.devices.push({ sn: r.sn.trim(), typ: r.typ.trim(), ort: r.ort.trim(), tpl: r.tpl, ans: {}, addedOnSite: true });
    save(); render();
  },
  demoDevs() {
    const c = cur(); const D = [];
    for (let i = 0; i < 6; i++) D.push({ sn: `4471-${pad(932 + i).padStart(4, '0')}`, typ: 'Messgerät MX-200', ort: 'Halle 2 · Linie 1', tpl: 'kal' });
    for (let i = 0; i < 4; i++) D.push({ sn: `3380-${1120 + i}`, typ: 'Dosiereinheit D4', ort: 'Halle 2 · Linie 2', tpl: 'wart' });
    for (let i = 0; i < 4; i++) D.push({ sn: `5502-${pad(70 + i * 2).padStart(4, '0')}`, typ: 'Sensor S-12', ort: 'Lager', tpl: 'wart' });
    c.devices.push(...D.map(d => ({ ...d, ans: {} }))); save(); render();
  },
  filter(ds) { ui.filter = ds.f; render(); },
  selMode() { ui.selecting = !ui.selecting; ui.selected.clear(); render(); },
  sel(ds) { ui.selected.has(ds.sn) ? ui.selected.delete(ds.sn) : ui.selected.add(ds.sn); render(); },
  async bulk() {
    const c = cur(); const sel = c.devices.filter(d => ui.selected.has(d.sn) && !isDone(d));
    const tpls = [...new Set(sel.map(d => d.tpl))], typs = [...new Set(sel.map(d => d.typ))];
    if (!sel.length) { toast('Nur offene Geräte auswählen'); return; }
    if (tpls.length > 1 || typs.length > 1) { toast('Nur identische Geräte auswählen (gleicher Typ, gleiche Checkliste)'); return; }
    if (TEMPLATES[tpls[0]].steps.some(s => s.type === 'measure')) { toast('Checkliste hat Messwerte – bitte jedes Gerät einzeln erfassen'); return; }
    const refs = c.devices.filter(d => d.tpl === tpls[0] && d.typ === typs[0] && devDone(d) && !d.copiedFrom && devResult(d) === 'ok');
    if (!refs.length) { toast('Erst ein Gerät dieser Art komplett und fehlerfrei abschließen'); return; }
    const r = await modal(`<h2>Ergebnis übernehmen</h2><div class="small">${sel.length} Gerät(e) werden als „OK“ abgeschlossen, mit Vermerk „übernommen von …“ im Bericht. Nur machen, wenn du diese Geräte tatsächlich genauso geprüft hast.</div>
      <label class="field">Referenzgerät<select class="inp" name="ref">${refs.map(d => `<option>${esc(d.sn)}</option>`).join('')}</select></label>
      <div class="grid2"><button class="btn sec" data-m="cancel">Abbrechen</button><button class="btn pri" data-m="ok">Übernehmen</button></div>`);
    if (!r) return;
    const ref = c.devices.find(d => d.sn === r.ref); const now = Date.now();
    sel.forEach(d => { d.copiedFrom = ref.sn; d.copiedAt = now; d.ans = {}; TEMPLATES[d.tpl].steps.forEach(s => d.ans[s.id] = { ans: 'ja', doneAt: now, copied: true }); });
    ui.selecting = false; ui.selected.clear(); save(); render(); toast(`${sel.length} Gerät(e) übernommen`);
  },
  openDev(ds) {
    const c = cur();
    if (!c.times.beginn && !c.sign?.at) { toast('Erst „Angekommen“ und „Arbeit beginnen“ tippen'); return; }
    if (ui.selecting) { ACT.sel(ds); return; }
    ui.sn = ds.sn; go('device');
  },
  ans(ds) {
    const d = curDev(); const t = TEMPLATES[d.tpl]; const s = t.steps.find(x => !d.ans[x.id]?.doneAt);
    const a = d.ans[s.id] = d.ans[s.id] || {};
    a[ds.f] = ds.v;
    if (ds.f === 'ans' && ds.v === 'ja') { delete a.reason; delete a.massnahme; }
    save(); render();
  },
  doneStep() {
    const d = curDev(); const t = TEMPLATES[d.tpl]; const s = t.steps.find(x => !d.ans[x.id]?.doneAt);
    const a = d.ans[s.id] || {};
    if (stepMissing(s, a).length) return;
    a.doneAt = Date.now(); d.ans[s.id] = a; save(); render();
    const nxt = document.querySelector('.step-now') || document.querySelector('.card:last-of-type');
    nxt && nxt.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
  undoStep(ds) { const d = curDev(); delete d.ans[ds.id].doneAt; save(); render(); },
  async delPhoto(ds) {
    if (!confirm('Foto löschen?')) return;
    const list = ds.ctx === 'ue' ? cur().ue.photos : stepAns().photos;
    list.splice(list.indexOf(ds.id), 1); await DB.del('photos', ds.id); save(); render();
  },
  noPhoto(ds) {
    const o = ds.ctx === 'ue' ? cur().ue : stepAns();
    o.noPhoto = o.noPhoto?.on ? { on: false, reason: '' } : { on: true, reason: '' };
    save(); render();
  },
  goUe() { const c = cur(); if (stage(c) < 2) return; c.ue = c.ue || {}; go('ue'); },
  goSign() { if (stage(cur()) < 3) return; go('sign'); },
  ue(ds) { const u = cur().ue; u[ds.f] = ds.v; save(); render(); },
  ueDone() { const u = cur().ue; if (ueMissing(u).length) return; u.doneAt = Date.now(); u.sentence = ueSentence(cur()); save(); go('sign'); },
  ueReopen() { if (cur().sign?.at) return; delete cur().ue.doneAt; save(); render(); },
  sigClear() { setupSig(true); },
  async doSign() {
    const c = cur(); const name = $('#sig-name').value.trim();
    if (!name) { $('#sig-name').focus(); toast('Bitte Namen in Druckbuchstaben eintragen'); return; }
    if (!sigState.strokes) { toast('Bitte unterschreiben lassen'); return; }
    const r = await modal(`<h2>Jetzt sperren?</h2><div>Nach der Unterschrift kann der Bericht nicht mehr geändert werden. Korrekturen gehen nur noch als Nachtrag.</div>
      <div class="grid2"><button class="btn sec" data-m="cancel">Zurück</button><button class="btn ok" data-m="ok">Unterschreiben &amp; sperren</button></div>`);
    if (!r) return;
    c.sign = { name, png: sigState.canvas.toDataURL('image/png'), at: Date.now(), text: CONFIRM };
    await save(c, true); go('done');
  },
  async pdf() { try { const blob = await buildPdf(cur()); await shareFile(blob, pdfName(cur()), 'application/pdf'); } catch (e) { console.error(e); alert('PDF-Fehler: ' + e.message); } },
  async csv() { const c = cur(); await shareFile(new Blob([buildCsv(c)], { type: 'text/csv' }), `Flow_${(c.nr || 'Einsatz').replace(/[^\w-]/g, '_')}.csv`, 'text/csv'); },
  async nachtrag() {
    const r = await modal(`<h2>Nachtrag</h2><div class="small muted">Wird mit Datum und Uhrzeit angehängt. Der unterschriebene Teil bleibt unverändert.</div>
      <label class="field">Text (Pflicht)<textarea class="inp" name="text"></textarea></label>
      <div class="grid2"><button class="btn sec" data-m="cancel">Abbrechen</button><button class="btn pri" data-m="ok" data-req="text">Hinzufügen</button></div>`);
    if (!r) return; const c = cur(); (c.nachtraege = c.nachtraege || []).push({ at: Date.now(), text: r.text.trim() }); save(); render();
  },
  async delCase() {
    const c = cur();
    const r = await modal(`<h2>Einsatz löschen?</h2><div>„${esc(c.kunde)}“ wird mit allen Fotos endgültig von diesem Gerät gelöscht.</div>
      <div class="grid2"><button class="btn sec" data-m="cancel">Abbrechen</button><button class="btn bad" data-m="ok">Endgültig löschen</button></div>`);
    if (!r) return;
    for (const p of await DB.all('photos')) if (p.caseId === c.id) await DB.del('photos', p.id);
    await DB.del('cases', c.id); cases = cases.filter(x => x.id !== c.id); go('home');
  }
};
function stepAns() { const d = curDev(); const s = TEMPLATES[d.tpl].steps.find(x => !d.ans[x.id]?.doneAt); return d.ans[s.id] = d.ans[s.id] || {}; }

/* ------------------------------------------------------------ Eingaben */
function setBind(path, value, el) {
  const [root, ...rest] = path.split('.');
  if (root === 'set') { settings[rest[0]] = value; localStorage.setItem('sn-settings', JSON.stringify(settings)); return; }
  if (root === 'search') { ui.search = value; const pos = el.selectionStart; render(); const i = document.querySelector('[data-bind=search]'); i.focus(); i.setSelectionRange(pos, pos); return; }
  let obj = root === 'ans' ? stepAns() : cur().ue;
  rest.slice(0, -1).forEach(k => obj = obj[k] = obj[k] || {});
  obj[rest[rest.length - 1]] = value; save();
  // Fußzeile live aktualisieren ohne Fokus zu verlieren
  if (root === 'ans') {
    const d = curDev(), s = TEMPLATES[d.tpl].steps.find(x => !d.ans[x.id]?.doneAt), miss = stepMissing(s, stepAns());
    const box = document.querySelector('.step-now .missing'), btn = document.querySelector('[data-act=doneStep]');
    if (box) { box.className = 'missing grow ' + (miss.length ? '' : 'okk'); box.innerHTML = miss.length ? miss.map(x => `<span>${ICON.warn} ${esc(x)}</span>`).join('') : `<span>${ICON.check} Alle Pflichtangaben vollständig</span>`; }
    if (btn) { btn.disabled = !!miss.length; btn.className = 'btn ' + (miss.length ? '' : 'ok'); btn.innerHTML = `${miss.length ? ICON.lock : ICON.check} Schritt abschließen`; }
  }
  if (root === 'ue') {
    const u = cur().ue, miss = ueMissing(u); const h = $('#ue-hint'), b = $('#ue-btn'), q = $('#ue-sentence');
    if (q) q.textContent = `„${ueSentence(cur())}“`;
    if (h) { h.className = 'hint ' + (miss.length ? 'bad' : 'ok'); h.innerHTML = miss.length ? ICON.warn + ' ' + esc(miss[0]) + (miss.length > 1 ? ` (+${miss.length - 1})` : '') : ICON.check + ' Alles vollständig'; }
    if (b) { b.disabled = !!miss.length; b.className = 'btn ' + (miss.length ? '' : 'ok'); }
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  e.preventDefault(); ACT[b.dataset.act]?.(b.dataset, b);
});
document.addEventListener('input', e => { const el = e.target; if (el.dataset.bind) setBind(el.dataset.bind, el.value, el); });
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset.rerender !== undefined) { render(); return; }
  if (el.dataset.photo && el.files?.[0]) {
    const ctx = el.dataset.photo; const file = el.files[0];
    const label = ctx === 'ue' ? 'Übergabe' : `SN ${ui.sn}`;
    try {
      const id = await addPhoto(file, label);
      const o = ctx === 'ue' ? cur().ue : stepAns(); (o.photos = o.photos || []).push(id);
      if (o.noPhoto) o.noPhoto.on = false;
      save(); render();
    } catch (err) { alert('Foto konnte nicht gespeichert werden: ' + err); }
  }
  if (el.dataset.import !== undefined && el.files?.[0]) {
    try { const rows = await importDevices(el.files[0]); const c = cur(); let added = 0;
      rows.forEach(r => { if (r.sn && !c.devices.some(d => d.sn === r.sn)) { c.devices.push({ ...r, tpl: c.tpl, ans: {} }); added++; } });
      save(); render(); toast(`${added} Geräte importiert`);
    } catch (err) { alert('Import fehlgeschlagen: ' + err.message); }
  }
});

/* ------------------------------------------------------------ Import Excel/CSV */
async function importDevices(file) {
  let table;
  if (/\.csv$/i.test(file.name)) {
    const txt = await file.text(); const sep = (txt.split('\n')[0].match(/;/g) || []).length >= (txt.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    table = txt.split(/\r?\n/).filter(l => l.trim()).map(l => l.split(sep).map(x => x.replace(/^"|"$/g, '').trim()));
  } else {
    const zip = await JSZip.loadAsync(file); const P = s => new DOMParser().parseFromString(s, 'application/xml');
    const ss = zip.file('xl/sharedStrings.xml') ? [...P(await zip.file('xl/sharedStrings.xml').async('string')).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
    const sheetName = Object.keys(zip.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()[0];
    const doc = P(await zip.file(sheetName).async('string'));
    table = [...doc.getElementsByTagName('row')].map(row => {
      const out = [];
      [...row.getElementsByTagName('c')].forEach(cell => {
        const ref = cell.getAttribute('r') || ''; const col = ref.replace(/\d/g, '').split('').reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const v = cell.getElementsByTagName('v')[0]?.textContent ?? [...cell.getElementsByTagName('t')].map(t => t.textContent).join('');
        out[col] = cell.getAttribute('t') === 's' ? ss[+v] : v;
      });
      return [...out].map(x => (x ?? '').toString().trim());
    });
  }
  if (!table.length) throw new Error('Datei ist leer');
  const head = table[0].map(h => h.toLowerCase());
  const find = (...keys) => head.findIndex(h => keys.some(k => h.includes(k)));
  let iSn = find('serien', 'serial', 'sn'), iTyp = find('typ', 'modell', 'produkt', 'bezeichnung', 'model'), iOrt = find('standort', 'ort', 'location', 'raum');
  let body = table.slice(1);
  if (iSn < 0) { iSn = 0; body = table; }  // keine Kopfzeile erkannt
  return body.map(r => ({ sn: r[iSn] || '', typ: iTyp >= 0 ? r[iTyp] || '' : '', ort: iOrt >= 0 ? r[iOrt] || '' : '' })).filter(r => r.sn);
}

/* ------------------------------------------------------------ Unterschrift */
const sigState = { canvas: null, strokes: 0 };
function setupSig(clear) {
  const cv = $('#sig'); if (!cv) return;
  const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  cv.width = r.width * dpr; cv.height = r.height * dpr;
  const g = cv.getContext('2d'); g.scale(dpr, dpr); g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#14212E';
  sigState.canvas = cv; sigState.strokes = 0; if (clear) g.clearRect(0, 0, r.width, r.height);
  let drawing = false;
  const pt = e => { const b = cv.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  cv.onpointerdown = e => { drawing = true; cv.setPointerCapture(e.pointerId); const [x, y] = pt(e); g.beginPath(); g.moveTo(x, y); g.lineTo(x + 0.1, y + 0.1); g.stroke(); sigState.strokes++; };
  cv.onpointermove = e => { if (!drawing) return; const [x, y] = pt(e); g.lineTo(x, y); g.stroke(); };
  cv.onpointerup = cv.onpointercancel = () => { drawing = false; };
}

/* ------------------------------------------------------------ Teilen */
async function shareFile(blob, name, type) {
  const file = new File([blob], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const pdfName = c => `Servicebericht_${(c.nr || c.kunde).replace(/[^\wäöüÄÖÜß-]/g, '_')}_${fmtD(c.createdAt).split('.').reverse().join('-')}.pdf`;

function buildCsv(c) {
  const rows = [['Seriennummer', 'Typ', 'Standort', 'Checkliste', 'Ergebnis', 'Status Flow', 'Abschluss']];
  c.devices.forEach(d => {
    const res = devResult(d); const last = Math.max(0, ...Object.values(d.ans).map(a => a.doneAt || 0));
    rows.push([d.sn, d.typ, d.ort, TEMPLATES[d.tpl].name, STATUS[res][0], TEMPLATES[d.tpl].flow[res], last ? fmtDT(last) : '']);
  });
  return '﻿' + rows.map(r => r.map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

/* ------------------------------------------------------------ PDF */
async function docId(c) {
  const data = new TextEncoder().encode(JSON.stringify({ ...c, sign: { ...c.sign, png: (c.sign?.png || '').length } }));
  const h = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(h)].slice(0, 6).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g).join('-');
}
const W1252 = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const pdfTxt = s => String(s ?? '').replace(/→/g, '->').replace(/[✓✔]/g, 'OK').replace(/×/g, 'x').replace(/[  ]/g, ' ')
  .split('').map(ch => (ch.charCodeAt(0) < 256 || W1252.includes(ch)) ? ch : '?').join('');

async function buildPdf(c) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`Servicebericht ${c.nr || ''} ${c.kunde}`); doc.setCreator('ServiceNotes ' + APP_VERSION); doc.setProducer('ServiceNotes');
  const F = await doc.embedFont(StandardFonts.Helvetica), FB = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4 = [595.28, 841.89], M = 42, CW = A4[0] - 2 * M;
  const C = { text: rgb(.106, .141, .188), muted: rgb(.357, .404, .459), line: rgb(.84, .86, .89), dark: rgb(.078, .129, .18),
    ok: rgb(.12, .37, .2), rep: rgb(.54, .29, .03), def: rgb(.61, .11, .08), okbg: rgb(.86, .94, .89), repbg: rgb(.99, .92, .83), defbg: rgb(.98, .88, .87), blue: rgb(.11, .3, .85), warn: rgb(.71, .33, .04), soft: rgb(.96, .97, .98) };
  const id = await docId(c);
  let page, y;
  const newPage = (sub) => {
    page = doc.addPage(A4); y = A4[1] - M;
    page.drawText(pdfTxt('Servicebericht'), { x: M, y: y - 16, size: 18, font: FB, color: C.dark });
    page.drawText(pdfTxt(sub), { x: M, y: y - 31, size: 9.5, font: F, color: C.muted });
    const right = [[`Bericht-Nr. `, `SB-${c.nr || fmtD(c.createdAt)}`], ['CE-Case ', c.nr || '–'], ['Datum ', fmtD(c.createdAt)]];
    right.forEach(([k, v], i) => { const t = pdfTxt(v), w = FB.widthOfTextAtSize(t, 8.5), kw = F.widthOfTextAtSize(k, 8.5);
      page.drawText(t, { x: A4[0] - M - w, y: y - 10 - i * 11, size: 8.5, font: FB, color: C.text }); page.drawText(k, { x: A4[0] - M - w - kw, y: y - 10 - i * 11, size: 8.5, font: F, color: C.muted }); });
    if (settings.firma) page.drawText(pdfTxt(settings.firma), { x: M + 160, y: y - 16, size: 10, font: FB, color: C.muted });
    y -= 42; page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: 1.5, color: C.dark }); y -= 14;
  };
  const wrap = (s, font, size, w) => {
    const out = []; pdfTxt(s).split('\n').forEach(par => { let line = '';
      par.split(' ').forEach(word => { const t = line ? line + ' ' + word : word; if (font.widthOfTextAtSize(t, size) <= w) line = t; else { if (line) out.push(line); line = word; } });
      out.push(line); }); return out;
  };
  const ensure = (h, sub) => { if (y - h < M + 24) newPage(sub); };
  const text = (s, o = {}) => {
    const size = o.size || 9.5, font = o.bold ? FB : F, x = o.x ?? M, w = o.w ?? CW, lh = size * 1.35;
    wrap(s, font, size, w).forEach(l => { if (!o.noBreak) ensure(lh, o.sub); page.drawText(l, { x, y: y - size, size, font, color: o.color || C.text }); y -= lh; });
  };
  const heading = (s, sub, color) => { ensure(40, sub); y -= 6; page.drawText(pdfTxt(s.toUpperCase()), { x: M, y: y - 10, size: 10, font: FB, color: color || C.dark }); y -= 18; };
  const kv = (rows, kw = 170, sub) => rows.forEach(([k, v]) => {
    const lines = wrap(v, F, 9.5, CW - kw); const h = lines.length * 13 + 4; ensure(h, sub);
    page.drawText(pdfTxt(k), { x: M, y: y - 9.5, size: 9.5, font: F, color: C.muted });
    lines.forEach((l, i) => page.drawText(l, { x: M + kw, y: y - 9.5 - i * 13, size: 9.5, font: F, color: C.text }));
    y -= h; page.drawLine({ start: { x: M, y: y + 1 }, end: { x: A4[0] - M, y: y + 1 }, thickness: .4, color: C.line }); y -= 3;
  });
  const imgCache = new Map();
  const getImg = async pid => { if (imgCache.has(pid)) return imgCache.get(pid); const p = (await DB.all('photos')).find(x => x.id === pid); if (!p) return null;
    const im = await doc.embedJpg(new Uint8Array(await p.blob.arrayBuffer())); imgCache.set(pid, im); return im; };
  const photoRow = async (ids, sub, h = 120) => {
    if (!ids?.length) return;
    const per = 3, gap = 8, w = (CW - gap * (per - 1)) / per;
    for (let i = 0; i < ids.length; i += per) {
      ensure(h + 8, sub);
      for (let j = 0; j < per && i + j < ids.length; j++) {
        const im = await getImg(ids[i + j]); if (!im) continue;
        const sc = Math.min(w / im.width, h / im.height), iw = im.width * sc, ih = im.height * sc;
        page.drawImage(im, { x: M + j * (w + gap) + (w - iw) / 2, y: y - h + (h - ih) / 2, width: iw, height: ih });
      }
      y -= h + 8;
    }
  };
  const k = counts(c);
  const SUB1 = 'Einsatzbericht · ' + [...new Set(c.devices.map(d => TEMPLATES[d.tpl].name))].join(', ');

  /* Seite 1 */
  newPage(SUB1);
  const colW = (CW - 14) / 2, y0 = y;
  const block = (x, title, lines) => { let yy = y0; page.drawText(pdfTxt(title), { x, y: yy - 10, size: 10, font: FB, color: C.dark }); yy -= 24;
    lines.forEach(([t, b], i) => { wrap(t, b ? FB : F, b ? 11 : 9.5, colW).forEach(l => { page.drawText(l, { x, y: yy - 10, size: b ? 11 : 9.5, font: b ? FB : F, color: C.text }); yy -= 14; }); }); return yy; };
  const ya = block(M, 'KUNDE', [[c.kunde, true], [c.adresse || ''], [c.ap ? 'Ansprechpartner vor Ort: ' + c.ap : '']]);
  const yb = block(M + colW + 14, 'DURCHGEFÜHRT VON', [[settings.name || '[Name in Einstellungen eintragen]', true], [settings.firma || ''], ['Einsatz: ' + [...new Set(c.devices.map(d => TEMPLATES[d.tpl].name))].join(', ')]]);
  y = Math.min(ya, yb) - 6;

  heading('Zeiten · automatisch erfasst', SUB1);
  const tRow = (label, key) => { const t = c.times[key]; if (!t) return [label, '–']; return [label, t.korr != null ? `${fmtT(t.korr)} (korrigiert, erfasst ${fmtT(t.t)} – Grund: ${t.grund})` : fmtT(t.t)]; };
  const pz = (c.times.pausen || []).filter(p => p.ende).map(p => `${fmtT(p.start)}–${fmtT(p.ende)}`).join(', ') || 'keine';
  kv([tRow('Ankunft beim Kunden', 'ankunft'), tRow('Arbeitsbeginn', 'beginn'), ['Pausen', pz], tRow('Arbeitsende', 'ende'), ['Arbeitszeit (ohne Pausen)', fmtDur(workMs(c))]], 170, SUB1);

  heading('Ergebnis', SUB1); ensure(46, SUB1);
  const boxes = [[k.ok, 'OK', C.okbg, C.ok], [k.rep, 'repariert', C.repbg, C.rep], [k.def, 'defekt', C.defbg, C.def], [c.devices.length, 'Geräte gesamt', C.soft, C.text]];
  const bw = (CW - 24) / 4;
  boxes.forEach(([n, l, bg, fg], i) => { const x = M + i * (bw + 8); page.drawRectangle({ x, y: y - 40, width: bw, height: 40, color: bg });
    page.drawText(String(n), { x: x + 8, y: y - 22, size: 16, font: FB, color: fg }); page.drawText(pdfTxt(l), { x: x + 8, y: y - 34, size: 8.5, font: F, color: fg }); });
  y -= 50; text('Einzelnachweis aller Geräte und Details zu Auffälligkeiten im Anhang.', { color: C.muted, size: 8.5, sub: SUB1 });

  heading('Zustand bei Übergabe', SUB1, C.warn);
  const u = c.ue || {};
  kv([['Funktionstest durchgeführt', u.funk === 'ja' ? 'Ja' : `Nein – ${u.funkText || ''}`],
    ['Test unter realen Produktionsbedingungen', u.prod === 'ja' ? 'Ja' : 'Nein'],
    ...(u.prod === 'nein' ? [['Grund', u.prodReason === 'Sonstiges' ? u.prodText : u.prodReason], ['Ersatzweise getestet', u.ersatz]] : []),
    ['Nachweis', (u.photos || []).length ? `${u.photos.length} Foto(s), Übergabe ${fmtT(u.doneAt)}` : `KEIN FOTO – Grund: ${u.noPhoto?.reason || ''}`]], 200, SUB1);
  await photoRow(u.photos, SUB1, 110);

  const mats = materials(c);
  if (mats.length) { heading('Verbautes Material', SUB1); kv(mats.map(m => [m.sn, m.m]), 120, SUB1); }
  const defs = c.devices.filter(d => devResult(d) === 'def');
  if (defs.length) { heading('Offene Punkte', SUB1, C.def); defs.forEach(d => text(`SN ${d.sn} (${d.typ || ''}): defekt – ${TEMPLATES[d.tpl].flow.def}. Details im Anhang.`, { sub: SUB1 })); }

  ensure(190, SUB1); heading('Bestätigung durch den Kunden', SUB1, C.blue);
  text(c.sign?.text || CONFIRM, { sub: SUB1 });
  if (u.prod === 'nein') text('Dies schließt die Angabe ein, dass ein Test unter realen Produktionsbedingungen nicht möglich war.', { sub: SUB1 });
  y -= 8; ensure(80, SUB1);
  const sw = (CW - 28) / 3, base = y - 62;
  if (c.sign?.png) { const sig = await doc.embedPng(await (await fetch(c.sign.png)).arrayBuffer()); const sc = Math.min(sw / sig.width, 58 / sig.height);
    page.drawImage(sig, { x: M + sw + 14, y: base + 2, width: sig.width * sc, height: sig.height * sc }); }
  [[c.sign?.name || '', 'Name in Druckbuchstaben'], ['', 'Unterschrift Kunde'], [c.sign ? fmtDT(c.sign.at) + ' Uhr' : '', 'Datum, Uhrzeit (automatisch) · vor Ort']].forEach(([v, l], i) => {
    const x = M + i * (sw + 14); if (v) page.drawText(pdfTxt(v), { x, y: base + 4, size: 10.5, font: F, color: C.text });
    page.drawLine({ start: { x, y: base }, end: { x: x + sw, y: base }, thickness: .8, color: C.text }); page.drawText(pdfTxt(l), { x, y: base - 10, size: 7.5, font: F, color: C.muted }); });
  y = base - 20;

  /* Anhang 1: Einzelnachweis */
  const SUB2 = 'Anhang 1 · Einzelnachweis aller Geräte';
  newPage(SUB2);
  text('Jede Zeile entspricht einer abgeschlossenen Checkliste. Uhrzeit = Abschluss der Checkliste.', { color: C.muted, size: 8.5, sub: SUB2 }); y -= 4;
  const cols = [['#', 18], ['Seriennr.', 70], ['Typ', 84], ['Standort', 78], ['Checkliste', 62], ['Ergebnis', 52], ['Messwerte', 79], ['Uhrzeit', 34], ['Fotos', 26]];
  const thead = () => { let x = M; cols.forEach(([h, w]) => { page.drawText(pdfTxt(h.toUpperCase()), { x, y: y - 8, size: 7, font: FB, color: C.muted }); x += w; }); y -= 12;
    page.drawLine({ start: { x: M, y }, end: { x: A4[0] - M, y }, thickness: .7, color: C.line }); y -= 2; };
  thead();
  c.devices.forEach((d, i) => {
    const t = TEMPLATES[d.tpl], res = devResult(d);
    const mw = t.steps.filter(s => s.type === 'measure').map(s => { const a = d.ans[s.id] || {}; const v = num(a.value); return v == null ? '–' : tolOk(s, v) ? fmtN(v) : `${fmtN(v)}->${a.adjusted === 'ja' ? fmtN(num(a.after)) : 'n.j.'}`; }).join(' / ') || '–';
    const nph = Object.values(d.ans).reduce((s, a) => s + (a.photos || []).length, 0);
    const last = Math.max(0, ...Object.values(d.ans).map(a => a.doneAt || 0));
    const cells = [String(i + 1), d.sn, d.typ, d.ort, t.name, STATUS[res][0] + (d.copiedFrom ? '*' : ''), mw, last ? fmtT(last) : '', nph ? String(nph) : '–'];
    const lines = cells.map((v, j) => wrap(v || '', j === 1 ? FB : F, 8, cols[j][1] - 4));
    const h = Math.max(...lines.map(l => l.length)) * 10 + 5;
    if (y - h < M + 24) { newPage(SUB2); thead(); }
    let x = M; lines.forEach((ls, j) => { ls.forEach((l, li) => page.drawText(l, { x, y: y - 8 - li * 10, size: 8, font: j === 1 ? FB : F, color: j === 5 ? (res === 'ok' ? C.ok : res === 'rep' ? C.rep : C.def) : C.text })); x += cols[j][1]; });
    y -= h; page.drawLine({ start: { x: M, y: y + 1 }, end: { x: A4[0] - M, y: y + 1 }, thickness: .3, color: C.line });
  });
  if (c.devices.some(d => d.copiedFrom)) { y -= 6; text('* Ergebnis per Sammel-Abschluss von einem identisch geprüften Referenzgerät übernommen (Referenz-SN siehe Anhang 2).', { size: 8, color: C.muted, sub: SUB2 }); }

  /* Anhang 2: Auffälligkeiten */
  const SUB3 = 'Anhang 2 · Auffälligkeiten, Fotodokumentation, Protokoll';
  newPage(SUB3);
  const issues = c.devices.filter(d => !d.copiedFrom && Object.values(d.ans).some(a => a.ans === 'nein' || a.adjusted || (a.photos || []).length || a.noPhoto?.on));
  if (!issues.length) text('Keine Auffälligkeiten.', { sub: SUB3 });
  for (const d of issues) {
    const t = TEMPLATES[d.tpl];
    heading(`SN ${d.sn} · ${d.typ || ''} · ${d.ort || ''}`, SUB3, devResult(d) === 'def' ? C.def : C.rep);
    for (const s of t.steps) {
      const a = d.ans[s.id] || {};
      const rel = a.ans === 'nein' || a.adjusted || (a.photos || []).length || a.noPhoto?.on; if (!rel) continue;
      const rows = [['Prüfpunkt', s.q], ['Ergebnis', stepSummary(s, a)]];
      if (a.material) rows.push(['Material', a.material]);
      if (a.noPhoto?.on) rows.push(['Foto', 'NICHT MÖGLICH – ' + (a.noPhoto.reason || '')]);
      rows.push(['Abgeschlossen', fmtDT(a.doneAt)]);
      kv(rows, 110, SUB3); await photoRow(a.photos, SUB3, 100); y -= 4;
    }
  }
  const copied = c.devices.filter(d => d.copiedFrom);
  if (copied.length) { heading('Sammel-Abschlüsse', SUB3); kv(copied.map(d => [d.sn, `Ergebnis übernommen von SN ${d.copiedFrom} am ${fmtDT(d.copiedAt)}`]), 110, SUB3); }
  heading('Änderungsprotokoll', SUB3);
  const log = [...(c.korrekturen || []).map(x => [fmtDT(x.at), `Zeitkorrektur ${x.feld}: ${fmtT(x.von)} -> ${fmtT(x.auf)}. Grund: ${x.grund}`]),
    ...(c.nachtraege || []).map(n => [fmtDT(n.at), `NACHTRAG nach Unterschrift: ${n.text}`])];
  if (log.length) kv(log, 110, SUB3); else text('Keine Korrekturen, keine Nachträge. Der Bericht wurde nach der Unterschrift nicht verändert.', { sub: SUB3 });

  /* Fußzeilen */
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 30 }, end: { x: A4[0] - M, y: 30 }, thickness: .5, color: C.line });
    p.drawText(pdfTxt(`Erstellt mit ServiceNotes ${APP_VERSION}${c.sign ? ' · unterschrieben ' + fmtDT(c.sign.at) + ' · danach gesperrt' : ' · ENTWURF, nicht unterschrieben'}`), { x: M, y: 19, size: 7, font: F, color: C.muted });
    const r = `Dokument-ID ${id} · Seite ${i + 1} von ${pages.length}`;
    p.drawText(r, { x: A4[0] - M - F.widthOfTextAtSize(r, 7), y: 19, size: 7, font: F, color: C.muted });
  });
  return new Blob([await doc.save()], { type: 'application/pdf' });
}

/* ------------------------------------------------------------ Start */
(async function init() {
  try {
    await DB.open(); cases = await DB.all('cases'); await loadPhotos();
    if (navigator.storage?.persist) navigator.storage.persist();
  } catch (e) { $('#app').innerHTML = `<div class="boot">Speicher nicht verfügbar: ${esc(e.message)}<br>Bitte nicht im privaten Modus öffnen.</div>`; return; }
  render();
  window.addEventListener('online', render); window.addEventListener('offline', render);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
})();
