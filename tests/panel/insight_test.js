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

const NOW = Math.floor(Date.now() / 1000);
const INSIGHT = {
  health: [
    { room: 'banyo', kind: 'offline', text: 'Banyo: Lamba cevrimdisi', level: 'bad' },
    { room: 'koridor', kind: 'missing', text: 'Koridor: Sensor X HA da yok', level: 'bad' },
  ],
  usage: {
    days: 30, first: '2026-07-20', watt: 9, price: 3.5,
    rooms: {
      salon: { seconds: 36000, hours: 10, bulbs: 17, kwh: 1.53, cost: 5.36 },
      ofis: { seconds: 18000, hours: 5, bulbs: 12, kwh: 0.54, cost: 1.89 },
    },
    series: {},
  },
  notify_services: ['notify.mobile_app_berkan', 'notify.persistent_notification'],
};

let posted = null, insightPost = null;
const hass = {
  states: DATA.states, entities: DATA.entities, areas: DATA.areas, devices: DATA.devices,
  auth: { data: { access_token: 't' } },
  callApi: (m, u, d) => {
    if (u === 'lumen_ha/insight' && m === 'POST') { insightPost = d; return Promise.resolve({ ok: true, sent: true, issues: 2 }); }
    if (u === 'lumen_ha/insight') return Promise.resolve(INSIGHT);
    if (u === 'lumen_ha/config' && m === 'POST') { posted = d; return Promise.resolve({ ok: true }); }
    return Promise.resolve(String(u).startsWith('history/period') ? DATA.history
      : u === 'lumen_ha/config' ? DATA.config_res
        : u === 'lumen_ha/state' ? DATA.state
          : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true });
  },
};
const panel = document.createElement('lumen-panel');
document.body.appendChild(panel); panel.hass = hass;
const sr = () => panel.shadowRoot, wait = ms => new Promise(r => setTimeout(r, ms));
const txt = e => (e.textContent || '').trim();

(async () => {
  await wait(900);
  console.log('--- ISTATISTIK ---');
  const nav = [...sr().querySelectorAll('#nav .navb')].map(txt);
  console.log(' menu            :', nav.join(' | '));
  if (!nav.some(n => /statistik/i.test(n))) problems.push('menude istatistik yok');
  panel._go('stats'); await wait(400);
  const rows = [...sr().querySelectorAll('.sl-row')];
  console.log(' satirlar        :', rows.map(r => txt(r.querySelector('.sl-n'))).join(', '));
  console.log(' ilk satir       :', [...rows[0].querySelectorAll('.sl-v')].map(txt).join('  |  '));
  console.log(' ozet            :', txt(sr().querySelector('.room-meta')));
  if (rows.length !== 2) problems.push('satir sayisi ' + rows.length);
  if (!/10/.test(txt(rows[0]))) problems.push('saat gosterilmiyor');
  // Money is gone: it was a guess (watts) multiplied by a guess (tariff)
  // presented as a bill. Hours are what the panel actually knows.
  console.log(' fiyat alani     :', sr().querySelectorAll('.nin.mini').length, '(0 olmali)');
  if (sr().querySelectorAll('.nin.mini').length) problems.push('fiyat alani duruyor');
  const page = txt(sr().querySelector('#stage'));
  if (/₺/.test(page)) problems.push('sayfada hala para birimi var');
  if (/kWh/.test(page)) problems.push('sayfada hala kWh var');

  console.log('--- AYARLAR: SAGLIK + OGRENME ---');
  await panel._openSettings(); await wait(600);
  let dlg = [...sr().querySelectorAll('.ov')].pop();
  const labels = [...dlg.querySelectorAll('.ed-l')].map(txt);
  console.log(' bolumler        :', labels.join(' | '));
  for (const need of ['Sağlık kontrolü']) {
    if (!labels.includes(need)) problems.push(need + ' yok');
  }
  // the report is a timeline now, not a stack of notes
  const notes = [...dlg.querySelectorAll('.hz-item .hz-text')].map(txt);
  console.log(' saglik satirlari:', notes.slice(0, 2).join('  //  '));
  if (notes.length < 2) problems.push('saglik sorunlari listelenmedi');
  const sel = [...dlg.querySelectorAll('select.nsel')].pop();
  console.log(' servis secenegi :', [...sel.options].map(o => o.textContent).join(', '));
  if (sel.options.length !== 3) problems.push('notify servisleri listelenmedi');
  sel.value = 'notify.mobile_app_berkan'; sel.onchange(); await wait(700);
  console.log(' secilen servis  :', panel._cfg.notify.service);
  if (panel._cfg.notify.service !== 'notify.mobile_app_berkan') problems.push('servis kaydedilmedi');

  dlg = [...sr().querySelectorAll('.ov')].pop();
  const test = [...dlg.querySelectorAll('.btn')].find(b => /gönder/i.test(txt(b)));
  console.log(' test dugmesi    :', test ? 'var' : 'YOK');
  if (!test) problems.push('test dugmesi yok');
  else {
    test.onclick(); await wait(300);
    console.log(' test istegi     :', JSON.stringify(insightPost));
    if (!insightPost || insightPost.action !== 'test_notify') problems.push('test istegi gitmedi');
  }

  // the lux "learning" was removed before release: one-sided samples cannot
  // find a threshold, so nothing of it may be left in the panel
  console.log(' ogrenme izi     :',
    dlg.querySelector('.learncard') ? 'VAR (olmamali)' : 'yok');
  if (dlg.querySelector('.learncard')) problems.push('ogrenme karti hala duruyor');
  if (/Evin öğrendikleri|What the house has learnt/i.test(dlg.textContent))
    problems.push('ogrenme basligi hala duruyor');
  if (typeof panel._learnCard === 'function') problems.push('_learnCard hala duruyor');

  if (problems.length) {
    console.log('SORUN:'); problems.forEach(x => console.log('   x ' + x)); process.exit(1);
  }
  console.log('-> GECTI'); process.exit(0);
})().catch(e => { console.log('threw:', e); process.exit(2); });
