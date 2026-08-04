const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// No option asks who flicked the switch any more. Two settings replace them:
// how long LUMEN keeps away after any outside touch, and when it mentions a
// light burning in an empty room.
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
setTimeout(async () => {
  const sr = panel.shadowRoot;
  const src = fs.readFileSync(fs.readdirSync(_FR)
    .filter(f => f.endsWith('.js'))
    .map(f => (_FR + _path.sep) + f)[0], 'utf8');

  // 1) the guessing is gone from the code, not just from the screen
  for (const dead of ['keep_manual_off', 'was_seen', 'manual_off_held',
                      'manual_respect', 'respect_set', 'manual_until']) {
    if (src.includes(dead)) problems.push('kalinti: ' + dead);
  }

  // 2) the room dialog says nothing about who touched what
  panel._openRoomSettings('salon');
  const dlg = [...sr.querySelectorAll('.ov')].pop();
  const rows = [...dlg.querySelectorAll('.row')].map(r => txt(r));
  const claim = rows.find(t => /dışarıdan|elle açtı|elle kapat/i.test(t));
  console.log('oda satirlari:', rows.length);
  if (claim) problems.push('hala kim yapti ayari var: ' + claim.slice(0, 40));
  dlg.remove();

  // 3) the watchdog's settings live with the other notifications
  panel._cfg.notify = { service: 'notify.telefon', enabled: true, every_h: 24,
    after_min: 5, stuck: true, stuck_min: 10 };
  panel._insight = { health: [], usage: { rooms: {}, series: {} },
    notify_services: ['notify.telefon'] };
  await panel._openSettings();
  await new Promise(r => setTimeout(r, 80));
  const all = [...sr.querySelectorAll('.row')].map(t => txt(t));
  const stuck = all.find(t => /Boş odada kalan ışık/i.test(t));
  const after = all.find(t => /Şu kadar sonra haber ver/i.test(t));
  console.log('bildirim satiri:', (stuck || 'YOK').slice(0, 50));
  console.log('sure satiri    :', (after || 'YOK').slice(0, 50));
  if (!stuck) problems.push('bos oda bildirimi satiri yok');
  if (!after) problems.push('sure satiri yok');
  // it promises a word, not a hand on the switch
  if (!/haber verir/i.test(stuck || '')) problems.push('bildirim vaadi yok');
  if (!/güreşmez/i.test(stuck || '')) problems.push('guresmeme sozu yok');

  console.log(problems.length ? ['SORUN:'].concat(problems).join('  |  ') : 'HEPSI GECTI');
  process.exit(problems.length ? 1 : 0);
}, 300);
