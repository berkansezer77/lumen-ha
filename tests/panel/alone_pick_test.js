const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// Picking every sensor in a room must survive the save and come back ticked.
const fs = require('fs'), { JSDOM } = require('jsdom');
const DATA = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom; global.window = window; global.document = window.document;
const problems = [];
window.customElements.define('ha-icon', class extends window.HTMLElement { });
window.HTMLElement.prototype.scrollIntoView = function () { };
window.eval(fs.readFileSync(fs.readdirSync(_FR)
  .filter(f => f.endsWith('.js')).map(f => (_FR + _path.sep) + f)[0], 'utf8'));
let posted = null;
const cfg = JSON.parse(JSON.stringify(DATA.config_res));
const hass = { states: DATA.states, entities: DATA.entities, areas: DATA.areas,
  devices: DATA.devices, auth: { data: { access_token: 't' } },
  callApi: (m, u, d) => { if (u === 'lumen_ha/config' && m === 'POST') { posted = d; return Promise.resolve({ ok: true }); }
    return Promise.resolve(String(u).startsWith('history/period') ? DATA.history
      : u === 'lumen_ha/config' ? cfg : u === 'lumen_ha/state' ? DATA.state
        : u === 'lumen_ha/insight' ? { health: [], usage: { rooms: {}, series: {}, stayed: {} }, notify_services: [] }
          : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true }); } };
const panel = document.createElement('lumen-panel');
document.body.appendChild(panel); panel.hass = hass;
const sr = () => panel.shadowRoot, wait = ms => new Promise(r => setTimeout(r, ms));
const txt = e => (e && e.textContent || '').trim();
(async () => {
  await wait(900);
  // a room with two sensors, the way his bathroom has
  const room = panel._cfg.rooms.banyo;
  room.trigger = ['binary_sensor.banyo_sensor_motion'];
  room.hold = ['binary_sensor.banyo_presence_presence'];
  panel._go('modes'); await wait(600);
  const row = [...sr().querySelectorAll('.al-row')]
    .find(x => /Banyo/i.test(txt(x.querySelector('.al-n'))));
  console.log('banyo satiri  :', txt(row.querySelector('.al-s')));
  row.querySelector('.al-s .pick').onclick();
  await wait(300);
  const dlg = [...sr().querySelectorAll('.ov')].pop();
  const pills = [...dlg.querySelectorAll('.gpills .pick')];
  console.log('secenekler    :', pills.map(txt).join(' | '));
  if (pills.length !== 2) problems.push('sensor sayisi ' + pills.length);
  pills.forEach(p => p.onclick());
  [...dlg.querySelectorAll('.btn')].find(b => /Kaydet|Save|Bitti/i.test(txt(b))).onclick();
  await wait(700);
  const saved = (panel._modeCfg('alone').enter || {}).banyo;
  console.log('kaydedilen    :', JSON.stringify(saved));
  if (!saved || saved.length !== 2) problems.push('iki sensor kaydedilmedi: ' + JSON.stringify(saved));
  console.log('sunucuya giden:', JSON.stringify(((posted || {}).modes || [])
    .filter(m => m.key === 'alone').map(m => m.enter && m.enter.banyo)));
  const row2 = [...sr().querySelectorAll('.al-row')]
    .find(x => /Banyo/i.test(txt(x.querySelector('.al-n'))));
  const pill2 = row2.querySelector('.al-s .pick');
  console.log('pill          :', txt(pill2), '| vurgulu:', pill2.classList.contains('on'));
  if (!pill2.classList.contains('on')) problems.push('secim vurgulanmadi');
  pill2.onclick(); await wait(300);
  const on = [...[...sr().querySelectorAll('.ov')].pop()
    .querySelectorAll('.gpills .pick.on')].map(txt);
  console.log('yeniden acinca:', on.join(', ') || 'HICBIRI');
  if (on.length !== 2) problems.push('yeniden acinca isaretli degil: ' + on.length);
  if (problems.length) { console.log('SORUN:'); problems.forEach(x => console.log('  x ' + x)); process.exit(1); }
  console.log('-> GECTI'); process.exit(0);
})().catch(e => { console.log('threw:', e); process.exit(2); });
