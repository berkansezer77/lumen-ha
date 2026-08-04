const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// custom:lumen-house-card — panelin evi, kartın içinde; mobil ve tablette.
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
  callApi: (m, u, d) => {
    if (u === 'lumen_ha/action') { posted.push(d); return Promise.resolve({ ok: true }); }
    return Promise.resolve(String(u).startsWith('history/period') ? []
      : u === 'lumen_ha/config' ? D.config_res : u === 'lumen_ha/state' ? D.state
        : u === 'lumen_ha/insight' ? { health: [], usage: { rooms: {}, series: {} }, notify_services: [] }
          : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true });
  } };
let posted = [];
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const kart = (cfg, w) => {
  const c = document.createElement('lumen-house-card');
  c.setConfig(cfg || {});
  Object.defineProperty(c, 'clientWidth', { value: w || 1200, configurable: true });
  document.body.appendChild(c);
  c.hass = hass;
  return c;
};

setTimeout(async () => {
  console.log('1) kart tanimli ve kart secicisinde gorunuyor');
  if (!window.customElements.get('lumen-house-card')) problems.push('eleman tanımlı değil');
  const kayit = (window.customCards || []).find(c => c.type === 'lumen-house-card');
  console.log('   kayıt:', kayit && kayit.name);
  if (!kayit) problems.push('customCards kaydı yok');

  console.log('2) genis kartta izometrik ev cizilir');
  const geniş = kart({ height: 640 }, 1200);
  await wait(400);
  // fixture fotoğrafsız çekilmiş; katmanın çizildiğini görmek için biri konur
  geniş._cfg.rooms[Object.keys(geniş._cfg.rooms)[0]].image = '/local/lumen/oda.jpg';
  geniş._render();
  await wait(80);
  const sr = geniş.shadowRoot;
  const iso = sr.querySelector('.iso');
  const odalar = sr.querySelectorAll('.room').length;
  console.log('   oda:', odalar, '· izometrik katman:', !!iso,
    '· sahne yüksekliği:', sr.querySelector('.stage3d') && sr.querySelector('.stage3d').style.height);
  if (!odalar) problems.push('oda çizilmedi');
  if (!iso) problems.push('izometrik katman yok');
  if (sr.querySelector('.stage3d').style.height !== '640px') problems.push('yükseklik ayara uymadı');

  console.log('3) kartin ustunde ne varsa: fotograf, serit, lux halkasi, cip, yuruyen adam');
  const parçalar = {
    'fotoğraf': '.face.top .photo', 'zaman şeridi': '.rtl, .ribbon, .rchips',
    'lux halkası': '.luxorb', 'oda araçları': '.rtools', 'ev modu şeridi': '.modestrip',
  };
  for (const [ad, sel] of Object.entries(parçalar)) {
    const var_ = sr.querySelector(sel);
    console.log('   ', ad, '->', !!var_);
    if (!var_) problems.push('eksik: ' + ad);
  }

  console.log('4) menu/gezinti yok — kart kabugu sade');
  if (sr.querySelector('#nav') || sr.querySelector('.topwrap')) problems.push('panel menüsü sızmış');
  if (sr.querySelector('.head-act') && geniş.shadowRoot.querySelector('.cardhost.withbar')) {
    problems.push('toolbar varsayılan açık');
  }

  console.log('5) dar sutunda telefon duzenine duser');
  const dar = kart({ height: 500 }, 420);
  await wait(400);
  const darSr = dar.shadowRoot;
  console.log('   dar mı:', dar._narrow(), '· kart ızgarası:', !!darSr.querySelector('.roomgrid'));
  if (!dar._narrow()) problems.push('dar sütun geniş sayıldı');
  if (!darSr.querySelector('.roomgrid')) problems.push('mobil ızgara çizilmedi');

  console.log('6) salt-okunur: dokunus isik cevirmez');
  const ro = kart({ interactive: false }, 1200);
  await wait(400);
  posted = [];
  ro._toggleRoom(Object.keys(ro._cfg.rooms)[0]);
  await wait(60);
  console.log('   giden istek:', posted.length);
  if (posted.length) problems.push('salt-okunur kartta ışık çevrildi');
  if (!ro.classList.contains('ro')) problems.push('ro sınıfı yok');

  console.log('7) etkilesimli kartta dokunus calisir');
  posted = [];
  geniş._toggleRoom(Object.keys(geniş._cfg.rooms)[0]);
  await wait(60);
  console.log('   giden istek:', posted.length);
  if (!posted.length) problems.push('etkileşimli kartta ışık çevrilmedi');

  console.log('7b) dar sutunda (telefon) karta dokunmak isigi cevirir');
  posted = [];
  const kartlar = [...dar.shadowRoot.querySelectorAll('.roomgrid .room')];
  console.log('   ızgara kartı:', kartlar.length);
  if (!kartlar.length) problems.push('ızgara kartı yok');
  else {
    kartlar[0].onclick({ currentTarget: kartlar[0], stopPropagation(){}, preventDefault(){} });
    await wait(60);
    console.log('   giden istek:', posted.length, posted[0] && posted[0].action);
    if (!posted.length) problems.push('telefonda dokunuş ışığı çevirmedi');
  }

  console.log('7c) salt-okunur kartta telefonda da dokunus yok');
  posted = [];
  const roDar = kart({ interactive: false, height: 480 }, 420);
  await wait(400);
  const roKart = roDar.shadowRoot.querySelector('.roomgrid .room');
  if (roKart) {
    roKart.onclick({ currentTarget: roKart, stopPropagation(){}, preventDefault(){} });
    await wait(60);
    if (posted.length) problems.push('salt-okunur telefonda ışık çevrildi');
  }

  console.log('8) panel hala kendi kabuguyla calisiyor');
  const panel = document.createElement('lumen-panel');
  document.body.appendChild(panel); panel.hass = hass;
  await wait(400);
  if (!panel.shadowRoot.querySelector('#nav')) problems.push('panel menüsü bozuldu');

  console.log(problems.length ? ['SORUN:'].concat(problems).join('  |  ') : 'HEPSI GECTI');
  process.exit(problems.length ? 1 : 0);
}, 300);
