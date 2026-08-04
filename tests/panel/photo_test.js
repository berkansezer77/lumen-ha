const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// Oda kartında odanın kendi fotoğrafı: yüklenir, kartta görünür, ışıkla parlar.
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
  const rid = Object.keys(panel._cfg.rooms)[0];
  // Fotoğrafı testin kendisi kaldırır: örnek evde her odanın fotoğrafı var
  // ve "fotoğrafsız oda" durumu artık veriden gelmiyor.
  delete panel._cfg.rooms[rid].image;

  // 1) fotoğrafsız oda: kartta katman yok
  panel._renderStage();
  await wait(50);
  const kart = () => [...sr.querySelectorAll('.room')].find(
    n => (n.textContent || '').includes(panel._rst(rid).name || rid));
  if (kart() && kart().querySelector('.face.top .photo')) problems.push('fotoğrafsız odada katman var');

  // 2) oda ayarlarında yükleme kutusu
  panel._openRoomSettings(rid);
  await wait(60);
  const dlg = [...sr.querySelectorAll('.ov')].pop();
  const basliklar = [...dlg.querySelectorAll('.sec-name')].map(e => e.textContent.trim());
  console.log('bölümler:', basliklar.join(' | '));
  if (!basliklar.some(t => /Oda fotoğrafı/.test(t))) problems.push('fotoğraf bölümü yok');
  const slot = dlg.querySelector('.artslot');
  if (!slot) problems.push('bırakma kutusu yok');
  if (!slot || !slot.querySelector('input[type=file]')) problems.push('dosya seçici yok');
  dlg.remove();

  // 3) fotoğraf atanınca kartta görünür ve ışıkla parlar
  panel._cfg.rooms[rid].image = '/local/lumen/oda.jpg';
  panel._renderStage();
  await wait(60);
  const layer = kart() && kart().querySelector('.face.top .photo');
  console.log('katman:', layer && layer.style.backgroundImage);
  if (!layer) problems.push('fotoğraf kartta görünmedi');
  else if (!/oda\.jpg/.test(layer.style.backgroundImage)) problems.push('yanlış görsel');
  if (!kart().querySelector('.face.top.hasphoto')) problems.push('hasphoto sınıfı yok');

  // 4) tırnak/parantez içeren yol enjeksiyon yapamaz
  panel._cfg.rooms[rid].image = "/local/x.jpg');background:url('evil";
  panel._renderStage();
  await wait(50);
  const kotu = kart().querySelector('.face.top .photo').style.backgroundImage;
  console.log('temizlenmiş:', kotu);
  // kaçış karakterleri temizlendiği için tek bir url() değeri kalır: kırılamaz
  const ic = kotu.replace(/^url\(["']?|["']?\)$/g, '');
  if (/["'()\\]/.test(ic)) problems.push('kaçış karakteri geçti: ' + ic);
  if (kotu.split('url(').length > 2) problems.push('ikinci bir url() sızdı');

  console.log(problems.length ? ['SORUN:'].concat(problems).join('  |  ') : 'HEPSI GECTI');
  process.exit(problems.length ? 1 : 0);
}, 320);
