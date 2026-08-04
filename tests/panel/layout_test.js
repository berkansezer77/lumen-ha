const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// Nothing on a room card may sit on top of anything else. Measured, not eyeballed.
const fs = require('fs'), { JSDOM } = require('jsdom');
const D = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom; global.window = window; global.document = window.document;
const problems = [];
window.customElements.define('ha-icon', class extends window.HTMLElement { });
window.HTMLElement.prototype.scrollIntoView = function () { };
window.eval(fs.readFileSync(fs.readdirSync(_FR)
  .filter(f => f.endsWith('.js')).map(f => (_FR + _path.sep) + f)[0], 'utf8'));
const hass = { states: D.states, entities: {}, areas: {}, devices: {},
  auth: { data: { access_token: 't' } },
  callApi: (m, u) => Promise.resolve(String(u).startsWith('history/period') ? D.history
    : u === 'lumen_ha/config' ? D.config_res : u === 'lumen_ha/state' ? D.state
      : u === 'lumen_ha/insight' ? { health: [], usage: { rooms: {}, series: {} }, notify_services: [] }
        : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true }) };
const panel = document.createElement('lumen-panel');
document.body.appendChild(panel); panel.hass = hass;
setTimeout(() => {
  const sr = panel.shadowRoot;
  const card = [...sr.querySelectorAll('.stage3d .room')]
    .find(c => /Ofis/.test((c.querySelector('.rname') || {}).textContent || ''));
  const face = card.querySelector('.face.top');
  // jsdom has no layout, so read the intent instead: the order in the flow and
  // that nothing is pulled out of it on top of the text
  const kids = [...face.children].map(n => String(n.getAttribute('class') || n.tagName));
  console.log('kart icerigi sirayla:', kids.join(' -> '));
  const order = kids.map(c => c.split(' ')[0]);
  const want = ['rname', 'rmeta', 'iso-lux', 'rchips', 'rtl'];
  const got = order.filter(c => want.includes(c));
  console.log('beklenen sira:', want.join(' -> '));
  console.log('bulunan      :', got.join(' -> '));
  if (got.join() !== want.join()) problems.push('sira bozuk');

  const style = [...sr.querySelectorAll('style')].map(s => s.textContent).join('');
  const lux = style.slice(style.indexOf('.iso-lux{'), style.indexOf('}', style.indexOf('.iso-lux{')));
  console.log('.iso-lux kurali:', lux.replace(/\s+/g, ' '));
  if (/position:absolute/.test(lux)) problems.push('lux hala yazilarin uzerinde duruyor');
  if (!/flex:1 1 auto/.test(lux)) problems.push('lux akista yer kaplamiyor');

  // the two buttons keep their distance
  // the two buttons share one row at the foot of the card, never a column
  const tools = card.querySelector('.rtools');
  console.log('alet satiri:', !!tools, '| icindeki dugme:', tools ? tools.children.length : 0);
  if (!tools) problems.push('alet satiri yok');
  if (tools && tools.children.length !== 2) problems.push('dugmeler ayni satirda degil');
  if (!/\.rtools\{display:flex/.test(style)) problems.push('alet satiri yan yana degil');
  // and nothing may be yanked out of the column on top of the text
  if (/\.rgear\{[^}]*position:absolute/.test(style))
    problems.push('disli hala mutlak konumlu (o kural zaten eziliyordu)');
  // the graph is the only elastic part; the ribbon may never be squeezed away
  const luxCss = style.slice(style.indexOf('.iso-lux{'), style.indexOf('}', style.indexOf('.iso-lux{')));
  if (!/flex:1 1 auto/.test(luxCss)) problems.push('grafik esnek degil');
  if (!/\.rname,\.rmeta,\.rchips,\.rtl,\.rtools\{flex:0 0 auto;\}/.test(style))
    problems.push('serit ve digerleri ezilmeye acik');
  console.log('serit kartta duruyor mu:', !!card.querySelector('.rtl'),
    '| grafik esnek:', /flex:1 1 auto/.test(luxCss));

  if (problems.length) { console.log('SORUN:'); problems.forEach(x => console.log('  x ' + x)); process.exit(1); }
  console.log('-> GECTI'); process.exit(0);
}, 1200);
