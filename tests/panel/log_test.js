const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
const fs = require('fs'), { JSDOM } = require('jsdom');
const DATA = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom; global.window = window; global.document = window.document;
Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
const problems = []; window.addEventListener('error', e => problems.push('error: ' + e.message));
console.error = (...a) => problems.push('console.error: ' + a.join(' '));
window.customElements.define('ha-icon', class extends window.HTMLElement { });
window.HTMLElement.prototype.scrollIntoView = function () { };
window.eval(fs.readFileSync(fs.readdirSync(_FR).filter(f=>f.endsWith('.js')).map(f=>(_FR + _path.sep)+f)[0], 'utf8'));

// a state with a detailed "on" event, an off, and a manual line in another room
const state = JSON.parse(JSON.stringify(DATA.state));
state.events = [
  {
    ts: '2026-07-31T22:04:11', room: 'salon', action: 'on',
    text: 'Salon AÇ — Akşam · son ayar',
    d: {
      sensors: [
        { n: 'Salon Sensör Motion', s: 'on', a: 2, r: 'trigger' },
        { n: 'Salon Giriş Presence', s: 'off', a: 340, r: 'trigger' },
      ],
      lights: ['Sarkıt Sol', 'Sarkıt Orta', 'Sarkıt Sağ'], more: 4, bri: 70,
    },
  },
  { ts: '2026-07-31T22:03:40', room: 'ofis', action: 'off', text: 'Ofis KAPAT — oda boşaldı' },
  { ts: '2026-07-30T23:59:59', room: 'salon', action: 'manual', text: 'Salon elle kapatıldı' },
];
const hass = {
  states: DATA.states, entities: DATA.entities, areas: DATA.areas, devices: DATA.devices,
  auth: { data: { access_token: 't' } },
  callApi: (m, u) => Promise.resolve(String(u).startsWith('history/period') ? DATA.history
    : u === 'lumen_ha/config' ? DATA.config_res : u === 'lumen_ha/state' ? state
      : u === 'lumen_ha/insight' ? { health: [], learn: {}, usage: { rooms: {}, series: {} }, notify_services: [] }
        : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true }),
};
const panel = document.createElement('lumen-panel');
document.body.appendChild(panel); panel.hass = hass;
const sr = () => panel.shadowRoot, wait = ms => new Promise(r => setTimeout(r, ms));
const txt = e => (e.textContent || '').trim();

(async () => {
  await wait(900);
  panel._go('log'); await wait(300);
  console.log('--- ZAMAN CIZGISI ---');
  const items = [...sr().querySelectorAll('.lg-item')];
  console.log(' madde sayisi   :', items.length);
  if (items.length !== 3) problems.push('madde sayisi ' + items.length);
  const days = [...sr().querySelectorAll('.lg-day')].map(txt);
  console.log(' gun ayirimlari :', days.join(' | '));
  if (days.length !== 2) problems.push('gun ayirimi ' + days.length);
  const first = items[0];
  console.log(' ilk madde      :', txt(first.querySelector('.lg-time')), '/',
    txt(first.querySelector('.lg-room')), '/', txt(first.querySelector('.lg-text')));
  if (txt(first.querySelector('.lg-time')) !== '22:04:11') problems.push('saniyeler gorunmuyor');
  console.log('--- ACILIS AYRINTISI ---');
  const chips = [...first.querySelectorAll('.lg-chip')].map(txt);
  chips.forEach(c => console.log('   sensor: ' + c));
  if (chips.length !== 2) problems.push('sensor cipleri eksik');
  if (!/2 sn önce gördü/.test(chips[0])) problems.push('gorme saniyesi yanlis: ' + chips[0]);
  if (!/görmüyordu/.test(chips[1])) problems.push('gormeyen sensor isaretlenmedi');
  if (!first.querySelector('.lg-chip.saw')) problems.push('yesil cip yok');
  if (!first.querySelector('.lg-chip.blind')) problems.push('kirmizi cip yok');
  const lights = txt(first.querySelector('.lg-lights'));
  console.log('   isiklar: ' + lights);
  if (!/Sarkıt Sol.*\+4.*%70/.test(lights)) problems.push('isik listesi eksik: ' + lights);
  const second = items[1];
  if (second.querySelector('.lg-chip')) problems.push('ayrintisiz olaya cip cizildi');

  console.log('--- ODA FILTRESI ---');
  const sel = sr().querySelector('.stage-h .nsel');
  const opts = [...sel.options].map(o => o.textContent);
  console.log(' secenekler     :', opts.join(', '));
  if (opts[0] !== 'Hepsi') problems.push('Hepsi yok');
  if (!opts.includes('Salon') || !opts.includes('Ofis')) problems.push('odalar listede degil');
  // rooms come from config: dropping one must drop the option
  const n0 = opts.length;
  const kept = panel._cfg.rooms.giysi;
  delete panel._cfg.rooms.giysi;
  panel._renderStage(); await wait(150);
  const opts2 = [...sr().querySelector('.stage-h .nsel').options].map(o => o.textContent);
  console.log(' oda silinince  :', n0, '->', opts2.length, '(Giysi', opts2.includes('Giysi') ? 'HALA VAR' : 'gitti', ')');
  if (opts2.includes('Giysi')) problems.push('silinen oda filtreden dusmedi');
  panel._cfg.rooms.giysi = kept;
  // filter to salon
  const sel2 = sr().querySelector('.stage-h .nsel');
  sel2.value = 'salon'; sel2.onchange(); await wait(150);
  const filtered = [...sr().querySelectorAll('.lg-item')];
  console.log(' Salon filtresi :', filtered.length, 'madde (2 olmali)');
  if (filtered.length !== 2) problems.push('filtre calismadi');
  if ([...sr().querySelectorAll('.lg-item .lg-room')].length) {
    problems.push('filtreliyken oda adi tekrarlaniyor');
  }
  // the stale filter heals itself if the room disappears
  panel._logRoom = 'olmayan_oda';
  panel._renderStage(); await wait(150);
  console.log(' bilinmeyen oda :', panel._logRoom === '' ? 'Hepsiye dustu' : 'TAKILDI');
  if (panel._logRoom !== '') problems.push('gecersiz filtre temizlenmedi');

  if (problems.length) {
    console.log('SORUN:'); problems.forEach(x => console.log('   x ' + x)); process.exit(1);
  }
  console.log('-> GECTI'); process.exit(0);
})().catch(e => { console.log('threw:', e); process.exit(2); });
