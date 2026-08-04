const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// The Night House must be its full width the moment it appears — a section
// that is widened after it is on the page slides across the screen.
const fs = require('fs'), { JSDOM } = require('jsdom');
const D = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const W = 1900;
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom; global.window = window; global.document = window.document;
Object.defineProperty(window, 'innerWidth', { value: W, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 1000, configurable: true });
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() {
  if (this.tagName === 'LUMEN-PANEL') return W - 120;
  return W - 160; }, configurable: true });
const problems = [];
window.customElements.define('ha-icon', class extends window.HTMLElement { });
window.HTMLElement.prototype.scrollIntoView = function () { };
// watch every section from the moment it is put on the page
const widths = [];
const realAppend = window.Element.prototype.appendChild;
window.Element.prototype.appendChild = function (node) {
  if (node && node.classList && node.classList.contains('sec')) {
    widths.push({ eklendigindeGenislik: node.style.width || '(yok)',
      marj: node.style.marginLeft || '(yok)' });
  }
  return realAppend.call(this, node);
};
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
setTimeout(() => {
  const sr = panel.shadowRoot;
  const house = [...sr.querySelectorAll('.sec')]
    .find(x => /Gece Evi/i.test((x.querySelector('.sec-name') || {}).textContent || ''));
  console.log('gece evi bolumu genisligi:', house && house.style.width,
    '| marj:', house && house.style.marginLeft);
  if (!house || !house.style.width) problems.push('bolum genisligi verilmemis');
  const wide = widths.filter(w => w.eklendigindeGenislik !== '(yok)');
  console.log('eklenirken genisligi verilmis bolum:', wide.length, JSON.stringify(wide));
  if (!wide.length) problems.push('genislik sayfaya eklendikten SONRA veriliyor');
  // and the transition may no longer cover width or margin
  const style = [...sr.querySelectorAll('style')].map(s => s.textContent).join('');
  const secRule = style.slice(style.indexOf('.sec{'), style.indexOf('}', style.indexOf('.sec{')));
  console.log('.sec gecisi:', (secRule.match(/transition:[^;]*/) || ['(yok)'])[0]);
  if (/transition:\s*\.?[0-9]/.test(secRule)) problems.push('gecis hala her seyi kapsiyor');
  if (typeof panel._widenSec === 'function') problems.push('_widenSec hala duruyor');
  if (problems.length) { console.log('SORUN:'); problems.forEach(x => console.log('  x ' + x)); process.exit(1); }
  console.log('-> GECTI'); process.exit(0);
}, 1200);
