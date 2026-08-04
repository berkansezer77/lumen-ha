const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// A room may wear an icon its type never suggested.
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
  console.log('ofis varsayilan simge:', panel._roomIcon('ofis'));
  await panel._openRoomSettings('ofis');
  await new Promise(r => setTimeout(r, 500));
  const dlg = [...sr.querySelectorAll('.ov')].pop();
  const input = [...dlg.querySelectorAll('input.nin')].find(i => i.placeholder === 'mdi:sofa');
  console.log('yazi alani:', !!input);
  if (!input) { problems.push('simge alani yok'); }
  else {
    input.value = 'mdi:rocket-launch';
    input.onchange();
    await new Promise(r => setTimeout(r, 200));
    console.log('yazinca      :', panel._roomIcon('ofis'));
    if (panel._roomIcon('ofis') !== 'mdi:rocket-launch') problems.push('yazilan simge tutmadi');
    // the card wears it too
    const card = [...sr.querySelectorAll('.stage3d .room')]
      .find(c => /Ofis/.test(txt(c.querySelector('.rname'))));
    const worn = card.querySelector('.rtoggle ha-icon').getAttribute('icon');
    console.log('kartta       :', worn);
    if (worn !== 'mdi:rocket-launch') problems.push('kart eski simgeyi tasiyor');
    // rubbish is refused
    input.value = 'sofa'; input.onchange();
    await new Promise(r => setTimeout(r, 150));
    console.log('gecersiz ad  :', panel._roomIcon('ofis'), '(tipe donmeli)');
    if (panel._roomIcon('ofis') === 'sofa') problems.push('gecersiz ad kabul edildi');
    // the wall of examples is gone; suggestions come as you type
    const iconSec = dlg.querySelector('.icon-hints').closest('.sec') || dlg;
    console.log('simge bolumunde pill:', iconSec.querySelectorAll('.gpills .pick').length, '(0 olmali)');
    if (iconSec.querySelectorAll('.gpills .pick').length) problems.push('ornek duvari duruyor');
    // re-query: earlier steps redraw the page, so type into what is on screen
    const live = [...sr.querySelectorAll('.ov')].pop();
    const field = [...live.querySelectorAll('input.nin')].find(i => i.placeholder === 'mdi:sofa');
    field.value = 'ted';
    field.oninput();
    await new Promise(r => setTimeout(r, 150));
    const hints = [...live.querySelectorAll('.icon-hints .pick-hint')];
    console.log('oneri sayisi :', hints.length, '| ilk:', hints[0] && txt(hints[0]));
    if (!hints.length) problems.push('yazarken oneri cikmadi');
    else {
      if (!/teddy-bear/.test(txt(hints[0]))) problems.push('dogru oneri yok: ' + txt(hints[0]));
      hints[0].onclick();
      await new Promise(r => setTimeout(r, 150));
      console.log('oneriyi sec  :', panel._roomIcon('ofis'));
      if (panel._roomIcon('ofis') !== 'mdi:teddy-bear') problems.push('oneri secimi tutmadi');
    }
    // two letters is the floor: one letter must not spray the list
    const f2 = [...[...sr.querySelectorAll('.ov')].pop()
      .querySelectorAll('input.nin')].find(i => i.placeholder === 'mdi:sofa');
    f2.value = 't'; f2.oninput();
    await new Promise(r => setTimeout(r, 120));
    const few = [...sr.querySelectorAll('.ov')].pop()
      .querySelectorAll('.icon-hints .pick-hint').length;
    console.log('tek harf     :', few, '(0 olmali)');
    if (few) problems.push('tek harfte oneri cikti');
  }
  if (problems.length) { console.log('SORUN:'); problems.forEach(x => console.log('  x ' + x)); process.exit(1); }
  console.log('-> GECTI'); process.exit(0);
}, 1200);
