const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// Tablette titreme ve pinch gecikmesi: uygulamanın GERÇEK kullandığı yoldan.
// Bir önceki test _render() üzerinden geçiyordu; canlı yenileme oradan
// geçmiyor, doğrudan _renderStage'e giriyor. Test o yüzden hata yakalamamıştı.
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
window.eval(fs.readFileSync(DIR + fs.readdirSync(DIR).filter(f => f.endsWith('.js'))[0], 'utf8'));
const state = JSON.parse(JSON.stringify(D.state));
const hass = {
  states: D.states, entities: {}, areas: {}, devices: {},
  auth: { data: { access_token: 't' } },
  callApi: (m, u) => Promise.resolve(String(u).startsWith('history/period') ? []
    : u === 'lumen_ha/config' ? D.config_res : u === 'lumen_ha/state' ? state
      : u === 'lumen_ha/insight' ? { health: [], usage: { rooms: {}, series: {} }, notify_services: [] }
        : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true })
};
const card = document.createElement('lumen-house-card');
card.setConfig({ height: 600 });
Object.defineProperty(card, 'clientWidth', { value: 1200, configurable: true });
document.body.appendChild(card); card.hass = hass;
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const SRC = fs.readFileSync(DIR + fs.readdirSync(DIR).filter(f => f.endsWith('.js'))[0], 'utf8');

setTimeout(async () => {
  const sr = card.shadowRoot;

  console.log('0) DİKEY SÜRÜKLEME: sahnede ev, ızgarada sayfa');
  // `manipulation` çift-dokunuş beklemesini kaldırır ama dikey sürüklemeyi
  // tarayıcının kaydırmasına bırakır: ev öne/arkaya yatmaz. Sahnede `none`
  // olmalı — ama telefon ızgarasında DEĞİL, orada kaydırma kullanıcının hakkı.
  const sahne = /\.stage3d \.room\{[^}]*\}/.exec(SRC);
  console.log('   sahne kuralı:', sahne ? sahne[0] : 'YOK');
  if (!sahne || !/touch-action:\s*none/.test(sahne[0])) {
    problems.push('sahnede dikey sürükleme tarayıcıya gidiyor (eğim çalışmaz)');
  }
  const genel = /\n\.room\{[^}]*\}/.exec(SRC);
  if (!genel || !/touch-action:\s*manipulation/.test(genel[0])) {
    problems.push('ızgara kartlarında sayfa kaydırma engellendi');
  }
  const rid = Object.keys(card._cfg.rooms).find(r => sr.querySelector('.room[data-rid="' + r + '"]'));
  const node = () => sr.querySelector('.room[data-rid="' + rid + '"]');
  const ilk = node();

  console.log('0b) EL KAĞITTAYKEN SAHNE SADELEŞİR');
  // Pinch sırasında her kare yeniden hesaplanan şeyler: sonsuz animasyonlar,
  // blur'lu katmanlar ve hareket eden sahnenin üstündeki backdrop-filter.
  // Ucuz bir tablette pinch'in takılmasının sebebi bunlardı.
  const kurallar = [
    [/:host\(\.moving\) \.stage3d \*\{[^}]*animation-play-state:\s*paused/,
     'harekette animasyonlar durmuyor'],
    [/:host\(\.moving\)[^{]*\.modestrip[^{]*\{[^}]*backdrop-filter:\s*none/,
     'harekette backdrop-filter kapanmıyor'],
    [/:host\(\.moving\)[^{]*\.beam[\s\S]{0,160}?filter:\s*none/,
     'harekette blur katmanları kapanmıyor'],
    // Sınıf çarpışması: panelin başlığı için yazılan .top kuralı, oda
    // kartlarının .face.top yüzüne de uyuyor ve görünmeyen bir blur bindiriyor.
    [/\.face\.top\{backdrop-filter:none;\}/,
     'oda yüzlerinde istenmeyen backdrop blur geri geldi'],
    // Çevirme yönü: parmak sağa gidince ev sağa dönsün.
    [/cam\.rz = from\.rz - dx \* 0\.35/, 'çevirme yönü ters döndü'],
  ];
  for (const [kalip, dert] of kurallar) if (!kalip.test(SRC)) problems.push(dert);
  console.log('   kural kontrolü:', kurallar.length - problems.length, '/', kurallar.length);

  console.log('0c) EĞİM: yön, yol ve sınırda esneme');
  // Eskiden 0.3°/piksel ve 50°'lik aralık: 300 piksellik sürüklemenin ilk
  // 112 pikseli işe yarıyor, kalanı boşa gidiyordu — "akmıyor" hissi buydu.
  const taban = card._tiltFloor();
  const yol = Math.round(50 / 0.12);
  console.log('   tüm aralık için parmak yolu: ~' + yol + ' piksel');
  if (yol < 300) problems.push('eğim aralığı çok kısa yola sıkışmış');
  const icinde = card._tiltGive(taban + 10);
  const ustte = card._tiltGive(200);
  const altta = card._tiltGive(-200);
  console.log('   aralıkta:', icinde, '· tavanı zorla:', ustte.toFixed(1),
    '· tabanı zorla:', altta.toFixed(1));
  if (icinde !== taban + 10) problems.push('aralık içinde eğim bozuluyor');
  if (!(ustte > 80 && ustte <= 86)) problems.push('tavanda esneme yok ya da sınırsız');
  if (!(altta < taban && altta >= taban - 6)) problems.push('tabanda esneme yok ya da sınırsız');
  if (!/cam\.rx = this\._tiltGive\(from\.rx - dy \* TILT_PER_PX\)/.test(SRC)) {
    problems.push('eğim yönü ya da duyarlılığı değişmiş');
  }
  if (!/yerine !== cam\.rx/.test(SRC)) problems.push('parmak kalkınca esneme geri alınmıyor');

  console.log('1) CANLI YOL: _renderStage doğrudan çağrılınca sahne kurulmaz');
  card._st.rooms[rid].lux = (card._st.rooms[rid].lux || 10) + 5;
  card._st.rooms[rid].bri = 71;
  card._renderStage();
  await wait(20);
  console.log('   aynı düğüm mü:', node() === ilk);
  if (node() !== ilk) problems.push('_renderStage sahneyi yeniden kurdu (titreme)');

  console.log('2) Lovelace durum yağmuru sahneyi kurmaz');
  const once = node();
  // Kartın kendi ilk yüklemesinden kalan çizim sırası bizim ölçtüğümüz şey
  // değil; ölçtüğümüz, hass akışının kendi başına çizim koyup koymadığı.
  clearTimeout(card._liveTimer); card._liveTimer = null;
  for (let i = 0; i < 8; i++) { card.hass = hass; }
  await wait(60);
  console.log('   aynı düğüm mü:', node() === once, '· bekleyen çizim:', !!card._liveTimer);
  if (node() !== once) problems.push('hass akışı sahneyi yeniden kurdu');
  if (card._liveTimer) problems.push('kart hass akışında çizim zamanlıyor');

  console.log('3) Yapı değişince YİNE de yeniden kurulur');
  const rooms = card._cfg.rooms;
  const kopya = JSON.parse(JSON.stringify(rooms[rid]));
  rooms['test_oda'] = Object.assign(kopya, { name: 'Test', x: null, y: null });
  card._st.rooms['test_oda'] = JSON.parse(JSON.stringify(card._st.rooms[rid]));
  card._renderStage();
  await wait(20);
  const kuruldu = node() !== once && !!sr.querySelector('.room[data-rid="test_oda"]');
  console.log('   yeni oda çizildi mi:', kuruldu);
  if (!kuruldu) problems.push('oda eklenince sahne yenilenmedi');
  delete rooms['test_oda']; delete card._st.rooms['test_oda'];
  card._renderStage();
  await wait(20);

  console.log('4) PINCH: parmak kağıttayken yerleşim ölçülmez');
  const stage = sr.querySelector('.stage3d'), iso = sr.querySelector('.iso');
  let okuma = 0;
  Object.defineProperty(stage, 'clientWidth',
    { get() { okuma++; return 900; }, configurable: true });
  stage.dataset.pw = '900'; stage.dataset.ph = '700';
  card._dragging = true; card._panBox = null;
  for (let i = 0; i < 12; i++) {
    card._camera().zoom = 1 + i * 0.03;
    card._applyCamera(iso, stage);
  }
  console.log('   12 harekette yerleşim okuması:', okuma);
  if (okuma > 1) problems.push('her harekette yerleşim okunuyor (' + okuma + ')');

  console.log('5) PINCH: büyütme zoom yerine transform ile');
  const cam = card._camera();
  cam.zoom = 1.0; card._pinchBase = null; card._fitScale = 0.8;
  cam.tx = 60; cam.ty = -40;
  card._applyCamera(iso, stage);
  const durgun = { zoom: parseFloat(iso.style.zoom), tr: iso.style.transform };
  const ekran = (z, tr) => {
    const m = /translate\(([-\d.]+)px,([-\d.]+)px\)/.exec(tr);
    const sc = /scale\(([\d.]+)\)/.exec(tr);
    return { x: +m[1] * z * (sc ? +sc[1] : 1), y: +m[2] * z * (sc ? +sc[1] : 1) };
  };
  const a = ekran(durgun.zoom, durgun.tr);

  card._pinchBase = 0.8;            // parmaklar 1.0'da indi
  cam.zoom = 1.45;                  // ve 1.45'e açıldı
  card._applyCamera(iso, stage);
  const canli = { zoom: parseFloat(iso.style.zoom), tr: iso.style.transform };
  const b = ekran(canli.zoom, canli.tr);
  console.log('   zoom durağan:', durgun.zoom, '· pinch sırasında:', canli.zoom,
    '· transform:', canli.tr.slice(0, 34));
  if (canli.zoom !== 0.8) problems.push('pinch sırasında zoom yazılıyor (yerleşim)');
  if (!/scale\(/.test(canli.tr)) problems.push('büyütme transform ile taşınmıyor');
  const beklenen = 0.8 * 1.45;
  const gercek = canli.zoom * parseFloat(/scale\(([\d.]+)\)/.exec(canli.tr)[1]);
  console.log('   ekrandaki ölçek:', gercek.toFixed(3), '· beklenen:', beklenen.toFixed(3));
  if (Math.abs(gercek - beklenen) > 0.005) problems.push('pinch ölçeği tutmuyor');

  // Ölçü, kamera ayarlarının kendisi değil EKRANDA GÖRÜLEN yer: kaydırmayı
  // _clampPan zaten meşru olarak sınırlıyor. Aranan şey, parmak kalkarken
  // evin olduğu yerde kalması — yani devirden önce ve sonra aynı nokta.
  console.log('6) Parmak kalkınca büyütme gerçek zoom\'a yazılır, ev oynamaz');
  card._pinchBase = null;
  card._applyCamera(iso, stage);
  const son = parseFloat(iso.style.zoom);
  const sonEkran = ekran(son, iso.style.transform);
  const sabit = Math.abs(sonEkran.x - b.x) < 1.5 && Math.abs(sonEkran.y - b.y) < 1.5;
  console.log('   zoom:', son.toFixed(3), '· ev yerinde mi:', sabit,
    '(' + b.x.toFixed(1) + ',' + b.y.toFixed(1) + ') → (' +
    sonEkran.x.toFixed(1) + ',' + sonEkran.y.toFixed(1) + ')');
  if (Math.abs(son - beklenen) > 0.005) problems.push('parmak kalkınca zoom yazılmadı');
  if (!sabit) problems.push('parmak kalkınca ev yerinden oynadı');
  card._dragging = false; card._panBox = null;
  void a;

  console.log(problems.length ? '\nSORUN:\n' + problems.join('\n') : '\nTEMİZ');
  process.exit(problems.length ? 1 : 0);
}, 400);
