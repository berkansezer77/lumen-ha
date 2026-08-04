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
Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
const problems = []; window.addEventListener('error', e => problems.push('error: ' + e.message));
console.error = (...a) => problems.push('console.error: ' + a.join(' '));
window.customElements.define('ha-icon', class extends window.HTMLElement { });
window.HTMLElement.prototype.scrollIntoView = function () { };
window.eval(fs.readFileSync(fs.readdirSync(_FR).filter(f=>f.endsWith('.js')).map(f=>(_FR + _path.sep)+f)[0], 'utf8'));

const cfg = JSON.parse(JSON.stringify(DATA.config_res));
const conf = cfg.config || cfg;
// his real plan: three columns, Antre and Salon two wide
conf.layout = { floors: [{ id: 'f1', name: '', cols: 3, rows_n: 4, rooms: [
  { id: 'banyo', x: 1, y: 0, w: 1, h: 1 }, { id: 'bedroom', x: 2, y: 0, w: 1, h: 1 },
  { id: 'antre', x: 0, y: 1, w: 2, h: 1 }, { id: 'mutfak', x: 2, y: 1, w: 1, h: 1 },
  { id: 'ofis', x: 0, y: 2, w: 1, h: 1 }, { id: 'salon', x: 1, y: 2, w: 2, h: 1 },
  { id: 'koridor', x: 1, y: 3, w: 1, h: 1 }, { id: 'giysi', x: 2, y: 3, w: 1, h: 1 },
] }] };
const hass = {
  states: DATA.states, entities: DATA.entities, areas: DATA.areas, devices: DATA.devices,
  auth: { data: { access_token: 't' } },
  callApi: (m, u) => Promise.resolve(String(u).startsWith('history/period') ? DATA.history
    : u === 'lumen_ha/config' ? cfg : u === 'lumen_ha/state' ? DATA.state
      : u === 'lumen_ha/insight' ? { health: [], learn: {}, usage: { rooms: {}, series: {} }, notify_services: [] }
        : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true }),
};
const panel = document.createElement('lumen-panel');
document.body.appendChild(panel); panel.hass = hass;
const sr = () => panel.shadowRoot, wait = ms => new Promise(r => setTimeout(r, ms));
const txt = e => (e.textContent || '').trim();
const floor = () => panel._cfg.layout.floors[0];
const wOf = id => (floor().rooms.find(r => r.id === id) || {}).w;

function holes() {
  const f = floor(), grid = [];
  for (const r of f.rooms) for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) { grid[y] = grid[y] || []; grid[y][x] = r.id; }
  let n = 0;
  for (let y = 0; y < f.rows_n; y++) for (let x = 0; x < f.cols; x++) if (!(grid[y] || [])[x]) n++;
  return n;
}
function overlaps() {
  const f = floor(), seen = {};
  let n = 0;
  for (const r of f.rooms) for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const k = y + ':' + x;
      if (seen[k]) n++; else seen[k] = r.id;
    }
  return n;
}
const cardOf = n => [...sr().querySelectorAll('.stage3d .room')]
  .find(c => new RegExp(n).test(txt(c.querySelector('.rname'))));

(async () => {
  await wait(900);
  console.log('--- BASLANGIC ---');
  console.log(' genislikler:', floor().rooms.map(r => r.id + ':' + r.w).join(', '));
  console.log(' bosluk:', holes(), '| cakisma:', overlaps());

  console.log('--- CIFT TIKLAMA ---');
  const ofis = cardOf('Ofis');
  console.log(' ofis ondblclick:', typeof ofis.ondblclick);
  if (typeof ofis.ondblclick !== 'function') problems.push('cift tiklama yok');
  for (let i = 1; i <= 4; i++) {
    cardOf('Ofis').ondblclick({ preventDefault() { }, stopPropagation() { } });
    await wait(350);
    console.log('  ' + i + '. cift tik -> ofis genisligi', wOf('ofis'),
      '| bosluk', holes(), '| cakisma', overlaps(), '| satir', floor().rows_n);
    if (overlaps()) problems.push(i + '. tiktan sonra cakisma: ' + overlaps());
    if (overlaps()) problems.push(i + '. tiktan sonra cakisma: ' + overlaps());
  }
  // the cycle is 1 -> 2 -> 3 -> 1, so four clicks from 1 land on 2
  const cw = id => (floor().rooms.find(r => r.id === id) || {}).cw;
  console.log(' dort tiktan sonra secilen genislik:', cw('ofis'), '(2 olmali)');
  if (cw('ofis') !== 2) problems.push('dongu yanlis: ' + cw('ofis'));

  console.log('--- TEK DOKUNUS ISIGI CEVIRIR, PLANA DOKUNMAZ ---');
  // Widening belongs to Düzenle now; outside it a tap is the room's switch,
  // answered at once. tap_test.js walks that gesture — here we only make sure
  // it does not move the plan.
  let toggled = 0;
  panel._toggleRoom = () => toggled++;
  const before = wOf('salon');
  const stage2 = sr().querySelector('.stage3d');
  const salon = cardOf('Salon');
  const face = salon.querySelector('.face.top') || salon;
  face.closest = (sel) => sel.includes('rgear') || sel.includes('rtoggle') || sel.includes('rlog')
    ? null : salon;
  const P2 = (x, y) => ({ pointerId: 4, clientX: x, clientY: y, target: face,
    preventDefault() { }, stopPropagation() { } });
  stage2.onpointerdown(P2(500, 500)); stage2.onpointerup(P2(500, 500));
  await wait(80);
  stage2.onpointerdown(P2(500, 500)); stage2.onpointerup(P2(500, 500));
  await wait(400);
  console.log(' iki dokunus -> isik cevrildi:', toggled, '| salon genisligi', before, '->', wOf('salon'));
  if (toggled !== 2) problems.push('dokunus isigi cevirmedi: ' + toggled);
  if (wOf('salon') !== before) problems.push('dokunus plani degistirdi');
  // and the plan is still arranged by double clicking, which edit mode allows
  cardOf('Salon').ondblclick({ preventDefault() { }, stopPropagation() { } });
  await wait(350);
  console.log(' cift tiklama -> salon', before, '->', wOf('salon'));
  if (wOf('salon') === before) problems.push('cift tiklama genisletmedi');

  console.log('--- SATIRLAR TAM DOLU ---');
  // widen several rooms and check the invariants hold every time
  for (const name of ['Banyo', 'Mutfak', 'Giysi', 'Bedroom']) {
    cardOf(name).ondblclick({ preventDefault() { }, stopPropagation() { } });
    await wait(320);
    if (overlaps()) problems.push(name + ' sonrasi cakisma: ' + overlaps());
    if (overlaps()) problems.push(name + ' sonrasi cakisma: ' + overlaps());
  }
  console.log(' son plan:');
  for (let y = 0; y < floor().rows_n; y++) {
    console.log('   satir ' + y + ': ' + floor().rooms.filter(r => r.y === y)
      .sort((a, b) => a.x - b.x)
      .map(r => r.id + '(' + r.w + (r.cw !== r.w ? '←' + r.cw : '') + ')').join(' '));
  }
  console.log(' bosluk:', holes(), '| cakisma:', overlaps(), '| sutun:', floor().cols);
  const stretched = floor().rooms.filter(r => r.cw !== r.w).length;
  console.log(' esnetilen oda:', stretched, '/', floor().rooms.length);
  if (stretched > floor().rooms.length / 2) problems.push('cok fazla oda esnetildi');
  const rowSums = {};
  for (const r of floor().rooms) rowSums[r.y] = (rowSums[r.y] || 0) + r.w;
  console.log(' satir toplamlari:', Object.values(rowSums).join(','),
    '(en fazla ' + floor().cols + ' olmali; bosluk serbest)');
  if (Object.values(rowSums).some(v => v > floor().cols)) problems.push('satir tasti');
  // ve kimsenin genisligi arkasindan degistirilmemeli
  const zorlanan = floor().rooms.filter(r => r.cw && r.w !== r.cw);
  if (zorlanan.length) problems.push('genisligi degistirilen oda: ' +
    zorlanan.map(r => r.id + ' ' + r.cw + '->' + r.w).join(', '));

  console.log('--- SAHNEDE CIFT TIKLAMA KAMERAYI SIFIRLAMIYOR ---');
  const stage = sr().querySelector('.stage3d');
  console.log(' stage.ondblclick:', typeof stage.ondblclick);
  if (typeof stage.ondblclick === 'function') problems.push('sahne cift tiklamasi duruyor');

  if (problems.length) {
    console.log('SORUN:'); problems.forEach(x => console.log('   x ' + x)); process.exit(1);
  }
  console.log('-> GECTI'); process.exit(0);
})().catch(e => { console.log('threw:', e); process.exit(2); });
