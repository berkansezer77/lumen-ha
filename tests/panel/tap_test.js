const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// The stage captures the pointer, so a tap has to be read there. These checks
// go through the STAGE only — the way a real finger does once capture starts.
const fs = require('fs'), { JSDOM } = require('jsdom');
const D = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom; global.window = window; global.document = window.document;
Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
const problems = [];
window.addEventListener('error', e => problems.push('error: ' + e.message));
console.error = (...a) => problems.push('console.error: ' + a.join(' '));
window.customElements.define('ha-icon', class extends window.HTMLElement { });
window.HTMLElement.prototype.scrollIntoView = function () { };
window.eval(fs.readFileSync(fs.readdirSync(_FR)
  .filter(f => f.endsWith('.js')).map(f => (_FR + _path.sep) + f)[0], 'utf8'));
let posted = [];
const hass = { states: D.states, entities: {}, areas: {}, devices: {},
  auth: { data: { access_token: 't' } },
  callApi: (m, u, d) => { if (u === 'lumen_ha/action') posted.push(d);
    return Promise.resolve(String(u).startsWith('history/period') ? D.history
      : u === 'lumen_ha/config' ? D.config_res : u === 'lumen_ha/state' ? D.state
        : u === 'lumen_ha/insight' ? { health: [], usage: { rooms: {}, series: {} }, notify_services: [] }
          : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true }); } };
const panel = document.createElement('lumen-panel');
document.body.appendChild(panel); panel.hass = hass;
const sr = () => panel.shadowRoot, wait = ms => new Promise(r => setTimeout(r, ms));
const cardOf = n => [...sr().querySelectorAll('.stage3d .room')]
  .find(c => new RegExp(n).test((c.querySelector('.rname') || {}).textContent || ''));

// a finger: press on the card, maybe slide, lift — all delivered to the stage,
// because that is where capture sends them
const P = (id, x, y, t) => ({ pointerId: id, clientX: x, clientY: y, target: t,
  preventDefault() { }, stopPropagation() { } });
async function tap(name, dx, dy) {
  const stage = sr().querySelector('.stage3d');
  const card = cardOf(name);
  const t = card.querySelector('.face.top') || card;
  t.closest = (sel) => (sel.includes('.room') && !sel.includes('rgear')) ? card : null;
  stage.onpointerdown(P(9, 500, 500, t));
  if (dx || dy) stage.onpointermove(P(9, 500 + dx, 500 + dy, t));
  stage.onpointerup(P(9, 500 + (dx || 0), 500 + (dy || 0), t));
}

(async () => {
  await wait(900);
  console.log('--- TEK DOKUNUS ISIGI CEVIRIR ---');
  posted = [];
  await tap('Ofis', 0, 0);
  await wait(400);
  console.log(' gonderilen:', JSON.stringify(posted[0]), '| oda bolmesi:', !!sr().getElementById('roomdock'));
  if (!posted[0] || posted[0].room !== 'ofis') problems.push('dokunus isigi cevirmedi');
  if (posted[0] && posted[0].action !== 'room_off') problems.push('yanik oda sondurulmeliydi');
  if (sr().getElementById('roomdock')) problems.push('dokunusla bolme acildi');

  console.log('--- SURUKLEME ISIGA DOKUNMAZ ---');
  posted = [];
  await tap('Salon', 40, 30);
  await wait(400);
  console.log(' surukleme sonrasi istek:', posted.length);
  if (posted.length) problems.push('surukleme isigi cevirdi');

  console.log('--- GUNLUK DUGMESI POPUP ACAR ---');
  const diary = cardOf('Ofis').querySelector('.rlog');
  console.log(' dugme var mi:', !!diary);
  if (!diary) problems.push('gunluk dugmesi yok');
  else {
    diary.onclick({ preventDefault() { }, stopPropagation() { } });
    await wait(300);
    const dlg = [...sr().querySelectorAll('.ov')].pop();
    const rows = dlg ? dlg.querySelectorAll('.loglist > *').length : 0;
    console.log(' popup acildi:', !!dlg, '| satir:', rows);
    if (!dlg) problems.push('gunluk popup acilmadi');
    if (dlg) dlg.remove();
  }

  console.log('--- IKON ISIGI CEVIRIR ---');
  // Ilk dokunus odayi (beklemeden) sondurmus gorundu; sunucu hala yanik
  // diyor. Bu adim "yanik odaya basinca soner mi" sorusunu sordugu icin
  // durumu sunucunun dediği gibi geri koyuyoruz.
  panel._st.rooms.ofis.lit = true;
  panel._st.rooms.ofis.lights_lit = 12;
  panel._render();
  await wait(200);
  posted = [];
  const knob = cardOf('Ofis').querySelector('.rtoggle');
  console.log(' dugme var mi:', !!knob, '| yanik gorunum:', knob && knob.className);
  if (!knob) problems.push('acma dugmesi yok');
  else {
    knob.onclick({ preventDefault() { }, stopPropagation() { } });
    await wait(300);
    console.log(' gonderilen:', JSON.stringify(posted[0]));
    if (!posted[0] || posted[0].room !== 'ofis') problems.push('istek gitmedi');
    if (posted[0] && posted[0].action !== 'room_off') problems.push('yanik oda sondurulmeliydi: ' + posted[0].action);
  }
  // and pressing the switch must not open the room
  const stage = sr().querySelector('.stage3d');
  const fake = { target: { closest: (sel) => sel.includes('rtoggle') ? knob : null },
    pointerId: 5, clientX: 1, clientY: 1, preventDefault() { } };
  panel._tapRoom = 'DEGISMEDI';
  stage.onpointerdown(fake);
  console.log(' dugmeye basinca sahne devrede mi:', panel._tapRoom === 'DEGISMEDI' ? 'hayir (dogru)' : 'EVET');
  if (panel._tapRoom !== 'DEGISMEDI') problems.push('dugme sahneyi de tetikledi');

  if (problems.length) { console.log('SORUN:'); problems.forEach(x => console.log('   x ' + x)); process.exit(1); }
  console.log('-> GECTI'); process.exit(0);
})().catch(e => { console.log('threw:', e); process.exit(2); });
