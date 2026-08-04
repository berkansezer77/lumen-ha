const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
const fs = require('fs'), { JSDOM } = require('jsdom');
const DATA = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom; global.window = window; global.document = window.document;
Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
const problems = []; window.addEventListener('error', e => problems.push('error: ' + e.message));
console.error = (...a) => problems.push('console.error: ' + a.join(' '));
window.customElements.define('ha-icon', class extends window.HTMLElement { });
window.HTMLElement.prototype.scrollIntoView = function () { };
window.eval(fs.readFileSync(fs.readdirSync(_FR).filter(f=>f.endsWith('.js')).map(f=>(_FR + _path.sep)+f)[0], 'utf8'));

const INSIGHT = {
  health: [
    { room: 'banyo', kind: 'offline', text: 'Banyo: Presence cevrimdisi', level: 'bad' },
    { room: 'koridor', kind: 'no_sensor', text: 'Koridor: hic sensor yok', level: 'warn' },
    { room: 'sokak', kind: 'no_lights', text: 'Sokak: hic isik yok', level: 'warn' },
    { room: 'sokak', kind: 'no_sensor', text: 'Sokak: hic sensor yok', level: 'warn' },
  ],
  learn: {}, usage: { days: 30, rooms: {}, series: {}, first: '', watt: 9, price: 3.5 },
  notify_services: ['notify.mobile_app_iphone'],
};
let acted = null;
const cfg = JSON.parse(JSON.stringify(DATA.config_res));
const hass = {
  states: DATA.states, entities: DATA.entities, areas: DATA.areas, devices: DATA.devices,
  auth: { data: { access_token: 't' } },
  callApi: (m, u, d) => {
    if (u === 'lumen_ha/insight' && m === 'GET') return Promise.resolve(INSIGHT);
    if (u === 'lumen_ha/action') { acted = d; return Promise.resolve({ ok: true }); }
    if (u === 'lumen_ha/config' && m === 'POST') return Promise.resolve({ ok: true });
    return Promise.resolve(String(u).startsWith('history/period') ? DATA.history
      : u === 'lumen_ha/config' ? cfg : u === 'lumen_ha/state' ? DATA.state
        : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true });
  },
};
const panel = document.createElement('lumen-panel');
document.body.appendChild(panel); panel.hass = hass;
const sr = () => panel.shadowRoot, wait = ms => new Promise(r => setTimeout(r, ms));
const txt = e => (e.textContent || '').trim();

(async () => {
  await wait(900);
  await panel._openSettings(); await wait(600);
  let dlg = [...sr().querySelectorAll('.ov')].pop();

  console.log('--- SAGLIK ZAMAN CIZGISI ---');
  const tags = [...dlg.querySelectorAll('.hz-tag')].map(txt);
  console.log(' ozet rozetleri :', tags.join(' | '));
  if (tags.length !== 2) problems.push('ozet rozetleri eksik');
  const items = [...dlg.querySelectorAll('.hz-item')];
  console.log(' madde sayisi   :', items.length);
  console.log(' siralama       :', items.map(i => i.classList.contains('bad') ? 'ciddi' : 'uyari').join(' > '));
  if (items.length !== 4) problems.push('madde sayisi ' + items.length);
  if (!items[0].classList.contains('bad')) problems.push('ciddi olan basa gelmedi');
  console.log(' ilk madde      :', txt(items[0].querySelector('.hz-room')), '/',
    txt(items[0].querySelector('.hz-kind')), '/', txt(items[0].querySelector('.hz-text')));
  if (!items.every(i => i.querySelector('.hz-dot ha-icon'))) problems.push('nokta ikonu yok');
  if (!items.every(i => i.querySelector('.hz-kind'))) problems.push('tur etiketi yok');

  console.log('--- ODA CIKARMA ---');
  // Cikarilabilir oda, testin saglik raporuna kendi koydugu oda: yukaridaki
  // 'sokak'. (Alanlardan gelmiyor — once oyle sanmistim.)
  const disAd = 'sokak';
  const drops = items.map(i => i.querySelector('.btn')).filter(Boolean);
  console.log(' cikar dugmesi  :', drops.length, 'tane (LUMEN disi alan sayisi kadar olmali)');
  if (drops.length !== 1) problems.push('cikar dugmesi sayisi ' + drops.length);
  drops[0].onclick(); await wait(250);
  const ask = [...sr().querySelectorAll('.ov')].pop();
  console.log(' onay basligi   :', txt(ask.querySelector('.ed-t')));
  if (!txt(ask.querySelector('.ed-t')).toLowerCase().includes(disAd)) problems.push('onay basligi yanlis');
  const yes = [...ask.querySelectorAll('.ed-foot .btn')].pop();
  yes.onclick(); await wait(500);
  console.log(' gonderilen     :', JSON.stringify(acted));
  if (!acted || acted.action !== 'remove_room' || acted.room !== 'sokak') {
    problems.push('remove_room gitmedi');
  }

  console.log('--- GERI ALMA ---');
  panel._cfg.skip_areas = ['sokak'];
  acted = null;
  for (const o of sr().querySelectorAll('.ov')) o.remove();
  await panel._openSettings(); await wait(600);
  dlg = [...sr().querySelectorAll('.ov')].pop();
  const labels = [...dlg.querySelectorAll('.ed-l')].map(txt);
  console.log(' bolumler       :', labels.join(' | '));
  if (!labels.includes('Oda saymadıkların')) problems.push('geri alma bolumu yok');
  const rows = [...dlg.querySelectorAll('.gpills')];
  const shelf = rows.find(r => txt(r).toLowerCase().includes(disAd));
  console.log(' listede        :', shelf ? txt(shelf) : 'YOK');
  if (!shelf) problems.push('cikarilan oda listelenmedi');
  else {
    shelf.querySelector('.dev-x').onclick({ stopPropagation() { } });
    await wait(400);
    console.log(' geri alma istegi:', JSON.stringify(acted));
    if (!acted || acted.action !== 'restore_room') problems.push('restore_room gitmedi');
  }

  console.log('--- ODA PENCERESINDE ---');
  for (const o of sr().querySelectorAll('.ov')) o.remove();
  panel._dlgRoom = null;
  panel._openRoomSettings('ofis'); await wait(300);
  const foot = sr().getElementById('roomdlg').querySelector('.ed-foot');
  console.log(' alt dugmeler   :', [...foot.querySelectorAll('.btn')].map(txt).join(' | '));
  if (!/Odayı çıkar/.test(txt(foot))) problems.push('oda penceresinde cikar dugmesi yok');

  if (problems.length) {
    console.log('SORUN:'); problems.forEach(x => console.log('   x ' + x)); process.exit(1);
  }
  console.log('-> GECTI'); process.exit(0);
})().catch(e => { console.log('threw:', e); process.exit(2); });
