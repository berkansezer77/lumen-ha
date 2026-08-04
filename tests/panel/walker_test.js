const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// Odada biri varsa canlı kartın sağında oturan figür; ayardan kapatılabilir.
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
  const ids = Object.keys(panel._cfg.rooms);
  const dolu = ids[0], bos = ids[1];
  panel._st.rooms[dolu] = Object.assign({}, panel._st.rooms[dolu], { motion: true, hold: false });
  panel._st.rooms[bos] = Object.assign({}, panel._st.rooms[bos], { motion: false, hold: false });
  panel._renderStage();
  await wait(60);

  const kart = (rid) => sr.querySelector('.room[data-id="' + rid + '"]') ||
    [...sr.querySelectorAll('.room')].find(n => (n.textContent || '').includes(
      panel._rst(rid).name || rid));

  const doluKart = kart(dolu), bosKart = kart(bos);
  const gorunur = (kart) => {
    const w = kart && kart.querySelector('.mwalk');
    return !!w && !w.classList.contains('gone');
  };
  console.log('dolu odada figür:', gorunur(doluKart), '· boş odada:', gorunur(bosKart));
  if (!gorunur(doluKart)) problems.push('dolu odada yürüyen yok');
  if (gorunur(bosKart)) problems.push('boş odada yürüyen var');

  // gövde parçaları: kafa, gövde, iki kol, bacaklar
  const who = doluKart && doluKart.querySelector('.mwalk .fig .body .who');
  if (!who) problems.push('yürüyen figür yok');
  if (!doluKart.querySelector('.mwalk .fig .shadow')) problems.push('gölge yok');

  // ayardan kapatılabiliyor mu
  await panel._openSettings();
  await wait(60);
  const row = [...sr.querySelectorAll('.row')].find(r => /Odadaki insanı göster/.test(r.textContent));
  console.log('ayar satırı:', !!row);
  if (!row) problems.push('ayar satırı yok');
  else {
    const sw = row.querySelector('.sw, .toggle, [role="switch"], button');
    if (sw && sw.onclick) sw.onclick(); else panel._cfg.sitter = false;
    panel._cfg.sitter = false;
    [...sr.querySelectorAll('.ov')].forEach(o => o.remove());
    panel._renderStage();
    await wait(60);
    if (gorunur(kart(dolu))) problems.push('kapatınca da duruyor');
  }

  console.log(problems.length ? ['SORUN:'].concat(problems).join('  |  ') : 'HEPSI GECTI');
  process.exit(problems.length ? 1 : 0);
}, 320);
