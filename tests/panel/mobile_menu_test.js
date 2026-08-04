const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// On a phone the menu is one control with the page's name on it.
const fs = require('fs'), { JSDOM } = require('jsdom');
const D = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom; global.window = window; global.document = window.document;
Object.defineProperty(window, 'innerWidth', { value: 420, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
const problems = [];
window.addEventListener('error', e => problems.push('error: ' + e.message));
console.error = (...a) => problems.push('console.error: ' + a.join(' '));
window.customElements.define('ha-icon', class extends window.HTMLElement { });
window.HTMLElement.prototype.scrollIntoView = function () { };
window.eval(fs.readFileSync(fs.readdirSync(_FR)
  .filter(f => f.endsWith('.js')).map(f => (_FR + _path.sep) + f)[0], 'utf8'));
const hass = { states: D.states, entities: {}, areas: {}, devices: {},
  auth: { data: { access_token: 't' } },
  callApi: (m, u) => Promise.resolve(String(u).startsWith('history/period') ? D.history
    : u === 'lumen_ha/config' ? D.config_res : u === 'lumen_ha/state' ? D.state
      : u === 'lumen_ha/insight' ? { health: [], usage: { rooms: {}, series: {}, stayed: {} }, notify_services: [] }
        : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true }) };
const panel = document.createElement('lumen-panel');
document.body.appendChild(panel); panel.hass = hass;
const txt = e => (e.textContent || '').trim();
setTimeout(async () => {
  const sr = panel.shadowRoot;
  const sel = sr.querySelector('.nav .navsel');
  console.log('acilir menu:', !!sel);
  if (!sel) problems.push('mobil menu yok');
  const labels = [...sel.options].map(o => o.textContent);
  console.log('secenekler:', labels.join(' | '));
  if (labels.length !== 6) problems.push('sayfa sayisi ' + labels.length);
  if (!labels.every(l => /[A-Za-zĞÜŞİÖÇğüşıöç]/.test(l)))
    problems.push('isimsiz secenek var');
  console.log('secili:', sel.value, '->', sel.selectedOptions[0].textContent);
  if (sel.value !== 'home') problems.push('acilista Gece Evi secili degil');
  // the buttons are still built, for the stylesheet to show on a wide screen
  console.log('dugmeler de duruyor:', sr.querySelectorAll('.nav .navb').length);
  if (sr.querySelectorAll('.nav .navb').length !== 6) problems.push('genis ekran menusu kayboldu');
  const style = [...sr.querySelectorAll('style')].map(s => s.textContent).join('');
  if (!/@media\(max-width:900px\)\{[^}]*\.nav \.navb\{display:none/.test(style.replace(/\s+/g, '')))
    console.log('(kural bicimi degismis olabilir)');
  if (!/\.navsel\{display:none/.test(style)) problems.push('menu genis ekranda da gorunur');
  // choosing a page navigates
  sel.value = 'stats'; sel.onchange();
  await new Promise(r => setTimeout(r, 400));
  console.log('istatistige gecti:', panel._page);
  if (panel._page !== 'stats') problems.push('secim sayfayi degistirmedi');
  if (problems.length) { console.log('SORUN:'); problems.forEach(x => console.log('  x ' + x)); process.exit(1); }
  console.log('-> GECTI'); process.exit(0);
}, 1200);
