const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// Switching off may name its own lights; left empty it still means the room.
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
const txt = e => (e.textContent || '').trim();
setTimeout(() => {
  const rule = panel._cfg.rooms.salon.slots.evening;
  const acilisOnce = JSON.stringify(rule.picks || []);
  console.log('once  off_picks:', JSON.stringify(rule.off_picks || []));
  panel._pickLights('salon', rule, 'off');
  const sr = panel.shadowRoot;
  const dlg = [...sr.querySelectorAll('.ov')].pop();
  console.log('baslik:', txt(dlg.querySelector('.ed-t')));
  if (!/söner/i.test(txt(dlg.querySelector('.ed-t')))) problems.push('sonme basligi yok');
  const pills = [...dlg.querySelectorAll('.gpills .pick')];
  // Lamba adlari eve gore degisir; ilk uc secilebilir lambayi ornek evden al.
  const secilebilir = pills.map(x => txt(x)).filter(Boolean).slice(0, 3);
  console.log(' secilecek lambalar:', secilebilir.join(', '));
  for (const w of secilebilir) {
    const p = pills.find(x => txt(x).includes(w));
    if (!p) problems.push(w + ' bulunamadi'); else p.onclick();
  }
  [...dlg.querySelectorAll('.btn')].find(b => /Bitti|Done/i.test(txt(b))).onclick();
  setTimeout(() => {
    console.log('sonra off_picks:', JSON.stringify(rule.off_picks));
    console.log('acilis listesi bozulmadi mi:', JSON.stringify(rule.picks));
    if ((rule.off_picks || []).length !== 3) problems.push('coklu sonme secimi tutmadi');
    if (JSON.stringify(rule.picks) !== acilisOnce)
      problems.push('acilis listesi degisti!');
    // and the "off" row shows the chips
    panel._go('home');
    setTimeout(() => {
      if (problems.length) { console.log('SORUN:'); problems.forEach(x => console.log('  x ' + x)); process.exit(1); }
      console.log('-> GECTI'); process.exit(0);
    }, 400);
  }, 250);
}, 1200);
