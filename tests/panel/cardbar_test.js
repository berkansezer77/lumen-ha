const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// Kartın düğme şeridi: toolbar:true gerçekten bir şey yapmalı.
// (Bir sürüm boyunca ölü bir seçenekti — şerit kartta hiç kurulmuyordu.)
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
const hass = {
  states: D.states, entities: {}, areas: {}, devices: {},
  auth: { data: { access_token: 't' } },
  callApi: (m, u) => Promise.resolve(String(u).startsWith('history/period') ? []
    : u === 'lumen_ha/config' ? D.config_res : u === 'lumen_ha/state' ? D.state
      : u === 'lumen_ha/insight' ? { health: [], usage: { rooms: {}, series: {} }, notify_services: [] }
        : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true })
};
const kur = (conf) => {
  const c = document.createElement('lumen-house-card');
  c.setConfig(conf);
  Object.defineProperty(c, 'clientWidth', { value: 1100, configurable: true });
  document.body.appendChild(c); c.hass = hass;
  return c;
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));

setTimeout(async () => {
  console.log('1) toolbar:false → şerit boş (varsayılan)');
  const yok = kur({ height: 500 });
  await wait(350);
  const bosSerit = yok.shadowRoot.querySelectorAll('#cardbar button').length;
  console.log('   düğme:', bosSerit);
  if (bosSerit) problems.push('istenmediği hâlde şerit çıktı');

  console.log('2) toolbar:true → dört düğme');
  const c = kur({ height: 500, toolbar: true, turn: -20 });
  await wait(350);
  const btn = c.shadowRoot.querySelectorAll('#cardbar button');
  console.log('   düğme:', btn.length, '·',
    [...btn].map(b => b.title).join(' · '));
  if (btn.length !== 4) problems.push('şerit kurulmadı (' + btn.length + ' düğme)');

  console.log('3) Yakınlaş/uzaklaş kamerayı değiştirir');
  const z0 = c._camera().zoom;
  btn[0].onclick({ stopPropagation() { } });
  const z1 = c._camera().zoom;
  btn[1].onclick({ stopPropagation() { } });
  const z2 = c._camera().zoom;
  console.log('   zoom:', z0, '→', z1.toFixed(3), '→', z2.toFixed(3));
  if (!(z1 > z0)) problems.push('yakınlaş çalışmıyor');
  if (!(z2 < z1)) problems.push('uzaklaş çalışmıyor');

  console.log('4) Düz/izometrik düğmesi karta özel, panele bulaşmaz');
  window.localStorage.setItem('lumen_flat', '0');
  console.log('   önce düz mü:', c._flatView());
  c.shadowRoot.querySelectorAll('#cardbar button')[2]
    .onclick({ stopPropagation() { } });
  await wait(120);
  console.log('   sonra düz mü:', c._flatView(),
    '· panelin ayarı:', window.localStorage.getItem('lumen_flat'));
  if (!c._flatView()) problems.push('düz görünüme geçmedi');
  if (window.localStorage.getItem('lumen_flat') !== '0') {
    problems.push('kartın düğmesi panelin görünümünü değiştirdi');
  }
  if (!c.shadowRoot.querySelector('.flatview')) problems.push('sahne düz çizilmedi');

  console.log('5) Başa dön: YAML açısına döner (turn:-20), düz iptal');
  c.shadowRoot.querySelectorAll('#cardbar button')[3]
    .onclick({ stopPropagation() { } });
  await wait(150);
  console.log('   kamera:', JSON.stringify(c._camera()), '· düz mü:', c._flatView());
  if (c._camera().rz !== -20 || c._camera().zoom !== 1) {
    problems.push('başa dön YAML açısına dönmedi');
  }
  if (c._flatView()) problems.push('başa dön düz görünümü bırakmadı');

  console.log('6) Şerit her nabızda yeniden kurulmaz (tablette titreme)');
  const ilk = c.shadowRoot.querySelector('#cardbar button');
  c._render(); c._render();
  await wait(60);
  const ayni = c.shadowRoot.querySelector('#cardbar button') === ilk;
  console.log('   aynı düğme mi:', ayni);
  if (!ayni) problems.push('şerit her çizimde yeniden kuruluyor');

  console.log(problems.length ? '\nSORUN:\n' + problems.join('\n') : '\nTEMİZ');
  process.exit(problems.length ? 1 : 0);
}, 400);
