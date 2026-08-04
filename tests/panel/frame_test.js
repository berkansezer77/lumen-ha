const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// The frame never moves. That is the whole point of it.
const fs = require('fs'), { JSDOM } = require('jsdom');
const D = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const W = 1900, H = 1000;
const dom = new JSDOM('<!doctype html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom; global.window = window; global.document = window.document;
Object.defineProperty(window, 'innerWidth', { value: W, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: H, configurable: true });
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() {
  if (this.tagName === 'LUMEN-PANEL') return W - 120;
  if (this.classList && this.classList.contains('iso-wrap')) return this.isConnected ? W - 160 : 0;
  return W - 160; }, configurable: true });
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
const sr = () => panel.shadowRoot, wait = ms => new Promise(r => setTimeout(r, ms));
const P = (id, x, y, t) => ({ pointerId: id, clientX: x, clientY: y, target: t, preventDefault() { } });
const proj = (w, h, rx, rz, s) => {
  const r = d => d * Math.PI / 180;
  return (w * Math.abs(Math.sin(r(rz))) + h * Math.abs(Math.cos(r(rz)))) * Math.cos(r(rx)) * s;
};
(async () => {
  await wait(900);
  const stage = sr().querySelector('.stage3d'), iso = sr().querySelector('.iso');
  const frame = parseFloat(stage.style.height);
  const w = parseFloat(iso.style.width), h = parseFloat(iso.style.height);
  // The frame is a plain share of the screen and reads nothing from the page:
  // a frame that measured the page would change the page and be measured again.
  console.log('cerceve:', frame + 'px | ekran yuksekligi', H,
    '(%86 =', Math.round(H * 0.86) + ')');
  if (Math.abs(frame - Math.round(H * 0.86)) > 2)
    problems.push('cerceve ekranin sabit orani degil: ' + frame);
  const fitSrc = String(panel._fitStage);
  if (/getBoundingClientRect|offsetTop|scrollY|clientHeight/.test(
      fitSrc.slice(fitSrc.indexOf('const frame'), fitSrc.indexOf('const frame') + 400)))
    problems.push('cerceve hesabi sayfadan olcum aliyor');

  console.log('--- CERCEVE HICBIR SEYDE OYNAMAZ ---');
  const heights = new Set([frame]);
  for (let i = 0; i < 10; i++) {
    stage.onpointerdown(P(1, 500, 500, stage));
    stage.onpointermove(P(1, 500 + i * 30, 500 + (i % 2 ? -180 : 220), stage));
    stage.onpointerup(P(1, 0, 0, stage));
    heights.add(parseFloat(sr().querySelector('.stage3d').style.height));
    await wait(30);
  }
  for (const f of [1.6, 1.6, 0.6, 0.6, 1.6]) {
    panel._zoomBy(f);
    heights.add(parseFloat(sr().querySelector('.stage3d').style.height));
    await wait(30);
  }
  panel._render(); await wait(500);
  heights.add(parseFloat(sr().querySelector('.stage3d').style.height));
  console.log('cevirme + yakinlasma + yeniden cizim sonrasi yukseklikler:', [...heights].join(', '));
  if (heights.size !== 1) problems.push('cerceve oynadi: ' + [...heights].join(','));

  console.log('--- VARSAYILAN GORUNUM CERCEVEYE SIGAR (ODALAR YANIKKEN DE) ---');
  panel._resetCamera(); await wait(400);
  // a lit room stands off the floor, and that height lands above the plan
  for (const rid of Object.keys(panel._st.rooms)) {
    panel._st.rooms[rid] = Object.assign({}, panel._st.rooms[rid],
      { lit: true, bri: 100, lights_lit: 3 });
  }
  panel._render(); await wait(500);
  const lift = 74 * Math.sin(56 * Math.PI / 180) * panel._fitScale;
  const rest = proj(w, h, 56, -42, panel._fitScale) + lift;
  console.log('dinlenme acisinda ev (kalkma dahil):', Math.round(rest), '| cerceve', frame);
  if (rest > frame) problems.push('varsayilan gorunum tasiyor: ' + Math.round(rest));

  console.log('--- EV PANELIN TAMAMINI KULLANIR ---');
  const across = panel._stageWidth();
  console.log('panel', W - 120, '-> sahne', across, '| eski dar sutun 1104');
  if (across < W - 200) problems.push('genislik kullanilmiyor: ' + across);

  console.log('--- EGIM TAM ARALIK ---');
  // reset built a new stage and a new camera object; the old handlers point at
  // the old one, so take what is on screen now
  const live = sr().querySelector('.stage3d');
  live.onpointerdown(P(2, 0, 0, live)); live.onpointermove(P(2, 0, -3000, live));
  live.onpointerup(P(2, 0, 0, live));
  const steep = panel._camera().rx;          // yukari = diklesir (1.18.0)
  live.onpointerdown(P(3, 0, 0, live)); live.onpointermove(P(3, 0, 3000, live));
  live.onpointerup(P(3, 0, 0, live));
  const flat = panel._camera().rx;           // asagi = yatar
  console.log('en yatik', flat + '°', '| en dik', steep + '°');
  if (flat > 32 || steep !== 80) problems.push('egim araligi daraldi: ' + flat + '-' + steep);

  console.log('--- KAYDIRMA EVI KAYBETMEZ ---');
  panel._camera().tx = 1e6; panel._camera().ty = -1e6;
  panel._applyCamera(sr().querySelector('.iso'), sr().querySelector('.stage3d'));
  const cam = panel._camera();
  console.log('asiri kaydirma sonrasi tx/ty:', Math.round(cam.tx), Math.round(cam.ty));
  if (Math.abs(cam.tx) > 4000 || Math.abs(cam.ty) > 4000) problems.push('kaydirma sinirlanmadi');

  console.log('--- CTRL: SURUKLEME EVI TASIR, CEVIRMEZ ---');
  panel._resetCamera(); await wait(400);
  const st2 = sr().querySelector('.stage3d');
  const C = (id, x, y, ctrl) => ({ pointerId: id, clientX: x, clientY: y, target: st2,
    ctrlKey: !!ctrl, preventDefault() { } });
  const cam0 = Object.assign({}, panel._camera());
  st2.onpointerdown(C(7, 700, 500, true));
  for (let i = 1; i <= 6; i++) st2.onpointermove(C(7, 700, 500 + i * 25, true));
  st2.onpointerup(C(7, 700, 650, true));
  const cam1 = Object.assign({}, panel._camera());
  console.log('ctrl+surukle -> ty', Math.round(cam1.ty), '| rx', Math.round(cam1.rx),
    '(rx degismemeli)');
  if (cam1.rx !== cam0.rx) problems.push('ctrl basiliyken ev cevrildi');
  if (cam1.ty === cam0.ty) problems.push('ctrl basiliyken ev tasinmadi');
  const tyAfter = cam1.ty;
  st2.onpointerdown(C(8, 700, 500, false));
  for (let i = 1; i <= 6; i++) st2.onpointermove(C(8, 700, 500 - i * 25, false));
  st2.onpointerup(C(8, 700, 350, false));
  console.log('ctrlsiz surukle -> rx', Math.round(panel._camera().rx),
    '| ty', Math.round(panel._camera().ty), '(ty degismemeli)');
  if (panel._camera().rx === cam1.rx) problems.push('ctrlsiz surukleme cevirmedi');
  if (panel._camera().ty !== tyAfter) problems.push('ctrlsiz surukleme evi tasidi');

  if (problems.length) { console.log('SORUN:'); problems.forEach(x => console.log('   x ' + x)); process.exit(1); }
  console.log('-> GECTI'); process.exit(0);
})().catch(e => { console.log('threw:', e); process.exit(2); });
