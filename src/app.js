// ───────────── Zitronenpresse · App-Logik (Phase 1: Speicher auf dem Gerät) ─────────────
const PEOPLE = {
  hanne: { name: 'Hanne', focus: 'Po & Beine', color: 'var(--hanne)', ink: 'var(--hanne-ink)', soft: 'var(--hanne-soft)' },
  andi: { name: 'Andi', focus: 'Oberkörper', color: 'var(--andi)', ink: 'var(--andi-ink)', soft: 'var(--andi-soft)' },
};
const STRICH_MIN = 15;
const EX = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));
const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Speicher auf dem Gerät ──
// Die Online-Version setzt window.ZP_CONFIG = { url, key } (Supabase). Ohne Konfiguration läuft alles lokal.
const CONFIG = window.ZP_CONFIG || {};
const ONLINE = !!(CONFIG.url && CONFIG.key);
const Store = (() => {
  const KEY = 'zitronenpresse.v1';
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) {}
    return null;
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  return { load, save };
})();

const dayKey = (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); };
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtClock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

function demoState() {
  const sessions = [];
  const now = new Date();
  const mk = (who, back, min, ids) => {
    const start = addDays(now, -back); start.setHours(18, 5, 0, 0);
    sessions.push({ id: uid(), who, day: dayKey(start), start: +start, durationMs: min * 60000, counted: min >= STRICH_MIN, demo: true,
      items: ids.map((id) => ({ ex: id, sets: Array.from({ length: EX[id].sets }, () => ({ v: EX[id].metric === 'time' ? 30 : 12, done: true })) })) });
  };
  const planFor = (who, back) => { const wd = addDays(now, -back).getDay(); return WEEKPLAN[wd][who]; };
  [1, 2, 3, 5, 6, 8, 9].forEach((b) => mk('hanne', b, b === 5 ? 12 : 17, planFor('hanne', b)));
  [1, 3, 4, 6, 9].forEach((b) => mk('andi', b, 16, planFor('andi', b)));
  return Object.assign(emptyState('andi'), { demo: true, sessions });
}
function emptyState(me) {
  return { me: me || 'andi', demo: false, sessions: [], duels: [], active: { andi: null, hanne: null }, seen: {},
    settings: { sexy: true }, customCards: { 1: [], 2: [], 3: [], 4: [], team: [] },
    sync: { code: null, since: null, dirty: {}, lastOk: null, err: null } };
}
function normalize(s) {
  const base = emptyState(s && s.me);
  s = Object.assign(base, s || {});
  ['sessions', 'duels'].forEach((k) => { if (!Array.isArray(s[k])) s[k] = []; });
  s.active = Object.assign({ andi: null, hanne: null }, s.active || {});
  s.seen = s.seen || {};
  s.settings = Object.assign({ sexy: true }, s.settings || {});
  s.customCards = Object.assign({ 1: [], 2: [], 3: [], 4: [], team: [] }, s.customCards || {});
  ['1', '2', '3', '4', 'team'].forEach((k) => { if (!Array.isArray(s.customCards[k])) s.customCards[k] = []; });
  s.sync = Object.assign({ code: null, since: null, dirty: {}, lastOk: null, err: null }, s.sync || {});
  if (s.me !== 'hanne' && s.me !== 'andi') s.me = 'andi';
  return s;
}

let S = normalize(Store.load() || (ONLINE ? emptyState() : demoState()));
let UI = { tab: 'heute', filter: 'alle', q: '', sw: null, sheetStop: null };
const persist = () => Store.save(S);
// markiert einen Datensatz als geändert, damit er beim nächsten Abgleich hochgeladen wird
function touch(kind, id) {
  if (!ONLINE || !S.sync.code || S.demo) return;
  const k = kind + '|' + id;
  S.sync.dirty[k] = (S.sync.dirty[k] || 0) + 1;
  Sync.schedule();
}
function dropDemo() {
  if (!S.demo) return;
  S.sessions = S.sessions.filter((s) => !s.demo);
  S.duels = S.duels.filter((d) => !d.demo);
  S.seen = {};
  S.demo = false;
}

// ── Abgleich zwischen euren Handys (nur Online-Version) ──
const Sync = (() => {
  let timer = null, busy = false, poll = null;
  const on = () => ONLINE && !!S.sync.code;
  function headers() {
    const h = { 'Content-Type': 'application/json', apikey: CONFIG.key };
    if (/^eyJ/.test(CONFIG.key)) h.Authorization = 'Bearer ' + CONFIG.key; // älterer anon-Key
    return h;
  }
  async function rpc(fn, body) {
    const r = await fetch(CONFIG.url.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Server ' + r.status);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  }
  function rowFor(key) {
    const i = key.indexOf('|'); const kind = key.slice(0, i), id = key.slice(i + 1);
    let data = null;
    if (kind === 'session') data = S.sessions.find((s) => s.id === id) || null;
    if (kind === 'duel') data = duelFor(id) || null;
    if (kind === 'meta') data = S.customCards;
    return { kind, id, data };
  }
  async function push() {
    const snap = Object.assign({}, S.sync.dirty); const keys = Object.keys(snap);
    if (!keys.length) return;
    await rpc('zp_push', { p_space: S.sync.code, p_rows: keys.map(rowFor) });
    keys.forEach((k) => { if (S.sync.dirty[k] === snap[k]) delete S.sync.dirty[k]; });
  }
  function merge(arr, match, data) {
    const i = arr.findIndex(match);
    if (!data) { if (i >= 0) { arr.splice(i, 1); return true; } return false; }
    if (i >= 0) { if (JSON.stringify(arr[i]) === JSON.stringify(data)) return false; arr[i] = data; return true; }
    arr.push(data); return true;
  }
  async function pull() {
    // 2 Minuten Überlappung, damit gleichzeitige Schreibvorgänge nicht verloren gehen
    const since = S.sync.since ? new Date(Date.parse(S.sync.since) - 120000).toISOString() : null;
    const rows = await rpc('zp_pull', { p_space: S.sync.code, p_since: since });
    let changed = false, max = S.sync.since ? Date.parse(S.sync.since) : 0;
    (rows || []).forEach((r) => {
      max = Math.max(max, Date.parse(r.updated_at) || 0);
      if (r.kind === 'meta' && r.data) { changed = mergeCustomCards(r.data) || changed; return; }
      if (S.sync.dirty[r.kind + '|' + r.id]) return; // eigene, noch nicht hochgeladene Änderung gewinnt
      if (r.kind === 'session') changed = merge(S.sessions, (s) => s.id === r.id, r.data) || changed;
      if (r.kind === 'duel') changed = merge(S.duels, (d) => d.week === r.id, r.data) || changed;
    });
    if (max) S.sync.since = new Date(max).toISOString();
    if (changed) { S.sessions.sort((a, b) => a.start - b.start); S.duels.sort((a, b) => (a.week < b.week ? -1 : 1)); }
    return changed;
  }
  async function run() {
    if (!on()) return;
    if (busy) { schedule(1500); return; }
    busy = true;
    try {
      await push();
      const changed = await pull();
      S.sync.lastOk = Date.now(); S.sync.err = null; persist();
      if (changed) onRemoteChange();
    } catch (e) {
      S.sync.err = navigator.onLine === false ? 'Offline' : String(e.message || e); persist();
    } finally { busy = false; }
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(run, ms == null ? 800 : ms); }
  function start() {
    if (!on()) return;
    run(); clearInterval(poll);
    poll = setInterval(() => { if (!document.hidden) run(); }, 30000);
  }
  return { on, run, schedule, start };
})();
function onRemoteChange() {
  // mitten im Training nicht neu zeichnen, sonst springen die Eingabefelder
  if (UI.tab === 'training' && S.active[S.me]) return;
  if (UI.sheetMode === 'draw') return;
  render();
}

// ── Auswertungen ──
function countedDays(who) {
  const set = new Set();
  S.sessions.forEach((s) => { if (s.who === who && s.counted) set.add(s.day); });
  return set;
}
function streak(who) {
  const days = countedDays(who);
  let d = new Date(); let cur = 0;
  if (!days.has(dayKey(d))) d = addDays(d, -1);
  while (days.has(dayKey(d))) { cur++; d = addDays(d, -1); }
  const sorted = [...days].sort(); let best = 0, run = 0, prev = null;
  sorted.forEach((k) => { run = prev && dayKey(addDays(new Date(prev + 'T12:00'), 1)) === k ? run + 1 : 1; best = Math.max(best, run); prev = k; });
  return { cur, best, today: days.has(dayKey(new Date())) };
}
function weekStrokes(who, ref) {
  const mon = mondayOf(ref || new Date()); const days = countedDays(who); let n = 0;
  for (let i = 0; i < 7; i++) if (days.has(dayKey(addDays(mon, i)))) n++;
  return n;
}
function bestFor(who, exId) {
  let best = 0;
  S.sessions.forEach((s) => { if (s.who !== who) return; s.items.forEach((it) => { if (it.ex === exId) it.sets.forEach((st) => { if (st.done && +st.v > best) best = +st.v; }); }); });
  return best;
}
function lastVal(who, exId) {
  for (let i = S.sessions.length - 1; i >= 0; i--) {
    const s = S.sessions[i]; if (s.who !== who) continue;
    const it = s.items.find((x) => x.ex === exId); if (it && it.sets.length) return it.sets[it.sets.length - 1].v;
  }
  return '';
}
const unit = (e) => (e.metric === 'time' ? 'Sek.' : 'Wdh.');
const bestLabel = (e, v) => (v ? `Bestleistung ${v} ${unit(e)}` : '');

// ── Erfolge (Abzeichen) ──
function totalStrokes(who) { return countedDays(who).size; }
function earlyBirds(who) {
  let n = 0;
  S.sessions.forEach((s) => { if (s.who === who && s.counted && new Date(s.start).getHours() < 7) n++; });
  return n;
}
function plankSetCount(who) {
  let n = 0;
  S.sessions.forEach((s) => {
    if (s.who !== who) return;
    s.items.forEach((it) => { if (it.ex !== 'plank') return; it.sets.forEach((st) => { if (st.done && +st.v >= 30) n++; }); });
  });
  return n;
}
function bothTrainedDays() {
  const a = countedDays('hanne'), b = countedDays('andi'); let n = 0;
  a.forEach((k) => { if (b.has(k)) n++; });
  return n;
}
const ACHIEVEMENTS = [
  { id: 'schweiss', name: 'Erster Schweiß', desc: 'Erste Einheit absolviert', reward: 'Profil-Abzeichen',
    progress: (who) => ({ n: Math.min(S.sessions.filter((s) => s.who === who).length, 1), goal: 1 }) },
  { id: 'warm', name: 'Warmgelaufen', desc: '3 Tage Streak', reward: 'Abzeichen',
    progress: (who) => ({ n: Math.min(streak(who).best, 3), goal: 3 }) },
  { id: 'wocheeisen', name: 'Eine Woche Eisen', desc: '7 Tage Streak', reward: '1 Joker zum Neuziehen',
    progress: (who) => ({ n: Math.min(streak(who).best, 7), goal: 7 }) },
  { id: 'unaufhaltsam', name: 'Unaufhaltsam', desc: '14 Tage Streak', reward: '1 Schutzschild extra',
    progress: (who) => ({ n: Math.min(streak(who).best, 14), goal: 14 }) },
  { id: 'monat', name: 'Monatsmonster', desc: '30 Tage Streak', reward: 'eigene Wunschkarte, die der Partner erfüllen muss',
    progress: (who) => ({ n: Math.min(streak(who).best, 30), goal: 30 }) },
  { id: 'halbehundert', name: 'Halbe Hundert', desc: '50 Striche gesamt', reward: 'Abzeichen und Konfetti',
    progress: (who) => ({ n: Math.min(totalStrokes(who), 50), goal: 50 }) },
  { id: 'centurion', name: 'Centurion', desc: '100 Striche gesamt', reward: 'Wunschkarte Stufe 3',
    progress: (who) => ({ n: Math.min(totalStrokes(who), 100), goal: 100 }) },
  { id: 'frueh', name: 'Frühaufsteher', desc: '5 Einheiten vor 7 Uhr', reward: 'Abzeichen',
    progress: (who) => ({ n: Math.min(earlyBirds(who), 5), goal: 5 }) },
  { id: 'powerpaar', name: 'Power-Paar', desc: '7 Tage, an denen beide trainiert haben', reward: 'Team-Belohnung', team: true,
    progress: () => ({ n: Math.min(bothTrainedDays(), 7), goal: 7 }) },
  { id: 'roller', name: 'Roller-Lizenz', desc: '3× 30 Sek. Planke eingetragen', reward: 'schaltet den knienden Ab-Roller frei',
    progress: (who) => ({ n: Math.min(plankSetCount(who), 3), goal: 3 }) },
];
function achProgress(a, who) { return a.team ? a.progress() : a.progress(who); }
function achOn(a, who) { const p = achProgress(a, who); return p.n >= p.goal; }
function unlockedIds(who) { return ACHIEVEMENTS.filter((a) => achOn(a, who)).map((a) => a.id); }
const achById = (id) => ACHIEVEMENTS.find((a) => a.id === id);

// Roller-Lizenz: kniender Ab-Roller erst nach 3 × 30 s Planke
const LOCKS = { ab_kneeling: 'roller' };
const isLocked = (exId, who) => !!LOCKS[exId] && !achOn(achById(LOCKS[exId]), who);
const LOCK_FALLBACK = { ab_kneeling: 'ab_wall' };
function planFor(who, date) {
  return WEEKPLAN[(date || new Date()).getDay()][who].map((id) => (isLocked(id, who) ? LOCK_FALLBACK[id] || id : id));
}

// ── Wochen-Abrechnung (Sonntag 20 Uhr) ──
const SETTLE_HOUR = 20;
const other = (who) => (who === 'hanne' ? 'andi' : 'hanne');
function settleTime(mon) { const t = addDays(mon, 6); t.setHours(SETTLE_HOUR, 0, 0, 0); return t; }
// die jüngste Woche, deren Sonntag 20 Uhr schon vorbei ist
function dueMonday(now) { const mon = mondayOf(now); return now >= settleTime(mon) ? mon : addDays(mon, -7); }
const duelFor = (week) => S.duels.find((d) => d.week === week);
function stageFor(diff) { return diff <= 0 ? 0 : diff === 1 ? 1 : diff <= 3 ? 2 : diff <= 5 ? 3 : 4; }
function extraShieldFree(who, week) {
  return achOn(achById('unaufhaltsam'), who) && !S.duels.some((d) => d.extra && d.loser === who && d.week !== week);
}
// Ergebnis einer Woche (live berechnet, bis die Karte gezogen und gespeichert ist)
// Striche einer Woche, gezählt bis Sonntag 20 Uhr (spätere Einheiten ändern die Abrechnung nicht mehr)
function settledStrokes(who, mon) {
  const cut = +settleTime(mon); const days = new Set();
  S.sessions.forEach((s) => { if (s.who === who && s.counted && s.start < cut && s.start >= +mon) days.add(s.day); });
  return days.size;
}
function outcome(mon) {
  const h = settledStrokes('hanne', mon), a = settledStrokes('andi', mon);
  const r = { week: dayKey(mon), h, a, diff: Math.abs(h - a) };
  if (!h && !a) return Object.assign(r, { kind: 'none', why: 'empty' });
  if (h >= 6 && a >= 6) return Object.assign(r, { kind: 'team', stage: 'team' });
  if (h === a) return Object.assign(r, { kind: 'none', why: 'tie' });
  const winner = h > a ? 'hanne' : 'andi', loser = other(winner);
  let stage = stageFor(r.diff);
  const shield = Math.min(h, a) >= 5;
  if (shield) stage--;
  let extra = false;
  if (stage >= 2 && extraShieldFree(loser, r.week)) { stage--; extra = true; }
  if (stage < 1) return Object.assign(r, { kind: 'none', why: 'shield', winner, loser, shield });
  return Object.assign(r, { kind: 'win', winner, loser, stage, shield, extra });
}
// Karte passt nicht mehr zum Stand, z. B. weil eine Einheit von vor 20 Uhr erst später synchronisiert wurde
function isStale(d) {
  if (!d || d.redeemedAt || d.demo) return false;
  const o = outcome(mondayOf(new Date(d.week + 'T12:00')));
  if (o.h === d.h && o.a === d.a) return false;
  return o.kind !== d.kind || (o.winner || null) !== d.winner || o.stage !== d.stage;
}
const liveDuel = (week) => { const d = duelFor(week); return d && !isStale(d) ? d : null; };
const monthKey = (d) => dayKey(d).slice(0, 7);
function jokerFor(who) {
  const m = monthKey(new Date());
  if (!S.duels.some((d) => d.joker && d.joker.by === who && d.joker.src === 'monat' && d.joker.month === m)) return 'monat';
  if (achOn(achById('wocheeisen'), who) && !S.duels.some((d) => d.joker && d.joker.by === who && d.joker.src === 'bonus')) return 'bonus';
  return null;
}
// eigene Karten: nie löschbar per Sync, damit ein gleichzeitig hinzugefügter Eintrag beim anderen nicht verschwindet
function mergeCustomCards(remote) {
  let changed = false;
  ['1', '2', '3', '4', 'team'].forEach((k) => {
    const seen = new Map((S.customCards[k] || []).map((c) => [c.id, c]));
    (remote[k] || []).forEach((c) => { if (c && c.id && !seen.has(c.id)) { seen.set(c.id, c); changed = true; } });
    S.customCards[k] = [...seen.values()];
  });
  return changed;
}
function addCustomCard(stage, text, sexy) {
  const card = { id: uid(), t: text, s: !!sexy, by: S.me, at: Date.now() };
  S.customCards[stage] = (S.customCards[stage] || []).concat(card);
  touch('meta', 'cards'); persist();
}
function deckFor(stage) { return (CARDS[stage] || []).concat(S.customCards[stage] || []); }
function pickCard(stage, exclude) {
  const recent = new Set(S.duels.slice(-4).map((d) => d.card && d.card.t));
  if (exclude) recent.add(exclude);
  let deck = deckFor(stage).filter((c) => S.settings.sexy || !c.s);
  const fresh = deck.filter((c) => !recent.has(c.t));
  if (fresh.length) deck = fresh;
  else if (exclude && deck.length > 1) deck = deck.filter((c) => c.t !== exclude);
  return Object.assign({}, deck[Math.floor(Math.random() * deck.length)]);
}
function drawCard(o) {
  const d = { week: o.week, h: o.h, a: o.a, diff: o.diff, kind: o.kind, winner: o.winner || null, loser: o.loser || null, stage: o.stage,
    shield: !!o.shield, extra: !!o.extra, card: pickCard(o.stage), drawnBy: S.me, drawnAt: Date.now(), joker: null, redeemedAt: null };
  if (S.demo) d.demo = true;
  S.duels = S.duels.filter((x) => x.week !== d.week).concat(d);
  touch('duel', d.week); persist();
  return d;
}
function redrawCard(week) {
  const d = duelFor(week); const src = jokerFor(S.me);
  if (!d || d.joker || !src) return d;
  d.card = pickCard(d.stage, d.card.t);
  d.joker = { by: S.me, src, month: monthKey(new Date()) };
  touch('duel', week); persist();
  return d;
}
function daysSince(ts) { return Math.floor((Date.now() - ts) / 864e5); }

// ── kleine Grafik-Bausteine ──
function tallySvg(n, color) {
  let s = ''; let x = 4;
  for (let i = 0; i < 7; i++) {
    const inGroup = i % 5; const on = i < n;
    const col = on ? color : 'var(--line)';
    if (inGroup === 4) { const gx = x - 4 * 7; s += `<line x1="${gx - 3}" y1="24" x2="${gx + 3 * 7 + 3}" y2="6" stroke="${col}"/>`; x += 8; continue; }
    s += `<line x1="${x}" y1="5" x2="${x}" y2="25" stroke="${col}"/>`; x += 7;
  }
  return `<svg class="tally" viewBox="0 0 ${x + 4} 30" preserveAspectRatio="xMinYMid meet" role="img" aria-label="${n} von 7 Strichen">${s}</svg>`;
}
function lemonSvg(sour, cls) {
  const body = sour ? 'var(--lime)' : 'var(--lemon)';
  const face = sour
    ? '<path d="M10.5 12.5l2 1M21.5 12.5l-2 1" stroke="#2A2200" stroke-width="1.6" stroke-linecap="round"/><path d="M12 20c2.5-2 5.5-2 8 0" stroke="#2A2200" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
    : '<circle cx="12.5" cy="14" r="1.4" fill="#2A2200"/><circle cx="19.5" cy="14" r="1.4" fill="#2A2200"/><path d="M12 18.5c2.5 2.5 5.5 2.5 8 0" stroke="#2A2200" stroke-width="1.8" fill="none" stroke-linecap="round"/>';
  return `<svg class="${cls || ''}" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 16c0-6.5 5-11 11-11 3 0 5 .8 7 2.5l3-1.5-.5 3.5C28 11.5 28 14 28 16c0 6.5-5 11-12 11S5 22.5 5 16z" fill="${body}"/><path d="M22 5.5c1.5-2 3.5-2.5 5-2" stroke="var(--lime)" stroke-width="2" fill="none" stroke-linecap="round"/>${face}</svg>`;
}
function medalSvg(on, color) {
  const col = on ? color : 'var(--line)';
  return `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M11 4.5L7.5 13M21 4.5L24.5 13" stroke="${col}" stroke-width="2.6" stroke-linecap="round"/><circle cx="16" cy="19" r="10.5" fill="${col}"/><path d="M16 12.8l1.7 3.5 3.8.5-2.8 2.7.7 3.8-3.4-1.8-3.4 1.8.7-3.8-2.8-2.7 3.8-.5z" fill="${on ? '#FFFFFF' : 'var(--surface)'}" opacity="${on ? 0.95 : 0.7}"/></svg>`;
}
const ICON = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
};

// ── Rendering ──
const $view = document.getElementById('view');
function render() {
  const setup = ONLINE && !S.sync.code;
  document.body.classList.toggle('is-setup', setup);
  if (setup) { $view.innerHTML = viewSetup(); return; }
  document.querySelectorAll('.who button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.who === S.me)));
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === UI.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    b.classList.toggle('live', b.dataset.tab === 'training' && !!S.active[S.me]);
  });
  const fn = { heute: viewHeute, training: viewTraining, uebungen: viewUebungen, verlauf: viewVerlauf, erfolge: viewErfolge }[UI.tab];
  $view.innerHTML = fn();
  if (UI.tab === 'training') tick();
}

function demoBanner() {
  if (!S.demo) return '';
  return `<div class="banner"><span>Das sind Beispieldaten zum Ausprobieren.</span><span class="spacer"></span><button data-act="clear-demo">Löschen</button></div>`;
}

const stageText = (st) => (st === 'team' ? STAGES.team.label : `${STAGES[st].name} · ${STAGES[st].label}`);
function weekLabel(week) {
  const mon = mondayOf(new Date(week + 'T12:00')); const cur = mondayOf(new Date());
  if (+mon === +cur) return 'Diese Woche';
  if (+mon === +addDays(cur, -7)) return 'Letzte Woche';
  return 'Woche ab ' + mon.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}
const scoreText = (h, a) => `Hanne ${h} : ${a} Andi`;
function deadlineText(d) {
  const due = addDays(new Date(d.drawnAt), 7); const day0 = (x) => { const y = new Date(x); y.setHours(0, 0, 0, 0); return y; };
  const left = Math.round((day0(due) - day0(Date.now())) / 864e5);
  if (left < 0) return `<span style="color:var(--warn)">überfällig seit ${-left} ${-left === 1 ? 'Tag' : 'Tagen'}</span>`;
  if (left === 0) return '<span style="color:var(--warn)">heute fällig</span>';
  return `einlösen bis ${due.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })}`;
}
function liveVerdict(o) {
  const n = (x) => `${x} ${x === 1 ? 'Strich' : 'Strichen'}`;
  if (o.why === 'empty') return `${lemonSvg(false)}<span>Neue Woche, noch keine Striche. Wer legt vor?</span>`;
  if (o.kind === 'team') return `${lemonSvg(false)}<span>Ihr habt beide 6 oder mehr Striche. Bleibt es so, gibt es am Sonntag eine Team-Belohnung.</span>`;
  if (o.why === 'tie') return `${lemonSvg(false)}<span>Gleichstand mit ${n(o.h)}. Diese Woche seid ihr beide süße Zitronen.</span>`;
  const lead = PEOPLE[o.winner].name, lag = PEOPLE[o.loser].name;
  if (o.kind === 'none') return `${lemonSvg(false)}<span>${lead} führt mit ${n(o.diff)}, aber ${lag} hat den Schutzschild (5+ Striche). Stand jetzt zahlt keiner.</span>`;
  return `${lemonSvg(true)}<span>${lead} führt mit ${n(o.diff)}. ${lag} droht die saure Zitrone: Stand jetzt ${stageText(o.stage)}.</span>`;
}
function shieldNotes(o) {
  let s = '';
  if (o.shield) s += ` ${PEOPLE[o.loser].name} hatte 5+ Striche, der Schutzschild macht es eine Stufe leichter.`;
  if (o.extra) s += ` Dazu kommt das Extra-Schutzschild aus dem Erfolg „Unaufhaltsam“.`;
  return s;
}
// offene und fällige Belohnungen im Duell-Kärtchen
function settlementHtml(now) {
  let out = '';
  const dueMon = dueMonday(now);
  // fällige Woche plus die davor, falls dort die Karte noch nicht gezogen wurde
  [addDays(dueMon, -7), dueMon].forEach((mon) => {
  const o = outcome(mon); const older = +mon !== +dueMon;
  if (older && !(o.kind === 'win' || o.kind === 'team')) return;
  const corrected = isStale(duelFor(o.week));
  if (!liveDuel(o.week)) {
    if (o.kind === 'win' || o.kind === 'team') {
      const canDraw = o.kind === 'team' || S.me === o.winner;
      const head = o.kind === 'team' ? 'Ihr seid beide süße Zitronen!' : `${PEOPLE[o.winner].name} ist die süße Zitrone der Woche!`;
      const sub = o.kind === 'team' ? 'Beide 6+ Striche: Zieht eine gemeinsame Team-Belohnung.'
        : `${PEOPLE[o.loser].name} schuldet eine Karte aus ${stageText(o.stage)}.`;
      const hint = canDraw ? '' : ONLINE ? `<p class="muted small" style="margin:0">${PEOPLE[o.winner].name} zieht die Karte auf dem eigenen Handy.</p>`
        : `<p class="muted small" style="margin:0">Zum Ziehen oben auf ${PEOPLE[o.winner].name} wechseln.</p>`;
      out += `<div class="reward due"><div class="eyebrow">${weekLabel(o.week)} · ${scoreText(o.h, o.a)}</div>${corrected ? '<div class="small" style="font-weight:600">Stand nachträglich korrigiert, die alte Karte gilt nicht mehr.</div>' : ''}
        <div class="rt">${head}</div><div class="muted small">${sub}</div>
        ${canDraw ? `<button class="btn btn-lemon btn-block" data-act="draw-open" data-week="${o.week}">${o.kind === 'team' ? 'Team-Belohnung abholen' : 'Belohnung abholen'}</button>` : hint}</div>`;
    } else if (o.why !== 'empty') {
      const why = o.why === 'tie' ? 'unentschieden, keiner zahlt' : `Schutzschild für ${PEOPLE[o.loser].name}, keiner zahlt`;
      out += `<div class="verdict">${lemonSvg(false)}<span>${weekLabel(o.week)}: ${scoreText(o.h, o.a)}, ${why}.</span></div>`;
    }
  }
  });
  S.duels.filter((d) => !d.redeemedAt && d.card && !isStale(d)).forEach((d) => {
    const team = d.kind === 'team'; const mine = team || S.me === d.winner;
    const hidden = d.card.s && !(UI.reveal && UI.reveal[d.week]);
    const who = team ? 'Für euch beide' : S.me === d.loser ? `Du schuldest ${PEOPLE[d.winner].name}` : `${PEOPLE[d.loser].name} schuldet ${S.me === d.winner ? 'dir' : PEOPLE[d.winner].name}`;
    out += `<div class="reward open">
      <div class="row" style="gap:6px"><span class="eyebrow">Offen · ${stageText(d.stage)}</span><span class="spacer"></span>${d.card.s ? '<span class="chip spicy">pikant</span>' : ''}</div>
      <button class="cardtext ${hidden ? 'veil' : ''}" data-act="reveal" data-week="${d.week}" ${hidden ? 'aria-label="Pikante Karte anzeigen"' : 'tabindex="-1"'}>${esc(d.card.t)}</button>
      ${hidden ? '<div class="muted small" style="margin-top:-4px">Antippen zum Anzeigen</div>' : ''}
      <div class="row" style="flex-wrap:wrap;gap:8px"><span class="muted small" style="flex:1;min-width:150px">${who} · ${deadlineText(d)}</span>
        ${mine ? `<button class="btn btn-main btn-sm" data-act="redeem" data-week="${d.week}">Eingelöst</button>` : ''}</div>
    </div>`;
  });
  return out;
}

function viewHeute() {
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
  const me = PEOPLE[S.me];
  const mon = mondayOf(now);
  const wH = weekStrokes('hanne'), wA = weekStrokes('andi');
  const settledNow = now >= settleTime(mon);
  const verdict = settledNow ? '' : liveVerdict(outcome(mon));
  const daysLeft = Math.round((addDays(mon, 6) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5);
  const chip = settledNow ? 'Abrechnung ist durch' : daysLeft === 0 ? 'Abrechnung heute 20 Uhr' : daysLeft === 1 ? 'Abrechnung morgen 20 Uhr' : `Abrechnung in ${daysLeft} Tagen`;
  const settle = settlementHtml(now);
  const fighter = (who, w) => {
    const st = streak(who); const P = PEOPLE[who];
    return `<div class="fighter ${who}">
      <div class="row"><span class="name">${P.name}</span><span class="spacer"></span>${st.today ? '<span class="chip" style="background:var(--surface)">heute ✓</span>' : ''}</div>
      <div class="big num">${w}<small>/ 7</small></div>
      ${tallySvg(w, P.color === 'var(--hanne)' ? 'var(--hanne-ink)' : 'var(--andi-ink)')}
      <div class="muted" style="font-size:13px;font-weight:600">Serie ${st.cur} ${st.cur === 1 ? 'Tag' : 'Tage'} · Rekord ${st.best}</div>
    </div>`;
  };
  const plan = WEEKPLAN[now.getDay()];
  const mine = planFor(S.me, now);
  const active = S.active[S.me];
  return `${demoBanner()}${syncBanner()}
  <div><div class="eyebrow">${now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}</div><h1>${greet}, ${me.name}</h1></div>
  <section class="card" aria-label="Wochen-Duell">
    <div class="row" style="margin-bottom:10px;flex-wrap:wrap;row-gap:6px"><h2 style="white-space:nowrap">Wochen-Duell</h2><span class="spacer"></span><span class="chip num" style="white-space:nowrap">${chip}</span></div>
    <div class="duel">${fighter('hanne', wH)}${fighter('andi', wA)}</div>
    ${verdict ? `<div class="verdict" style="margin-top:12px">${verdict}</div>` : ''}
    ${settle ? `<div class="settle">${settle}</div>` : ''}
  </section>
  <section class="card" aria-label="Heutiges Training">
    <div class="eyebrow">Vorschlag für heute · ${plan.type}</div>
    <h2 style="margin:4px 0 10px">${me.name}: ${me.focus}</h2>
    <div class="suggest">${mine.map((id) => `<button class="chip" data-act="info" data-ex="${id}">${esc(EX[id].name)}</button>`).join('')}</div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      ${active
        ? `<button class="btn btn-lemon btn-block" data-act="goto" data-tab="training">Training läuft · weiter</button>`
        : `<button class="btn btn-main" style="flex:1" data-act="start-plan">Vorschlag starten</button><button class="btn btn-ghost" data-act="start-free">Frei wählen</button>`}
    </div>
    <p class="muted" style="font-size:13px;margin:10px 0 0">Ein Strich zählt ab ${STRICH_MIN} Minuten Training.</p>
  </section>
  <button class="card row" style="text-align:left;width:100%" data-act="goto" data-tab="erfolge">
    <span class="medal" style="width:34px;height:34px;flex:none">${medalSvg(true, me.color)}</span>
    <span><div style="font-weight:700">Erfolge</div><div class="muted" style="font-size:13px">${ACHIEVEMENTS.filter((a) => achOn(a, S.me)).length} von ${ACHIEVEMENTS.length} freigeschaltet</div></span>
    <span class="spacer"></span><span class="iconbtn" aria-hidden="true">${ICON.chev}</span>
  </button>
  <button class="linkrow" data-act="settings">${ICON.gear}<span>Einstellungen${ONLINE ? ' & Abgleich' : ''}</span></button>`;
}
function syncBanner() {
  if (!ONLINE || !S.sync.code || !S.sync.err) return '';
  const pending = Object.keys(S.sync.dirty).length;
  return `<div class="banner warn"><span>${S.sync.err === 'Offline' ? 'Offline.' : 'Abgleich gerade nicht möglich.'} ${pending ? 'Deine Einträge sind gespeichert und werden nachgereicht.' : ''}</span><span class="spacer"></span><button data-act="sync-now">Erneut</button></div>`;
}

function exCard(e, mode) {
  const b = bestFor(S.me, e.id);
  const act = S.active[S.me];
  const inSession = act && act.items.some((it) => it.ex === e.id);
  const locked = isLocked(e.id, S.me);
  const right = locked ? `<span class="add lock" aria-hidden="true">${ICON.lock}</span>`
    : mode === 'pick' ? `<span class="add ${inSession ? 'on' : ''}" aria-hidden="true">${inSession ? '✓' : '+'}</span>`
    : `<span class="iconbtn" aria-hidden="true">${ICON.info}</span>`;
  return `<button class="ex ${locked ? 'locked' : ''}" data-act="${mode === 'pick' && !locked ? 'pick' : 'info'}" data-ex="${e.id}" aria-label="${esc(e.name)}${locked ? ', gesperrt' : ''}">
    <span class="thumb">${FIG.svg(e, 1)}</span>
    <span><div class="t">${esc(e.name)}</div><div class="s">${e.sets} × ${esc(e.target)}${e.side ? ' pro Seite' : ''} · ${e.equip.length ? esc(e.equip.join(', ')) : 'ohne Geräte'}</div>${locked ? `<div class="best" style="color:var(--ink2)">Freischalten mit Erfolg „${esc(achById(LOCKS[e.id]).name)}“</div>` : b ? `<div class="best">${bestLabel(e, b)}</div>` : ''}</span>
    ${right}</button>`;
}

function exListHtml(mode) {
  const q = UI.q.trim().toLowerCase();
  const filters = [{ id: 'alle', label: 'Alle' }].concat(CATS);
  const list = EXERCISES.filter((e) => (UI.filter === 'alle' || e.cat === UI.filter) && (!q || (e.name + ' ' + e.desc + ' ' + e.equip.join(' ')).toLowerCase().includes(q)));
  let body = '';
  CATS.forEach((c) => {
    const items = list.filter((e) => e.cat === c.id); if (!items.length) return;
    body += `<div class="cathead"><h3>${c.label}</h3><span class="muted num" style="font-size:13px">${items.length}</span></div><div class="exlist">${items.map((e) => exCard(e, mode)).join('')}</div>`;
  });
  if (!body) body = `<div class="empty">Keine Übung gefunden. Suchbegriff ändern oder Filter auf „Alle“ setzen.</div>`;
  return `<input class="search" id="search-${mode}" type="search" placeholder="Übung suchen, z. B. Band oder Hantel" value="${esc(UI.q)}" autocomplete="off">
    <div class="filters" role="group" aria-label="Filter">${filters.map((f) => `<button data-act="filter" data-f="${f.id}" aria-pressed="${UI.filter === f.id}">${f.label}</button>`).join('')}</div>
    <div id="exbody-${mode}" style="display:flex;flex-direction:column;gap:8px">${body}</div>`;
}

function viewUebungen() {
  return `<div><div class="eyebrow">Gesamtübersicht</div><h1>${EXERCISES.length} Übungen</h1><p class="muted" style="margin:4px 0 0">Antippen zeigt Bewegung, Ausführung und deine Bestleistung.</p></div>${exListHtml('list')}`;
}

function elapsed(a) { return a.acc + (a.runSince ? Date.now() - a.runSince : 0); }

function viewTraining() {
  const a = S.active[S.me]; const me = PEOPLE[S.me];
  if (!a) {
    const plan = WEEKPLAN[new Date().getDay()];
    return `<div><div class="eyebrow">Training · ${me.name}</div><h1>Bereit für 15 Minuten?</h1></div>
    <section class="card"><div class="eyebrow">Vorschlag · ${plan.type}</div>
      <div class="exlist" style="margin-top:10px">${planFor(S.me).map((id) => exCard(EX[id], 'list')).join('')}</div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-main" style="flex:1" data-act="start-plan">Vorschlag starten</button><button class="btn btn-ghost" data-act="start-free">Frei wählen</button></div>
    </section>`;
  }
  const items = a.items.map((it, ei) => {
    const e = EX[it.ex];
    const allDone = it.sets.length && it.sets.every((s) => s.done);
    const sets = it.sets.map((st, si) => {
      const swOn = UI.sw && UI.sw.ei === ei && UI.sw.si === si;
      return `<div class="set"><span class="n">Satz ${si + 1}</span>
        <input id="set-${ei}-${si}" type="number" inputmode="numeric" min="0" max="999" value="${esc(st.v)}" placeholder="${esc(e.target.split(/[–\s]/)[0])}" data-act="setv" data-ei="${ei}" data-si="${si}" aria-label="${esc(e.name)} Satz ${si + 1} ${unit(e)}">
        ${e.metric === 'time' ? `<button class="sw ${swOn ? 'run' : ''}" data-act="sw" data-ei="${ei}" data-si="${si}" id="sw-${ei}-${si}">${swOn ? 'Stopp' : '▶ Uhr'}</button>` : `<span class="unit">${unit(e)}</span>`}
        <button class="check" aria-pressed="${!!st.done}" aria-label="Satz ${si + 1} erledigt" data-act="done" data-ei="${ei}" data-si="${si}">${ICON.check}</button></div>`;
    }).join('');
    return `<div class="wex ${allDone ? 'complete' : ''}">
      <div class="head"><button class="thumb" data-act="info" data-ex="${e.id}" aria-label="${esc(e.name)} ansehen">${FIG.svg(e, 1)}</button>
        <div><div style="font-weight:700;line-height:1.2">${esc(e.name)}</div><div class="muted" style="font-size:13px">Ziel ${esc(e.target)}${e.side ? ' pro Seite' : ''}${e.metric === 'time' ? ' · Sekunden' : ''}</div></div>
        <button class="iconbtn" data-act="rm" data-ei="${ei}" aria-label="${esc(e.name)} entfernen">${ICON.x}</button></div>
      <div class="sets">${sets}</div>
      <button class="addset" data-act="addset" data-ei="${ei}">+ Satz</button>
    </div>`;
  }).join('');
  return `<section class="card clock">
      <div class="ring" id="ring"><svg viewBox="0 0 108 108"><circle class="bg" cx="54" cy="54" r="46" fill="none" stroke-width="10"/><circle class="fg" id="ringfg" cx="54" cy="54" r="46" fill="none" stroke-width="10" stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="289"/></svg>
        <div class="lbl"><div><div class="time num" id="clock">0:00</div><div class="sub" id="clocksub">bis zum Strich</div></div></div></div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div class="eyebrow">${me.name} trainiert</div>
        <div id="clockmsg" style="font-weight:600;font-size:14px"></div>
        <div class="row" style="flex-wrap:wrap;gap:8px"><button class="btn btn-ghost btn-sm" data-act="pause" id="pausebtn">${a.runSince ? 'Pause' : 'Weiter'}</button><button class="btn btn-main btn-sm" data-act="finish">Beenden</button></div>
      </div>
    </section>
    <div class="work">${items || `<div class="empty">Noch keine Übung. Füge unten deine erste hinzu.</div>`}</div>
    <button class="btn btn-line btn-block" data-act="picker">+ Übung hinzufügen</button>`;
}

function viewVerlauf() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const start = addDays(mondayOf(today), -28);
  const dH = countedDays('hanne'), dA = countedDays('andi');
  let cells = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => `<div class="dh">${d}</div>`).join('');
  for (let i = 0; i < 35; i++) {
    const d = addDays(start, i); const k = dayKey(d);
    const fut = d > today; const isT = +d === +today;
    cells += `<div class="d ${isT ? 'today' : ''} ${fut ? 'future' : ''}"><span class="num">${d.getDate()}</span><span class="pips">${dH.has(k) ? '<span class="pip" style="background:var(--hanne)"></span>' : ''}${dA.has(k) ? '<span class="pip" style="background:var(--andi)"></span>' : ''}</span></div>`;
  }
  const tot = (who) => { const ss = S.sessions.filter((s) => s.who === who); return { n: countedDays(who).size, min: Math.round(ss.reduce((a, s) => a + s.durationMs, 0) / 60000) }; };
  const tH = tot('hanne'), tA = tot('andi');
  const log = S.sessions.slice().sort((a, b) => b.start - a.start).slice(0, 25).map((s) => {
    const d = new Date(s.start);
    return `<div class="it"><span class="sw8" style="background:${PEOPLE[s.who].color}"></span>
      <span><div style="font-weight:700">${PEOPLE[s.who].name} · ${d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' })}</div><div class="muted" style="font-size:13px">${s.items.map((i) => EX[i.ex] ? EX[i.ex].name : i.ex).join(', ')}</div></span>
      <span class="num" style="text-align:right;font-weight:700">${Math.round(s.durationMs / 60000)} Min<br><span style="font-size:12px;color:${s.counted ? 'var(--lime-ink)' : 'var(--ink2)'}">${s.counted ? 'Strich' : 'kein Strich'}</span></span></div>`;
  }).join('');
  return `${demoBanner()}<div><div class="eyebrow">Strichliste</div><h1>Letzte 5 Wochen</h1></div>
  <section class="card"><div class="cal">${cells}</div>
    <div class="row" style="margin-top:10px;gap:14px;font-size:13px;font-weight:600"><span class="row" style="gap:6px"><span class="pip" style="width:9px;height:9px;border-radius:50%;background:var(--hanne)"></span>Hanne</span><span class="row" style="gap:6px"><span class="pip" style="width:9px;height:9px;border-radius:50%;background:var(--andi)"></span>Andi</span></div></section>
  <section class="stats">
    <div class="stat" style="background:var(--hanne-soft)"><div class="k">Hanne gesamt</div><div class="v num">${tH.n} Striche</div><div class="k num">${tH.min} Minuten</div></div>
    <div class="stat" style="background:var(--andi-soft)"><div class="k">Andi gesamt</div><div class="v num">${tA.n} Striche</div><div class="k num">${tA.min} Minuten</div></div>
  </section>
  <section class="card"><h2 style="margin-bottom:4px">Einheiten</h2><div class="log">${log || '<div class="empty">Noch keine Einheit gespeichert.</div>'}</div></section>`;
}

function viewErfolge() {
  const me = PEOPLE[S.me];
  const n = ACHIEVEMENTS.filter((a) => achOn(a, S.me)).length;
  const cards = ACHIEVEMENTS.map((a) => {
    const p = achProgress(a, S.me); const on = p.n >= p.goal;
    const pct = Math.round((p.n / p.goal) * 100);
    return `<div class="badge ${on ? 'on' : ''}">
      <span class="medal">${medalSvg(on, a.team ? 'var(--lemon)' : me.color)}</span>
      <div class="bt">
        <div class="row"><span class="t">${esc(a.name)}</span>${a.team ? '<span class="chip" style="padding:2px 8px;font-size:11px">gemeinsam</span>' : ''}</div>
        <div class="muted" style="font-size:13px">${esc(a.desc)}</div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="muted num" style="font-size:12px;margin-top:2px">${Math.min(p.n, p.goal)} / ${p.goal}${on ? ' · geschafft' : ''}</div>
        <div class="reward">${on ? 'Freigeschaltet: ' : 'Belohnung: '}${esc(a.reward)}</div>
      </div>
    </div>`;
  }).join('');
  return `<div><div class="eyebrow">${me.name} · Erfolge</div><h1>${n} von ${ACHIEVEMENTS.length} freigeschaltet</h1>
    <p class="muted" style="margin:4px 0 0">Joker und Extra-Schutzschild setzt die App bei der Sonntags-Abrechnung automatisch ein. Wunschkarten löst ihr direkt beim anderen ein.</p></div>
    <div class="badges">${cards}</div>
    <button class="card row" style="text-align:left;width:100%" data-act="rewards">
      <span class="medal" style="width:34px;height:34px;flex:none">${medalSvg(true, 'var(--lemon)')}</span>
      <span><div style="font-weight:700">Belohnungen &amp; Team-Belohnungen</div><div class="muted" style="font-size:13px">Alle Karten ansehen, eigene hinzufügen</div></span>
      <span class="spacer"></span><span class="iconbtn" aria-hidden="true">${ICON.chev}</span>
    </button>`;
}

// ── Belohnungsübersicht (Kartendeck) ──
function rewardCardHtml(c, stage) {
  return `<div class="rcard ${c.id ? 'own' : ''}"><span>${esc(c.t)}</span>
    <span class="row" style="gap:6px;flex:none">${c.s ? '<span class="chip spicy">pikant</span>' : ''}${c.id ? `<span class="chip" style="font-size:11px">von ${esc(PEOPLE[c.by] ? PEOPLE[c.by].name : c.by)}</span>` : ''}</span></div>`;
}
function rewardsBody() {
  const stage = UI.rewardStage || '1';
  const chips = [['1', 'Stufe 1'], ['2', 'Stufe 2'], ['3', 'Stufe 3'], ['4', 'Stufe 4'], ['team', 'Team']];
  const list = deckFor(stage);
  return `<div class="filters" role="group" aria-label="Stufe" id="reward-tabs">${chips.map(([id, l]) => `<button data-act="reward-stage" data-stage="${id}" aria-pressed="${stage === id}">${l}</button>`).join('')}</div>
    <div id="reward-list" style="display:flex;flex-direction:column;gap:8px">${list.map((c) => rewardCardHtml(c, stage)).join('')}</div>
    <div style="display:flex;flex-direction:column;gap:8px;border-top:1px dashed var(--line);padding-top:12px">
      <div class="eyebrow">Eigene Karte für ${chips.find((c) => c[0] === stage)[1]} hinzufügen</div>
      <textarea class="field" id="reward-text" rows="2" placeholder="z. B. Eine Runde Eis ausgeben" style="resize:vertical;font-family:inherit"></textarea>
      <label class="toggle" style="font-weight:500"><input type="checkbox" id="reward-sexy"><span>Pikant</span></label>
      <button class="btn btn-lemon btn-block" data-act="reward-add">Hinzufügen</button>
    </div>`;
}
function showRewards() {
  UI.rewardStage = UI.rewardStage || '1';
  openSheet(`<div class="row"><h2>Belohnungen</h2><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-act="close">Fertig</button></div>
    <p class="muted small" style="margin:0">Das sind alle Karten, aus denen die App bei der Sonntagsabrechnung zieht. Ihr könnt jederzeit eigene ergänzen.</p>
    <div id="rewards-body">${rewardsBody()}</div>`, null, 'rewards');
}
function refreshRewards() {
  const sh = $ov.querySelector('.sheet'); if (!sh || UI.sheetMode !== 'rewards') return;
  const body = sh.querySelector('#rewards-body'); if (body) body.innerHTML = rewardsBody();
}

// ── Sheets ──
const $ov = document.getElementById('overlay');
function openSheet(html, onMount, mode) {
  closeSheet();
  UI.sheetMode = mode || null;
  $ov.innerHTML = `<div class="scrim" data-act="close-scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  if (onMount) onMount($ov.querySelector('.sheet'));
}
function closeSheet() { if (UI.sheetStop) { UI.sheetStop(); UI.sheetStop = null; } $ov.innerHTML = ''; UI.sheetMode = null; }

function showInfo(id) {
  const e = EX[id]; const b = bestFor(S.me, id); const a = S.active[S.me];
  const inSession = a && a.items.some((it) => it.ex === id);
  openSheet(`<div class="stage"><svg class="fig" id="animfig" viewBox="0 0 160 100" role="img" aria-label="Bewegungsablauf ${esc(e.name)}">${FIG.svgInner(e, 1)}</svg></div>
    <div><div class="eyebrow">${CATS.find((c) => c.id === e.cat).label}</div><h2 style="font-size:22px">${esc(e.name)}</h2></div>
    <p style="margin:0">${esc(e.desc)}</p>
    <dl class="facts"><dt>Ziel</dt><dd>${e.sets} Sätze × ${esc(e.target)}${e.side ? ' pro Seite' : ''}</dd>
      <dt>Erfassung</dt><dd>${e.metric === 'time' ? 'Zeit in Sekunden' : 'Wiederholungen'}</dd>
      <dt>Ausrüstung</dt><dd>${e.equip.length ? esc(e.equip.join(', ')) : 'keine'}</dd>
      <dt>Bestleistung</dt><dd>${b ? b + ' ' + unit(e) : 'noch keine'}</dd></dl>
    ${isLocked(id, S.me) ? (() => { const L = achById(LOCKS[id]); const p = achProgress(L, S.me);
      return `<div class="banner"><span>${ICON.lock}</span><span>Gesperrt, bis der Erfolg „${esc(L.name)}“ geschafft ist: ${esc(L.desc)} (${p.n} von ${p.goal}). Bis dahin ist der Ab-Roller an der Wand die sichere Variante.</span></div>`; })()
    : `<button class="btn ${inSession ? 'btn-ghost' : 'btn-main'} btn-block" data-act="add-from-info" data-ex="${id}" ${inSession ? 'disabled' : ''}>${inSession ? 'Ist im Training' : a ? 'Zum Training hinzufügen' : 'Training mit dieser Übung starten'}</button>`}
    <button class="btn btn-ghost btn-block" data-act="close">Schließen</button>`,
  (sh) => { if (!REDUCED) UI.sheetStop = FIG.animate(sh.querySelector('#animfig'), e); });
}
function showPicker() {
  openSheet(`<div class="row"><h2>Übung hinzufügen</h2><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-act="close">Fertig</button></div>${exListHtml('pick')}`, null, 'pick');
}
function refreshPicker() {
  const sh = $ov.querySelector('.sheet'); if (!sh || UI.sheetMode !== 'pick') return;
  const tmp = document.createElement('div'); tmp.innerHTML = exListHtml('pick');
  sh.querySelector('#exbody-pick').replaceWith(tmp.querySelector('#exbody-pick'));
  sh.querySelectorAll('.filters button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === UI.filter)));
}

// ── Belohnung abholen ──
function showDraw(week, animate) {
  const d = liveDuel(week);
  const o = d || outcome(mondayOf(new Date(week + 'T12:00')));
  if (o.diff == null) o.diff = Math.abs(o.h - o.a);
  if (!d && o.kind !== 'win' && o.kind !== 'team') { closeSheet(); render(); return; }
  const team = o.kind === 'team';
  const st = STAGES[o.stage];
  const joker = d && !d.joker && (team || S.me === d.winner) ? jokerFor(S.me) : null;
  const intro = team ? `Ihr hattet beide 6 oder mehr Striche. Das feiert ihr zusammen.`
    : `${PEOPLE[o.winner].name} holt sich die Belohnung, ${PEOPLE[o.loser].name} löst sie ein. Differenz ${o.diff} ${o.diff === 1 ? 'Strich' : 'Striche'}: ${stageText(o.stage)}, ${st.hint}.${shieldNotes(o)}`;
  const face = d ? `<div class="stg">${stageText(d.stage)}</div><div class="ct">${esc(d.card.t)}</div>${d.card.s ? '<span class="chip spicy">pikant</span>' : ''}` : '';
  openSheet(`<div><div class="eyebrow">${weekLabel(o.week)} · ${scoreText(o.h, o.a)}</div>
      <h2 style="font-size:22px">${team ? 'Team-Belohnung' : 'Belohnung abholen'}</h2></div>
    <p class="muted" style="margin:0">${intro}</p>
    <div class="pcard ${d && !animate ? 'flipped' : ''}" id="pcard">
      <div class="face back">${lemonSvg(false)}<div>Zitronenpresse</div><div class="muted small">${stageText(o.stage)}</div></div>
      <div class="face front">${face}</div>
    </div>
    ${d ? `<p class="small" style="margin:0;text-align:center">${team ? 'Wer zuerst Zeit hat, plant es.' : `${PEOPLE[d.loser].name} hat 7 Tage Zeit. Die Karte steht bis dahin auf „Heute“.`}</p>
        ${joker ? `<button class="btn btn-ghost btn-block" data-act="redraw" data-week="${week}">Joker einsetzen: neu ziehen</button><p class="muted small" style="margin:-6px 0 0;text-align:center">${joker === 'monat' ? 'Dein Joker für diesen Monat' : 'Bonus-Joker aus „Eine Woche Eisen“'}, nur einmal pro Karte.</p>` : ''}
        <button class="btn btn-main btn-block" data-act="close">Fertig</button>`
      : `<label class="toggle"><input type="checkbox" data-act="set-sexy" ${S.settings.sexy ? 'checked' : ''}><span>Pikante Karten mit im Stapel</span></label>
        <button class="btn btn-lemon btn-block" data-act="draw" data-week="${week}">Karte ziehen</button>
        <button class="btn btn-ghost btn-block" data-act="close">Später</button>`}`,
  (sh) => { if (animate) { const c = sh.querySelector('#pcard'); requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add('flipped'))); } }, 'draw');
}

// ── Einstellungen ──
function showSettings() {
  const sy = S.sync;
  const ago = (t) => { if (!t) return 'noch nie'; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min.` : `vor ${Math.round(m / 60)} Std.`; };
  openSheet(`<div class="row"><h2>Einstellungen</h2><span class="spacer"></span><button class="btn btn-ghost btn-sm" data-act="close">Fertig</button></div>
    <label class="toggle"><input type="checkbox" data-act="set-sexy" ${S.settings.sexy ? 'checked' : ''}><span>Pikante Karten im Stapel<br><span class="muted small">Ausschalten, falls das Handy mal rumgezeigt wird. Gilt für dieses Gerät.</span></span></label>
    ${ONLINE && sy.code ? `<section class="card" style="display:flex;flex-direction:column;gap:8px">
      <h3>Abgleich</h3>
      <div class="small">${sy.err ? `<span style="color:var(--warn)">${sy.err === 'Offline' ? 'Offline' : 'Fehler beim Abgleich'}</span> · ` : ''}Zuletzt abgeglichen: ${ago(sy.lastOk)}${Object.keys(sy.dirty).length ? ` · ${Object.keys(sy.dirty).length} Einträge warten` : ''}</div>
      <button class="btn btn-ghost btn-sm" data-act="sync-now">Jetzt abgleichen</button>
      <div class="small muted">Paar-Code: <span class="num" style="font-weight:700;color:var(--ink)">${esc(sy.code)}</span></div>
      <button class="btn btn-line btn-sm" data-act="share-invite">Einladungslink für ${PEOPLE[other(S.me)].name} teilen</button>
      <p class="muted small" style="margin:0">Der Code ist euer Schlüssel. Nur wer ihn kennt, sieht eure Daten.</p>
    </section>` : ''}
    ${S.demo ? '<button class="btn btn-line btn-block" data-act="clear-demo">Beispieldaten löschen</button>' : ''}`, null, 'settings');
}
function inviteLink() { return location.origin + location.pathname + '#code=' + encodeURIComponent(S.sync.code); }
async function shareInvite() {
  const url = inviteLink(); const text = 'Zitronenpresse: unser gemeinsames Training';
  try { if (navigator.share) { await navigator.share({ title: 'Zitronenpresse', text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); flash('Link kopiert'); } catch (e) { prompt('Link kopieren:', url); }
}
function flash(msg) {
  $toast.innerHTML = `<div class="toast" role="status"><span>${esc(msg)}</span></div>`;
  setTimeout(() => { $toast.innerHTML = ''; }, 2200);
}

// ── Ersteinrichtung der Online-Version ──
function newCode() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'; const b = new Uint8Array(20); crypto.getRandomValues(b);
  const s = Array.from(b, (x) => abc[x % abc.length]).join('');
  return 'zp-' + s.match(/.{1,5}/g).join('-');
}
function codeFromHash() {
  const m = /[#&]code=([^&]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]).trim() : '';
}
function viewSetup() {
  const code = UI.setupCode != null ? UI.setupCode : codeFromHash();
  const who = UI.setupWho || '';
  return `<div class="setup">
    <div style="text-align:center">${lemonSvg(false, 'lemonbig')}<h1 style="margin-top:8px">Willkommen in der Zitronenpresse</h1>
    <p class="muted" style="margin:6px 0 0">Einmal einrichten, dann trainiert ihr im Duell.</p></div>
    <section class="card" style="display:flex;flex-direction:column;gap:10px">
      <h2>1. Wer bist du?</h2>
      <div class="duel">${['hanne', 'andi'].map((w) => `<button class="btn ${who === w ? 'btn-main' : 'btn-ghost'}" data-act="setup-who" data-who2="${w}" aria-pressed="${who === w}">${PEOPLE[w].name}</button>`).join('')}</div>
    </section>
    <section class="card" style="display:flex;flex-direction:column;gap:10px">
      <h2>2. Euer Paar-Code</h2>
      ${code ? `<p class="muted small" style="margin:0">Code aus dem Einladungslink übernommen.</p>` : `<p class="muted small" style="margin:0">Wer zuerst einrichtet, erzeugt einen neuen Code. Die andere Person gibt ihn ein oder öffnet den Einladungslink.</p>`}
      <input class="field num" id="setup-code" placeholder="zp-xxxxx-xxxxx-…" value="${esc(code)}" autocomplete="off" autocapitalize="off" spellcheck="false">
      ${code ? '' : '<button class="btn btn-line" data-act="setup-new">Neuen Code erzeugen</button>'}
    </section>
    ${UI.setupErr ? `<div class="banner warn">${esc(UI.setupErr)}</div>` : ''}
    <button class="btn btn-lemon btn-block" data-act="setup-go" ${who ? '' : 'disabled'}>Los geht’s</button>
  </div>`;
}
async function finishSetup() {
  const inp = document.getElementById('setup-code');
  const code = (inp ? inp.value : UI.setupCode || '').trim().toLowerCase();
  if (!UI.setupWho) return;
  if (!/^[a-z0-9-]{16,64}$/.test(code)) { UI.setupErr = 'Der Code sieht nicht richtig aus. Bitte komplett einfügen.'; render(); return; }
  dropDemo();
  S.me = UI.setupWho; S.sync.code = code; S.sync.since = null; S.sync.err = null;
  // bereits lokal vorhandene Einträge mit hochladen
  S.sessions.forEach((s) => { S.sync.dirty['session|' + s.id] = 1; });
  S.duels.forEach((d) => { S.sync.dirty['duel|' + d.week] = 1; });
  S.sync.dirty['meta|cards'] = 1;
  persist();
  // Code in der Adresse behalten, damit „Zum Home-Bildschirm“ ihn mitnimmt
  try { history.replaceState(null, '', location.pathname + '#code=' + encodeURIComponent(code)); } catch (e) {}
  UI.setupCode = null; UI.setupErr = null; UI.tab = 'heute';
  render();
  Sync.start();
}

// ── Training-Logik ──
function newItem(id) {
  const e = EX[id]; const lv = lastVal(S.me, id);
  return { ex: id, sets: Array.from({ length: e.sets }, () => ({ v: lv, done: false })) };
}
function startSession(ids) {
  S.active[S.me] = { id: uid(), start: Date.now(), acc: 0, runSince: Date.now(), items: ids.map(newItem) };
  persist(); requestWake();
  UI.tab = 'training'; render();
}
function addExercise(id) {
  if (!EX[id] || isLocked(id, S.me)) return;
  if (!S.active[S.me]) { startSession([id]); return; }
  const a = S.active[S.me]; if (a.items.some((it) => it.ex === id)) return;
  a.items.push(newItem(id)); persist();
}
// laufende Stoppuhr beim Beenden nicht verlieren
function stopRunningSw() {
  const a = S.active[S.me]; if (!a || !UI.sw) return;
  const st = a.items[UI.sw.ei] && a.items[UI.sw.ei].sets[UI.sw.si];
  if (st) { st.v = Math.round((Date.now() - UI.sw.t0) / 1000); st.done = true; }
  UI.sw = null; persist();
}
function finish(force) {
  const a = S.active[S.me]; if (!a) return;
  stopRunningSw();
  const ms = elapsed(a); const min = ms / 60000;
  const doneSets = a.items.reduce((n, it) => n + it.sets.filter((s) => s.done).length, 0);
  if (!force && min < STRICH_MIN) {
    openSheet(`<h2>Noch ${Math.ceil(STRICH_MIN - min)} Minuten bis zum Strich</h2>
      <p style="margin:0" class="muted">Du hast ${fmtClock(ms)} Minuten trainiert und ${doneSets} ${doneSets === 1 ? 'Satz' : 'Sätze'} abgehakt. Ein Strich zählt erst ab ${STRICH_MIN} Minuten.</p>
      <button class="btn btn-lemon btn-block" data-act="close">Weitermachen</button>
      <button class="btn btn-ghost btn-block" data-act="finish-force">Ohne Strich speichern</button>
      <button class="btn btn-block" style="color:var(--warn)" data-act="discard">Training verwerfen</button>`);
    return;
  }
  // erstes echtes Training: Beispieldaten verschwinden, ab jetzt zählt es
  const wasDemo = S.demo; dropDemo();
  const hadToday = streak(S.me).today;
  const counted = min >= STRICH_MIN;
  const before = new Set(unlockedIds(S.me));
  const sess = { id: a.id, who: S.me, day: dayKey(a.start), start: a.start, durationMs: Math.round(ms), counted,
    items: a.items.filter((it) => it.sets.some((s) => s.done)).map((it) => ({ ex: it.ex, sets: it.sets.filter((s) => s.done).map((s) => ({ v: +s.v || 0, done: true })) })) };
  S.sessions.push(sess); S.active[S.me] = null;
  const fresh = unlockedIds(S.me).filter((id) => !before.has(id) && !S.seen[id]);
  fresh.forEach((id) => { S.seen[id] = true; });
  touch('session', sess.id);
  persist(); releaseWake();
  UI.sw = null; hideToast();
  const st = streak(S.me);
  const freshHtml = fresh.length ? `<div class="freshBadges">${fresh.map((id) => {
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    return `<div class="freshbadge"><span class="fbmedal">${medalSvg(true, a.team ? 'var(--lemon)' : PEOPLE[S.me].color)}</span><span><div class="t">Neuer Erfolg: ${esc(a.name)}</div><div class="muted" style="font-size:12.5px">${esc(a.reward)}</div></span></div>`;
  }).join('')}</div>` : '';
  openSheet(`<div class="win">${lemonSvg(!counted, 'lemonbig')}
      <h2 style="font-size:24px">${counted ? (hadToday ? 'Extra-Einheit gespeichert' : 'Strich verdient!') : 'Gespeichert, ohne Strich'}</h2>
      <p class="muted" style="margin:0">${fmtClock(ms)} Minuten · ${sess.items.length} ${sess.items.length === 1 ? 'Übung' : 'Übungen'} · ${doneSets} ${doneSets === 1 ? 'Satz' : 'Sätze'}</p>
      ${counted ? `<p style="margin:0;font-weight:600">Serie: ${st.cur} ${st.cur === 1 ? 'Tag' : 'Tage'} · diese Woche ${weekStrokes(S.me)} von 7</p>` : ''}
      ${freshHtml}
      ${wasDemo ? '<p class="muted small" style="margin:0">Die Beispieldaten sind jetzt weg. Ab hier zählt nur noch Echtes.</p>' : ''}
    </div><button class="btn btn-main btn-block" data-act="close-home">Zur Übersicht</button>`);
  render();
}

// Stoppuhr für Zeit-Übungen
function toggleSw(ei, si) {
  const a = S.active[S.me]; if (!a) return;
  if (UI.sw && UI.sw.ei === ei && UI.sw.si === si) {
    const secs = Math.round((Date.now() - UI.sw.t0) / 1000);
    a.items[ei].sets[si].v = secs; a.items[ei].sets[si].done = true; UI.sw = null; persist(); render(); return;
  }
  if (UI.sw) stopRunningSw();
  UI.sw = { ei, si, t0: Date.now() }; render();
}

// Toast für kurze Meldungen (siehe flash())
const $toast = document.getElementById('toast');
function hideToast() { $toast.innerHTML = ''; }

function tick() {
  const a = S.active[S.me];
  if (UI.tab === 'training' && a) {
    const ms = elapsed(a); const need = STRICH_MIN * 60000;
    const c = document.getElementById('clock'); if (c) c.textContent = fmtClock(ms);
    const fg = document.getElementById('ringfg'); if (fg) fg.setAttribute('stroke-dashoffset', String(289 * (1 - Math.min(1, ms / need))));
    const ring = document.getElementById('ring'); if (ring) ring.classList.toggle('done', ms >= need);
    const sub = document.getElementById('clocksub'); if (sub) sub.textContent = ms >= need ? 'Strich sicher' : 'noch ' + fmtClock(need - ms);
    const msg = document.getElementById('clockmsg');
    if (msg) msg.textContent = !a.runSince ? 'Pausiert. Die Zeit läuft erst weiter, wenn du fortsetzt.' : ms >= need ? 'Der Strich ist dir sicher. Alles ab jetzt ist Bonus.' : 'Die Uhr läuft. Ab 15:00 gibt es den Strich.';
    if (UI.sw) { const b = document.getElementById(`sw-${UI.sw.ei}-${UI.sw.si}`); if (b) b.textContent = 'Stopp ' + Math.round((Date.now() - UI.sw.t0) / 1000) + ' s'; }
  }
}
setInterval(tick, 500);

// Bildschirm während des Trainings anlassen (falls erlaubt)
let wake = null;
async function requestWake() { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; } }
function releaseWake() { try { wake && wake.release(); } catch (e) {} wake = null; }

// ── Ereignisse ──
document.addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-act],[data-who],[data-tab]');
  if (!t) return;
  if (t.dataset.who) { closeSheet(); S.me = t.dataset.who; UI.sw = null; persist(); render(); return; }
  const act = t.dataset.act;
  if (!act && t.dataset.tab) { UI.tab = t.dataset.tab; closeSheet(); render(); window.scrollTo(0, 0); return; }
  const a = S.active[S.me];
  const ei = +t.dataset.ei, si = +t.dataset.si;
  switch (act) {
    case 'close-scrim': if (ev.target === t) closeSheet(); break;
    case 'close': closeSheet(); refreshIfStale(); break;
    case 'close-home': closeSheet(); UI.tab = 'heute'; render(); break;
    case 'goto': closeSheet(); UI.tab = t.dataset.tab; render(); window.scrollTo(0, 0); break;
    case 'info': showInfo(t.dataset.ex); break;
    case 'start-plan': startSession(planFor(S.me)); break;
    case 'start-free': startSession([]); showPicker(); break;
    case 'picker': showPicker(); break;
    case 'pick': {
      const id = t.dataset.ex;
      const it = a && a.items.find((x) => x.ex === id);
      if (it) { if (!it.sets.some((s) => s.done)) { a.items = a.items.filter((x) => x !== it); UI.sw = null; persist(); } else flash('Hat schon erledigte Sätze, bleibt drin'); }
      else addExercise(id);
      refreshPicker(); render(); break;
    }
    case 'draw-open': showDraw(t.dataset.week, false); break;
    case 'draw': {
      const wk = t.dataset.week; if (liveDuel(wk)) { showDraw(wk, false); break; }
      const o = outcome(mondayOf(new Date(wk + 'T12:00')));
      if (!(o.kind === 'team' || (o.kind === 'win' && S.me === o.winner))) { closeSheet(); render(); break; }
      drawCard(o); showDraw(wk, true); render(); break;
    }
    case 'redraw': redrawCard(t.dataset.week); showDraw(t.dataset.week, true); render(); break;
    case 'redeem': {
      const d = duelFor(t.dataset.week); if (!d) break;
      d.redeemedAt = Date.now(); d.redeemedBy = S.me; touch('duel', d.week); persist(); render(); flash('Eingelöst. Auf in die nächste Runde!'); break;
    }
    case 'reveal': UI.reveal = UI.reveal || {}; UI.reveal[t.dataset.week] = !UI.reveal[t.dataset.week]; render(); break;
    case 'settings': showSettings(); break;
    case 'sync-now': Sync.run().then(() => { render(); if (UI.sheetMode === 'settings') showSettings(); }); break;
    case 'rewards': showRewards(); break;
    case 'reward-stage': UI.rewardStage = t.dataset.stage; refreshRewards(); break;
    case 'reward-add': {
      const ta = document.getElementById('reward-text'); const text = ta && ta.value.trim();
      if (!text) break;
      const sexy = !!(document.getElementById('reward-sexy') || {}).checked;
      addCustomCard(UI.rewardStage || '1', text, sexy);
      refreshRewards(); flash('Karte hinzugefügt'); break;
    }
    case 'share-invite': shareInvite(); break;
    case 'setup-who': UI.setupWho = t.dataset.who2; UI.setupCode = (document.getElementById('setup-code') || {}).value || ''; render(); break;
    case 'setup-new': UI.setupCode = newCode(); UI.setupErr = null; render(); break;
    case 'setup-go': finishSetup(); break;
    case 'add-from-info': addExercise(t.dataset.ex); closeSheet(); UI.tab = 'training'; render(); break;
    case 'filter': UI.filter = t.dataset.f; if (UI.sheetMode === 'pick') refreshPicker(); else render(); break;
    case 'done': {
      if (!a) break; const st = a.items[ei].sets[si];
      const inp = document.getElementById(`set-${ei}-${si}`);
      if (!st.done && (st.v === '' || st.v == null) && inp && !inp.value) { st.v = parseInt(EX[a.items[ei].ex].target, 10) || ''; }
      st.done = !st.done; persist(); render(); break;
    }
    case 'addset': if (a) { const it = a.items[ei]; it.sets.push({ v: it.sets.length ? it.sets[it.sets.length - 1].v : '', done: false }); persist(); render(); } break;
    case 'rm': if (a) { a.items.splice(ei, 1); UI.sw = null; persist(); render(); } break;
    case 'sw': toggleSw(ei, si); break;
    case 'pause': if (a) { if (a.runSince) { a.acc += Date.now() - a.runSince; a.runSince = null; releaseWake(); } else { a.runSince = Date.now(); requestWake(); } persist(); render(); } break;
    case 'finish': finish(false); break;
    case 'finish-force': closeSheet(); finish(true); break;
    case 'discard': S.active[S.me] = null; UI.sw = null; persist(); closeSheet(); hideToast(); releaseWake(); UI.tab = 'heute'; render(); break;
    case 'clear-demo': dropDemo(); persist(); closeSheet(); render(); break;
  }
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.dataset.act === 'set-sexy') { S.settings.sexy = t.checked; persist(); }
});
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.classList.contains('search')) {
    UI.q = t.value;
    if (UI.sheetMode === 'pick') refreshPicker();
    else {
      const cur = document.getElementById('exbody-list'); if (!cur) return;
      const tmp = document.createElement('div'); tmp.innerHTML = exListHtml('list'); cur.replaceWith(tmp.querySelector('#exbody-list'));
    }
    return;
  }
  if (t.dataset.act === 'setv') {
    const a = S.active[S.me]; if (!a) return;
    const it = a.items[+t.dataset.ei]; const st = it && it.sets[+t.dataset.si]; if (!st) return;
    st.v = t.value; persist();
  }
});
// Ansicht auffrischen, wenn ein neuer Tag oder die Sonntags-Abrechnung beginnt
let stamp = '';
function freshStamp() { const n = new Date(); return dayKey(n) + '|' + dayKey(dueMonday(n)); }
function refreshIfStale() {
  const s = freshStamp(); if (s === stamp) return;
  if ($ov.innerHTML || (UI.tab === 'training' && S.active[S.me])) return;
  stamp = s; render();
}
setInterval(refreshIfStale, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (S.active[S.me] && S.active[S.me].runSince) requestWake();
  refreshIfStale(); Sync.run();
});
window.addEventListener('online', () => Sync.run());

// Start: laufendes Training direkt zeigen
if (S.active[S.me]) UI.tab = 'training';
stamp = freshStamp();
render();
Sync.start();
