/* ==================================================================
   Tidrapport – app.js
   Ren vanilla JS, inget byggsteg, ingen databas.
   All data ligger i webbläsaren (localStorage). Vill du synka mellan
   mobil och dator slår du på Netlify-synk under Inställningar – då
   speglas samma JSON via /api/sync (Netlify Blobs).

   Innehåll:
     1. Konfiguration & hjälpfunktioner (datum, format)
     2. Lagring (localStorage + valfri Netlify-synk)
     3. State, härledda beräkningar & mutationer
     4. Vyer (Registrera, Rapportera, Översikt, Inställningar)
     5. Banner, toast, navigation, uppstart
================================================================== */

// ---------- 1. Konfiguration ----------
const KLEER_URL = 'https://my.kleer.se';
const LS_DATA = 'tidrapport.data.v1';
const LS_SYNC = 'tidrapport.sync.v1';
const LS_UI = 'tidrapport.ui.v1';
const DEFAULT_CLIENT = { name: 'Riksbyggen', hourly_rate: 1260 };   // skapas vid första start
const QUICK_HOURS = [4, 6, 7.5, 8, 9, 10];
const SYNC_URL = '/api/sync';

const MONTHS = ['Januari','Februari','Mars','April','Maj','Juni','Juli','Augusti','September','Oktober','November','December'];
const MONTHS_SHORT = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
const DAYS_SHORT = ['sön','mån','tis','ons','tor','fre','lör'];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now());
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Datum – allt lagras som 'YYYY-MM-DD' (lokal tid)
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const todayStr = () => fmtDate(new Date());
const monthKey = (s) => s.slice(0, 7);                        // 'YYYY-MM'
const weekStart = (d) => addDays(d, -((d.getDay() + 6) % 7)); // måndag
function isoWeek(d) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - day);
  const yStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return { year: x.getUTCFullYear(), week: Math.ceil(((x - yStart) / 86400000 + 1) / 7) };
}
const lastWorkdayOfMonth = (y, m) => { let d = new Date(y, m + 1, 0); while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, -1); return d; };
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
const longDate = (s) => { const d = parseDate(s); return `${DAYS_SHORT[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };

const fmtHours = (h) => (Math.round(h * 100) / 100).toLocaleString('sv-SE', { maximumFractionDigits: 2 }) + ' h';
const fmtSEK = (n) => Math.round(n).toLocaleString('sv-SE') + ' kr';

// ---------- 2. Lagring ----------
/* Datamodell (en enda JSON-klump, sparas i localStorage)
   clients:  { id, name, hourly_rate, active }
   projects: { id, client_id, name, hourly_rate (null = kundens), active }
   entries:  { id, date, client_id, project_id (null ok), hours, note, reported_at }  (unik per date+client+project)
   invoices: { id, client_id, month, paid, paid_at }                                   (unik per client+month)
   updated_at: ISO-tid för senaste ändringen – används av synken
*/
const emptyData = () => ({ clients: [], projects: [], entries: [], invoices: [], updated_at: null });

function loadLocal() {
  try { return { ...emptyData(), ...JSON.parse(localStorage.getItem(LS_DATA) || '{}') }; }
  catch { return emptyData(); }
}
function saveLocal(data) {
  try { localStorage.setItem(LS_DATA, JSON.stringify(data)); }
  catch (e) { toast('Kunde inte spara lokalt: ' + e.message); }
}

const syncCfg = () => { try { return JSON.parse(localStorage.getItem(LS_SYNC) || 'null'); } catch { return null; } };
const syncOn = () => !!syncCfg()?.token;

/* Netlify-synk: hela datamängden skickas som en JSON-klump.
   Nyast vinner (updated_at avgör). Fungerar bra för en användare på
   ett par enheter – inte tänkt för samtidig redigering. */
async function syncPush(silent = true) {
  const cfg = syncCfg(); if (!cfg?.token) return;
  const res = await fetch(SYNC_URL, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}` },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Fel synknyckel' : `Synk misslyckades (${res.status})`);
  if (!silent) toast('Synkat');
}
async function syncPull() {
  const cfg = syncCfg(); if (!cfg?.token) return null;
  const res = await fetch(SYNC_URL, { headers: { authorization: `Bearer ${cfg.token}` } });
  if (!res.ok) throw new Error(res.status === 401 ? 'Fel synknyckel' : `Synk misslyckades (${res.status})`);
  return await res.json();
}
let pushTimer = null;
function schedulePush() {
  if (!syncOn()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { syncPush().catch((e) => toast(e.message)); }, 1200);
}

/** Sparar state lokalt + (om påslaget) till Netlify. Anropas efter varje ändring. */
function persist() {
  state.updated_at = new Date().toISOString();
  saveLocal(state);
  schedulePush();
}

// ---------- 3. State ----------
let state = emptyData();
let ui = Object.assign(
  { tab: 'today', date: todayStr(), clientId: null, projectId: null, defaultClientId: null, year: new Date().getFullYear() },
  JSON.parse(localStorage.getItem(LS_UI) || '{}')
);
ui.date = todayStr(); // börja alltid på idag

const saveUi = () => localStorage.setItem(LS_UI, JSON.stringify({ tab: ui.tab, clientId: ui.clientId, projectId: ui.projectId, defaultClientId: ui.defaultClientId, year: ui.year }));

const activeClients = () => state.clients.filter((c) => c.active !== false);
const clientById = (id) => state.clients.find((c) => c.id === id);
const projectById = (id) => state.projects.find((p) => p.id === id);
const projectsFor = (clientId, includeInactive = false) => state.projects.filter((p) => p.client_id === clientId && (includeInactive || p.active !== false));
const rateFor = (e) => { const p = e.project_id ? projectById(e.project_id) : null; return Number((p && p.hourly_rate != null && p.hourly_rate !== '') ? p.hourly_rate : clientById(e.client_id)?.hourly_rate || 0); };
const currentClient = () => clientById(ui.clientId) || clientById(ui.defaultClientId) || activeClients()[0] || null;
const labelFor = (e) => { const c = clientById(e.client_id)?.name ?? '?'; const p = e.project_id ? projectById(e.project_id)?.name : null; return p ? `${c} · ${p}` : c; };

const entriesFor = (pred) => state.entries.filter(pred);
const sumHours = (list) => list.reduce((s, e) => s + Number(e.hours || 0), 0);
const sumAmount = (list) => list.reduce((s, e) => s + Number(e.hours || 0) * rateFor(e), 0);
const unreported = (upTo = todayStr()) => entriesFor((e) => !e.reported_at && e.date <= upTo && Number(e.hours) > 0);

function reminder() {
  const t = new Date();
  const isFriday = t.getDay() === 5;
  const isMonthEnd = fmtDate(t) === fmtDate(lastWorkdayOfMonth(t.getFullYear(), t.getMonth()));
  const list = unreported();
  return { isFriday, isMonthEnd, due: (isFriday || isMonthEnd) && list.length > 0, hours: sumHours(list), count: list.length };
}

// ---------- Mutationer ----------
function saveEntry({ date, client_id, project_id, hours, note }) {
  hours = Number(hours); project_id = project_id || null;
  let e = state.entries.find((x) => x.date === date && x.client_id === client_id && (x.project_id || null) === project_id);
  if (hours <= 0) {
    if (e) { state.entries = state.entries.filter((x) => x.id !== e.id); persist(); toast('Post borttagen'); }
    return;
  }
  if (e) { e.hours = hours; e.note = note; }
  else state.entries.push({ id: uid(), date, client_id, project_id, hours, note, reported_at: null });
  persist();
  toast(`Sparat ${fmtHours(hours)} – ${longDate(date)}`);
}
function upsertClient(c) {
  const i = state.clients.findIndex((x) => x.id === c.id);
  if (i >= 0) state.clients[i] = c; else state.clients.push(c);
  persist();
}
function deleteClient(id) {
  state.clients = state.clients.filter((c) => c.id !== id);
  state.projects = state.projects.filter((p) => p.client_id !== id);
  state.entries = state.entries.filter((e) => e.client_id !== id);
  state.invoices = state.invoices.filter((i) => i.client_id !== id);
  persist();
}
function upsertProject(p) {
  const i = state.projects.findIndex((x) => x.id === p.id);
  if (i >= 0) state.projects[i] = p; else state.projects.push(p);
  persist();
}
function deleteProject(id) {
  state.projects = state.projects.filter((p) => p.id !== id);
  state.entries = state.entries.filter((e) => e.project_id !== id);
  persist();
}
function setInvoicePaid(client_id, month, paid) {
  let inv = state.invoices.find((i) => i.client_id === client_id && i.month === month);
  if (!inv) { inv = { id: uid(), client_id, month, paid: false, paid_at: null }; state.invoices.push(inv); }
  inv.paid = paid; inv.paid_at = paid ? new Date().toISOString() : null;
  persist();
}
function markReported(ids) {
  const ts = new Date().toISOString();
  for (const e of state.entries) if (ids.includes(e.id)) e.reported_at = ts;
  persist();
  toast(`${plural(ids.length, 'dag markerad', 'dagar markerade')} som rapporterade`);
}
function unmarkReported(ids) {
  for (const e of state.entries) if (ids.includes(e.id)) e.reported_at = null;
  persist();
}

/** Import av JSON-fil. Kunder och projekt matchas på namn så att
    inget dubbleras, och tidposternas id:n skrivs om därefter. */
function importData(data) {
  const clientMap = new Map();   // id i filen -> id i appen
  const projectMap = new Map();
  let added = 0, updated = 0;

  for (const c of data.clients ?? []) {
    const existing = state.clients.find((x) => x.name.trim().toLowerCase() === String(c.name).trim().toLowerCase());
    if (existing) clientMap.set(c.id, existing.id);
    else { const n = { ...c, id: uid(), active: c.active !== false }; state.clients.push(n); clientMap.set(c.id, n.id); }
  }
  for (const p of data.projects ?? []) {
    const cid = clientMap.get(p.client_id) ?? p.client_id;
    const existing = state.projects.find((x) => x.client_id === cid && x.name.trim().toLowerCase() === String(p.name).trim().toLowerCase());
    if (existing) projectMap.set(p.id, existing.id);
    else { const n = { ...p, id: uid(), client_id: cid, active: p.active !== false }; state.projects.push(n); projectMap.set(p.id, n.id); }
  }
  for (const e of data.entries ?? []) {
    const client_id = clientMap.get(e.client_id) ?? e.client_id;
    const project_id = e.project_id ? (projectMap.get(e.project_id) ?? e.project_id) : null;
    if (!clientById(client_id)) continue;
    const existing = state.entries.find((x) => x.date === e.date && x.client_id === client_id && (x.project_id || null) === project_id);
    if (existing) { Object.assign(existing, { hours: e.hours, note: e.note ?? existing.note, reported_at: e.reported_at ?? existing.reported_at }); updated++; }
    else { state.entries.push({ id: uid(), date: e.date, client_id, project_id, hours: Number(e.hours), note: e.note ?? '', reported_at: e.reported_at ?? null }); added++; }
  }
  for (const i of data.invoices ?? []) {
    const cid = clientMap.get(i.client_id) ?? i.client_id;
    if (!clientById(cid)) continue;
    const existing = state.invoices.find((x) => x.client_id === cid && x.month === i.month);
    if (existing) Object.assign(existing, { paid: i.paid, paid_at: i.paid_at });
    else state.invoices.push({ ...i, id: uid(), client_id: cid });
  }
  persist();
  return { added, updated };
}

// ---------- 4. Vyer ----------
function render() {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
  renderBanner();
  const v = $('#view');
  ({ today: renderToday, report: renderReport, months: renderMonths, settings: renderSettings })[ui.tab](v);
  $('#syncStatus').textContent = syncOn() ? 'Synkad' : 'Lokalt';
  $('#syncStatus').classList.toggle('online', syncOn());
}

const clientSelectHtml = (id, selected) => `<select id="${id}">${activeClients().map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
const projectSelectHtml = (id, clientId, selected) => {
  const ps = projectsFor(clientId); if (ps.length === 0) return '';
  return `<select id="${id}"><option value="">Inget projekt</option>${ps.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
};

/* --- Registrera --- */
function renderToday(v) {
  const client = currentClient();
  if (!client) { v.innerHTML = `<div class="card"><p class="eyebrow">Kom igång</p><h2>Ingen kund ännu</h2><p class="muted">Lägg till en kund under Inställningar för att börja logga timmar.</p><button class="btn primary" data-go="settings">Gå till Inställningar</button></div>`; return; }
  ui.clientId = client.id;
  const projects = projectsFor(client.id);
  if (ui.projectId && !projects.some((p) => p.id === ui.projectId)) ui.projectId = null;
  const projectId = ui.projectId || null;

  const existing = state.entries.find((e) => e.date === ui.date && e.client_id === client.id && (e.project_id || null) === projectId);
  const hours = existing ? Number(existing.hours) : 8;
  const d = parseDate(ui.date);
  const ws = weekStart(d);
  const weekDays = [...Array(7)].map((_, i) => fmtDate(addDays(ws, i)));
  const weekEntries = entriesFor((e) => e.client_id === client.id && weekDays.includes(e.date));
  const monthEntries = entriesFor((e) => e.client_id === client.id && monthKey(e.date) === monthKey(ui.date));

  v.innerHTML = `
  <div class="card stack">
    <div>
      <p class="eyebrow">${existing ? 'Ändra' : 'Registrera'}</p>
      <h2>${longDate(ui.date)}</h2>
    </div>
    <div class="${projects.length ? 'grid-2' : ''}">
      <label class="field">Kund${clientSelectHtml('clientSel', client.id)}</label>
      ${projects.length ? `<label class="field">Projekt${projectSelectHtml('projectSel', client.id, projectId)}</label>` : ''}
    </div>
    <div class="row">
      <button class="btn sm ghost" id="prevDay" aria-label="Föregående dag">‹</button>
      <input type="date" id="dateInput" value="${ui.date}" />
      <button class="btn sm ghost" id="nextDay" aria-label="Nästa dag">›</button>
      <button class="btn sm" id="todayBtn">Idag</button>
    </div>
    <div class="hours-stepper">
      <button class="btn" id="minus">−</button>
      <input type="number" id="hoursInput" step="0.5" min="0" max="24" inputmode="decimal" value="${hours}" />
      <button class="btn" id="plus">+</button>
    </div>
    <div class="chips">
      ${QUICK_HOURS.map((h) => `<button class="chip ${h === hours ? 'active' : ''}" data-h="${h}">${String(h).replace('.', ',')} h</button>`).join('')}
      <button class="chip" data-h="0">Ledig</button>
    </div>
    <label class="field">Notering (valfritt)<input id="noteInput" placeholder="t.ex. workshop, resa" value="${esc(existing?.note ?? '')}" /></label>
    <button class="btn primary block" id="saveBtn">Spara</button>
    ${existing?.reported_at ? `<div class="small muted">Rapporterad i Kleer ${new Date(existing.reported_at).toLocaleDateString('sv-SE')}. Ändringar här påverkar inte Kleer.</div>` : ''}
  </div>

  <div class="card">
    <div class="row between"><div><p class="eyebrow">${esc(client.name)}</p><h2>Vecka ${isoWeek(d).week}</h2></div><span class="muted small right">${fmtHours(sumHours(weekEntries))}<br>${fmtSEK(sumAmount(weekEntries))}</span></div>
    <div class="list">
      ${weekDays.map((ds) => {
        const dd = parseDate(ds); const es = weekEntries.filter((x) => x.date === ds);
        const total = sumHours(es);
        return `<div class="list-item ${ds === todayStr() ? 'today' : ''} ${isWeekend(dd) ? 'weekend' : ''}" data-date="${ds}" role="button">
          <div><div class="title">${longDate(ds)}</div>${es.length === 1 && (es[0].project_id || es[0].note) ? `<div class="sub">${esc([es[0].project_id ? projectById(es[0].project_id)?.name : null, es[0].note].filter(Boolean).join(' – '))}</div>` : ''}</div>
          <div class="row"><span class="value">${es.length ? fmtHours(total) : '<span class="muted">–</span>'}</span>${es.length ? (es.every((e) => e.reported_at) ? '<span class="badge ok">✓</span>' : '<span class="badge warn">ej rapp.</span>') : ''}</div>
        </div>
        ${es.length > 1 ? es.map((e) => `<div class="list-item sub-item"><div class="sub">${esc([e.project_id ? projectById(e.project_id)?.name : 'Inget projekt', e.note].filter(Boolean).join(' – '))}</div><div class="sub mono">${fmtHours(e.hours)}</div></div>`).join('') : ''}`;
      }).join('')}
    </div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="k">${MONTHS[d.getMonth()]}</div><div class="v">${fmtHours(sumHours(monthEntries))}</div></div>
    <div class="kpi"><div class="k">Att fakturera</div><div class="v">${fmtSEK(sumAmount(monthEntries))}</div></div>
    <div class="kpi"><div class="k">Ej rapporterat</div><div class="v">${fmtHours(sumHours(unreported()))}</div></div>
  </div>`;

  const hoursInput = $('#hoursInput');
  const setHours = (h) => { hoursInput.value = Math.max(0, Math.min(24, Math.round(h * 4) / 4)); $$('.chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.h) === Number(hoursInput.value))); };
  $('#minus').onclick = () => setHours(Number(hoursInput.value) - 0.5);
  $('#plus').onclick = () => setHours(Number(hoursInput.value) + 0.5);
  $$('.chip').forEach((c) => (c.onclick = () => setHours(Number(c.dataset.h))));
  $('#dateInput').onchange = (e) => { if (e.target.value) { ui.date = e.target.value; render(); } };
  $('#prevDay').onclick = () => { ui.date = fmtDate(addDays(d, -1)); render(); };
  $('#nextDay').onclick = () => { ui.date = fmtDate(addDays(d, 1)); render(); };
  $('#todayBtn').onclick = () => { ui.date = todayStr(); render(); };
  $('#clientSel').onchange = (e) => { ui.clientId = e.target.value; ui.projectId = null; saveUi(); render(); };
  $('#projectSel') && ($('#projectSel').onchange = (e) => { ui.projectId = e.target.value || null; saveUi(); render(); });
  $$('[data-date]').forEach((el) => (el.onclick = () => { ui.date = el.dataset.date; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  $('#saveBtn').onclick = () => {
    saveEntry({ date: ui.date, client_id: client.id, project_id: projectId, hours: hoursInput.value, note: $('#noteInput').value.trim() });
    render();
  };
}

/* --- Rapportera (Kleer) --- */
function renderReport(v) {
  const r = reminder();
  const list = unreported(); // t.o.m. idag
  // Gruppera per vecka + månad så att månadsbryt mitt i veckan blir egna grupper
  const groups = new Map();
  for (const e of list) {
    const d = parseDate(e.date); const w = isoWeek(d);
    const key = `${w.year}-W${pad(w.week)}-${monthKey(e.date)}`;
    if (!groups.has(key)) groups.set(key, { key, week: w.week, month: monthKey(e.date), entries: [] });
    groups.get(key).entries.push(e);
  }
  const sorted = [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
  const recent = entriesFor((e) => e.reported_at).sort((a, b) => b.reported_at.localeCompare(a.reported_at) || b.date.localeCompare(a.date)).slice(0, 10);

  v.innerHTML = `
  <div class="card stack">
    <div><p class="eyebrow">Kleer</p><h2>Rapportera timmar</h2></div>
    <p class="muted small" style="margin:0">Varje <b>fredag</b>, samt sista arbetsdagen i månaden när månadsbrytet infaller mitt i veckan: logga in i Kleer, för över timmarna nedan och markera dem sedan som rapporterade här.</p>
    <a class="btn primary block" href="${KLEER_URL}" target="_blank" rel="noopener">Öppna my.kleer.se ↗</a>
    <div class="kpis">
      <div class="kpi"><div class="k">Ej rapporterat</div><div class="v">${fmtHours(r.hours)}</div></div>
      <div class="kpi"><div class="k">Dagar</div><div class="v">${r.count}</div></div>
      <div class="kpi"><div class="k">Status</div><div class="v" style="font-size:.95rem">${r.due ? '<span style="color:var(--warn)">Dags nu</span>' : r.count ? 'Väntar' : '<span style="color:var(--ok)">Klart</span>'}</div></div>
    </div>
  </div>

  ${sorted.length === 0 ? `<div class="card"><div class="empty">Allt är rapporterat.</div></div>` : sorted.map((g) => {
    const byLabel = new Map();
    for (const e of g.entries) { const k = labelFor(e); byLabel.set(k, (byLabel.get(k) || 0) + Number(e.hours)); }
    const [y, m] = g.month.split('-').map(Number);
    return `<div class="card stack">
      <div class="row between">
        <div><p class="eyebrow">${MONTHS[m - 1]} ${y}</p><h2>Vecka ${g.week}</h2></div>
        <span class="value mono">${fmtHours(sumHours(g.entries))}</span>
      </div>
      ${(byLabel.size > 1 || state.projects.length || activeClients().length > 1) ? `<div class="chips">${[...byLabel].map(([k, h]) => `<span class="chip">${esc(k)}: ${fmtHours(h)}</span>`).join('')}</div>` : ''}
      <div class="list">
        ${g.entries.sort((a, b) => a.date.localeCompare(b.date)).map((e) => `<div class="list-item">
          <div><div class="title">${longDate(e.date)}</div><div class="sub">${esc([labelFor(e), e.note].filter(Boolean).join(' – '))}</div></div>
          <div class="value">${fmtHours(e.hours)}</div></div>`).join('')}
      </div>
      <button class="btn ok block" data-mark="${g.key}">Markera veckan som rapporterad</button>
    </div>`; }).join('')}

  ${recent.length ? `<div class="card">
    <details><summary>Senast rapporterat (${recent.length})</summary>
      <div class="list" style="margin-top:.5rem">${recent.map((e) => `<div class="list-item">
        <div><div class="title">${longDate(e.date)}</div><div class="sub">${esc(labelFor(e))} · rapporterad ${new Date(e.reported_at).toLocaleDateString('sv-SE')}</div></div>
        <div class="row"><span class="value">${fmtHours(e.hours)}</span><button class="btn sm ghost" data-unmark="${e.id}" title="Ångra">↶</button></div></div>`).join('')}</div>
    </details></div>` : ''}`;

  $$('[data-mark]').forEach((b) => (b.onclick = () => { markReported(groups.get(b.dataset.mark).entries.map((e) => e.id)); render(); }));
  $$('[data-unmark]').forEach((b) => (b.onclick = () => { unmarkReported([b.dataset.unmark]); render(); }));
}

/* --- Översikt (månader/år) --- */
function renderMonths(v) {
  const year = ui.year;
  const years = [...new Set([new Date().getFullYear(), ...state.entries.map((e) => Number(e.date.slice(0, 4)))])].sort();
  const yearEntries = entriesFor((e) => e.date.startsWith(String(year)));
  const clients = state.clients.filter((c) => yearEntries.some((e) => e.client_id === c.id) || c.active !== false);
  const multi = clients.length > 1;

  const rows = MONTHS.map((name, mi) => {
    const mk = `${year}-${pad(mi + 1)}`;
    const list = yearEntries.filter((e) => monthKey(e.date) === mk);
    return { name, mk, list, hours: sumHours(list), amount: sumAmount(list) };
  });

  v.innerHTML = `
  <div class="card stack">
    <div class="row between">
      <div><p class="eyebrow">Översikt</p><h2>${year}</h2></div>
      <div class="row">
        <button class="btn sm ghost" id="prevYear">‹</button>
        <select id="yearSel" style="width:auto">${years.map((y) => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <button class="btn sm ghost" id="nextYear">›</button>
      </div>
    </div>
    <table>
      <thead><tr><th>Månad</th><th class="num">Timmar</th><th class="num">Belopp</th><th>Faktura</th></tr></thead>
      <tbody>
        ${rows.map((r) => `<tr class="${r.hours ? '' : 'dim'}">
          <td>${r.name}</td>
          <td class="num">${r.hours ? fmtHours(r.hours) : '–'}</td>
          <td class="num">${r.hours ? fmtSEK(r.amount) : '–'}</td>
          <td>${r.hours ? clients.filter((c) => r.list.some((e) => e.client_id === c.id)).map((c) => {
            const inv = state.invoices.find((i) => i.client_id === c.id && i.month === r.mk);
            return `<label class="toggle" title="${esc(c.name)}"><input type="checkbox" data-paid="${c.id}|${r.mk}" ${inv?.paid ? 'checked' : ''}/>${multi ? esc(c.name.slice(0, 10)) : 'Betald'}</label>`;
          }).join('<br>') : ''}</td>
        </tr>
        ${multi && r.hours ? clients.filter((c) => r.list.some((e) => e.client_id === c.id)).map((c) => { const l = r.list.filter((e) => e.client_id === c.id); return `<tr class="sub"><td>${esc(c.name)}</td><td class="num">${fmtHours(sumHours(l))}</td><td class="num">${fmtSEK(sumAmount(l))}</td><td></td></tr>`; }).join('') : ''}`).join('')}
        <tr class="total"><td>Totalt ${year}</td><td class="num">${fmtHours(sumHours(yearEntries))}</td><td class="num">${fmtSEK(sumAmount(yearEntries))}</td><td></td></tr>
      </tbody>
    </table>
    <p class="muted small" style="margin:0">Belopp = timmar × timpris (per projekt om satt, annars kundens). Bocka i <i>Betald</i> när fakturan är betald.</p>
  </div>

  ${(multi || state.projects.length) ? `<div class="card">
    <p class="eyebrow">Per kund och projekt</p><h2>${year}</h2>
    <table><thead><tr><th>Kund / projekt</th><th class="num">Timmar</th><th class="num">Belopp</th></tr></thead><tbody>
      ${clients.map((c) => {
        const l = yearEntries.filter((e) => e.client_id === c.id);
        const ps = projectsFor(c.id, true).filter((p) => l.some((e) => e.project_id === p.id));
        const none = l.filter((e) => !e.project_id);
        return `<tr><td>${esc(c.name)}</td><td class="num">${fmtHours(sumHours(l))}</td><td class="num">${fmtSEK(sumAmount(l))}</td></tr>` +
          ps.map((p) => { const pl = l.filter((e) => e.project_id === p.id); return `<tr class="sub"><td>${esc(p.name)}</td><td class="num">${fmtHours(sumHours(pl))}</td><td class="num">${fmtSEK(sumAmount(pl))}</td></tr>`; }).join('') +
          (ps.length && none.length ? `<tr class="sub"><td>Inget projekt</td><td class="num">${fmtHours(sumHours(none))}</td><td class="num">${fmtSEK(sumAmount(none))}</td></tr>` : '');
      }).join('')}
    </tbody></table></div>` : ''}

  <div class="card stack">
    <p class="eyebrow">Export</p>
    <div class="row wrap">
      <button class="btn" id="csvBtn">Ladda ner CSV (${year})</button>
      <button class="btn" id="jsonBtn">Säkerhetskopia (JSON)</button>
    </div>
  </div>`;

  const setYear = (y) => { ui.year = y; saveUi(); render(); };
  $('#yearSel').onchange = (e) => setYear(Number(e.target.value));
  $('#prevYear').onclick = () => setYear(year - 1);
  $('#nextYear').onclick = () => setYear(year + 1);
  $$('[data-paid]').forEach((cb) => (cb.onchange = () => { const [cid, mk] = cb.dataset.paid.split('|'); setInvoicePaid(cid, mk, cb.checked); }));
  $('#csvBtn').onclick = () => {
    const lines = [['Datum', 'Vecka', 'Kund', 'Projekt', 'Timmar', 'Timpris', 'Belopp', 'Notering', 'Rapporterad'].join(';')];
    for (const e of [...yearEntries].sort((a, b) => a.date.localeCompare(b.date))) {
      lines.push([e.date, isoWeek(parseDate(e.date)).week, clientById(e.client_id)?.name ?? '', e.project_id ? projectById(e.project_id)?.name ?? '' : '', String(e.hours).replace('.', ','), rateFor(e), String(Math.round(e.hours * rateFor(e))), (e.note ?? '').replace(/;/g, ','), e.reported_at ? e.reported_at.slice(0, 10) : ''].join(';'));
    }
    download(`tidrapport-${year}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  };
  $('#jsonBtn').onclick = () => download(`tidrapport-backup-${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json');
}

/* --- Inställningar --- */
function renderSettings(v) {
  const defaultId = clientById(ui.defaultClientId) ? ui.defaultClientId : (activeClients()[0]?.id ?? null);
  const cfg = syncCfg() || { token: '' };

  v.innerHTML = `
  <div class="card stack">
    <div><p class="eyebrow">Inställningar</p><h2>Kunder & projekt</h2></div>
    ${state.clients.length === 0 ? '<div class="empty">Inga kunder ännu.</div>' : state.clients.map((c) => `
      <div class="client-block ${c.id === defaultId ? 'default' : ''}">
        <div class="row between">
          <div class="row">
            <button class="star ${c.id === defaultId ? 'on' : ''}" data-default="${c.id}" title="Gör till standardkund">${c.id === defaultId ? '★' : '☆'}</button>
            <div><div style="font-weight:500">${esc(c.name)} ${c.active === false ? '<span class="badge">inaktiv</span>' : ''}${c.id === defaultId ? '<span class="badge link">standard</span>' : ''}</div><div class="small muted">${fmtSEK(c.hourly_rate)}/h</div></div>
          </div>
          <div class="row"><button class="btn sm" data-edit="${c.id}">Ändra</button><button class="btn sm danger" data-del="${c.id}">Ta bort</button></div>
        </div>
        ${projectsFor(c.id, true).length ? `<div class="list">${projectsFor(c.id, true).map((p) => `<div class="list-item">
            <div><div class="title small">${esc(p.name)} ${p.active === false ? '<span class="badge">inaktiv</span>' : ''}</div><div class="sub">${p.hourly_rate != null && p.hourly_rate !== '' ? fmtSEK(p.hourly_rate) + '/h' : 'kundens timpris'}</div></div>
            <div class="row"><button class="btn sm ghost" data-pedit="${p.id}">Ändra</button><button class="btn sm ghost" data-pdel="${p.id}">✕</button></div>
          </div>`).join('')}</div>` : ''}
        <button class="btn sm link" data-padd="${c.id}" style="justify-self:start">+ Lägg till projekt</button>
      </div>`).join('')}
    <button class="btn" id="cAdd">+ Lägg till kund</button>

    <details id="clientForm">
      <summary>Kund</summary>
      <div class="stack" style="margin-top:.6rem">
        <input type="hidden" id="cId" />
        <label class="field">Namn<input id="cName" placeholder="t.ex. Riksbyggen" /></label>
        <label class="field">Timpris (kr, exkl. moms)<input id="cRate" type="number" inputmode="numeric" placeholder="1260" /></label>
        <label class="toggle"><input type="checkbox" id="cActive" checked /> Aktiv</label>
        <div class="row"><button class="btn primary" id="cSave">Spara kund</button><button class="btn ghost" id="cCancel">Avbryt</button></div>
      </div>
    </details>

    <details id="projectForm">
      <summary>Projekt</summary>
      <div class="stack" style="margin-top:.6rem">
        <input type="hidden" id="pId" /><input type="hidden" id="pClient" />
        <div class="small muted" id="pClientName"></div>
        <label class="field">Projektnamn<input id="pName" placeholder="t.ex. PRISMA integration" /></label>
        <label class="field">Eget timpris (lämna tomt för kundens)<input id="pRate" type="number" inputmode="numeric" placeholder="" /></label>
        <label class="toggle"><input type="checkbox" id="pActive" checked /> Aktiv</label>
        <div class="row"><button class="btn primary" id="pSave">Spara projekt</button><button class="btn ghost" id="pCancel">Avbryt</button></div>
      </div>
    </details>
  </div>

  <div class="card stack">
    <div><p class="eyebrow">Data</p><h2>Säkerhetskopia & import</h2></div>
    <p class="small muted" style="margin:0">All data ligger i den här webbläsaren. Ta en säkerhetskopia då och då – och innan du byter telefon.</p>
    <div class="row wrap">
      <button class="btn" id="backupBtn">Ladda ner säkerhetskopia</button>
      <label class="btn">Importera JSON<input type="file" id="importFile" accept="application/json" hidden /></label>
    </div>
    <div class="small muted">${state.entries.length} tidposter · ${state.clients.length} kunder · ${state.projects.length} projekt${state.updated_at ? ` · senast ändrad ${new Date(state.updated_at).toLocaleString('sv-SE')}` : ''}</div>
    <button class="btn danger" id="wipeBtn">Rensa all data</button>
  </div>

  <div class="card stack">
    <div><p class="eyebrow">Valfritt</p><h2>Synk mellan enheter</h2></div>
    <p class="small muted" style="margin:0">Utan synk lever datan bara i den här webbläsaren. Slår du på synk speglas allt via din Netlify-sajt (Netlify Blobs) så att mobil och dator visar samma timmar. Kräver att du satt <code>SYNC_TOKEN</code> i Netlify – se README.</p>
    <label class="field">Synknyckel<input id="syncToken" type="password" placeholder="samma värde som SYNC_TOKEN" value="${esc(cfg.token)}" autocapitalize="off" /></label>
    <div class="row wrap">
      <button class="btn primary" id="syncSave">${syncOn() ? 'Uppdatera nyckel' : 'Slå på synk'}</button>
      ${syncOn() ? '<button class="btn" id="syncNow">Synka nu</button><button class="btn ghost" id="syncOff">Stäng av</button>' : ''}
    </div>
  </div>
  <div class="footer-note">Melago AB · <a href="${KLEER_URL}" target="_blank" rel="noopener">my.kleer.se</a></div>`;

  // Kund- och projektformulär
  const cForm = $('#clientForm'), pForm = $('#projectForm');
  const openClient = (c) => { pForm.open = false; cForm.open = true; $('#cId').value = c?.id ?? ''; $('#cName').value = c?.name ?? ''; $('#cRate').value = c?.hourly_rate ?? ''; $('#cActive').checked = c ? c.active !== false : true; cForm.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#cName').focus(); };
  const openProject = (clientId, p) => { cForm.open = false; pForm.open = true; $('#pId').value = p?.id ?? ''; $('#pClient').value = clientId; $('#pClientName').textContent = 'Kund: ' + (clientById(clientId)?.name ?? ''); $('#pName').value = p?.name ?? ''; $('#pRate').value = p?.hourly_rate ?? ''; $('#pActive').checked = p ? p.active !== false : true; pForm.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#pName').focus(); };
  $('#cAdd').onclick = () => openClient(null);
  $('#cCancel').onclick = () => (cForm.open = false);
  $('#pCancel').onclick = () => (pForm.open = false);
  $$('[data-edit]').forEach((b) => (b.onclick = () => openClient(clientById(b.dataset.edit))));
  $$('[data-padd]').forEach((b) => (b.onclick = () => openProject(b.dataset.padd, null)));
  $$('[data-pedit]').forEach((b) => (b.onclick = () => { const p = projectById(b.dataset.pedit); openProject(p.client_id, p); }));
  $$('[data-default]').forEach((b) => (b.onclick = () => { ui.defaultClientId = b.dataset.default; ui.clientId = b.dataset.default; ui.projectId = null; saveUi(); render(); toast('Standardkund: ' + clientById(b.dataset.default).name); }));
  $$('[data-del]').forEach((b) => (b.onclick = () => {
    const c = clientById(b.dataset.del);
    const n = state.entries.filter((e) => e.client_id === c.id).length;
    if (!confirm(`Ta bort ${c.name}${n ? ` och ${n} tidposter` : ''}? Kan inte ångras.`)) return;
    deleteClient(c.id); if (ui.clientId === c.id) ui.clientId = null; if (ui.defaultClientId === c.id) ui.defaultClientId = null; saveUi(); render();
  }));
  $$('[data-pdel]').forEach((b) => (b.onclick = () => {
    const p = projectById(b.dataset.pdel);
    const n = state.entries.filter((e) => e.project_id === p.id).length;
    if (!confirm(`Ta bort projektet ${p.name}${n ? ` och ${n} tidposter` : ''}? Tips: avmarkera "Aktiv" istället om du vill behålla historiken.`)) return;
    deleteProject(p.id); if (ui.projectId === p.id) ui.projectId = null; saveUi(); render();
  }));
  $('#cSave').onclick = () => {
    const name = $('#cName').value.trim(); if (!name) return toast('Ange ett namn');
    const c = { id: $('#cId').value || uid(), name, hourly_rate: Number($('#cRate').value || 0), active: $('#cActive').checked };
    upsertClient(c); if (!ui.defaultClientId) ui.defaultClientId = c.id; ui.clientId = c.id; saveUi(); render(); toast('Kund sparad');
  };
  $('#pSave').onclick = () => {
    const name = $('#pName').value.trim(); if (!name) return toast('Ange ett projektnamn');
    const rate = $('#pRate').value.trim();
    upsertProject({ id: $('#pId').value || uid(), client_id: $('#pClient').value, name, hourly_rate: rate === '' ? null : Number(rate), active: $('#pActive').checked });
    render(); toast('Projekt sparat');
  };

  // Data
  $('#backupBtn').onclick = () => download(`tidrapport-backup-${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json');
  $('#importFile').onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const n = data.entries?.length ?? 0;
      if (!confirm(`Importera ${n} tidposter från ${f.name}? Kunder och projekt matchas på namn; dagar som redan finns skrivs över.`)) return;
      const res = importData(data);
      render(); toast(`Import klar: ${res.added} nya, ${res.updated} uppdaterade`);
    } catch (e) { console.error(e); toast('Kunde inte läsa filen'); }
    ev.target.value = '';
  };
  $('#wipeBtn').onclick = () => {
    if (!confirm('Rensa ALL data i den här webbläsaren? Ta en säkerhetskopia först. Kan inte ångras.')) return;
    localStorage.removeItem(LS_DATA); state = emptyData(); seedIfEmpty(); persist(); render();
  };

  // Synk
  $('#syncSave').onclick = async () => {
    const token = $('#syncToken').value.trim(); if (!token) return toast('Ange synknyckeln');
    localStorage.setItem(LS_SYNC, JSON.stringify({ token }));
    try {
      const remote = await syncPull();
      if (remote?.entries?.length && confirm(`Det finns redan ${remote.entries.length} tidposter i molnet (ändrad ${remote.updated_at ? new Date(remote.updated_at).toLocaleString('sv-SE') : 'okänt'}).\n\nOK = hämta hit dem. Avbryt = skriv över molnet med den här enhetens data.`)) {
        state = { ...emptyData(), ...remote }; saveLocal(state); toast('Hämtat från molnet');
      } else { await syncPush(false); }
      render();
    } catch (e) { toast(e.message); localStorage.removeItem(LS_SYNC); render(); }
  };
  $('#syncNow') && ($('#syncNow').onclick = async () => { try { await syncPush(false); } catch (e) { toast(e.message); } });
  $('#syncOff') && ($('#syncOff').onclick = () => { localStorage.removeItem(LS_SYNC); render(); toast('Synk avstängd – datan finns kvar lokalt'); });
}

// ---------- 5. Banner, toast, navigation ----------
function renderBanner() {
  const b = $('#banner'); const r = reminder();
  if (r.count === 0) { b.className = 'banner hidden'; return; }
  if (r.due) {
    b.className = 'banner warn';
    b.innerHTML = `<div class="grow"><strong>${r.isMonthEnd ? 'Månadsbryt – dags att rapportera' : 'Fredag – dags att rapportera'}</strong><br><span class="small">${fmtHours(r.hours)} på ${plural(r.count, 'dag', 'dagar')} väntar på att läggas in i Kleer.</span></div>
      <a class="btn sm primary" href="${KLEER_URL}" target="_blank" rel="noopener">Öppna Kleer ↗</a><button class="btn sm" data-go="report">Visa</button>`;
  } else {
    b.className = 'banner info';
    b.innerHTML = `<div class="grow small">${fmtHours(r.hours)} orapporterade sedan senaste Kleer-rapporten.</div><button class="btn sm" data-go="report">Rapportera</button>`;
  }
}

let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600); }
function download(name, content, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]'); if (go) { ui.tab = go.dataset.go; saveUi(); render(); window.scrollTo(0, 0); }
  const tab = e.target.closest('.tab'); if (tab) { ui.tab = tab.dataset.tab; saveUi(); render(); window.scrollTo(0, 0); }
});

// ---------- Uppstart ----------
function seedIfEmpty() {
  if (state.clients.length === 0) {
    const c = { id: uid(), ...DEFAULT_CLIENT, active: true };
    state.clients.push(c); ui.clientId = c.id; ui.defaultClientId = c.id; saveUi(); saveLocal(state);
  }
}

(async function main() {
  state = loadLocal();
  seedIfEmpty();
  render();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

  // Hämta nyare data från molnet om synk är påslagen
  if (syncOn()) {
    try {
      const remote = await syncPull();
      if (remote && (!state.updated_at || (remote.updated_at && remote.updated_at > state.updated_at))) {
        state = { ...emptyData(), ...remote }; saveLocal(state); render(); toast('Hämtade senaste från molnet');
      } else if (state.updated_at && (!remote || !remote.updated_at || state.updated_at > remote.updated_at)) {
        await syncPush();
      }
    } catch (e) { toast(e.message); }
  }
})();
