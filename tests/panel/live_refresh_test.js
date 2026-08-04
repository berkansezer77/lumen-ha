const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// Değişen sayı sahneyi yeniden kurmamalı: kart yerinde tazelenir.
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
const state = JSON.parse(JSON.stringify(D.state));
const hass = { states: D.states, entities: {}, areas: {}, devices: {},
  auth: { data: { access_token: 't' } },
  callApi: (m, u) => Promise.resolve(String(u).startsWith('history/period') ? []
    : u === 'lumen_ha/config' ? D.config_res : u === 'lumen_ha/state' ? state
      : u === 'lumen_ha/insight' ? { health: [], usage: { rooms: {}, series: {} }, notify_services: [] }
        : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true }) };
const card = document.createElement('lumen-house-card');
card.setConfig({ height: 600 });
Object.defineProperty(card, 'clientWidth', { value: 1200, configurable: true });
document.body.appendChild(card); card.hass = hass;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

setTimeout(async () => {
  const sr = card.shadowRoot;
  const rid = Object.keys(card._cfg.rooms).find(r => sr.querySelector('.room[data-rid="' + r + '"]'));
  const node = () => sr.querySelector('.room[data-rid="' + rid + '"]');
  const ilk = node();
  console.log('1) lux oynayınca sahne yeniden KURULMAZ');
  card._st.rooms[rid].lux = (card._st.rooms[rid].lux || 10) + 3;
  card._render();
  await wait(30);
  console.log('   aynı düğüm mü:', node() === ilk,
    '· orb:', node().querySelector('.luxorb .v') && node().querySelector('.luxorb .v').textContent);
  if (node() !== ilk) problems.push('lux değişince kart yeniden kuruldu');
  if (node().querySelector('.luxorb .v').textContent !== String(card._st.rooms[rid].lux)) {
    problems.push('lux yerinde güncellenmedi');
  }

  console.log('2) ışık yanınca da yeniden kurulmaz, yalnız görünüm değişir');
  card._st.rooms[rid].lit = !card._st.rooms[rid].lit;
  card._st.rooms[rid].lights_lit = card._st.rooms[rid].lit ? 3 : 0;
  card._render();
  await wait(30);
  console.log('   aynı düğüm mü:', node() === ilk, '· on sınıfı:', node().classList.contains('on'));
  if (node() !== ilk) problems.push('ışık değişince kart yeniden kuruldu');
  if (node().classList.contains('on') !== !!card._st.rooms[rid].lit) problems.push('yanık görünüm güncellenmedi');

  console.log('3) varlık değişince yürüyen adam yerinde gizlenir');
  card._st.rooms[rid].motion = false; card._st.rooms[rid].hold = false;
  card._render(); await wait(30);
  const w = node().querySelector('.mwalk');
  console.log('   figür gizli mi:', w && w.classList.contains('gone'));
  if (w && !w.classList.contains('gone')) problems.push('boş odada figür görünür kaldı');
  card._st.rooms[rid].motion = true;
  card._render(); await wait(30);
  if (w && w.classList.contains('gone')) problems.push('dolu odada figür gizli kaldı');
  if (node() !== ilk) problems.push('varlık değişince kart yeniden kuruldu');

  console.log('4) oda eklenince YENİDEN kurulur (yapı değişti)');
  card._cfg.rooms['yeni_oda'] = JSON.parse(JSON.stringify(card._cfg.rooms[rid]));
  card._st.rooms['yeni_oda'] = JSON.parse(JSON.stringify(card._st.rooms[rid]));
  card._render();
  await wait(60);
  console.log('   kart sayısı:', sr.querySelectorAll('.room').length);
  if (node() === ilk) problems.push('yapı değişti ama yeniden kurulmadı');

  console.log(problems.length ? ['SORUN:'].concat(problems).join('  |  ') : 'HEPSI GECTI');
  process.exit(problems.length ? 1 : 0);
}, 350);
