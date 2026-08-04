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

const cfg = JSON.parse(JSON.stringify(DATA.config_res));
const conf = cfg.config || cfg;
conf.modes = [
  { key: 'normal', name: { tr: 'Normal' }, icon: 'mdi:home-outline', bri: null, kelvin: null, expire_h: 0 },
  { key: 'alone', name: { tr: 'Tek Oda' }, icon: 'mdi:map-marker', bri: null, kelvin: null, expire_h: 0, enter: {}, keep: [] },
];
const hass = {
  states: DATA.states, entities: DATA.entities, areas: DATA.areas, devices: DATA.devices,
  auth: { data: { access_token: 't' } },
  callApi: (m, u) => Promise.resolve(String(u).startsWith('history/period') ? DATA.history
    : u === 'lumen_ha/config' ? cfg : u === 'lumen_ha/state' ? DATA.state
      : u === 'lumen_ha/insight' ? { health: [], learn: {}, usage: { rooms: {}, series: {} }, notify_services: [] }
        : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true }),
};
const panel = document.createElement('lumen-panel');
document.body.appendChild(panel); panel.hass = hass;
const sr = () => panel.shadowRoot, wait = ms => new Promise(r => setTimeout(r, ms));
const txt = e => (e.textContent || '').trim();
const top = () => [...sr().querySelectorAll('.ov')].pop();

(async () => {
  await wait(900);

  console.log('--- KISA LISTE (arama yine de var) ---');
  let saved = null;
  panel._pickMany('Test', [{ key: 'a', name: 'Alfa' }, { key: 'b', name: 'Beta' }],
    ['a'], l => { saved = l; });
  await wait(120);
  let dlg = top();
  // the search box is there whatever the length: one you have to look for is
  // worse than one you can ignore
  console.log(' arama kutusu :', dlg.querySelector('input[type=search]') ? 'var (dogru)' : 'YOK');
  if (!dlg.querySelector('input[type=search]')) problems.push('kisa listede arama yok');
  const s0 = dlg.querySelector('input[type=search]');
  s0.value = 'beta'; s0.oninput();
  await wait(20);
  console.log(' "beta" suzgeci:', [...dlg.querySelectorAll('.gpills .pick')].map(txt).join(','));
  s0.value = ''; s0.oninput();
  await wait(20);
  console.log(' sayac        :', txt(dlg.querySelector('.hint')));
  let ok = [...dlg.querySelectorAll('.ed-foot .btn')].pop();
  console.log(' kaydet yazisi:', txt(ok));
  if (!/1 tanesini kaydet/.test(txt(ok))) problems.push('kaydet sayaci yanlis: ' + txt(ok));
  [...dlg.querySelectorAll('.gpills .pick')].find(p => txt(p) === 'Beta').onclick();
  await wait(20);
  console.log(' beta secince :', txt(ok), '/', txt(dlg.querySelector('.hint')));
  ok.onclick(); await wait(50);
  console.log(' kaydedilen   :', JSON.stringify(saved));
  if (!saved || saved.sort().join() !== 'a,b') problems.push('kaydetme calismadi: ' + saved);

  console.log('--- UZUN LISTE (arama var) ---');
  const many = Array.from({ length: 20 }, (_, i) =>
    ({ key: 'e' + i, name: (i % 2 ? 'Salon Sensor ' : 'Mutfak Lamba ') + i }));
  saved = null;
  panel._pickMany('Test', many, ['e3'], l => { saved = l; }, 'alt yazi');
  await wait(120);
  dlg = top();
  const search = dlg.querySelector('input[type=search]');
  console.log(' arama kutusu :', search ? 'var' : 'YOK');
  if (!search) problems.push('uzun listede arama yok');
  console.log(' alt yazi     :', txt(dlg.querySelector('.ed-s')));
  if (txt(dlg.querySelector('.ed-s')) !== 'alt yazi') problems.push('alt yazi gecmedi');
  console.log(' baslangic    :', dlg.querySelectorAll('.gpills .pick').length, 'oge');
  search.value = 'mutfak'; search.oninput();
  await wait(30);
  let shown = [...dlg.querySelectorAll('.gpills .pick')].map(txt);
  console.log(' "mutfak"     :', shown.length, 'oge |', shown.slice(0, 2).join(', '));
  if (shown.some(n => /Salon/.test(n) && !/ 3$/.test(n))) problems.push('filtre sizdirdi');
  // the already-chosen one must survive the filter
  console.log(' secili olan filtrede kaldi mi:', shown.some(n => / 3$/.test(n)) ? 'evet' : 'HAYIR');
  if (!shown.some(n => / 3$/.test(n))) problems.push('secili oge filtrede kayboldu');
  // with something chosen the list is never empty — the chosen one always shows
  search.value = 'zzzz'; search.oninput();
  await wait(30);
  let left = [...dlg.querySelectorAll('.gpills .pick')].map(txt);
  console.log(' "zzzz" (secili varken):', left.join(',') || '(bos)');
  if (left.length !== 1 || !/ 3$/.test(left[0])) problems.push('secili oge korunmadi');
  search.value = ''; search.oninput();
  await wait(30);
  const pill = [...dlg.querySelectorAll('.gpills .pick')].find(p => / 6$/.test(txt(p)));
  pill.onclick(); await wait(20);
  ok = [...dlg.querySelectorAll('.ed-foot .btn')].pop();
  console.log(' iki secili   :', txt(ok));
  ok.onclick(); await wait(50);
  console.log(' kaydedilen   :', JSON.stringify(saved));
  if (!saved || saved.length !== 2) problems.push('coklu kaydetme calismadi: ' + saved);

  console.log('--- HIC SECILI YOKKEN BOS SONUC ---');
  panel._pickMany('Test', many, [], () => { });
  await wait(120);
  const d2 = top();
  const s2 = d2.querySelector('input[type=search]');
  s2.value = 'zzzz'; s2.oninput();
  await wait(30);
  console.log(' bos sonuc    :', txt(d2.querySelector('.gpills .empty')) || 'YOK');
  if (!d2.querySelector('.gpills .empty')) problems.push('bos sonuc mesaji yok');
  console.log(' dugme        :', txt([...d2.querySelectorAll('.ed-foot .btn')].pop()));
  [...d2.querySelectorAll('.ed-foot .btn')][0].onclick();
  await wait(40);

  console.log('--- IPTAL ---');
  saved = 'DOKUNULMADI';
  panel._pickMany('Test', many, [], l => { saved = l; });
  await wait(120);
  dlg = top();
  [...dlg.querySelectorAll('.ed-foot .btn')][0].onclick();
  await wait(50);
  console.log(' iptal sonrasi:', JSON.stringify(saved));
  if (saved !== 'DOKUNULMADI') problems.push('iptal kaydetti');

  console.log('--- TEK ODA SATIRINDAN ---');
  panel._go('modes'); await wait(400);
  const card = [...sr().querySelectorAll('.mode-card')]
    .find(c => /Tek Oda/.test(txt(c.querySelector('.mc-t'))));
  const row = [...card.querySelectorAll('.al-row')]
    .find(r => /Salon/.test(txt(r.querySelector('.al-n'))));
  row.querySelector('.al-s .pick').onclick();
  await wait(150);
  dlg = top();
  console.log(' baslik       :', txt(dlg.querySelector('.ed-t')));
  console.log(' aciklama     :', txt(dlg.querySelector('.ed-s')).slice(0, 46) + '...');
  console.log(' secenekler   :', [...dlg.querySelectorAll('.gpills .pick')].map(txt).join(' | '));
  if (!txt(dlg.querySelector('.ed-s'))) problems.push('oda popupinda aciklama yok');
  const okBtn = [...dlg.querySelectorAll('.ed-foot .btn')].pop();
  console.log(' dugme        :', txt(okBtn));
  if (!/[Kk]aydet/.test(txt(okBtn))) problems.push('kaydet dugmesi yok');

  if (problems.length) {
    console.log('SORUN:'); problems.forEach(x => console.log('   x ' + x)); process.exit(1);
  }
  console.log('-> GECTI'); process.exit(0);
})().catch(e => { console.log('threw:', e); process.exit(2); });
