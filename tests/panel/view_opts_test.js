const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// Kartın görünüm seçenekleri + donmuş adam nöbeti.
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
window.HTMLCanvasElement.prototype.getContext = () => null;
const DIR = _FR + _path.sep;
const FILE = DIR + fs.readdirSync(DIR).filter(f => f.endsWith('.js'))[0];
const SRC = fs.readFileSync(FILE, 'utf8');
window.eval(SRC);

// Panelde çevrilmiş tuhaf bir açı — kart bunu paylaşmalı mı, paylaşmamalı mı?
const TUZAK = '{"rx":12,"rz":88,"zoom":2.4,"tx":300,"ty":-120}';
const hass = {
  states: D.states, entities: {}, areas: {}, devices: {},
  auth: { data: { access_token: 't' } },
  callApi: (m, u) => Promise.resolve(String(u).startsWith('history/period') ? []
    : u === 'lumen_ha/config' ? D.config_res : u === 'lumen_ha/state' ? D.state
      : u === 'lumen_ha/insight' ? { health: [], usage: { rooms: {}, series: {} }, notify_services: [] }
        : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true })
};
const kur = (conf) => {
  const c = document.createElement('lumen-house-card');
  c.setConfig(conf);
  Object.defineProperty(c, 'clientWidth', { value: 1100, configurable: true });
  document.body.appendChild(c); c.hass = hass;
  return c;
};
const wait = (ms) => new Promise(r => setTimeout(r, ms));

setTimeout(async () => {
  console.log('0) DONMUŞ ADAM NÖBETİ: az-hareket kuralı figürü gizlemeli');
  // Animasyonu kesmek adamı başladığı yerde bırakıyordu: Android'de kiosk ya da
  // pil tasarrufu açık olan her tablette kartın sol ucunda donmuş bir figür.
  const blok = /@media \(prefers-reduced-motion:reduce\)\{[^}]*\.room \.mwalk[^}]*\}/.exec(SRC);
  console.log('   kural:', blok ? blok[0].replace(/\s+/g, ' ') : 'YOK');
  if (!blok) problems.push('az-hareket kuralı kayboldu');
  else {
    if (/animation:\s*none/.test(blok[0])) problems.push('figür donduruluyor (yine takılır)');
    if (!/display:\s*none/.test(blok[0])) problems.push('figür gizlenmiyor');
    if (!/walkalways/.test(blok[0])) problems.push('walk:true kuralı geçersiz kılamıyor');
  }

  console.log('1) walk:true → gövdeye izin sınıfı');
  const w = kur({ height: 500, walk: true });
  await wait(300);
  console.log('   sınıf:', w.className || '(yok)');
  if (!w.classList.contains('walkalways')) problems.push('walk:true sınıfı koymuyor');
  const w0 = kur({ height: 500 });
  await wait(300);
  if (w0.classList.contains('walkalways')) problems.push('varsayılan sistemi dinlemiyor');

  console.log('2) isometric:false → düz görünüm');
  const d = kur({ height: 500, isometric: false });
  await wait(300);
  const duz = !!d.shadowRoot.querySelector('.flatview');
  console.log('   düz mü:', duz, '· izometrik varsayılan:',
    !w0.shadowRoot.querySelector('.flatview'));
  if (!duz) problems.push('isometric:false düz görünüme geçmiyor');
  if (w0.shadowRoot.querySelector('.flatview')) problems.push('varsayılan düz geldi');

  console.log('3) align:false → panelin açısını paylaşır (eski davranış)');
  window.localStorage.setItem('lumen_cam', TUZAK);
  const p = kur({ height: 500 });
  await wait(300);
  console.log('   kamera:', JSON.stringify(p._camera()));
  if (p._camera().zoom !== 2.4) problems.push('paylaşılan açı okunmuyor');

  console.log('4) align:true → kendi açısı, panelinkine dokunmaz');
  window.localStorage.setItem('lumen_cam', TUZAK);
  const h = kur({ height: 500, align: true });
  await wait(300);
  const cam = h._camera();
  console.log('   kamera:', JSON.stringify(cam));
  if (cam.zoom !== 1 || cam.tx !== 0) problems.push('hizalı kart tuhaf açıyı devraldı');
  h._camera().zoom = 1.9; h._saveCamera();
  console.log('   saklanan bozuldu mu:', window.localStorage.getItem('lumen_cam') !== TUZAK);
  if (window.localStorage.getItem('lumen_cam') !== TUZAK) {
    problems.push('hizalı kart panelin açısını kirletiyor');
  }

  console.log('5) BAŞLANGIÇ AÇISI: turn/tilt/zoom');
  window.localStorage.setItem('lumen_cam', TUZAK);
  const a = kur({ height: 500, turn: -20 });
  await wait(300);
  console.log('   turn:-20 →', JSON.stringify(a._camera()));
  if (a._camera().rz !== -20) problems.push('turn uygulanmadı');
  if (a._camera().rx !== 56) problems.push('turn verilince tilt varsayılanı bozuldu');
  if (a._camera().zoom !== 1) problems.push('turn verilince zoom bozuldu');
  if (window.localStorage.getItem('lumen_cam') !== TUZAK) {
    problems.push('açılı kart panelin açısını kirletiyor');
  }

  const b = kur({ height: 500, tilt: 999, zoom: 99, turn: -12 });
  await wait(300);
  const cb = b._camera();
  console.log('   tilt:999 zoom:99 → sınırlandı:', JSON.stringify(cb));
  if (cb.rx > 80 || cb.zoom > 3) problems.push('saçma değer sınırlanmadı');

  // "Hiç yazmadım" ile "0 yazdım" ayrı şeyler; ikisi karışırsa açı vermeyen
  // kart da panelin açısını yok sayar.
  const c0 = kur({ height: 500, turn: 0 });
  await wait(300);
  console.log('   turn:0 →', JSON.stringify(c0._camera()));
  if (c0._camera().rz !== 0) problems.push('turn:0 yok sayıldı');
  const cbos = kur({ height: 500 });
  await wait(300);
  if (cbos._camera().rz !== 88) problems.push('açısız kart saklanan açıyı almadı');

  console.log('6) Görünüm seçeneği imzada: düz/izometrik geçişi sahneyi kurar');
  const sigDuz = d._sceneSig(), sigIso = w0._sceneSig();
  console.log('   imzalar farklı mı:', sigDuz !== sigIso);
  if (sigDuz === sigIso) problems.push('düz/izometrik imzada görünmüyor');

  console.log(problems.length ? '\nSORUN:\n' + problems.join('\n') : '\nTEMİZ');
  process.exit(problems.length ? 1 : 0);
}, 400);
