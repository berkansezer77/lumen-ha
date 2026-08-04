const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// Düzenle modu: kart parmakla taşınır, genişlik kullanıcınındır.
const fs = require('fs'), { JSDOM } = require('jsdom');
const D = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom; global.window = window; global.document = window.document;
const problems = [];
window.addEventListener('error', e => problems.push('error: ' + e.message));
console.error = (...a) => problems.push('console.error: ' + a.join(' '));
window.customElements.define('ha-icon', class extends window.HTMLElement { });
window.HTMLElement.prototype.scrollIntoView = function () { };
window.HTMLCanvasElement.prototype.getContext = () => null;
window.HTMLElement.prototype.setPointerCapture = function () { };
window.HTMLElement.prototype.releasePointerCapture = function () { };
const DIR = _FR + _path.sep;
window.eval(fs.readFileSync(DIR + fs.readdirSync(DIR).filter(f => f.endsWith('.js'))[0], 'utf8'));
const hass = { states: D.states, entities: {}, areas: {}, devices: {},
  auth: { data: { access_token: 't' } },
  callApi: (m, u) => Promise.resolve(String(u).startsWith('history/period') ? []
    : u === 'lumen_ha/config' ? D.config_res : u === 'lumen_ha/state' ? D.state
      : u === 'lumen_ha/insight' ? { health: [], usage: { rooms: {}, series: {} }, notify_services: [] }
        : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true }) };
const panel = document.createElement('lumen-panel');
document.body.appendChild(panel); panel.hass = hass;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

setTimeout(async () => {
  const sr = panel.shadowRoot;

  console.log('1) tek başına kalan oda kendi genişliğinde kalır');
  const floor = panel._cfg.layout.floors[0];
  const kor = floor.rooms.find(r => r.id === 'koridor') || floor.rooms[floor.rooms.length - 1];
  kor.cw = 1;
  panel._reflow();
  const after = panel._cfg.layout.floors[0].rooms.find(r => r.id === kor.id);
  console.log('  ', kor.id, 'istenen 1 · çizilen', after.w);
  if (after.w !== 1) problems.push('genişlik gerildi: ' + after.w);

  console.log('2) düzenlerken kart parmakla taşınır');
  panel._edit = true;
  panel._render();
  await wait(80);
  const rooms = [...sr.querySelectorAll('.room')];
  console.log('   kart:', rooms.length, '· data-id:', rooms.slice(0, 3).map(n => n.dataset.id).join(','));
  if (rooms.some(n => !n.dataset.id)) problems.push('data-id yok');
  if (rooms.some(n => !n.onpointerdown)) problems.push('taşıma dinleyicisi yok');

  const a = rooms[0], b = rooms[1];
  const idA = a.dataset.id, idB = b.dataset.id;
  const onceki = panel._cfg.layout.floors[0].rooms.map(r => r.id).join(',');
  // b'nin üstüne bırak
  sr.elementFromPoint = () => b;
  a.onpointerdown({ button: 0, pointerId: 1, clientX: 10, clientY: 10, preventDefault(){} });
  a.onpointermove({ pointerId: 1, clientX: 90, clientY: 40 });
  console.log('   kaldırıldı:', a.classList.contains('lifted'), '· hedef işaretli:', b.classList.contains('picked'));
  if (!a.classList.contains('lifted')) problems.push('kart kaldırılmadı');
  if (!b.classList.contains('picked')) problems.push('hedef işaretlenmedi');
  a.onpointerup({ pointerId: 1, clientX: 90, clientY: 40 });
  await wait(60);
  const sonra = panel._cfg.layout.floors[0].rooms.map(r => r.id).join(',');
  console.log('   önce :', onceki);
  console.log('   sonra:', sonra);
  if (onceki === sonra) problems.push('yer değişmedi (' + idA + ' <-> ' + idB + ')');

  console.log('3) kısa dokunuş taşıma sayılmaz');
  const c = [...sr.querySelectorAll('.room')][0];
  const oncekiPlan = panel._cfg.layout.floors[0].rooms.map(r => r.id).join(',');
  c.onpointerdown({ button: 0, pointerId: 2, clientX: 5, clientY: 5, preventDefault(){} });
  c.onpointerup({ pointerId: 2, clientX: 6, clientY: 6 });
  if (panel._cfg.layout.floors[0].rooms.map(r => r.id).join(',') !== oncekiPlan) {
    problems.push('dokunuş planı bozdu');
  }

  console.log(problems.length ? ['SORUN:'].concat(problems).join('  |  ') : 'HEPSI GECTI');
  process.exit(problems.length ? 1 : 0);
}, 320);
