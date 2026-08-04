const _path = require('path');
// Kaynak ve ornek ev, testin kendi konumundan bulunur.
const _KOK = _path.resolve(__dirname, '..', '..');
const _SRC = process.env.LUMEN_SRC || _path.join(_KOK, 'custom_components');
const _FR = _path.join(_SRC, 'lumen_ha', 'frontend');
const FIXTURE = _path.join(_KOK, 'tests', 'fixtures', 'house.json');
// Işık Hafızası: evin gerçekten ne yaptığı, kaydırıcıyla geri sarılabilir hâlde.
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
window.HTMLCanvasElement.prototype.getContext = () => null;   // jsdom: kanvas yok
const PANEL = (_FR + _path.sep) +
  fs.readdirSync(_FR).filter(f => f.endsWith('.js'))[0];
window.eval(fs.readFileSync(PANEL, 'utf8'));

// iki oda, iki ışık: biri gece 4'te yanmış, biri hiç yanmamış
const NOW = Date.now();
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const HISTORY = [
  [{ entity_id: 'light.a', state: 'off', last_changed: hoursAgo(24) },
   { entity_id: 'light.a', state: 'on', last_changed: hoursAgo(6) },
   { entity_id: 'light.a', state: 'off', last_changed: hoursAgo(2) }],
  [{ entity_id: 'light.b', state: 'off', last_changed: hoursAgo(24) }],
  // odada biri: 8 saat önce girdi, 3 saat önce çıktı
  [{ entity_id: 'binary_sensor.var', state: 'off', last_changed: hoursAgo(24) },
   { entity_id: 'binary_sensor.var', state: 'on', last_changed: hoursAgo(8) },
   { entity_id: 'binary_sensor.var', state: 'off', last_changed: hoursAgo(3) }],
];

const hass = {
  states: D.states, entities: {}, areas: {}, devices: {},
  auth: { data: { access_token: 't' } },
  callApi: (m, u) => Promise.resolve(
    String(u).startsWith('history/period') ? HISTORY
      : u === 'lumen_ha/config' ? D.config_res : u === 'lumen_ha/state' ? D.state
        : u === 'lumen_ha/insight' ? { health: [], usage: { rooms: {}, series: {} }, notify_services: [] }
          : u === 'lumen_ha/backups' ? { backups: [] } : { ok: true }),
};
const panel = document.createElement('lumen-panel');
document.body.appendChild(panel); panel.hass = hass;
const txt = e => (e.textContent || '').trim();
const wait = (ms) => new Promise(r => setTimeout(r, ms));

setTimeout(async () => {
  const sr = panel.shadowRoot;

  // 1) düğme, düz görünüm düğmesinin yanında
  const pills = [...sr.querySelectorAll('.pick,.gpill,.btn')].map(txt);
  console.log('üst düğmeler:', pills.filter(t => /Hafıza|görünüm|Yakınlaş/i.test(t)).join(' | '));
  const memBtn = [...sr.querySelectorAll('.pick,.gpill,.btn')]
    .find(b => /Işık Hafızası/i.test(txt(b)));
  if (!memBtn) problems.push('Işık Hafızası düğmesi yok');
  else {
    // odaların ışıklarını bilinen iki entity'ye indir, geçmişle eşleşsin
    const first = Object.keys(panel._cfg.rooms)[0], second = Object.keys(panel._cfg.rooms)[1];
    panel._cfg.rooms[first].lights = ['light.a'];
    panel._cfg.rooms[second].lights = ['light.b'];
    panel._cfg.rooms[first].trigger = ['binary_sensor.var'];
    panel._cfg.rooms[first].hold = [];
    memBtn.onclick();
    await wait(120);

    // 2) sahne kuruldu, odalar kolonlarıyla duruyor
    const rooms = [...sr.querySelectorAll('.mroom')];
    console.log('oda plakası:', rooms.length, '· kolon:', sr.querySelectorAll('.mroom .mbeam .cap').length);
    if (!rooms.length) problems.push('hafıza sahnesi kurulmadı');
    if (rooms.length !== sr.querySelectorAll('.mroom .mbeam').length) problems.push('kolonsuz oda var');

    // 3) zaman makinesi çubuğu
    const bar = sr.querySelector('.tm');
    if (!bar) problems.push('zaman makinesi yok');
    const ranges = [...sr.querySelectorAll('.memranges .pick,.memranges .gpill')].map(txt);
    console.log('aralıklar:', ranges.join(' | '));
    for (const need of ['24 saat', '2 gün', '3 gün']) {
      if (!ranges.some(t => t.includes(need))) problems.push('aralık yok: ' + need);
    }

    // 4) kaydırıcı evi o ana götürüyor
    const mem = panel._mem;
    if (!mem || !mem.steps) problems.push('geçmiş okunamadı');
    else {
      const litAt = (hoursBack) => Math.round(
        (mem.steps - 1) - (hoursBack * 3600000) / mem.stepMs);
      const node = sr.querySelector('.mroom[data-id="' + first + '"]');
      if (!node) problems.push('oda plakası bulunamadı: ' + first);
      panel._memApply(litAt(4));            // 4 saat önce: light.a yanıktı
      const on4 = node && node.style.getPropertyValue('--b');
      panel._memApply(litAt(1));            // 1 saat önce: sönmüştü
      const on1 = node && node.style.getPropertyValue('--b');
      console.log('4 saat önce =', on4, '· 1 saat önce =', on1);
      if (Number(on4) < 0.9) problems.push('yanık an sönük görünüyor: ' + on4);
      if (Number(on1) > 0.01) problems.push('sönük an yanık görünüyor: ' + on1);
      const hicYanmayan = mem.rooms[second];
      if (hicYanmayan && hicYanmayan.some(v => v > 0)) problems.push('yanmamış oda yanık');
    }

    // 4b) odada biri varken kartın üstünde yürüyen adam
    {
      const node = sr.querySelector('.mroom[data-id="' + first + '"]');
      const mem2 = panel._mem;
      const at = (h) => Math.round((mem2.steps - 1) - (h * 3600000) / mem2.stepMs);
      if (!node.querySelector('.mwalk .fig .body .who')) problems.push('yürüyen adam çizilmedi');
      if (!(panel.style.getPropertyValue('--walk') || '').includes('walk.gif')) {
        problems.push('yürüyüş görseli bağlanmadı');
      }
      panel._memApply(at(5));                    // içerideydi
      const varMi = node.classList.contains('here');
      panel._memApply(at(1));                    // çıkmıştı
      const yokMu = !node.classList.contains('here');
      console.log('5 saat önce odada:', varMi, '· 1 saat önce odada:', !yokMu);
      if (!varMi) problems.push('odada olan an boş görünüyor');
      if (!yokMu) problems.push('boş an dolu görünüyor');
      if (!(mem2.here && mem2.here[first])) problems.push('varlık çizgisi yok');
    }

    // 4c) duraklatıp adım adım ilerleme
    {
      const steps = [...sr.querySelectorAll('.tm .play.step')];
      console.log('adım düğmesi:', steps.length);
      if (steps.length !== 2) problems.push('ileri/geri düğmesi eksik');
      else {
        panel._memPlay();                        // oynarken bastığında dursun
        const once = panel._memPos;
        steps[1].onclick();
        if (panel._memTimer) problems.push('adım basınca oynatma durmadı');
        if (panel._memPos !== once + 1) problems.push('bir adım ileri gitmedi');
        steps[0].onclick();
        if (panel._memPos !== once) problems.push('bir adım geri gelmedi');
      }
    }

    // 4d) ray üstünde gezinme ve sürükleme (YouTube gibi)
    {
      const rail = sr.querySelector('.tm .tmrail');
      const ghost = rail.querySelector('.ghost');
      if (!ghost) problems.push('önizleme çizgisi yok');
      rail.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 40 });
      rail.setPointerCapture = () => {}; rail.releasePointerCapture = () => {};
      rail.onpointermove({ clientX: 500, preventDefault(){} });
      const gezinmeSonrasi = panel._memPos;
      console.log('gezinirken imleç oynadı mı:', gezinmeSonrasi !== panel._memPos,
        '· hayalet:', ghost.style.left, ghost.classList.contains('on'));
      if (!ghost.classList.contains('on')) problems.push('gezinince hayalet çıkmadı');
      if (ghost.style.left !== '50%') problems.push('hayalet yanlış yerde: ' + ghost.style.left);
      panel._memPlay();
      rail.onpointerdown({ clientX: 250, pointerId: 1, preventDefault(){} });
      if (panel._memTimer) problems.push('basınca oynatma durmadı');
      const beklenen = Math.round(0.25 * (panel._mem.steps - 1));
      if (panel._memPos !== beklenen) problems.push('basınca o ana gitmedi: ' + panel._memPos);
      rail.onpointermove({ clientX: 750, preventDefault(){} });
      const beklenen2 = Math.round(0.75 * (panel._mem.steps - 1));
      if (panel._memPos !== beklenen2) problems.push('sürüklerken takip etmedi: ' + panel._memPos);
      rail.onpointerup({ pointerId: 1 });
      rail.onpointermove({ clientX: 100, preventDefault(){} });
      if (panel._memPos !== beklenen2) problems.push('bıraktıktan sonra da takip ediyor');
      console.log('bas-sürükle:', beklenen, '->', beklenen2, '· bırakınca sabit');
    }

    // 4e) oda isimleri kart döndürülünce yerinde kalır
    {
      const face = sr.querySelector('.mroom .mface');
      const t = face.style.transform || '';
      if (/rotate/.test(t)) problems.push('isim hâlâ döndürülüyor: ' + t);
    }

    // 5) oynat/duraklat
    const play = sr.querySelector('.tm .play');
    play.onclick();
    if (!panel._memTimer) problems.push('oynatma başlamadı');
    play.onclick();
    if (panel._memTimer) problems.push('duraklatma çalışmadı');

    // 6) 7 gün seçilince cetvel yedi kat uzuyor (geçişler hızlanıyor)
    const genis = [...sr.querySelectorAll('.memranges .pick,.memranges .gpill')]
      .find(b => /3 gün/.test(txt(b)));
    const oncekiAdim = panel._mem.stepMs;
    genis.onclick();
    await wait(140);
    console.log('adım süresi 24s:', Math.round(oncekiAdim / 60000),
      'dk → 3g:', Math.round(panel._mem.stepMs / 60000), 'dk');
    if (!(panel._mem.stepMs > oncekiAdim * 2.5)) problems.push('3 gün aralığı uygulanmadı');
    // her odanın kendi rengi ve okunur etiketi olmalı (çizimdeki gibi)
    const bir = sr.querySelector('.mroom');
    if (!/#/.test(bir.style.getPropertyValue('--mc'))) problems.push('oda rengi yok');
    if (!sr.querySelector('.mroom .mface')) problems.push('etiket yok');
    if (!sr.querySelector('.memground')) problems.push('zemin ızgarası yok');
    if (!sr.querySelector('.tm-phase')) problems.push('dilim rozeti yok');

    // 7) canlı eve dönüş
    const backBtn = [...sr.querySelectorAll('.pick,.gpill,.btn')]
      .find(b => /Canlı ev/i.test(txt(b)));
    if (!backBtn) problems.push('canlı eve dönüş düğmesi yok');
    else {
      backBtn.onclick();
      await wait(80);
      if (sr.querySelector('.mroom')) problems.push('canlı eve dönmedi');
      if (!sr.querySelector('.room')) problems.push('canlı ev çizilmedi');
    }
  }

  console.log(problems.length ? ['SORUN:'].concat(problems).join('  |  ') : 'HEPSI GECTI');
  process.exit(problems.length ? 1 : 0);
}, 320);
