const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// Kaydedilen ayar dosyasi geri yuklenebilmeli; yanlis dosya evi silmemeli.
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
const REPO = (_FR + _path.sep);
const PANEL = REPO + fs.readdirSync(REPO).filter(f => f.endsWith('.js'))[0];
window.eval(fs.readFileSync(PANEL, 'utf8'));
let posted = null;
const hass = { states: D.states, entities: {}, areas: {}, devices: {},
  auth: { data: { access_token: 't' } },
  callApi: (m, u, d) => {
    if (u === 'lumen_ha/config' && m === 'POST') { posted = d; return Promise.resolve({ ok: true }); }
    return Promise.resolve(String(u).startsWith('history/period') ? []
      : u === 'lumen_ha/config' ? D.config_res : u === 'lumen_ha/state' ? D.state
        : u === 'lumen_ha/insight' ? { health: [], usage: { rooms: {}, series: {} }, notify_services: [] }
          : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true });
  } };
const panel = document.createElement('lumen-panel');
document.body.appendChild(panel); panel.hass = hass;
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const dosya = (obj) => ({ text: () => Promise.resolve(JSON.stringify(obj)) });
const txt = e => (e.textContent || '').trim();

setTimeout(async () => {
  const sr = panel.shadowRoot;

  console.log('1) ayarlarda yukleme ve sorun bildirme var mi');
  await panel._openSettings();
  await wait(80);
  const btns = [...sr.querySelectorAll('.btn')].map(txt);
  console.log('   dugmeler:', btns.filter(t => /yükle|Sorun|nerede|Kaydet/i.test(t)).join(' | '));
  for (const need of ['Ayar dosyası yükle', 'Sorun bildirme sayfasını aç', 'Dosya nerede?']) {
    if (!btns.some(t => t.includes(need))) problems.push('düğme yok: ' + need);
  }
  if (!sr.querySelector('input[type=file][accept*=json]')) problems.push('dosya seçici yok');
  [...sr.querySelectorAll('.ov')].forEach(o => o.remove());

  console.log('2) gecerli dosya: onay sorulur, kabul edilince kaydedilir');
  const iyi = JSON.parse(JSON.stringify(D.config_res.config || D.config_res));
  iyi.rooms = { salon: iyi.rooms[Object.keys(iyi.rooms)[0]] };
  await panel._importConfig(dosya(iyi));
  await wait(60);
  const onay = [...sr.querySelectorAll('.ov')].pop();
  console.log('   onay metni:', onay ? txt(onay.querySelector('.ed-b') || onay).slice(0, 60) : 'YOK');
  if (!onay) problems.push('onay sorulmadı');
  else {
    const evet = [...onay.querySelectorAll('.btn')].find(b => !b.classList.contains('ghost'));
    evet.onclick();
    await wait(80);
    console.log('   gönderilen oda sayısı:', posted && Object.keys(posted.rooms || {}).length);
    if (!posted) problems.push('kaydedilmedi');
    else if (Object.keys(posted.rooms).length !== 1) problems.push('yanlış içerik gitti');
  }

  console.log('3) onay verilmezse hicbir sey degismez');
  posted = null;
  await panel._importConfig(dosya(iyi));
  await wait(60);
  const onay2 = [...sr.querySelectorAll('.ov')].pop();
  const vazgec = [...onay2.querySelectorAll('.btn.ghost')][0];
  vazgec.onclick();
  await wait(60);
  if (posted) problems.push('vazgeçince de kaydetti');

  console.log('4) yanlis dosya reddedilir');
  for (const kotu of [{ hello: 'world' }, { rooms: {} }, { config: { rooms: {} } }]) {
    posted = null;
    await panel._importConfig(dosya(kotu));
    await wait(40);
    if (posted) problems.push('çöp dosya kabul edildi: ' + JSON.stringify(kotu));
  }
  const bozuk = { text: () => Promise.resolve('{bu json degil') };
  await panel._importConfig(bozuk);
  await wait(40);
  if (posted) problems.push('bozuk json kabul edildi');
  console.log('   dördü de reddedildi');

  console.log(problems.length ? ['SORUN:'].concat(problems).join('  |  ') : 'HEPSI GECTI');
  process.exit(problems.length ? 1 : 0);
}, 320);
