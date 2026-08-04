/*
 * LUMEN — automatic room lighting panel.
 *
 * The panel only ever writes JSON. Every decision lives in engine.py, so what
 * you see here is a drawing of the configuration plus the engine's own live
 * verdict — never a second implementation of the rules.
 *
 * Vanilla web component on purpose: no build step, no Lit, no npm. The version
 * lives in the FILE NAME so a browser cache can never serve yesterday's panel.
 */

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const icon = (mdi, cls) => {
  const i = document.createElement("ha-icon");
  i.setAttribute("icon", mdi);
  if (cls) i.className = cls;
  return i;
};
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const DAYS_SHORT = {
  tr: ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
const ASSETS = "/lumen_ha_frontend";
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* Turkish search: "isik" should match "Işık" (in JS "I".toLowerCase() === "i"). */
const norm = (s) => String(s || "")
  .replace(/[İIı]/g, "i").replace(/[Şş]/g, "s").replace(/[Ğğ]/g, "g")
  .replace(/[Üü]/g, "u").replace(/[Öö]/g, "o").replace(/[Çç]/g, "c")
  .toLowerCase();

const mmss = (secs) => {
  const s = Math.max(0, Math.round(secs));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

/* Which entities this panel is allowed to put to work. Everything else shows up
 * grey and cannot be dragged — a room full of thermometers stays readable. */
const ROLE_OK = {
  trigger: (dom, dc) => dom === "binary_sensor" &&
    ["motion", "occupancy", "presence", "door", "window", "opening"].includes(dc),
  hold: (dom, dc) => dom === "binary_sensor" &&
    ["occupancy", "presence", "motion"].includes(dc),
  lux: (dom, dc) => dom === "sensor" && dc === "illuminance",
  lights: (dom) => dom === "light" || dom === "switch",
};

const DOM_ICON = {
  light: "mdi:lightbulb-outline", switch: "mdi:power-socket-eu",
  binary_sensor: "mdi:radar", sensor: "mdi:gauge",
  climate: "mdi:snowflake", media_player: "mdi:television-classic",
  cover: "mdi:blinds-horizontal", fan: "mdi:fan", lock: "mdi:lock-outline",
  camera: "mdi:cctv", vacuum: "mdi:robot-vacuum", scene: "mdi:palette-outline",
  script: "mdi:script-text-outline", input_boolean: "mdi:toggle-switch-outline",
};

const TIME_OFFSETS = [-120, -90, -60, -45, -30, -20, -15, -10, -5, 0,
  5, 10, 15, 20, 30, 45, 60, 90, 120];

/* How far the house may spread, and how far past life size it may be drawn.
 * Vector rooms, so growing past 1 costs nothing in sharpness. */
const STAGE_MAX = 1760;
const STAGE_ZOOM_MAX = 1.6;

/* How far the house may be tipped. The flat end is worked out from the screen
 * (see _fitStage) and never asks for more tilt than the resting view; the other
 * end is where the floor turns edge-on and stops telling you anything. */
const TILT_MIN = 30;      // how flat the frame will ever let the house lie
const TILT_REST = 56;     // the angle the house is left at
/* How far a room stands off the floor at full brightness, plus its glow. It
 * only ever goes upward on the screen, so it is the top of the frame that has
 * to allow for it. */
const ROOM_LIFT = 74;
const TILT_MAX = 80;
/* Derece / piksel. Tüm aralık (50°) böylece ~420 piksellik bir sürüklemeye
 * yayılıyor: elin nereye giderse ev oraya, duvara toslamadan. */
const TILT_PER_PX = 0.12;
/* Sınıra gelince durmak sert; biraz esneyip parmak kalkınca yerine dönmek
 * yumuşak. Ötesinde parmağın etkisi ve en fazla kaç derece taşabileceği. */
const TILT_GIVE = 0.12;
const TILT_OVER = 6;

/* A shortlist for the icon picker — the rooms people actually have. Anything
 * else can be typed in by name; this is only here to save the typing. */
const ICON_CHOICES = ("sofa,sofa-outline,television,television-classic,speaker,\
countertop,silverware-fork-knife,fridge-outline,microwave,coffee-maker,pot-steam-outline,\
bed,bed-king-outline,bed-double-outline,teddy-bear,baby-carriage,cradle-outline,\
shower,shower-head,bathtub-outline,toilet,paper-roll-outline,washing-machine,tumble-dryer,\
hanger,tshirt-crew-outline,wardrobe-outline,shoe-formal,\
desktop-tower-monitor,laptop,monitor,keyboard,printer,desk,chair-rolling,office-building-outline,\
bookshelf,book-open-page-variant-outline,gamepad-variant-outline,dumbbell,yoga,\
door-open,door-closed,door-sliding,stairs,elevator,garage,garage-open,car,\
flower,flower-tulip-outline,tree-outline,grass,watering-can-outline,pine-tree,\
umbrella-beach-outline,pool,hot-tub,fire,fireplace,candle,\
paw,dog-side,cat,fish,bird,\
music,piano,guitar-acoustic,microphone-variant,movie-open-outline,popcorn,\
tools,hammer-screwdriver,wrench-outline,saw-blade,ladder,\
home-outline,home-heart,home-city-outline,floor-plan,view-grid-outline,\
lightbulb-outline,lightbulb-group-outline,ceiling-light,floor-lamp,wall-sconce,string-lights,\
shape-outline,star-outline,heart-outline,silverware-clean,table-furniture,\
window-closed-variant,curtains,mirror,broom,vacuum-outline,iron-outline,\
package-variant-closed,archive-outline,shelf,cube-outline,\
weight-lifter,run,bicycle,basketball,table-tennis,\
baby-face-outline,school-outline,pencil-ruler,palette-outline,camera-outline,\
tea-outline,glass-cocktail,silverware-spoon,cupcake,food-apple-outline,\
stove,dishwasher,water-pump,thermometer,air-conditioner,fan,radiator,\
solar-power-variant-outline,flash-outline,power-plug-outline,battery-outline,\
wifi,router-wireless,cctv,shield-home-outline,key-variant,\
sun-thermometer-outline,weather-night,white-balance-sunny,cloud-outline")
  .split(",").map((n) => "mdi:" + n.trim()).filter((n) => n.length > 4);


const OFF_STEPS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 90, 120, 180, 240, 300,
  420, 600, 900, 1200, 1800, 2700, 3600];

const COLOR_SET = [
  ["Amber", [255, 170, 80]], ["Kırmızı", [255, 90, 70]],
  ["Pembe", [255, 105, 165]], ["Mor", [160, 110, 255]],
  ["Mavi", [90, 150, 255]], ["Turkuaz", [80, 220, 210]],
  ["Yeşil", [110, 220, 130]],
];

const HOUSE_MODES = ["normal", "alone"];

/* Order matters: what LUMEN can put to work is listed first. */
const KIND_DEF = [
  { key: "light", tk: "k_light", icon: "mdi:lightbulb-outline", usable: true },
  { key: "lightgroup", tk: "k_lightgroup", icon: "mdi:lightbulb-group-outline", usable: true },
  { key: "switch", tk: "k_switch", icon: "mdi:power-socket-eu", usable: true },
  { key: "motion", tk: "k_motion", icon: "mdi:motion-sensor", usable: true },
  { key: "presence", tk: "k_presence", icon: "mdi:account-check-outline", usable: true },
  { key: "opening", tk: "k_opening", icon: "mdi:door-open", usable: true },
  { key: "lux", tk: "k_lux", icon: "mdi:brightness-5", usable: true },
  { key: "binary", tk: "k_binary", icon: "mdi:radar", usable: false },
  { key: "sensor", tk: "k_sensor", icon: "mdi:gauge", usable: false },
  { key: "rest", tk: "k_rest", icon: "mdi:shape-outline", usable: false },
];

const SLOT_TINT = {
  morning: ["rgba(255,184,107,.22)", "#ffb86b"],
  day: ["rgba(95,208,227,.16)", "#5fd0e3"],
  evening: ["rgba(236,75,136,.24)", "#ec4b88"],
  night: ["rgba(139,61,255,.18)", "#b58cff"],
};
const slotTint = (key, i) => SLOT_TINT[key] ||
  [["rgba(255,184,107,.22)", "rgba(95,208,227,.16)", "rgba(236,75,136,.24)",
    "rgba(139,61,255,.18)"][i % 4],
   ["#ffb86b", "#5fd0e3", "#ec4b88", "#b58cff"][i % 4]];

const I18N = {
  brand: { en: "LUMEN", tr: "LUMEN" },
  hero_l: { en: "SMART HOME · LIGHT ENGINE", tr: "AKILLI EV · IŞIK MOTORU" },
  hero_s: {
    en: "A lit window means that room is on — its glow spills into the garden. Tap a window for its rules, or drag it to lay your home out.",
    tr: "Yanan pencere, o odanın açık olduğu anlamına gelir — huzmesi bahçeye vurur. Pencereye dokun: kuralları. Sürükle: evini diz.",
  },
  saved: { en: "Saved", tr: "Kaydedildi" },
  save_err: { en: "Could not save", tr: "Kaydedilemedi" },
  page_home: { en: "Night House", tr: "Gece Evi" },
  page_modes: { en: "Modes", tr: "Modlar" },
  page_slots: { en: "Time slots", tr: "Zaman Dilimleri" },
  page_stats: { en: "Running cost", tr: "İstatistik" },
  stats_use: { en: "Hours lit", tr: "Yanma süresi" },
  stats_use_s: { en: "last 30 days", tr: "son 30 gün" },
  stats_none: {
    en: "Nothing counted yet — the tally starts when the engine runs.",
    tr: "Henüz sayacak bir şey yok — sayım motor çalıştıkça birikir.",
  },
  stats_since: { en: "counting since {d}", tr: "{d} tarihinden beri" },
  stats_note: {
    en: "An estimate: {w} W per bulb at {p} ₺/kWh. Set both below to make it "
      + "closer to your bill.",
    tr: "Tahmin: ampul başına {w} W, {p} ₺/kWh. Faturana yaklaştırmak için "
      + "aşağıdan ikisini de kendine göre ayarla.",
  },
  stats_cost: { en: "How the cost is worked out", tr: "Maliyet nasıl hesaplanıyor" },
  stats_cost_s: {
    en: "Nobody knows every bulb's wattage, so one average stands for the house.",
    tr: "Her ampulün gücü bilinmez; ev için tek bir ortalama kullanılır.",
  },
  stats_price: { en: "Price per kWh", tr: "kWh fiyatı" },
  stats_price_s: { en: "in your own currency", tr: "kendi para biriminde (₺)" },
  stats_watt: { en: "Watts per bulb", tr: "Ampul başına watt" },
  stats_watt_s: { en: "9 W is a typical LED", tr: "tipik bir LED 9 W civarı" },
  days: { en: "days", tr: "gün" },
  weekly: { en: "weekly", tr: "haftada bir" },

  hk_missing: { en: "gone", tr: "kayıp" },
  hk_offline: { en: "offline", tr: "çevrimdışı" },
  hk_stale: { en: "silent", tr: "sessiz" },
  hk_no_lights: { en: "no lights", tr: "ışık yok" },
  hk_no_sensor: { en: "no sensors", tr: "sensör yok" },
  hk_dead_slot: { en: "unreachable slot", tr: "ulaşılamaz dilim" },
  hk_zero_bri: { en: "on but dark", tr: "açık ama karanlık" },
  hk_gone_pick: { en: "stale choice", tr: "eski seçim" },
  health_bad_n: { en: "{n} broken", tr: "{n} ciddi" },
  health_warn_n: { en: "{n} to look at", tr: "{n} bakılacak" },
  room_drop: { en: "Take out of the house", tr: "Odayı çıkar" },
  room_drop_q: { en: "Take {s} out?", tr: "{s} çıkarılsın mı?" },
  room_drop_b: {
    en: "It leaves LUMEN only: Home Assistant keeps the area and everything in "
      + "it, and filling in from your areas will not put it back. You can bring "
      + "it back from the settings whenever you like.",
    tr: "Yalnızca LUMEN'den çıkar: Home Assistant'taki alan ve içindeki her şey "
      + "yerinde kalır, \"Alanlarımdan doldur\" da onu geri koymaz. İstediğin "
      + "zaman ayarlardan geri alabilirsin.",
  },
  room_dropped: { en: "{s} is out", tr: "{s} çıkarıldı" },
  dropped_h: { en: "Areas that are not rooms", tr: "Oda saymadıkların" },
  dropped_s: {
    en: "Left out of the house. Tap one to bring it back.",
    tr: "Evin dışında tutuluyor. Geri getirmek için üstüne dokun.",
  },
  dropped_back: { en: "{s} is back", tr: "{s} geri geldi" },
  health: { en: "Health check", tr: "Sağlık kontrolü" },
  health_ok: {
    en: "Nothing wrong: every sensor is talking and every room can do its job.",
    tr: "Sorun yok: bütün sensörler konuşuyor, her oda işini yapabiliyor.",
  },
  health_more: { en: "… and {n} more", tr: "… ve {n} tane daha" },
  health_notify: { en: "Tell me about it", tr: "Bana haber ver" },
  health_notify_s: {
    en: "Pick where the report should go, then switch it on.",
    tr: "Raporun nereye gideceğini seç, sonra aç.",
  },
  health_no_service: {
    en: "Home Assistant has no notify service set up yet.",
    tr: "Home Assistant'ta henüz bir bildirim servisi kurulu değil.",
  },
  health_pick_first: { en: "Pick a service first", tr: "Önce bir servis seç" },
  health_after: { en: "Tell me after", tr: "Ne kadar sonra haber ver" },
  health_after_s: {
    en: "a device has to stay offline this long — short blinks are ignored",
    tr: "cihaz bu kadar süre çevrimdışı kalırsa haber gelir; anlık kopmalar "
      + "yok sayılır",
  },
  health_every: { en: "How often", tr: "Ne sıklıkla" },
  health_every_s: {
    en: "Only sent when there is something to say.",
    tr: "Sadece söyleyecek bir şey varsa gönderilir.",
  },
  health_test: { en: "Send one now", tr: "Şimdi bir tane gönder" },
  health_sent: { en: "Sent — {n} things to fix", tr: "Gönderildi — {n} sorun" },

  page_log: { en: "Log", tr: "Günlük" },
  other_dev: { en: "Other", tr: "Diğer" },
  rail_rooms: { en: "Rooms", tr: "Odalar" },
  as_light: { en: "light", tr: "ışık" },
  as_lux: { en: "darkness meter", tr: "karanlık ölçer" },
  as_hold: { en: "presence", tr: "uyanık tutan" },
  as_trigger: { en: "trigger", tr: "uyandıran" },
  cant_assign: {
    en: "LUMEN cannot use this one",
    tr: "LUMEN bu cihazı kullanamaz",
  },
  assigned: { en: "{d} → {r} · {k}", tr: "{d} → {r} · {k}" },
  pick_room_h: { en: "Which room?", tr: "Hangi odaya?" },
  other_h: { en: "Devices without a room", tr: "Odası olmayan cihazlar" },
  other_s: {
    en: "Drag one onto a room in the Night House, or tap it to choose.",
    tr: "Birini Gece Evi'nde bir odanın üstüne sürükle, ya da dokunup oda seç.",
  },
  lux_now: { en: "Now {v} lx", tr: "Şu an {v} lx" },
  no_lux: { en: "no light sensor", tr: "ışık ölçer yok" },
  fresh_h: { en: "{n} new devices in your rooms", tr: "odalarında {n} yeni cihaz" },
  fresh_no: { en: "No thanks", tr: "İstemiyorum" },
  fresh_no_done: {
    en: "{n} devices will not be offered again",
    tr: "{n} cihaz bir daha önerilmeyecek",
  },
  ignored_h: { en: "Devices left out", tr: "Dışarıda bıraktıkların" },
  ignored_s: {
    en: "These are not offered as new devices and autofill leaves them alone. "
      + "Tap one to bring it back.",
    tr: "Bunlar yeni cihaz olarak önerilmez, otomatik doldurma da dokunmaz. "
      + "Geri getirmek için üstüne dokun.",
  },
  ignored_back: { en: "{s} is back in the list", tr: "{s} listeye geri döndü" },
  fresh_add: { en: "Add them", tr: "Ekle" },
  search_all: {
    en: "Searching every device. A purple chip already belongs to the room named on it — drop it elsewhere to move it.",
    tr: "Tüm cihazlarda arıyor. Mor çip zaten üstünde yazan odaya ait — başka odaya bırakırsan taşınır.",
  },
  gate_lbl: { en: "gate", tr: "eşik" },
  search_n: { en: "{n} of {t}", tr: "{t} içinden {n}" },
  search_none: { en: "Nothing matches that.", tr: "Eşleşen cihaz yok." },
  drag_rail: {
    en: "Tap a device to pick its room — or drag it onto a room in the house.",
    tr: "Cihaza dokunup odasını seç — ya da Gece Evi'ndeki odanın üstüne sürükle.",
  },
  night_house: { en: "Night House", tr: "Gece Evi" },
  view_plan: { en: "Floor plan", tr: "Kat Planı" },
  view_flat: { en: "Flat view", tr: "Düz görünüm" },
  view_iso: { en: "Isometric", tr: "İzometrik" },
  view_reset: { en: "Reset view", tr: "Görünümü sıfırla" },
  view_memory: { en: "Light memory", tr: "Işık Hafızası" },
  view_live: { en: "Live house", tr: "Canlı ev" },
  mem_title: { en: "TIME MACHINE", tr: "ZAMAN MAKİNESİ" },
  mem_hint: {
    en: "Drag along the bar below · ◀ ▶ step one at a time · column height = "
      + "how much of the room was lit · figure = somebody was in it",
    tr: "Aşağıdaki çubuk üzerinde sürükle · ◀ ▶ tek tek ilerlet · kolon "
      + "yüksekliği = odanın ne kadarının yandığı · figür = odada biri vardı",
  },
  mem_24h: { en: "24 hours", tr: "24 saat" },
  mem_3d: { en: "3 days", tr: "3 gün" },
  mem_2d: { en: "2 days", tr: "2 gün" },
  mem_loading: { en: "Reading the house's memory…", tr: "Evin hafızası okunuyor…" },
  mem_none: {
    en: "No history for this stretch. The recorder has to have been keeping "
      + "these lights for the house to remember them.",
    tr: "Bu aralık için kayıt yok. Evin hatırlaması için HA'nın bu ışıkları "
      + "kaydediyor olması gerekir.",
  },
  mem_off: { en: "off", tr: "kapalı" },
  mem_lights: { en: "lights", tr: "ışık" },
  mem_back: { en: "One step back", tr: "Bir adım geri" },
  mem_fwd: { en: "One step on", tr: "Bir adım ileri" },
  mem_here: { en: "somebody was here", tr: "odada biri vardı" },
  sitter: { en: "Show somebody in the room", tr: "Odadaki insanı göster" },
  sitter_s: {
    en: "While the sensors say a room is occupied, somebody walks the length "
      + "of its card.",
    tr: "Sensörler odada biri var dediği sürece kartın önünde biri bir uçtan "
      + "diğerine yürür.",
  },
  edit_do: { en: "Arrange", tr: "Düzenle" },
  edit_done: { en: "Done", tr: "Bitir" },
  edit_hint: {
    en: "Drag a room onto another to swap them. Double click a room to make it "
      + "wider. The house lies flat while you arrange it.",
    tr: "Bir odayı diğerinin üstüne sürükle, yer değiştirsinler. Genişletmek "
      + "için çift tıkla. Düzenlerken ev düz görünür.",
  },
  swapped: { en: "{a} and {b} swapped", tr: "{a} ile {b} yer değiştirdi" },
  widen_n: { en: "{s} is now {n} wide", tr: "{s} artık {n} birim geniş" },
  widen_hint: {
    en: "Drag to turn the house · Ctrl+drag to move it · Ctrl+wheel or two "
      + "fingers to zoom · tap a room for its light",
    tr: "Sürükle: evi çevir · Ctrl+sürükle: evi taşı · Ctrl+tekerlek ya da iki "
      + "parmak: yakınlaş · karta dokun: ışığı çevir",
  },
  repack_q: { en: "Lay the rooms out again?", tr: "Odalar yeniden dizilsin mi?" },
  repack_b: {
    en: "The gaps are closed and the rooms are ordered by how much they are "
      + "actually used — the busiest first. Your own arrangement is replaced, "
      + "and the version history can bring it back.",
    tr: "Boşluklar kapanır ve odalar gerçekte ne kadar kullanıldıklarına göre "
      + "dizilir — en çok vakit geçirdiğin oda başta. Kendi düzenin gider, "
      + "sürüm geçmişinden geri alabilirsin.",
  },
  repack_do: { en: "Lay it out", tr: "Diz" },
  zoom_in: { en: "Closer", tr: "Yakınlaş" },
  zoom_out: { en: "Further", tr: "Uzaklaş" },
  orbit_hint: {
    en: "Drag to turn the house, Ctrl+wheel or two fingers to zoom. "
      + "Double click puts it back.",
    tr: "Sürükleyerek evi çevir, Ctrl+tekerlek ya da iki parmakla yakınlaş. "
      + "Çift tıklayınca eski haline döner.",
  },
  view_house: { en: "Night House", tr: "Gece Evi" },
  plan_auto: { en: "automatic", tr: "otomatik" },
  rooms_n: { en: "{n} rooms", tr: "{n} oda" },
  lg_on: { en: "light on", tr: "ışık açık" },
  lg_dim: { en: "dimmed / borrowed", tr: "kısık / komşudan" },
  lg_motion: { en: "motion", tr: "hareket" },
  lg_empty: { en: "empty", tr: "boş" },
  lg_presence: { en: "presence", tr: "varlık" },
  someone_here: { en: "someone is in this room now", tr: "şu an bu odada biri var" },
  lg_warn: { en: "missing hardware", tr: "eksik donanım" },
  front_door: { en: "FRONT DOOR", tr: "GİRİŞ KAPISI" },
  north: { en: "NORTH", tr: "KUZEY" },
  plan_note: {
    en: "A schematic, not a scale drawing. Doorways come from which rooms touch; move a room and they follow.",
    tr: "Ölçekli çizim değil, şemadır. Kapı aralıkları odaların komşuluğundan çıkar; odayı taşırsan onlar da taşınır.",
  },
  live: { en: "live", tr: "canlı" },
  edit_home: { en: "Edit home", tr: "Evi düzenle" },
  done: { en: "Done", tr: "Bitti" },
  house_mode: { en: "House mode", tr: "Ev Modu" },
  tap_change: { en: "tap to change", tr: "dokunarak değiştir" },
  engine_on: { en: "Engine", tr: "Motor" },
  no_rooms_h: { en: "No rooms yet", tr: "Henüz oda yok" },
  no_rooms_s: {
    en: "Fill the house in from your Home Assistant areas — lights and sensors are matched for you, and you correct whatever looks wrong.",
    tr: "Evi Home Assistant alanlarından doldur — ışıklar ve sensörler eşleştirilir, yanlış olanı sen düzeltirsin.",
  },
  autofill: { en: "Fill from my areas", tr: "Alanlarımdan doldur" },
  filled: { en: "{n} rooms filled in", tr: "{n} oda kuruldu" },
  empty_lights: { en: "no light in Home Assistant", tr: "ışık HA'da yok" },
  empty_sensor: { en: "no sensor", tr: "sensör yok" },
  from_neighbor: { en: "from neighbour:", tr: "komşudan:" },
  lights_n: { en: "{n} lights", tr: "{n} ışık" },
  lights_lit_n: { en: "{n} lit", tr: "{n} ışık yanıyor" },
  since_n: { en: "{t}", tr: "{t}" },
  u_sec: { en: "s", tr: " sn" },
  u_min: { en: "m", tr: " dk" },
  u_hour: { en: "h", tr: " sa" },
  here_yes: { en: "somebody here", tr: "biri var" },
  here_no: { en: "empty", tr: "boş" },
  idle: { en: "empty", tr: "boş" },
  groups_on: { en: "{n} groups", tr: "{n} grup" },
  no_presence: { en: "no presence", tr: "varlık yok" },
  presence_ok: { en: "presence ✓", tr: "varlık ✓" },
  locked_for: { en: "locked {t}", tr: "kilitli {t}" },
  fuse_for: { en: "fuse {t}", tr: "sigorta {t}" },
  tonight: { en: "Tonight", tr: "Bu Gece" },
  rooms_lit: { en: "Rooms lit", tr: "Oda açık" },
  decisions: { en: "Decisions today", tr: "Karar bugün" },
  watching: { en: "Sensors watched", tr: "İzlenen sensör" },
  add_floor: { en: "+ Floor", tr: "+ Kat" },
  add_row: { en: "+ Row", tr: "+ Sıra" },
  grid_cols: { en: "Width", tr: "Genişlik" },
  grid_rows: { en: "Depth", tr: "Derinlik" },
  move_here: { en: "move here", tr: "buraya taşı" },
  no_space: { en: "No space there", tr: "Orada yer yok" },
  blocked_by: { en: "{n} is in the way — move that first", tr: "{n} engel oluyor — önce onu taşı" },
  pick_room: { en: "Tap a room to move or resize it", tr: "Taşımak ya da boyutlandırmak için bir odaya dokun" },
  bar_move: { en: "Move", tr: "Taşı" },
  bar_width: { en: "Width", tr: "En" },
  bar_depth: { en: "Depth", tr: "Boy" },
  remove_plan: { en: "Remove from plan", tr: "Plandan çıkar" },
  remove_plan_s: { en: "the room's rules are kept", tr: "odanın kuralları korunur" },
  plan_hint: {
    en: "Drag a room to move it, pull its right or bottom edge to stretch it — a corridor can run past three rooms. On a tablet: tap the room, then tap where it should go; the − + buttons resize it.",
    tr: "Odayı sürükleyip taşı, sağ ya da alt kenarından çekip uzat — koridor üç odanın önünden geçebilir. Tablette: odaya dokun, sonra gideceği yere dokun; − + düğmeleri boyutlandırır.",
  },
  floor_name: { en: "Floor name", tr: "Kat adı" },
  del_floor: { en: "Delete floor", tr: "Katı sil" },
  del_row: { en: "Delete row", tr: "Sırayı sil" },
  unplaced: { en: "Not placed yet", tr: "Yerleştirilmedi" },
  unplaced_s: {
    en: "Drag onto a row — or tap to send it to the last row.",
    tr: "Bir sıraya sürükle — ya da dokun, son sıraya eklenir.",
  },
  wider: { en: "Wider", tr: "Genişlet" },
  narrower: { en: "Narrower", tr: "Daralt" },
  remove: { en: "Remove", tr: "Çıkar" },
  flat_hint: {
    en: "One floor with a few rows is a flat. Add floors for a house — the label only shows when there is more than one.",
    tr: "Tek kat, birkaç sıra = daire. Ev için kat ekle — etiket yalnızca birden fazla kat varsa görünür.",
  },
  /* room page */
  room_river: { en: "Day river", tr: "Gün Nehri" },
  river_hint: { en: "tap a slot to edit its rule", tr: "dilime dokun → kuralı düzenle" },
  now_at: { en: "NOW", tr: "ŞİMDİ" },
  in_slot: { en: "you are in this slot", tr: "şu an bu dilimdesin" },
  copy_to: { en: "Copy", tr: "Kopyala" },
  undo: { en: "Undo", tr: "Geri al" },
  copy_h: { en: "Copy {s} onto", tr: "{s} ayarlarını kopyala" },
  copy_s: {
    en: "Pick the slots to overwrite. Every setting on this card is copied — "
      + "the lights, how it comes on, the thresholds and the timings.",
    tr: "Üzerine yazılacak dilimleri seç. Bu karttaki her ayar kopyalanır — "
      + "ışıklar, nasıl açılacağı, eşikler ve süreler.",
  },
  copy_do: { en: "Pick a slot", tr: "Bir dilim seç" },
  copy_do_n: { en: "Copy onto {n} slots", tr: "{n} dilime kopyala" },
  copy_done: { en: "Copied onto {s}", tr: "{s} dilimine kopyalandı" },
  copy_undone: { en: "Put back", tr: "Geri alındı" },
  copy_none: { en: "There is no other slot", tr: "Başka dilim yok" },
  watch_dark: { en: "Switch on when it gets dark", tr: "Karanlık çökünce aç" },
  watch_dark_s: {
    en: "You do not have to move: if the room goes dark while you are sitting "
      + "in it, the light comes on by itself.",
    tr: "Kıpırdaman gerekmez: sen otururken oda kararırsa ışık kendiliğinden "
      + "yanar. (Yoksa sistem yalnızca hareket anında karar verir.)",
  },
  check_every: { en: "Check every", tr: "Kontrol aralığı" },
  check_every_s: {
    en: "How often the room's lux is read while somebody is sitting in it. "
      + "Only used when the threshold above is on.",
    tr: "Sen odadayken lux değerinin kaç saniyede bir okunacağı. Yalnızca "
      + "yukarıdaki ışık eşiği açıkken kullanılır.",
  },
  enter_off: { en: "Switch off when this slot begins", tr: "Dilim başlarken söndür" },
  enter_off_s: {
    en: "The moment this slot starts, anything still on goes out — even if "
      + "somebody is in the room, and whoever switched it on.",
    tr: "Bu dilim başladığı anda yanan ışıklar söner — odada biri olsa da, "
      + "ışığı kim açmış olursa olsun.",
  },
  slot_on: { en: "Switch on in this slot", tr: "Bu dilimde aç" },
  slot_on_s: { en: "should motion light the room up", tr: "hareket gelince ışık yansın mı" },
  lux_max: { en: "Light threshold", tr: "Işık eşiği" },
  lux_max_none: {
    en: "off — motion alone decides",
    tr: "kapalı — kararı yalnızca hareket verir",
  },
  lux_max_s: { en: "brighter than this and we stay off", tr: "oda bundan aydınlıksa açma" },
  lux_max_off: {
    en: "the slot is off, but this still switches on when the room is dark",
    tr: "dilim kapalı ama oda bunun altına düşerse yine de açar",
  },
  never_on: {
    en: "This slot switches on for nothing: it is off and the darkness rule is ignored.",
    tr: "Bu dilim hiç açmaz: dilim kapalı ve karanlık kuralı da yok sayılıyor.",
  },
  how_on: { en: "How it comes on", tr: "Nasıl açılsın" },
  how_on_s: { en: "a fixed setting, a scene, or as you left it", tr: "sabit ayar, sahne, ya da son bıraktığın gibi" },
  how_set: { en: "Fixed", tr: "Sabit ayar" },
  how_scene: { en: "Scene", tr: "Sahne" },
  how_last: { en: "Last setting", tr: "Son ayar" },
  color: { en: "Colour", tr: "Renk" },
  color_s: { en: "instead of white", tr: "beyaz yerine" },
  no_color: { en: "White", tr: "Beyaz" },
  scene: { en: "Which scene", tr: "Hangi sahne" },
  scene_s: { en: "activated as it is, nothing else touched", tr: "olduğu gibi çalışır, başka şeye dokunulmaz" },
  at_once: { en: "at once", tr: "hemen" },
  lux_off: { en: "ignore the sensor", tr: "sensöre bakma" },
  which_groups: { en: "Which groups", tr: "Hangi gruplar" },
  slot_trigger: { en: "Wakes it in this slot", tr: "Bu dilimde uyandıran" },
  slot_trigger_s: { en: "movement here switches the light on",
                    tr: "burada hareket olunca ışık açılır" },
  slot_trigger_any: { en: "any one of them is enough",
                      tr: "herhangi biri yeter" },
  slot_trigger_all: { en: "all of them must have seen something",
                      tr: "hepsi bir şey görmüş olmalı" },
  slot_hold: { en: "Keeps it awake in this slot", tr: "Bu dilimde uyanık tutan" },
  slot_hold_s: { en: "stops the light going dark while you are here",
                 tr: "sen buradayken ışığın sönmesini engeller" },
  slot_hold_any: { en: "any one of them keeps it on",
                   tr: "herhangi biri açık tutar" },
  slot_hold_all: { en: "all of them must see you", tr: "hepsi seni görmeli" },
  which_trigger: { en: "Which sensors wake it", tr: "Hangi sensörler uyandırsın" },
  which_trigger_s: {
    en: "Only these count as movement in this slot. None picked means all of them.",
    tr: "Bu dilimde yalnızca bunlar hareket sayılır. Hiçbiri seçili değilse hepsi.",
  },
  all_triggers: { en: "All sensors", tr: "Tüm sensörler" },
  which_lights: { en: "Which lights come on", tr: "Hangi ışıklar açılır" },
  which_off: { en: "Which lights go out", tr: "Hangi ışıklar söner" },
  which_off_s: {
    en: "empty means the whole room",
    tr: "boş bırakırsan odanın tamamı söner",
  },
  which_lights_s: {
    en: "groups and single lamps, in any combination",
    tr: "gruplar ve tek tek lambalar, istediğin karışımda",
  },
  picked_n: { en: "{n} bulbs will switch on", tr: "{n} ışık yanacak" },
  pick_lights: { en: "Choose lights", tr: "Işık seç" },
  pick_change: { en: "Change", tr: "Değiştir" },
  which_groups_s: { en: "different lights per slot", tr: "dilime göre farklı ışık" },
  all_lights: { en: "All lights", tr: "Tüm ışıklar" },
  bri_first: { en: "If nothing is remembered", tr: "Hatırlanan yoksa" },
  bri_first_s: {
    en: "The level to use the first time, before there is a last setting.",
    tr: "Henüz bir \"son ayar\" yokken kullanılacak parlaklık.",
  },
  bri_kelvin: { en: "Brightness & tone", tr: "Parlaklık & ton" },
  off_after: { en: "Switch off when empty", tr: "Boşalınca söndür" },
  off_after_s: { en: "warns by dimming first", tr: "önce kısarak uyarır" },
  what_now: { en: "What would happen now?", tr: "Şu an ne olurdu?" },
  would_on: { en: "I WOULD SWITCH ON", tr: "AÇARDIM" },
  would_off: { en: "I WOULD STAY OFF", tr: "AÇMAZDIM" },
  pick_sensor: { en: "Choose a sensor", tr: "Sensör seç" },
  pick_sensor_s: {
    en: "Pick as many as you like; they are added when you are done.",
    tr: "İstediğin kadar seç, bitirdiğinde hepsi eklenir.",
  },
  pick_here: { en: "In this room", tr: "Bu odada" },
  pick_free: { en: "Not in any room yet", tr: "Henüz hiçbir odada değil" },
  pick_taken: { en: "In another room", tr: "Başka bir odada" },
  pick_add_n: { en: "Add {n}", tr: "{n} tanesini ekle" },
  pick_none: {
    en: "Home Assistant has no more sensors of this kind.",
    tr: "Home Assistant'ta bu türden başka sensör yok.",
  },
  mode_any: { en: "Any one", tr: "Herhangi biri" },
  mode_all: { en: "All of them", tr: "Hepsi birden" },
  and_window: { en: "Agreement window", tr: "Uzlaşma penceresi" },
  and_window_s: {
    en: "\"All of them\" means every sensor saw something within this long — "
      + "not in the same instant, which they would never manage.",
    tr: "\"Hepsi birden\", her sensörün bu süre içinde bir şey görmesi demek — "
      + "aynı saniyede değil, onu asla tutturamazlar.",
  },
  and_ok: { en: "All of them have seen something", tr: "Hepsi bir şey gördü" },
  and_waiting: {
    en: "Not all of them yet — the light stays off",
    tr: "Henüz hepsi değil — ışık açılmaz",
  },
  hold_all_w: {
    en: "With \"all of them\" a single sensor losing sight of you counts as an "
      + "empty room, and the light goes out while you are still there.",
    tr: "\"Hepsi birden\" seçiliyken tek bir sensörün seni kaçırması oda boş "
      + "sayılır ve sen içerideyken ışık söner.",
  },
  trigger_last: {
    en: "A slot needs at least one sensor — switch the slot off instead.",
    tr: "Bir dilimde en az bir sensör kalmalı — dilimi kapatmak istersen "
      + "\"Bu dilimde aç\"ı kapat.",
  },
  which_trigger_all: {
    en: "All of the room's sensors. Remove one and only this slot stops "
      + "listening to it.",
    tr: "Odanın tüm sensörleri. Birini çıkarırsan yalnızca bu dilim onu "
      + "dinlemeyi bırakır.",
  },
  sec_trigger: { en: "Wakes the room", tr: "Uyandıran" },
  sec_trigger_s: { en: "switches the light on", tr: "ışığı açar" },
  sec_hold: { en: "Keeps it awake", tr: "Uyanık Tutan" },
  sec_hold_s: { en: "stops it going dark", tr: "sönmesini engeller" },
  sec_temp: { en: "Temperature", tr: "Sıcaklık" },
  temp_pick: { en: "Choose sensors", tr: "Sensör seç" },
  temp_s: {
    en: "Pick the room's thermometers; the card shows their average.",
    tr: "Odanın sıcaklık sensörlerini seç; kart ortalamalarını gösterir.",
  },
  no_image: { en: "No picture yet", tr: "Henüz resim yok" },
  sec_lux: { en: "Darkness meter", tr: "Karanlık Ölçer" },
  sec_lights: { en: "Lights", tr: "Işıklar" },
  sec_groups: { en: "Your own groups", tr: "Kendi Grupların" },
  ha_groups: { en: "Home Assistant light groups", tr: "HA ışık grupları" },
  ha_groups_note: {
    en: "A group switches every light inside it — including any that live in another room.",
    tr: "Grup, içindeki tüm ışıkları birlikte yakar — başka odada duranlar dahil.",
  },
  members_n: { en: "{n} lights", tr: "{n} ışık" },
  groups_n: { en: "{n} groups", tr: "{n} grup" },
  sec_pool: { en: "In this room", tr: "Bu odadaki cihazlar" },
  sec_pool_s: { en: "drag onto a role above", tr: "yukarıdaki role sürükle" },
  hold_note: {
    en: "While one of these still sees you the light never goes out — no darkness in the middle of a film.",
    tr: "Bunlardan biri seni gördüğü sürece ışık asla sönmez — film ortasında karanlık kalmazsın.",
  },
  lux_note: {
    en: "The value is frozen the moment we switch on, so the lamp cannot argue with its own sensor.",
    tr: "Işığı açtığımız an değer dondurulur; lamba kendi sensörüyle tartışamaz.",
  },
  frozen: { en: "frozen", tr: "donduruldu" },
  add_group: { en: "+ Group", tr: "+ Grup" },
  group_name: { en: "Group name", tr: "Grup adı" },
  drop_here: { en: "drop here…", tr: "buraya bırak…" },
  dnd_hint: {
    en: "Drag and drop — or tap to pick. Dropping on a room in the left rail moves the device to that room.",
    tr: "Sürükleyip bırak — ya da dokunup seç. Soldaki oda satırına bırakmak cihazı o odaya taşır.",
  },
  room_settings: { en: "Room settings", tr: "Oda Ayarları" },
  delay_on: { en: "Trigger delay", tr: "Tetik gecikmesi" },
  delay_on_s: { en: "ignore someone just passing through", tr: "geçerken yanmasın" },
  dim_warn: { en: "Dim warning", tr: "Kapanma uyarısı" },
  dim_warn_s: {
    en: "Dims before going dark; move and it comes back. Off by default: some "
      + "bulbs read a slow dim as \"switch on\" and light up again. If yours "
      + "do that, leave this off. Switches skip it — they cannot dim.",
    tr: "Sönmeden önce kısar, kıpırdarsan geri gelir. Varsayılan kapalı: bazı "
      + "ampuller yavaş kısılmayı \"aç\" diye anlayıp geri yanıyor. Seninkiler "
      + "öyleyse kapalı bırak. Anahtarlar bu adımı atlar — kısılamazlar.",
  },
  stuck_notify: { en: "Light left on in an empty room", tr: "Boş odada kalan ışık" },
  stuck_notify_s: {
    en: "LUMEN puts an empty room out once. If a light is on again — a bulb "
      + "that relights itself, a switch somebody left — it does not fight it, "
      + "it tells you.",
    tr: "LUMEN boşalan odayı bir kez söndürür. Işık yine yanıyorsa — kendi "
      + "kendine yanan bir ampul, açık kalmış bir anahtar — onunla güreşmez, "
      + "sana haber verir.",
  },
  stuck_after: { en: "Tell me after", tr: "Şu kadar sonra haber ver" },
  stuck_after_s: {
    en: "how long it may burn in an empty room before it is worth a word",
    tr: "boş odada ne kadar yanarsa söylemeye değer",
  },
  manual_off: { en: "Tidy up after me", tr: "Arkamdan topla" },
  manual_off_s: { en: "also switch off what you turned on (3x later)", tr: "elle açtığını da söndür (3 kat sonra)" },
  transition: { en: "Fade", tr: "Sönerken yumuşat" },
  transition_s: {
    en: "Off by default, which is the plain switch-off Home Assistant sends. "
      + "Some bulbs read a slow fade as \"switch on\" and light up again a "
      + "minute later — if that happens to yours, leave this off.",
    tr: "Varsayılan kapalı: Home Assistant'ın gönderdiği düz söndürme. Bazı "
      + "ampuller yavaş sönmeyi \"aç\" diye anlayıp bir dakika sonra geri "
      + "yanıyor — seninkilerde oluyorsa kapalı bırak.",
  },
  slot_follow: { en: "Follow the slot", tr: "Dilimi takip et" },
  slot_follow_s: { en: "re-tune while already on", tr: "yanarken yeni dilime uyar" },
  neighbors: { en: "Borrow triggers from", tr: "Şu odaların tetiğini kullan" },
  neighbors_s: { en: "for rooms without a sensor", tr: "sensörsüz odalar için" },
  mode_off: { en: "Leave alone in these modes", tr: "Bu modlarda karışma" },
  upload: { en: "Upload a picture", tr: "Resim yükle" },
  clear_img: { en: "Remove", tr: "Kaldır" },
  room_type: { en: "Room type", tr: "Oda tipi" },
  room_icon: { en: "Room icon", tr: "Oda simgesi" },
  room_icon_s: {
    en: "Any Material Design icon name, or pick one below. Empty follows the "
      + "room type.",
    tr: "İstediğin Material Design simgesinin adını yaz, ya da aşağıdan seç. "
      + "Boş bırakırsan oda tipininki kullanılır.",
  },
  icon_auto: { en: "from the type", tr: "tipinden" },
  icon_reset: { en: "Back to the type", tr: "Tipe dön" },
  room_log: { en: "This room's log", tr: "Bu Odanın Günlüğü" },
  room_on: { en: "Engine on for this room", tr: "Bu odada motor açık" },
  room_on_s: {
    en: "off, and LUMEN leaves this room to you",
    tr: "kapatırsan LUMEN bu odaya karışmaz",
  },
  room_kit: { en: "What this room has", tr: "Bu odanın cihazları" },
  room_kit_s: {
    en: "its lights, its sensors, its meters — all of it",
    tr: "ışıkları, sensörleri, ölçerleri — hepsi burada",
  },
  lock2h: { en: "Leave alone 2 h", tr: "2 saat karışma" },
  unlock: { en: "Unlock", tr: "Kilidi aç" },
  turn_on: { en: "Switch on", tr: "Aç" },
  turn_off: { en: "Switch off", tr: "Kapat" },
  /* modes page */
  modes_h: { en: "House modes", tr: "Ev Modları" },
  modes_s: {
    en: "A mode never rewrites your rules — it bends them. Everything below is optional.",
    tr: "Mod kurallarını değiştirmez, büker. Aşağıdaki her şey isteğe bağlı.",
  },
  m_live: { en: "running", tr: "çalışıyor" },
  alone_lead: {
    en: "Walk into a room and every other room goes dark that instant — even a "
      + "room whose sensor still says somebody is there, because a motion "
      + "sensor holds for a while after you leave. Mark a room \"leave alone\" "
      + "to keep it out of this.",
    tr: "Bir odaya girdiğin anda diğer bütün odalar söner — sensörü hâlâ "
      + "\"biri var\" diyen oda dahil, çünkü hareket sensörü sen çıktıktan "
      + "sonra bir süre daha açık kalır. Sönmesini istemediğin odayı "
      + "\"Dokunma\" ile işaretle.",
  },
  alone_room: { en: "Room", tr: "Oda" },
  alone_auto: {
    en: "the room's own: {s}",
    tr: "odanın kendi sensörü: {s}",
  },
  alone_enter: { en: "Counts as arriving", tr: "Geldim sayılır" },
  alone_keep: { en: "Leave alone", tr: "Dokunma" },
  alone_pick_s: {
    en: "Which of {s}'s sensors mean you have just walked in. Choosing all of "
      + "them is the same as choosing none.",
    tr: "{s} odasının hangi sensörleri \"az önce girdim\" demek. Hepsini "
      + "seçmek hiçbirini seçmemekle aynı şeydir.",
  },
  alone_nosensor: { en: "no sensors", tr: "sensörü yok" },
  alone_keep_n: {
    en: "{s} is never switched off by this mode.",
    tr: "{s} bu modda hiçbir zaman söndürülmez.",
  },
  m_normal_s: {
    en: "Nothing is bent. Every room follows its own rules, hour by hour — "
      + "which is what the rest of the panel is for.",
    tr: "Hiçbir şey bükülmez. Her oda kendi kurallarıyla, saat saat çalışır — "
      + "panelin geri kalanı zaten bunun için.",
  },
  m_bri: { en: "Force brightness", tr: "Parlaklığı sabitle" },
  m_kelvin: { en: "Force tone", tr: "Tonu sabitle" },
  m_expire: { en: "Expire after", tr: "Kendi kendine bitsin" },
  m_expire_s: { en: "so guest mode is not still on next week", tr: "misafir modu haftaya kalmasın" },
  m_off: { en: "off", tr: "kapalı" },
  m_free: { en: "free", tr: "serbest" },
  add_mode: { en: "+ Mode", tr: "+ Mod" },
  mode_name: { en: "Mode name", tr: "Mod adı" },
  del_mode: { en: "Delete mode", tr: "Modu sil" },
  active: { en: "active", tr: "aktif" },
  /* slots page */
  slots_h: { en: "Time slots", tr: "Zaman Dilimleri" },
  slots_s: {
    en: "Slots are shared by every room: you set when each one begins, and it runs until the next one starts — so no hour is ever without a rule, or under two. Sunrise and sunset options follow the season by themselves.",
    tr: "Dilimler tüm odalarda ortaktır: her birinin ne zaman başladığını söylersin, bir sonrakine kadar sürer — böylece hiçbir saat kuralsız ya da iki kurallı kalmaz. Gündoğumu/günbatımı seçenekleri mevsimle kendiliğinden kayar.",
  },
  slot_from: { en: "Starts", tr: "Başlar" },
  stats_stay: { en: "Time in the room", tr: "Odada geçirilen zaman" },
  stats_stay_s: {
    en: "straight from the movement sensors, last 30 days",
    tr: "doğrudan hareket sensörlerinden, son 30 gün",
  },
  stats_stay_none: {
    en: "Nothing counted yet — this fills in as the sensors see you.",
    tr: "Henüz sayılmadı — sensörler seni gördükçe dolar.",
  },
  tf_clock: { en: "Clock", tr: "Saat" },
  tf_sunrise: { en: "Sunrise", tr: "Gündoğumu" },
  tf_sunset: { en: "Sunset", tr: "Günbatımı" },
  tf_exact: { en: "exactly", tr: "tam" },
  tf_before: { en: "min before", tr: "dk önce" },
  tf_after: { en: "min after", tr: "dk sonra" },
  tf_today: { en: "today {t}", tr: "bugün {t}" },
  gap_w: {
    en: "{a} → {b} belongs to no slot ({n} min). The engine falls back to the first slot there.",
    tr: "{a} → {b} hiçbir dilime ait değil ({n} dk). Motor orada ilk dilime düşer.",
  },
  gap_fix: { en: "Close the gap", tr: "Boşluğu kapat" },
  gap_manual: { en: "Set the hours yourself", tr: "Saatleri elle ayarla" },
  slot_to: { en: "Ends", tr: "Biter" },
  until_next: { en: "when {s} begins", tr: "{s} başlayınca" },
  until_wrap: { en: "runs to the next slot", tr: "sonraki dilime kadar" },
  add_slot: { en: "+ Slot", tr: "+ Dilim" },
  slots_tidy: { en: "Tidy up", tr: "Otomatik düzenle" },
  tidy_ok: { en: "Already in order", tr: "Zaten düzenli" },
  tidy_fixed: { en: "{n} slots put right", tr: "{n} dilim düzeltildi" },
  del_slot: { en: "Delete slot", tr: "Dilimi sil" },
  del_slot_q: { en: "Delete this slot?", tr: "Bu dilim silinsin mi?" },
  del_slot_b: {
    en: "Every room's rule for this slot is deleted with it. {n} rooms are affected.",
    tr: "Bu dilime ait tüm oda kuralları da silinir. {n} oda etkilenir.",
  },
  del_slot_heir: {
    en: "{s} takes over its hours, so no hour is left without a rule.",
    tr: "Saatlerini {s} devralır, böylece kuralsız saat kalmaz.",
  },
  sun_now: { en: "Sunrise {a} · sunset {b}", tr: "Gündoğumu {a} · günbatımı {b}" },
  /* log */
  log_all: { en: "Every room", tr: "Hepsi" },
  ago_now: { en: "saw you that instant", tr: "o an gördü" },
  ago_saw: { en: "saw you {t} earlier", tr: "{t} önce gördü" },
  ago_lost: { en: "not seeing you ({t})", tr: "görmüyordu ({t}dir)" },
  ago_unknown: { en: "no timing", tr: "süre bilinmiyor" },
  log_h: { en: "Decision log", tr: "Karar Günlüğü" },
  log_s: {
    en: "Every switch, and the reason for it. This page is the answer to “why did that light do that?”",
    tr: "Her karar ve sebebi. Bu sayfa “o ışık neden öyle yaptı?” sorusunun cevabıdır.",
  },
  clear_log: { en: "Clear", tr: "Temizle" },
  clear_log_q: { en: "Clear the log?", tr: "Günlük temizlensin mi?" },
  no_log: { en: "Nothing logged yet.", tr: "Henüz kayıt yok." },
  /* settings */
  settings: { en: "Settings", tr: "Ayarlar" },
  language: { en: "Language", tr: "Dil" },
  art_h: { en: "The look of the house", tr: "Evin görünümü" },
  art_s: {
    en: "Drop a picture into a box, or click it to choose one. Two of each: the "
      + "one that shows follows the hour.",
    tr: "Kutuya bir resim sürükle, ya da üstüne tıklayıp seç. Her biri iki "
      + "tane: hangisinin görüneceğini saat belirler.",
  },
  art_floor_day: { en: "Floor · day", tr: "Zemin · gündüz" },
  art_floor_night: { en: "Floor · night", tr: "Zemin · gece" },
  art_back_day: { en: "Behind · day", tr: "Arka plan · gündüz" },
  art_back_night: { en: "Behind · night", tr: "Arka plan · gece" },
  photo_head: { en: "Room photos", tr: "Oda fotoğrafları" },
  photo_off_style: { en: "While the room is dark", tr: "Oda karanlıkken" },
  photo_off_style_s: {
    en: "What a photograph does when the room's lights are off.",
    tr: "Odanın ışıkları kapalıyken fotoğrafa ne olacağı.",
  },
  photo_dark: { en: "Darken", tr: "Karart" },
  photo_gray: { en: "Black and white", tr: "Siyah-beyaz" },
  photo_both: { en: "Both", tr: "İkisi birden" },
  photo_off_amt: { en: "How dark when off", tr: "Kapalıyken koyuluk" },
  photo_off_amt_s: {
    en: "Nothing at all on the left, almost black on the right.",
    tr: "Solda hiç, sağda neredeyse siyah.",
  },
  photo_on_amt: { en: "How dark when lit", tr: "Açıkken koyuluk" },
  photo_on_amt_s: {
    en: "A lit room keeps its warm glow over the picture; this only decides "
      + "how much of the photograph shows through.",
    tr: "Yanan oda sıcak parıltısını korur; bu yalnızca fotoğrafın ne kadar "
      + "görüneceğini belirler.",
  },
  room_photo: { en: "Room photo", tr: "Oda fotoğrafı" },
  room_photo_s: {
    en: "A picture of the room itself, shown on its card. Dim while the room "
      + "is dark, bright when its lights are on.",
    tr: "Odanın kendi fotoğrafı, kartının üstünde görünür. Oda karanlıkken "
      + "loş, ışıkları yanınca aydınlık.",
  },
  art_drop: { en: "drop a picture", tr: "resmi buraya bırak" },
  art_done: { en: "Picture saved", tr: "Resim kaydedildi" },
  export_h: { en: "Keep a copy", tr: "Ayarları kaydet" },
  export_s: {
    en: "Every setting in one file, saved wherever your browser puts downloads.",
    tr: "Bütün ayarlar tek dosyada; tarayıcının indirdiklerini koyduğu yere iner.",
  },
  export_do: { en: "Save to my computer", tr: "Bilgisayarıma kaydet" },
  export_done: { en: "Saved", tr: "Kaydedildi" },
  import_do: { en: "Load a settings file", tr: "Ayar dosyası yükle" },
  import_s: {
    en: "Reads a file saved above and puts the house back the way it was. The "
      + "settings you have now are kept as a version first, so this can be "
      + "undone.",
    tr: "Yukarıdan kaydettiğin dosyayı okur ve evi o hâline döndürür. Şu anki "
      + "ayarların önce bir sürüm olarak saklanır, geri dönebilirsin.",
  },
  import_ask: {
    en: "Replace the current settings with this file? {n} rooms will be loaded.",
    tr: "Şu anki ayarların yerine bu dosya konsun mu? {n} oda yüklenecek.",
  },
  import_done: { en: "Settings loaded", tr: "Ayarlar yüklendi" },
  import_bad: {
    en: "This is not a LUMEN settings file.",
    tr: "Bu bir LUMEN ayar dosyası değil.",
  },
  report_h: { en: "Report a problem", tr: "Sorun bildir" },
  report_s: {
    en: "A light that stayed off, a room that will not go dark: send the "
      + "diagnostics file with it and the answer is usually in there. "
      + "Settings → Devices & services → Lumen HA → ⋮ → Download diagnostics.",
    tr: "Yanmayan ışık, sönmeyen oda: yanına tanılama dosyasını da ekle, cevap "
      + "çoğu zaman onun içinde çıkar. Ayarlar → Cihazlar ve servisler → "
      + "Lumen HA → ⋮ → Tanılamayı indir.",
  },
  /* Dosya herkese açık bir sayfaya yükleniyor; içinde ne olduğunu ÖNCEDEN
   * bilmek kullanıcının hakkı. Fotoğraf yolları ve bildirim servisi
   * maskeleniyor, ama oda ve cihaz adları teşhis için gerekli — onlarsız
   * "hangi sensör ne dedi" sorusunun cevabı yok. */
  report_priv: {
    en: "What is in that file: your room names and device names, the entity "
      + "ids they use, each room's current verdict, and the last 100 diary "
      + "lines (which room, when). Uploaded photo paths and your notify "
      + "service are masked. It goes to a public page — read it first if any "
      + "of that is private to you.",
    tr: "Dosyada ne var: oda adların, cihaz adların, kullandıkları entity "
      + "kimlikleri, her odanın o anki kararı ve son 100 günlük satırı (hangi "
      + "oda, ne zaman). Yüklediğin fotoğrafların yolu ve bildirim servisin "
      + "maskeleniyor. Dosya herkese açık bir sayfaya gidiyor — bunlardan "
      + "biri sana özelse önce bir bak.",
  },
  report_do: { en: "Open the issue page", tr: "Sorun bildirme sayfasını aç" },
  report_diag: { en: "Where is the file?", tr: "Dosya nerede?" },
  backups: { en: "Version history", tr: "Sürüm geçmişi" },
  backups_s: { en: "Every save keeps the previous version.", tr: "Her kayıt öncesini saklar." },
  restore: { en: "Restore", tr: "Geri yükle" },
  restore_q: { en: "Restore this version?", tr: "Bu sürüm geri yüklensin mi?" },
  restore_b: {
    en: "The current configuration is saved as a version first, so this can be undone too.",
    tr: "Mevcut ayar önce sürüm olarak kaydedilir; bu işlem de geri alınabilir.",
  },
  no_backups: { en: "No versions yet.", tr: "Henüz sürüm yok." },
  cancel: { en: "Cancel", tr: "Vazgeç" },
  yes: { en: "Yes", tr: "Evet" },
  close: { en: "Close", tr: "Kapat" },
  secs: { en: "s", tr: "sn" },
  mins: { en: "min", tr: "dk" },
  hours: { en: "h", tr: "saat" },
  off: { en: "off", tr: "kapalı" },
  search_ph: { en: "Search by name or entity id…", tr: "İsim ya da entity ile ara…" },
  search_none: { en: "Nothing matches that", tr: "Eşleşen bir şey yok" },
  picked_sel: { en: "{n} of {t} chosen", tr: "{t} içinden {n} seçili" },
  pick_nothing: { en: "Nothing chosen yet", tr: "Henüz hiçbiri seçili değil" },
  save: { en: "Save", tr: "Kaydet" },
  save_n: { en: "Save {n}", tr: "{n} tanesini kaydet" },
  none: { en: "none", tr: "yok" },
};

const CSS = `
:host{display:block;min-height:100%;background:#0c0a10;color:#fff;
  font-family:'Inter','Segoe UI',system-ui,sans-serif;}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
button,.rr,.dev,.pick,.sec-act,.addsec,.tgl,.win,.mchip,.mode-card,.slot,.rs{
  touch-action:manipulation;user-select:none;-webkit-user-select:none;}
ha-icon{--mdc-icon-size:20px;display:inline-flex;vertical-align:middle;}

.top{position:sticky;top:0;z-index:6;background:rgba(12,10,16,.85);backdrop-filter:blur(12px);
  border-bottom:1px solid rgba(255,255,255,.06);}
.topwrap{max-width:1160px;margin:0 auto;display:flex;align-items:center;gap:12px;padding:14px 28px;}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:2.5px;font-size:14px;}
.brand .logo{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#ec4b88,#8b3dff);
  display:flex;align-items:center;justify-content:center;color:#fff;}
.brand .logo ha-icon{--mdc-icon-size:18px;}
.status{margin-left:auto;font-size:13px;opacity:0;transition:opacity .25s;color:#5fe39a;}
.gear{margin-left:14px;width:38px;height:38px;border-radius:11px;border:1px solid rgba(255,255,255,.09);
  background:rgba(255,255,255,.04);color:#b9aeb8;cursor:pointer;display:flex;align-items:center;
  justify-content:center;transition:.15s;flex:0 0 auto;}
.gear:hover{color:#ff9cc1;border-color:rgba(236,75,136,.5);background:rgba(236,75,136,.08);}

.wrap{max-width:1160px;margin:0 auto;padding:34px 28px 90px;}
/* On the house page the drawing says all of this better, and the words had
 * started to lie: there is no dragging your home into place any more, and no
 * windows to tap. The line under "Gece Evi" carries what is left. */
.iso-wrap.flatview .stage3d{align-items:flex-start;}
.wrap.bare .hero-l,.wrap.bare .hero-h,.wrap.bare .hero-s{display:none;}
.wrap.bare{padding-top:16px;}
.hero-l{font-size:12px;letter-spacing:3px;color:#6f6675;text-transform:uppercase;}
.hero-h{font-family:Georgia,'Times New Roman',serif;font-size:36px;font-weight:500;margin:6px 0 4px;}
.hero-s{font-size:14.5px;color:#9a90a0;margin-bottom:30px;max-width:660px;line-height:1.55;}

.layout{display:flex;gap:34px;align-items:flex-start;}
@media(max-width:860px){.layout{flex-direction:column;}.rail{width:100%!important;position:static!important;}}

.rail{width:236px;flex:0 0 auto;position:sticky;top:86px;}
.rail-l{font-size:11px;letter-spacing:2.5px;color:#5d5464;text-transform:uppercase;padding:16px 14px 8px;}
.rr{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:12px;cursor:pointer;
  color:#93899b;position:relative;transition:.16s;}
.rr:hover{color:#e8dfe8;background:rgba(255,255,255,.035);}
.rr.on{color:#fff;background:linear-gradient(90deg,rgba(236,75,136,.15),rgba(139,61,255,.05) 70%,transparent);}
.rr.on::before{content:"";position:absolute;left:-2px;top:9px;bottom:9px;width:3px;border-radius:3px;
  background:linear-gradient(#ec4b88,#8b3dff);box-shadow:0 0 14px rgba(236,75,136,.8);}
.rr ha-icon{--mdc-icon-size:19px;opacity:.85;flex:0 0 auto;}
.rr.on ha-icon{color:#ff8fb3;opacity:1;}
.rr .n{flex:1;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.rr .c{font-size:11px;color:#5d5464;font-variant-numeric:tabular-nums;}
.rr.on .c{color:#b9a0c0;}
.rr .lit{width:7px;height:7px;border-radius:50%;background:#ffcf5c;box-shadow:0 0 8px rgba(255,207,92,.9);flex:0 0 auto;}
.rr .warnb{color:#ffb86b;--mdc-icon-size:15px;}
.rr.raildrop{background:rgba(236,75,136,.22)!important;outline:2px dashed rgba(236,75,136,.7);outline-offset:-2px;}

.stage{flex:1;min-width:0;position:relative;}
.glow{position:absolute;top:-90px;left:-60px;width:420px;height:280px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(236,75,136,.14),rgba(139,61,255,.06) 60%,transparent);
  pointer-events:none;filter:blur(6px);}
.stage-h{position:relative;display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap;
  padding:2px 0 6px;margin-bottom:6px;}
.room-title{font-family:Georgia,serif;font-size:42px;font-weight:500;line-height:1.05;}
.room-meta{font-size:13px;color:#8d8290;padding-bottom:9px;letter-spacing:.2px;}
.room-meta b{color:#cfc4ce;font-weight:600;}
.stage-h .head-act{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}

.sec{position:relative;padding:16px 0 12px 24px;margin-bottom:4px;
  transition:background .14s,border-color .14s,opacity .14s;}
.sec::before{content:"";position:absolute;left:0;top:24px;bottom:16px;width:2px;border-radius:2px;
  background:linear-gradient(rgba(236,75,136,.85),rgba(139,61,255,.35) 60%,transparent);}
.sec-h{display:flex;align-items:center;gap:10px;margin-bottom:13px;min-height:26px;flex-wrap:wrap;}
.sec-name{font-size:12px;letter-spacing:2.6px;text-transform:uppercase;color:#e2d7e0;font-weight:600;}
.sec-count{font-size:11px;color:#5d5464;font-variant-numeric:tabular-nums;letter-spacing:.5px;}
.sec-act{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.sec.dropok{background:rgba(139,61,255,.07);border-radius:16px;}
.sec.dropok::before{background:linear-gradient(#b58cff,#ec4b88);box-shadow:0 0 14px rgba(139,61,255,.8);}
.sec.dropok .sec-name{color:#c9a8ff;}

.devflow{display:flex;flex-wrap:wrap;gap:7px;}
.dev{display:inline-flex;align-items:center;gap:7px;padding:5px 10px 5px 8px;border-radius:17px;
  background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.055);cursor:grab;
  transition:.16s;max-width:100%;}
.dev:hover{border-color:rgba(236,75,136,.55);background:rgba(236,75,136,.08);transform:translateY(-1px);}
.dev ha-icon{--mdc-icon-size:15px;color:#9a90a0;flex:0 0 auto;transition:.16s;}
.dev .dn{font-size:12.5px;color:#e7dce6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:190px;}
.dev .ds{font-size:11px;color:#6f6675;white-space:nowrap;font-variant-numeric:tabular-nums;}
.dev .dot{width:6px;height:6px;border-radius:50%;background:#413b46;flex:0 0 auto;transition:.2s;}
.dev.on ha-icon{color:#ffcf5c;} .dev.on .ds{color:#ffcf5c;}
.dev.on .dot{background:#ffcf5c;box-shadow:0 0 9px rgba(255,207,92,.9);}
.dev.pulse .dot{background:#ff5c9d;box-shadow:0 0 10px rgba(255,92,157,.95);animation:pp 1.1s ease-in-out infinite;}
.dev.dead{opacity:.45;}
.dev.dead .dot{background:#ff5c6f;box-shadow:0 0 8px rgba(255,92,111,.8);}
.dev.drag{opacity:.35;}
.dev.locked{cursor:default;opacity:.5;}
.dev.locked:hover{border-color:rgba(255,255,255,.055);background:rgba(255,255,255,.045);transform:none;}
.dev.inzone{border-color:rgba(157,92,255,.5);background:rgba(139,61,255,.13);}
.dev.ghost{border-style:dashed;opacity:.55;cursor:default;}
.dev.tapedit{cursor:pointer;}
.dev-x{border:none;background:none;color:#6f6675;cursor:pointer;padding:0 0 0 2px;display:flex;}
.dev-x ha-icon{--mdc-icon-size:14px;}
.dev-x:hover ha-icon{color:#ff8296;}
@keyframes pp{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.55);opacity:.6}}

/* Bir satır: solda ad ve açıklaması, sağda denetim. Açıklama kısalmadığı
 * için uzun cümleler denetimi alt satıra itiyordu — metin sütunu artık
 * daralabiliyor, denetim de kendi yerini koruyor. */
.row{display:flex;align-items:center;gap:14px;padding:12px 2px;
  border-bottom:1px solid rgba(255,255,255,.045);flex-wrap:nowrap;}
.row:last-child{border-bottom:none;}
.row .rl{flex:1 1 auto;min-width:0;}
.row > *:not(.rl){flex:0 0 auto;}
.row .rl b{display:block;font-size:13.5px;color:#f0e8f0;font-weight:600;}
.row .rl small{display:block;font-size:11.5px;color:#7d7280;line-height:1.4;}
/* Dar ekranda denetim alta iner — orada zaten yan yana sığmaz. */
@media(max-width:620px){
  .row{flex-wrap:wrap;}
  .row .rl{flex:1 1 100%;}
  .row > *:not(.rl){margin-left:auto;}
}
.row .rr2{margin-left:auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap;}

.tgl{width:42px;height:24px;border-radius:20px;background:#2a2530;position:relative;cursor:pointer;
  transition:.2s;flex:0 0 auto;}
.tgl .k{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:.2s;}
.tgl.on{background:linear-gradient(90deg,#8b3dff,#ec4b88);}
.tgl.on .k{left:21px;}

.sl{display:flex;align-items:center;gap:12px;min-width:180px;max-width:290px;
  flex:0 0 auto;}
.sl input[type=range]{flex:1;-webkit-appearance:none;appearance:none;height:4px;border-radius:99px;
  background:#2a2530;outline:none;min-width:110px;}
.sl input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;
  background:#fff;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.6);}
.sl input[type=range]::-moz-range-thumb{width:16px;height:16px;border:none;border-radius:50%;
  background:#fff;cursor:pointer;}
.sl .v{font-size:12.5px;color:#e7dce6;font-weight:600;min-width:78px;text-align:right;
  font-variant-numeric:tabular-nums;}
.sl.kel input[type=range]{background:linear-gradient(90deg,#ff9d45,#ffd9a8,#fff6e8,#cfe8ff);}

.pick{display:inline-flex;align-items:center;gap:8px;padding:9px 16px 9px 12px;border-radius:20px;
  font-size:13px;color:#b9aeb8;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);
  cursor:pointer;transition:.14s;}
.pick ha-icon{--mdc-icon-size:16px;}
.pick:hover{color:#e8dfe8;}
.pick.on{color:#fff;background:rgba(236,75,136,.17);border-color:rgba(236,75,136,.65);}
.pick.tiny{padding:6px 12px;font-size:12px;}

.addsec{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;
  border-radius:22px;border:1px dashed rgba(255,255,255,.2);background:none;color:#cfc4ce;
  cursor:pointer;font:inherit;font-size:13.5px;transition:.15s;}
.addsec:hover{border-color:#ec4b88;color:#ff9cc1;background:rgba(236,75,136,.07);}
.addsec.tiny{padding:6px 13px;font-size:12.5px;}

.btn{padding:10px 20px;border-radius:20px;border:none;cursor:pointer;font:inherit;font-size:13.5px;
  background:linear-gradient(90deg,#8b3dff,#ec4b88);color:#fff;transition:.15s;}
.btn:hover{filter:brightness(1.2);}
.btn.ghost{background:none;border:1px solid rgba(255,255,255,.16);color:#b9aeb8;}
.btn[disabled]{opacity:.4;cursor:default;filter:none;}

.nsel{appearance:none;-webkit-appearance:none;background:rgba(255,255,255,.05);color:#e7dce6;
  border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:9px 34px 9px 13px;font:inherit;
  font-size:13.5px;cursor:pointer;min-width:210px;max-width:100%;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23b58cff' stroke-width='3'><path d='M6 9l6 6 6-6'/></svg>");
  background-repeat:no-repeat;background-position:right 12px center;}
.nsel option{background:#18141f;color:#e7dce6;}
.nin{background:#1b1721;border:1px solid rgba(255,255,255,.1);border-radius:11px;color:#fff;
  padding:9px 12px;font:inherit;font-size:13.5px;outline:none;max-width:100%;}
.nin:focus{border-color:#ec4b88;}
.nin.mini{width:110px;text-align:center;font-variant-numeric:tabular-nums;}

.safenote{display:flex;align-items:flex-start;gap:9px;margin-top:12px;padding:10px 12px;
  border-radius:12px;background:rgba(139,61,255,.09);border:1px solid rgba(157,92,255,.25);
  font-size:11.5px;color:#c9a8ff;line-height:1.5;}
.safenote ha-icon{--mdc-icon-size:15px;flex:0 0 auto;}
.safenote.warn{background:rgba(255,184,107,.09);border-color:rgba(255,184,107,.3);color:#ffd9a8;}
.warnbox{display:flex;align-items:center;gap:11px;margin:16px 0 4px;padding:12px 16px;border-radius:14px;
  background:rgba(255,184,107,.09);border:1px solid rgba(255,184,107,.32);font-size:13px;color:#ffd9a8;}
.empty{color:#6f6675;font-size:13.5px;padding:6px 0;line-height:1.6;}
.hint{font-size:12px;color:#6f6675;line-height:1.6;margin-top:14px;padding-left:24px;}
.hint b{color:#b58cff;font-weight:500;}

.ov{position:fixed;inset:0;z-index:50;background:rgba(8,6,12,.74);backdrop-filter:blur(9px);
  display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:40px 16px 60px;}
.ov.editor{z-index:60;}
.ov.picker{z-index:70;background:rgba(8,6,12,.6);}
.ov.confirm{z-index:80;}
.ed{width:100%;max-width:680px;background:#131017;border:1px solid rgba(255,255,255,.09);
  border-radius:22px;padding:26px 26px 22px;box-shadow:0 30px 80px rgba(0,0,0,.7);}
.ed.slim{max-width:460px;}
.ed-t{font-family:Georgia,serif;font-size:24px;margin-bottom:2px;}
.ed-s{font-size:13px;color:#8d8290;margin-bottom:22px;line-height:1.5;}
.ed-l{font-size:11px;letter-spacing:2.4px;text-transform:uppercase;color:#b58cff;
  margin:24px 0 10px;display:flex;align-items:center;gap:8px;}
.ed-l.first{margin-top:0;}
.ed-foot{display:flex;gap:10px;margin-top:24px;flex-wrap:wrap;}
.ed-foot .right{margin-left:auto;}
`;


/* ── Night House + Day River + pages ─────────────────────────────────────── */
const CSS2 = `
.scene{position:relative;border-radius:22px;overflow:hidden;border:1px solid rgba(255,255,255,.06);
  background:linear-gradient(180deg,#0e0b18 0%,#120d1e 45%,#0d0a14 100%);padding:46px 30px 0;}
.moon{position:absolute;top:26px;right:52px;width:44px;height:44px;border-radius:50%;
  background:radial-gradient(circle at 38% 35%,#f0e8f0,#b9aeb8 70%);
  box-shadow:0 0 40px rgba(240,232,240,.25);opacity:.85;}
.moon.sun{background:radial-gradient(circle at 38% 35%,#fff3d6,#ffb86b 72%);
  box-shadow:0 0 46px rgba(255,184,107,.35);}
.skystars{position:absolute;inset:0;background-image:
  radial-gradient(1px 1px at 8% 12%,rgba(255,255,255,.4),transparent),
  radial-gradient(1px 1px at 24% 8%,rgba(255,255,255,.25),transparent),
  radial-gradient(1.5px 1.5px at 44% 15%,rgba(255,255,255,.3),transparent),
  radial-gradient(1px 1px at 66% 6%,rgba(255,255,255,.28),transparent),
  radial-gradient(1px 1px at 86% 18%,rgba(255,255,255,.2),transparent);}
.house{position:relative;max-width:820px;margin:0 auto;}
.roof{height:0;border-left:60px solid transparent;border-right:60px solid transparent;
  border-bottom:54px solid #1c1626;width:56%;margin:0 auto;position:relative;box-sizing:content-box;}
.roof::after{content:"";position:absolute;left:-72px;right:-72px;top:52px;height:8px;
  background:#241d31;border-radius:4px;}
.body2{background:#181321;border:1px solid rgba(255,255,255,.05);border-top:none;
  padding:22px 22px 0;display:flex;flex-direction:column;gap:14px;}
.floor{display:flex;gap:14px;align-items:stretch;}
.floor-l{writing-mode:vertical-rl;transform:rotate(180deg);font-size:9.5px;letter-spacing:2.5px;
  color:#4a444f;text-transform:uppercase;text-align:center;flex:0 0 auto;padding:2px 0;}
.floor-rows{flex:1;min-width:0;display:flex;flex-direction:column;gap:12px;}

/* The plan. gap:0 + a border on every room means neighbours SHARE a wall — the
 * single change that makes this read as a home instead of a grid of cards. The
 * outer wall is thicker than the inner ones, the way a real plan is drawn. */
.plan{position:relative;display:grid;gap:0;--cellh:132px;--wall:rgba(255,255,255,.13);
  border:3px solid #2b2338;border-radius:9px;background:#0d0a13;overflow:hidden;
  box-shadow:0 0 0 1px rgba(255,255,255,.03),0 26px 60px -30px rgba(0,0,0,.9);}
@media(max-width:700px){.plan{--cellh:108px;}}
.cellx{position:relative;border-right:1px solid rgba(255,255,255,.035);
  border-bottom:1px solid rgba(255,255,255,.035);}

.win{position:relative;background:#0f0c15;border:1px solid var(--wall);
  padding:10px 12px;cursor:pointer;transition:background .28s,border-color .28s;
  overflow:hidden;display:flex;flex-direction:column;min-width:0;}
.win:hover{border-color:rgba(236,75,136,.65);z-index:3;}
/* Visible as soon as edit mode is on — a handle nobody can find is not a handle. */
.win .wn{font-family:Georgia,serif;font-size:14.5px;color:#9a90a0;position:relative;z-index:2;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.win .ws{font-size:10px;color:#5d5464;margin-top:2px;position:relative;z-index:2;
  font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.win .wb{margin-top:auto;display:flex;gap:5px;flex-wrap:wrap;position:relative;z-index:2;padding-bottom:2px;}
.tag{font-size:9.5px;padding:2px 7px;border-radius:8px;background:rgba(0,0,0,.42);color:#8d8290;
  font-variant-numeric:tabular-nums;backdrop-filter:blur(3px);}
.tag.lux{color:#5fd0e3;} .tag.tmr{color:#ffcf5c;} .tag.wrn{color:#ffb86b;}
.timefield{display:flex;flex-direction:column;gap:7px;flex:1 1 300px;min-width:280px;}
.tf-l{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#8d8290;}
.tf-line{display:flex;gap:8px;align-items:center;}
.tf-line > *{flex:1 1 0;min-width:0;}
.tf-base,.tf-off,.tf-time{min-width:0;}
.tf-time{text-align:center;font-variant-numeric:tabular-nums;}
.tf-now{font-size:12px;color:#5fd0e3;font-variant-numeric:tabular-nums;}
.tf-derived{display:flex;align-items:center;height:44px;padding:0 16px;border-radius:13px;
  background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.09);
  color:#8d8290;font-size:15px;font-variant-numeric:tabular-nums;}
.rolebox{display:flex;flex-direction:column;gap:8px;align-items:flex-end;}
/* one slot per line, with air around it */
.slots .row{padding:22px 0;gap:26px;align-items:flex-start;}
.slots .rr2{display:flex;gap:26px;flex-wrap:wrap;flex:1 1 auto;align-items:flex-start;}
.slots .rl b{font-size:19px;}
.slots .nsel,.slots .nin{height:44px;font-size:14.5px;}
.statlist{display:flex;flex-direction:column;gap:8px;}
.sl-row{display:grid;grid-template-columns:1.4fr 2fr auto auto auto;gap:14px;
  align-items:center;padding:10px 14px;border-radius:13px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);}
.sl-n{display:flex;align-items:center;gap:9px;font-size:14px;color:#e7dce6;}
.sl-n ha-icon{--mdc-icon-size:17px;color:#9a90a0;}
.sl-bar{height:7px;border-radius:5px;background:rgba(255,255,255,.05);overflow:hidden;}
.sl-bar span{display:block;height:100%;border-radius:5px;
  background:linear-gradient(90deg,#8b3dff,#ec4b88);}
.sl-v{font-size:12.5px;color:#8d8290;font-variant-numeric:tabular-nums;
  min-width:74px;text-align:right;}
.sl-v b{color:#e7dce6;font-size:14px;}
.sl-v.money b{color:#ffcf5c;}
@media(max-width:760px){.sl-row{grid-template-columns:1fr auto;}
  .sl-bar{grid-column:1 / -1;}}
.hz-sum{display:flex;gap:8px;margin:2px 0 14px;}
.hz-tag{font-size:11px;letter-spacing:1.3px;text-transform:uppercase;padding:5px 11px;
  border-radius:9px;font-weight:600;}
.hz-tag.bad{color:#ff9aa6;background:rgba(255,107,125,.12);
  border:1px solid rgba(255,107,125,.35);}
.hz-tag.warn{color:#ffcf9a;background:rgba(255,184,107,.10);
  border:1px solid rgba(255,184,107,.3);}
.hz-ok{display:flex;align-items:center;gap:11px;padding:14px 16px;border-radius:14px;
  color:#8ce6b4;background:rgba(95,227,154,.07);border:1px solid rgba(95,227,154,.25);}
.hz-ok ha-icon{--mdc-icon-size:19px;}
.hz{position:relative;padding-left:26px;display:flex;flex-direction:column;gap:12px;}
.hz::before{content:"";position:absolute;left:12px;top:6px;bottom:6px;width:2px;
  border-radius:2px;background:linear-gradient(rgba(255,107,125,.55),
    rgba(255,184,107,.4) 55%,rgba(255,255,255,.05));}
.hz-item{position:relative;display:flex;gap:13px;align-items:flex-start;
  padding:11px 15px;border-radius:14px;background:rgba(255,255,255,.03);
  border:1px solid rgba(255,255,255,.05);}
.hz-dot{position:absolute;left:-26px;top:12px;width:25px;height:25px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  background:#12101a;border:2px solid rgba(255,255,255,.12);}
.hz-dot ha-icon{--mdc-icon-size:13px;}
.hz-item.bad{border-color:rgba(255,107,125,.3);background:rgba(255,107,125,.06);}
.hz-item.bad .hz-dot{border-color:#ff6b7d;color:#ff9aa6;
  box-shadow:0 0 12px rgba(255,107,125,.4);}
.hz-item.warn .hz-dot{border-color:#ffb86b;color:#ffcf9a;}
.hz-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}
.hz-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap;}
.hz-top ha-icon{--mdc-icon-size:15px;color:#9a90a0;}
.hz-room{font-size:13.5px;color:#e7dce6;}
.hz-kind{font-size:10px;letter-spacing:1.4px;text-transform:uppercase;color:#8d8290;
  padding:2px 8px;border-radius:7px;background:rgba(255,255,255,.05);}
.hz-item.bad .hz-kind{color:#ff9aa6;background:rgba(255,107,125,.12);}
.hz-text{font-size:12.5px;color:#9a90a0;line-height:1.5;}
.hz-body .btn{align-self:flex-start;margin-top:6px;}
.btn.tiny{padding:5px 11px;font-size:12px;margin-left:auto;}
/* Everything inside a dialog lines up on the same left edge — the hint's
 * page indent belongs to the page, not to a box 460px wide. */
.ed .hint{padding-left:0;}
.pick-search{width:100%;display:block;}
.pick-count{margin-top:12px;}
.ed .gpills{margin:0;}
.pickinfo{font-size:11.5px;color:#5fd0e3;font-variant-numeric:tabular-nums;
  align-self:center;white-space:nowrap;}
.swatch{width:26px;height:26px;border-radius:50%;cursor:pointer;flex:0 0 auto;
  border:2px solid rgba(255,255,255,.12);transition:.14s;}
.swatch:hover{transform:scale(1.12);}
.swatch.on{border-color:#fff;box-shadow:0 0 0 2px rgba(236,75,136,.7);}
.tag.sens{color:#9a90a0;display:inline-flex;align-items:center;gap:4px;}
.tag.sens ha-icon{--mdc-icon-size:12px;}
.tag.sens.live{color:#ff9cc1;background:rgba(236,75,136,.18);}
.win.lit{border-color:rgba(255,207,92,.65);
  background:linear-gradient(180deg,rgba(255,207,92,.28),rgba(255,158,60,.12) 65%,rgba(255,207,92,.05));}
.win.lit .wn{color:#fff;} .win.lit .ws{color:#ffcf5c;}
.win.lit::before{content:"";position:absolute;inset:0;z-index:1;
  background:radial-gradient(ellipse at 50% 0%,rgba(255,207,92,.3),transparent 65%);}
.win.lit::after{content:"";position:absolute;left:-14px;right:-14px;bottom:-18px;height:26px;z-index:1;
  background:radial-gradient(ellipse at 50% 0%,rgba(255,207,92,.22),transparent 70%);filter:blur(6px);}
.win.dim{border-color:rgba(255,207,92,.3);
  background:linear-gradient(180deg,rgba(255,207,92,.12),rgba(255,207,92,.02));}
.win.dim .wn{color:#e7dce6;}
.win.dashed{border-style:dashed;}
.win.paused{opacity:.5;}
.win .person{position:absolute;top:7px;right:9px;font-size:14px;z-index:3;animation:sway 2.6s ease-in-out infinite;}
@keyframes sway{0%,100%{transform:translateX(0)}50%{transform:translateX(-4px)}}
.win .ping{position:absolute;top:11px;right:12px;width:7px;height:7px;border-radius:50%;
  background:#ff5c9d;box-shadow:0 0 9px rgba(255,92,157,.95);animation:pp 1.1s infinite;z-index:3;}
.win .hold{position:absolute;top:11px;right:12px;width:7px;height:7px;border-radius:50%;
  background:#8b3dff;box-shadow:0 0 8px rgba(139,61,255,.9);z-index:3;}

.win.moving{outline:2px solid rgba(236,75,136,.8);outline-offset:-2px;}

.ground{height:34px;margin:0 -30px;background:linear-gradient(180deg,#0a0810,#0c0a10);
  border-top:1px solid rgba(255,255,255,.05);position:relative;}
.ground::before{content:"";position:absolute;top:-1px;left:10%;right:10%;height:1px;
  background:linear-gradient(90deg,transparent,rgba(139,61,255,.4),rgba(236,75,136,.4),transparent);}
.lamp{position:absolute;bottom:34px;left:34px;width:3px;height:74px;background:#241d31;border-radius:2px;}
.lamp::before{content:"";position:absolute;top:-8px;left:-6px;width:15px;height:10px;border-radius:50%;
  background:#2a2530;}
.lamp.on::before{background:#ffcf5c;box-shadow:0 0 22px rgba(255,207,92,.7);}

.hud{position:absolute;left:18px;top:16px;z-index:6;font-size:11.5px;color:#a8e4f0;
  background:rgba(12,10,16,.72);border:1px solid rgba(95,208,227,.3);border-radius:12px;
  padding:9px 13px;backdrop-filter:blur(8px);font-variant-numeric:tabular-nums;
  display:flex;align-items:center;gap:8px;max-width:62%;}
.hud .dot{width:6px;height:6px;border-radius:50%;background:#5fd0e3;
  box-shadow:0 0 8px rgba(95,208,227,.9);animation:pp 2s infinite;flex:0 0 auto;}
.hud b{color:#5fd0e3;}
.hud .txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.iso-wrap.flatview .hud{position:static;max-width:100%;margin:0 0 14px;}
.mchip-live{margin-left:7px;font-size:9.5px;letter-spacing:1.4px;text-transform:uppercase;
  padding:2px 7px;border-radius:7px;background:rgba(255,255,255,.14);color:#fff;}
.mchip.alone.on{border-color:rgba(95,208,227,.75);
  box-shadow:0 0 26px rgba(95,208,227,.35);}
.alone-lead{font-size:13px;color:#9a90a0;line-height:1.6;margin:2px 0 14px;}
.al-head{display:grid;grid-template-columns:1.1fr 2fr auto;gap:14px;padding:0 14px 6px;
  font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#6f6675;}
.al-row{display:grid;grid-template-columns:1.1fr 2fr auto;gap:14px;align-items:center;
  padding:9px 14px;border-radius:12px;background:rgba(255,255,255,.025);
  border:1px solid rgba(255,255,255,.05);margin-bottom:7px;}
.al-row.kept{border-color:rgba(255,207,92,.3);background:rgba(255,207,92,.05);}
.al-n{display:flex;align-items:center;gap:9px;font-size:13.5px;color:#e7dce6;}
.al-n ha-icon{--mdc-icon-size:17px;color:#9a90a0;}
.al-s{display:flex;min-width:0;}
.al-s .pick{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.al-none{font-size:12px;color:#6f6675;}
.al-k{display:flex;justify-content:flex-end;}
@media(max-width:760px){.al-head{display:none;}
  .al-row{grid-template-columns:1fr auto;}
  .al-s{grid-column:1 / -1;}}
/* ── Işık Hafızası ───────────────────────────────────────────────────── */
.iso-wrap.memory{padding-bottom:158px;
  background:radial-gradient(ellipse 90% 70% at 50% -10%,
    var(--skytint,rgba(255,77,143,.10)),transparent 60%);
  transition:background 1s;}
.memnote{position:relative;z-index:3;padding:70px 24px;text-align:center;
  color:#8b8fa3;font-size:14px;max-width:520px;margin:0 auto;line-height:1.55;}
.memground{position:absolute;inset:-240px;transform:translateZ(-2px);
  background-image:linear-gradient(#1b1d30 1px,transparent 1px),
    linear-gradient(90deg,#1b1d30 1px,transparent 1px);
  background-size:46px 46px;opacity:.3;
  -webkit-mask-image:radial-gradient(ellipse 60% 60% at 50% 50%,#000 35%,transparent 72%);
  mask-image:radial-gradient(ellipse 60% 60% at 50% 50%,#000 35%,transparent 72%);}
.mroom{position:absolute;transform-style:preserve-3d;}
.mroom .plate{position:absolute;inset:0;background:#12141f;border:1px solid #262941;
  border-radius:6px;overflow:hidden;transform:translateZ(0);transition:.4s;}
/* The same photograph as the live card, lit by what the room was doing at that
 * minute: dark when it was dark, bright when its lamps were on. */
.mroom .mphoto{position:absolute;inset:0;background-size:cover;
  background-position:center;border-radius:6px;
  filter:brightness(calc(.18 + var(--b,0) * .72)) saturate(calc(.55 + var(--b,0) * .5));
  transition:filter .45s ease;}
.mroom.hasphoto .plate{background:#0b0a10;}
.mroom .plate::after{content:'';position:absolute;inset:0;background:var(--mc,#f5b942);
  opacity:calc(var(--b,0) * .22);transition:opacity .4s;}
.mroom .mface{position:relative;z-index:2;display:flex;flex-direction:column;gap:2px;
  padding:9px 11px;}
.mroom .rname{font-size:13px;font-weight:600;letter-spacing:.01em;color:#e8e9f0;
  white-space:nowrap;}
.mroom .rmeta{font-family:ui-monospace,'JetBrains Mono',Menlo,monospace;font-size:10px;
  color:#8b8fa3;white-space:nowrap;}
.mroom .rmeta b{color:var(--mc,#f5b942);font-weight:500;}
.mroom .halo{position:absolute;inset:-16px;border-radius:14px;transform:translateZ(1px);
  pointer-events:none;opacity:var(--b,0);transition:opacity .4s;
  box-shadow:0 0 50px 6px color-mix(in srgb,var(--mc,#f5b942) 40%,transparent);}
.mroom .mbeam{position:absolute;left:50%;top:50%;width:0;height:0;
  transform-style:preserve-3d;pointer-events:none;}
.mroom .mbeam .b1,.mroom .mbeam .b2{position:absolute;bottom:0;
  left:calc(var(--bw) * -0.5);width:var(--bw);
  height:calc(var(--b,0) * var(--bmax));transform-origin:bottom;filter:blur(.5px);
  background:linear-gradient(to top,
    color-mix(in srgb,var(--mc,#f5b942) 85%,transparent),transparent 92%);
  opacity:calc(.25 + var(--b,0) * .75);
  transition:height .45s cubic-bezier(.2,.8,.2,1),opacity .4s;}
.mroom .mbeam .b1{transform:rotateX(-90deg);}
.mroom .mbeam .b2{transform:rotateX(-90deg) rotateY(90deg);}
.mroom .mbeam .cap{position:absolute;left:-5px;top:-5px;width:10px;height:10px;
  border-radius:50%;background:var(--mc,#f5b942);opacity:var(--b,0);
  box-shadow:0 0 14px 3px var(--mc,#f5b942);
  transform:translateZ(calc(var(--b,0) * var(--bmax)));
  transition:transform .45s cubic-bezier(.2,.8,.2,1),opacity .4s;}
/* the figure: a person on the plate, upright, facing whoever is looking */
.mroom .mwalk{position:absolute;left:0;top:93%;width:100%;height:0;
  transform-style:preserve-3d;pointer-events:none;opacity:0;transition:opacity .45s;}
.mroom.here .mwalk{opacity:1;}
.mroom .fig{position:absolute;left:5%;bottom:0;width:0;height:0;
  transform-style:preserve-3d;}
.mroom.here .fig{animation:mlive 13s ease-in-out infinite alternate;}
.mroom .fig .body{position:absolute;left:-48px;bottom:0;width:96px;height:120px;
  transform-origin:bottom center;transform:rotate(var(--rz,45deg)) rotateX(-90deg);
  transform-style:preserve-3d;}
/* Çizilmiş bir çöp adam yerine gerçek yürüyüş: 25 karelik saydam animasyon,
 * entegrasyonun kendi klasöründen gelir — dışarıdan hiçbir şey indirilmez. */
.mroom .fig .who{position:absolute;inset:0;background:var(--walk) center bottom /
  contain no-repeat;
  animation:mturn 26s steps(1,end) infinite;}
.mroom .fig .shadow{position:absolute;left:-28px;bottom:-6px;width:56px;height:17px;
  border-radius:50%;background:rgba(0,0,0,.5);filter:blur(3px);}
/* Gidiş dönüş: yön değişince figür de döner, sırtı gittiği yöne kalmaz. */
@keyframes mturn{0%{transform:scaleX(1)}50%{transform:scaleX(-1)}}
/* Canlı kart geniş: adam bir ucundan diğerine gider. */
@keyframes mlive{from{left:3%}to{left:95%}}
.tm .play.step{width:28px;height:28px;font-size:11px;
  border-color:rgba(255,255,255,.10);color:#b9a6b4;}
.tm .play.step:hover{border-color:#8b7bf7;color:#8b7bf7;}
@media (prefers-reduced-motion:reduce){
  :host(:not(.walkalways)) .mroom .mwalk{display:none;}
}
.tm{position:absolute;left:0;right:0;bottom:0;z-index:8;padding:10px 24px 12px;
  display:flex;flex-direction:column;gap:7px;
  border-top:1px solid rgba(255,255,255,.08);
  background:rgba(10,11,16,.92);backdrop-filter:blur(14px);}
.tm-top{display:flex;align-items:center;gap:14px;flex-wrap:wrap;}
.tm .play{width:34px;height:34px;border-radius:50%;flex:0 0 auto;
  border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);
  color:#fff;cursor:pointer;font-size:13px;display:grid;place-items:center;
  transition:.15s;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
.tm .play:hover{border-color:#8b7bf7;color:#8b7bf7;}
.tm-title{font-family:ui-monospace,'JetBrains Mono',Menlo,monospace;font-size:10px;
  letter-spacing:.22em;color:#565a6e;}
.tm .memranges{margin-left:auto;}
.tm-clock{font-family:ui-monospace,'JetBrains Mono',Menlo,monospace;font-size:22px;
  font-weight:500;letter-spacing:.05em;}
.tm-phase{font-family:ui-monospace,'JetBrains Mono',Menlo,monospace;font-size:10px;
  letter-spacing:.18em;padding:5px 12px;border-radius:6px;}
.tm .tmrail{position:relative;height:52px;touch-action:none;cursor:ew-resize;
  border-radius:10px;background:rgba(255,255,255,.045);
  border:1px solid rgba(255,255,255,.10);overflow:hidden;}
.tm .tmrail:hover{border-color:rgba(255,255,255,.20);}
.tm .tmrail.scrubbing{cursor:grabbing;border-color:#ec4b88;}
.tm .tmrail canvas{border-radius:9px;}
.tm .ghost{position:absolute;top:0;bottom:0;width:1px;
  background:rgba(255,255,255,.35);pointer-events:none;opacity:0;
  transition:opacity .12s;}
.tm .ghost.on{opacity:1;}
.tm .ghost .gtime{position:absolute;bottom:calc(100% + 6px);left:50%;
  transform:translateX(-50%);font-family:ui-monospace,Menlo,monospace;font-size:10px;
  color:#e8e9f0;background:rgba(12,8,14,.92);border:1px solid rgba(255,255,255,.12);
  border-radius:5px;padding:2px 6px;white-space:nowrap;}
.tm .tmrail canvas{position:absolute;inset:0;width:100%;height:100%;}
.tm .tmrail input{position:absolute;inset:0;width:100%;height:100%;opacity:0;
  cursor:ew-resize;margin:0;}
.tm .cursor{position:absolute;top:0;bottom:0;width:2px;background:#fff;
  border-radius:1px;pointer-events:none;box-shadow:0 0 10px rgba(255,255,255,.85);}
/* the handle: the thing your eye looks for and your finger goes to */
.tm .cursor::before{content:'';position:absolute;left:50%;top:50%;width:15px;
  height:15px;margin:-7.5px 0 0 -7.5px;border-radius:50%;background:#fff;
  box-shadow:0 0 0 3px rgba(236,75,136,.45),0 2px 6px rgba(0,0,0,.6);}
.tm .tmrail.scrubbing .cursor::before{box-shadow:0 0 0 5px rgba(236,75,136,.55),
  0 2px 8px rgba(0,0,0,.7);}
.tm .cursor::after{content:attr(data-t);position:absolute;top:-21px;left:50%;
  transform:translateX(-50%);font-family:ui-monospace,Menlo,monospace;font-size:10px;
  color:#e8e9f0;white-space:nowrap;}
.tm .ticks{display:flex;justify-content:space-between;
  font-family:ui-monospace,Menlo,monospace;font-size:9px;color:#565a6e;
  letter-spacing:.08em;}
@media (max-width:900px){
  .tm{padding:12px 14px 14px;}
  .tm .memranges{margin-left:0;width:100%;}
  .tm-clock{font-size:18px;}
}
/* ── odanın kendi fotoğrafı ─────────────────────────────────────────── */
.face.top .photo{position:absolute;inset:0;border-radius:22px;z-index:0;
  background-size:cover;background-position:center;transition:filter .55s ease;}
/* Yanan oda bu evde sarıdır; fotoğraf bunu elinden almasın diye sıcak yıkama
 * resmin altına değil üstüne biner. */
.room.on .face.top .photo::before{content:'';position:absolute;inset:0;
  border-radius:22px;pointer-events:none;mix-blend-mode:screen;
  background:linear-gradient(135deg,rgba(255,190,80,.30),rgba(255,150,40,.10) 55%,
    transparent 78%);}
.face.top .photo::after{content:'';position:absolute;inset:0;border-radius:22px;
  background:linear-gradient(180deg,rgba(8,6,10,.05) 0%,rgba(8,6,10,.34) 48%,
    rgba(8,6,10,.74) 100%);}
.face.top.hasphoto{border-color:rgba(255,255,255,.16);}
.room.on .face.top.hasphoto{box-shadow:0 0 34px -6px rgba(255,196,92,.45);}
.roomgrid .face.top .photo,.roomgrid .face.top .photo::after{border-radius:16px;}
.artgrid.one{grid-template-columns:1fr;max-width:420px;}
/* ── canlı kartın ön kenarında yürüyen biri ───────────────────────────
 * Hafızadakiyle aynı figür, aynı dosya; yalnız canlı kart daha büyük olduğu
 * için figür de büyük. Oturan adamla birlikte odanın "burada biri var"
 * hâlini kuruyorlar. */
.rchip.gone,.mwalk.gone{display:none;}
/* Parmak kartın tam kenarına değil yakınına dokunuyor; birkaç piksellik
 * görünmez bir pay, dokunuşun kaybolmasını önler. */
.room::after{content:'';position:absolute;inset:-10px;z-index:0;}
.roomgrid .room::after{inset:-6px;}
.room .mwalk{position:absolute;left:0;top:101%;width:100%;height:0;
  transform-style:preserve-3d;pointer-events:none;z-index:4;}
.room .mwalk .fig{position:absolute;left:3%;bottom:0;width:0;height:0;
  transform-style:preserve-3d;animation:mlive 13s ease-in-out infinite alternate;}
.room .mwalk .fig .body{position:absolute;left:-75px;bottom:0;width:150px;height:188px;
  transform-origin:bottom center;transform:rotate(var(--rz,45deg)) rotateX(-90deg);
  transform-style:preserve-3d;}
.room .mwalk .fig .who{position:absolute;inset:0;
  background:var(--walk) center bottom / contain no-repeat;
  animation:mturn 26s steps(1,end) infinite;}
.room .mwalk .fig .shadow{position:absolute;left:-42px;bottom:-8px;width:84px;
  height:24px;border-radius:50%;background:rgba(0,0,0,.5);filter:blur(4px);}
.flatview .mwalk{opacity:0;}
@media (prefers-reduced-motion:reduce){
  :host(:not(.walkalways)) .room .mwalk{display:none;}
}
.modestrip{position:absolute;left:50%;transform:translateX(-50%);bottom:46px;z-index:6;
  display:flex;flex-direction:row;gap:9px;align-items:center;
  background:rgba(12,10,16,.75);border:1px solid rgba(255,255,255,.1);
  border-radius:13px;padding:5px 8px 5px 12px;backdrop-filter:blur(8px);}
.modestrip ha-icon{--mdc-icon-size:17px;color:#ec4b88;}
.modesel{background:transparent;border:none;color:#e7dce6;font-size:12.5px;
  padding:2px 2px;cursor:pointer;-webkit-appearance:none;appearance:none;}
.modestrip .modechev{--mdc-icon-size:16px;color:#9a90a0;margin-left:-4px;
  pointer-events:none;}
.mchip{font-size:10.5px;padding:6px 13px;border-radius:11px;background:rgba(12,10,16,.75);
  border:1px solid rgba(255,255,255,.1);color:#93899b;backdrop-filter:blur(8px);cursor:pointer;
  text-align:center;display:flex;align-items:center;gap:6px;justify-content:center;}
.mchip ha-icon{--mdc-icon-size:14px;}
.mchip.on{color:#fff;border-color:rgba(236,75,136,.6);background:rgba(236,75,136,.22);}
@media(max-width:700px){
  .modestrip{position:static;transform:none;flex-wrap:wrap;margin:14px 0 0;justify-content:center;}
  .hud{position:static;max-width:100%;margin-bottom:14px;}
  .scene{padding:18px 16px 0;}
  .moon{display:none;}
}

.statgrid{display:flex;gap:10px;flex-wrap:wrap;}
.stat{flex:1;min-width:118px;border-radius:14px;background:rgba(255,255,255,.035);
  border:1px solid rgba(255,255,255,.055);padding:13px 15px;}
.stat .sv{font-family:Georgia,serif;font-size:26px;color:#fff;font-variant-numeric:tabular-nums;}
.stat .sv small{font-size:12px;color:#7d7280;}
.stat .sn{font-size:10.5px;letter-spacing:1.6px;text-transform:uppercase;color:#7d7280;margin-top:3px;}
.stat.gold .sv{color:#ffcf5c;}

/* hover preview of the room's day river */

.riverbar{position:relative;height:74px;border-radius:16px;overflow:hidden;
  border:1px solid rgba(255,255,255,.07);display:flex;}
.riverbar.mini{height:44px;border-radius:12px;}
.rs{position:relative;display:flex;flex-direction:column;justify-content:flex-end;padding:8px 10px;
  cursor:pointer;transition:.18s;border-right:1px solid rgba(12,10,16,.6);min-width:0;overflow:hidden;}
.rs:last-child{border-right:none;}
.riverbar.mini .rs{padding:5px 6px;}
.rs .rsn{font-size:11px;letter-spacing:1.8px;text-transform:uppercase;font-weight:600;
  position:relative;z-index:2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.riverbar.mini .rs .rsn{font-size:9px;letter-spacing:1.2px;}
.rs .rst{font-size:10px;color:rgba(255,255,255,.55);font-variant-numeric:tabular-nums;
  position:relative;z-index:2;white-space:nowrap;}
.riverbar.mini .rs .rst{font-size:9px;}
.rs:hover{filter:brightness(1.25);}
.rs.off{filter:grayscale(.7) brightness(.6);}
.rs.sel{outline:2px solid #ec4b88;outline-offset:-2px;z-index:3;}
.rs.sel::after{content:"";position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(236,75,136,.12),transparent);}
.luxline{position:absolute;inset:0;pointer-events:none;z-index:2;}
.nowline{position:absolute;top:-8px;bottom:-8px;width:2px;
  background:linear-gradient(#ec4b88,#8b3dff);box-shadow:0 0 12px rgba(236,75,136,.9);z-index:4;}
.nowline::after{content:"";position:absolute;left:50%;top:-4px;width:9px;height:9px;
  margin-left:-4.5px;border-radius:50%;background:#ff9cc1;
  box-shadow:0 0 10px rgba(236,75,136,.95);}
.nowline span{position:absolute;top:-16px;left:50%;transform:translateX(-50%);font-size:9.5px;
  letter-spacing:1.5px;color:#ff9cc1;white-space:nowrap;font-variant-numeric:tabular-nums;}
.riverbar.mini .nowline span{display:none;}
.rivermarks{display:flex;justify-content:space-between;font-size:10px;color:#5d5464;
  padding:7px 2px 0;font-variant-numeric:tabular-nums;}

.slotcard{margin-top:16px;border-radius:16px;background:#14111a;
  border:1px solid rgba(236,75,136,.25);padding:20px 22px;}
.sc-h{display:flex;align-items:baseline;gap:12px;margin-bottom:6px;flex-wrap:wrap;}
.sc-t{font-family:Georgia,serif;font-size:22px;}
.sc-s{font-size:11.5px;color:#8d8290;font-variant-numeric:tabular-nums;}
.sc-tools{display:flex;gap:6px;margin-left:auto;}
.sc-tools + .sc-badge,.sc-badge + .sc-tools{margin-left:0;}
.roomtype{margin-left:auto;min-width:180px;}
.ed-room{display:flex;align-items:center;gap:10px;}
.sc-badge{margin-left:auto;font-size:10.5px;letter-spacing:1.5px;color:#ff9cc1;
  background:rgba(236,75,136,.12);border:1px solid rgba(236,75,136,.4);padding:4px 10px;
  border-radius:10px;text-transform:uppercase;}
.decide{display:flex;align-items:center;gap:11px;margin-top:14px;padding:12px 15px;border-radius:13px;
  background:rgba(95,208,227,.07);border:1px solid rgba(95,208,227,.25);font-size:12.5px;
  color:#a8e4f0;font-variant-numeric:tabular-nums;line-height:1.45;}
.decide b{color:#5fd0e3;}
.decide.no{background:rgba(255,184,107,.07);border-color:rgba(255,184,107,.28);color:#ffd9a8;}
.decide.no b{color:#ffb86b;}
.decide .dot{width:7px;height:7px;border-radius:50%;background:#5fd0e3;
  box-shadow:0 0 8px rgba(95,208,227,.9);animation:pp 2s infinite;flex:0 0 auto;}
.decide.no .dot{background:#ffb86b;box-shadow:0 0 8px rgba(255,184,107,.9);}

.gpills{display:flex;gap:8px;flex-wrap:wrap;}
.mode-card{border-radius:16px;background:#14111a;border:1px solid rgba(255,255,255,.07);
  padding:16px 18px;margin-bottom:10px;}
.mode-card.on{border-color:rgba(236,75,136,.5);
  background:linear-gradient(160deg,rgba(236,75,136,.09),#14111a 60%);}
.mc-h{display:flex;align-items:center;gap:11px;flex-wrap:wrap;}
.mc-h ha-icon{--mdc-icon-size:19px;color:#b58cff;}
.mc-t{font-family:Georgia,serif;font-size:19px;}
.mc-badge{font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#ff9cc1;
  background:rgba(236,75,136,.14);border:1px solid rgba(236,75,136,.45);padding:3px 9px;border-radius:9px;}
.mc-act{margin-left:auto;display:flex;gap:8px;}

.lg{position:relative;padding-left:27px;display:flex;flex-direction:column;gap:10px;}
.lg::before{content:"";position:absolute;left:12px;top:8px;bottom:8px;width:2px;
  border-radius:2px;background:linear-gradient(rgba(236,75,136,.5),
    rgba(139,61,255,.35) 55%,rgba(255,255,255,.04));}
.lg-day{font-size:10.5px;letter-spacing:2px;color:#6f6675;margin:8px 0 0;
  font-variant-numeric:tabular-nums;}
.lg-item{position:relative;display:flex;gap:12px;align-items:flex-start;
  padding:10px 14px;border-radius:13px;background:rgba(255,255,255,.025);
  border:1px solid rgba(255,255,255,.05);}
.lg-dot{position:absolute;left:-27px;top:11px;width:24px;height:24px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;background:#12101a;
  border:2px solid rgba(255,255,255,.12);color:#8d8290;}
.lg-dot ha-icon{--mdc-icon-size:12px;}
.lg-item.ok .lg-dot{border-color:#5fe39a;color:#8ce6b4;
  box-shadow:0 0 10px rgba(95,227,154,.35);}
.lg-item.bad .lg-dot{border-color:#ff6b7d;color:#ff9aa6;}
.lg-item.warn .lg-dot{border-color:#ffb86b;color:#ffcf9a;}
.lg-item.hand .lg-dot{border-color:#b98aff;color:#cdb0ff;}
.lg-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;}
.lg-top{display:flex;align-items:center;gap:8px;}
.lg-top ha-icon{--mdc-icon-size:14px;color:#9a90a0;}
.lg-time{font-size:11.5px;color:#5fd0e3;font-variant-numeric:tabular-nums;}
.lg-room{font-size:13px;color:#e7dce6;}
.lg-text{font-size:12.5px;color:#9a90a0;line-height:1.5;}
.lg-detail{display:flex;flex-wrap:wrap;gap:6px;margin-top:3px;}
.lg-chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;
  padding:4px 10px;border-radius:9px;font-variant-numeric:tabular-nums;
  border:1px solid rgba(255,255,255,.07);color:#9a90a0;}
.lg-chip ha-icon{--mdc-icon-size:13px;}
.lg-chip.saw{color:#8ce6b4;border-color:rgba(95,227,154,.3);
  background:rgba(95,227,154,.06);}
.lg-chip.blind{color:#c9909a;border-color:rgba(255,107,125,.22);
  background:rgba(255,107,125,.05);}
.lg-lights{display:flex;align-items:flex-start;gap:7px;font-size:11.5px;color:#8d8290;
  margin-top:2px;line-height:1.5;}
.lg-lights ha-icon{--mdc-icon-size:13px;color:#ffcf5c;flex:0 0 auto;margin-top:1px;}
.logrow{display:flex;align-items:flex-start;gap:12px;padding:9px 2px;
  border-bottom:1px solid rgba(255,255,255,.045);font-size:12.5px;font-variant-numeric:tabular-nums;}
.logrow:last-child{border-bottom:none;}
.logrow .lt{color:#5d5464;flex:0 0 44px;}
.logrow .la{font-weight:600;flex:0 0 78px;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;}
.la.on{color:#5fe39a;} .la.off{color:#ff8296;} .la.dim{color:#ffcf5c;}
.la.block{color:#ffb86b;} .la.manual{color:#c9a8ff;} .la.slot{color:#5fd0e3;}
.la.fuse{color:#ff5c6f;} .la.mode,.la.engine,.la.setup,.la.lock{color:#9a90a0;}
.logrow .lr{color:#9a90a0;flex:1;line-height:1.45;}

.bkrow{display:flex;align-items:center;gap:12px;padding:10px 2px;
  border-bottom:1px solid rgba(255,255,255,.045);font-size:12.5px;font-variant-numeric:tabular-nums;}
.bkrow:last-child{border-bottom:none;}
.bkrow .bt{color:#e7dce6;flex:0 0 152px;}
.bkrow .bm{color:#7d7280;flex:1;}
`;









/* 0.14 — the room card carries its own day, and the room opens under the house */
const CSS7 = `
.win.picked{outline:2px solid rgba(236,75,136,.75);outline-offset:-2px;z-index:5;}
.win.dropin{outline:2px dashed rgba(236,75,136,.9);outline-offset:-3px;z-index:6;
  background:rgba(236,75,136,.16);}
.win .wgear{position:absolute;top:7px;right:7px;z-index:7;width:26px;height:26px;
  border-radius:9px;border:1px solid rgba(255,255,255,.14);background:rgba(12,10,16,.78);
  color:#cfc4ce;display:flex;align-items:center;justify-content:center;cursor:pointer;
  padding:0;opacity:0;transition:.16s;backdrop-filter:blur(4px);}
.win:hover .wgear,.win.picked .wgear{opacity:1;}
.win .wgear:hover{color:#ff9cc1;border-color:rgba(236,75,136,.6);background:rgba(236,75,136,.16);}
.win .wgear ha-icon{--mdc-icon-size:15px;}
.win.lit .wgear{opacity:.85;color:#3a2c10;background:rgba(255,207,92,.85);
  border-color:rgba(255,207,92,.9);}
.win.lit .wgear:hover{color:#2a1f06;background:#ffcf5c;}
@media(hover:none){.win .wgear{opacity:.9;}}

/* the day strip along the bottom of the room */
.win .wriver{position:absolute;left:10px;right:10px;bottom:9px;z-index:4;pointer-events:none;}
.win .wriver .riverbar{height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.08);
  background:#0b0910;overflow:visible;}
.win .wriver .rs{padding:0 5px;justify-content:center;border-right-color:rgba(12,10,16,.8);}
.win .wriver .rsn{font-size:8.5px;letter-spacing:.9px;line-height:1;opacity:.95;
  text-shadow:0 1px 2px rgba(0,0,0,.85);}
.win .wriver .rst{display:none;}
.win .wriver .rs.off .rsn{opacity:.35;}
.win .wriver .luxline{opacity:.9;}
.win .wriver .nowline{top:-3px;bottom:-3px;width:2px;border-radius:2px;}
.win .wriver .nowline span{display:none;}
/* the now marker gets a head, so it reads at a glance */
.win .wriver .nowline::after{content:"";position:absolute;left:50%;top:-4px;width:7px;height:7px;
  margin-left:-3.5px;border-radius:50%;background:#ff9cc1;
  box-shadow:0 0 8px rgba(236,75,136,.95);}
.win.lit .wriver .riverbar{border-color:rgba(255,207,92,.28);}
.win .wb{padding-bottom:44px;}
.win .ws{margin-bottom:2px;}

.roomdock{margin:22px 0 6px;padding:20px 22px 8px;border-radius:20px;background:#131017;
  border:1px solid rgba(236,75,136,.22);box-shadow:0 26px 60px -40px rgba(0,0,0,.9);}
.dock-h{display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,.05);margin-bottom:4px;}
.dock-h .head-act{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:nowrap;}
.dock-h .head-act .pick{height:38px;padding:0 16px;}
.dock-h .dock-x{width:38px;height:38px;flex:0 0 auto;}
@media(max-width:760px){.dock-h .head-act{margin-left:0;width:100%;flex-wrap:wrap;}}
.dock-t{font-family:Georgia,serif;font-size:26px;display:flex;align-items:center;gap:10px;}
.dock-t ha-icon{--mdc-icon-size:21px;color:#ff9cc1;}
.dock-m{font-size:12.5px;color:#8d8290;font-variant-numeric:tabular-nums;}
.dock-m b{color:#cfc4ce;font-weight:600;}
.dock-x{width:34px;height:34px;border-radius:11px;border:1px solid rgba(255,255,255,.1);
  background:rgba(255,255,255,.04);color:#b9aeb8;cursor:pointer;display:flex;
  align-items:center;justify-content:center;padding:0;}
.dock-x:hover{color:#ff8296;border-color:rgba(255,92,111,.5);background:rgba(255,92,111,.08);}
.dock-x ha-icon{--mdc-icon-size:17px;}
.roomdock .sec:first-of-type{padding-top:10px;}
@media(max-width:620px){.roomdock{padding:16px 14px 6px;}.dock-t{font-size:21px;}}
.ed.wide{max-width:900px;}
/* search */
.freshnote{display:flex;align-items:center;gap:13px;margin:0 0 16px;padding:12px 16px;
  border-radius:16px;background:rgba(139,61,255,.09);border:1px solid rgba(157,92,255,.3);}
.freshnote ha-icon{--mdc-icon-size:19px;color:#b58cff;flex:0 0 auto;}
.fresh-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.fresh-t b{font-size:13.5px;color:#e7dce6;font-weight:600;}
.fresh-t span{font-size:11.5px;color:#8d8290;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.freshnote .btn{flex:0 0 auto;}
.luxleg{position:absolute;right:8px;top:5px;z-index:5;display:flex;gap:8px;
  font-size:9.5px;font-variant-numeric:tabular-nums;pointer-events:none;}
.luxleg .lx{color:#5fd0e3;}
.luxleg .gate{color:#ffcf5c;}
.noluxs{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);z-index:5;
  text-align:center;font-size:9.5px;letter-spacing:1.4px;text-transform:uppercase;
  color:#4a444f;pointer-events:none;}
.searchbar{display:flex;align-items:center;gap:10px;margin:4px 0 2px;padding:9px 14px;
  border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
  transition:.15s;}
.searchbar:focus-within{border-color:rgba(236,75,136,.55);background:rgba(236,75,136,.06);}
.searchbar ha-icon{--mdc-icon-size:18px;color:#7d7280;flex:0 0 auto;}
.searchbar:focus-within ha-icon{color:#ff9cc1;}
.searchin{flex:1;min-width:0;background:none;border:none;outline:none;color:#f0e8f0;
  font:inherit;font-size:14px;}
.searchin::placeholder{color:#5d5464;}
.searchin::-webkit-search-cancel-button{display:none;}
.searchn{font-size:11.5px;color:#7d7280;font-variant-numeric:tabular-nums;flex:0 0 auto;}
.searchx{width:26px;height:26px;border-radius:8px;border:1px solid rgba(255,255,255,.1);
  background:rgba(255,255,255,.04);color:#9a90a0;cursor:pointer;display:flex;
  align-items:center;justify-content:center;padding:0;flex:0 0 auto;}
.searchx:hover{color:#ff8296;border-color:rgba(255,92,111,.45);}
.searchx ha-icon{--mdc-icon-size:14px;color:inherit;}
/* device groups: a quiet header, then the chips */
.kind-h{display:flex;align-items:center;gap:9px;margin:18px 0 9px;}
.kind-h:first-child{margin-top:4px;}
.kind-h ha-icon{--mdc-icon-size:16px;color:#ff9cc1;}
.kind-n{font-size:11px;letter-spacing:2.2px;text-transform:uppercase;color:#cfc4ce;font-weight:600;}
.kind-c{font-size:11px;color:#5d5464;font-variant-numeric:tabular-nums;}
.kind-h.mute ha-icon{color:#5d5464;}
.kind-h.mute .kind-n{color:#7d7280;}
.kind-more{font-size:11.5px;color:#6f6675;align-self:center;padding:0 4px;
  font-variant-numeric:tabular-nums;}
.ed-room{display:flex;align-items:center;gap:10px;}
.ed-room ha-icon{--mdc-icon-size:20px;color:#ff9cc1;}
.cellx{position:relative;border-right:1px solid rgba(255,255,255,.03);
  border-bottom:1px solid rgba(255,255,255,.03);}
`;

/* 0.42 — the house seen from above and to the side. Same rooms, same grid, same
 * live state; only the projection is new. Rooms that are lit rise off the floor,
 * so "which room is on" is answered by the shape of the house itself. */
const CSS8 = `
.nav{display:flex;gap:4px;margin-left:22px;flex-wrap:wrap;}
.navb{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:13px;
  border:1px solid transparent;background:none;color:#93899b;cursor:pointer;font:inherit;
  font-size:13.5px;transition:.15s;}
.navb:hover{color:#e8dfe8;background:rgba(255,255,255,.04);}
.navb.on{color:#fff;background:linear-gradient(100deg,rgba(236,75,136,.2),rgba(139,61,255,.12));
  border-color:rgba(236,75,136,.45);}
.navb ha-icon{--mdc-icon-size:17px;opacity:.85;}
.navb.on ha-icon{color:#ff8fb3;opacity:1;}
.navb .c{font-size:11px;color:#5d5464;font-variant-numeric:tabular-nums;}
.navb.on .c{color:#b9a0c0;}
@media(max-width:900px){.nav{margin-left:10px;}}
.navsel{display:none;}
/* Narrow enough that six buttons cannot sit side by side: one control, with
 * the name of the page on it and its count beside. */
@media(max-width:900px){
  .nav .navb{display:none;}
  .navsel{display:block;flex:1 1 auto;min-width:0;max-width:280px;
    height:40px;padding:0 34px 0 14px;border-radius:13px;font-size:14px;
    color:#e8dfe8;background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.1);-webkit-appearance:none;appearance:none;
    background-image:linear-gradient(45deg,transparent 50%,#9a90a0 50%),
      linear-gradient(135deg,#9a90a0 50%,transparent 50%);
    background-position:calc(100% - 19px) 17px,calc(100% - 13px) 17px;
    background-size:6px 6px,6px 6px;background-repeat:no-repeat;}
  .navsel:focus{outline:none;border-color:rgba(236,75,136,.55);}
  /* min-width:0 or the row refuses to shrink and pushes the gear off the
   * side of a phone — a flex item is as wide as its content until told
   * otherwise. */
  .nav{flex:1 1 auto;justify-content:flex-end;min-width:0;}
  .topwrap{gap:10px;}
}
@media(max-width:520px){
  /* Both the row and the control itself have to be allowed to shrink, or the
   * gear is pushed off the side of the phone. */
  .navsel{max-width:none;min-width:0;padding-right:30px;font-size:13.5px;}
  .brand span{display:none;}
  .topwrap{padding:12px 14px;gap:8px;}
  .gear{margin-left:6px;}
}
.stage{width:100%;}
.iso-wrap{position:relative;border-radius:22px;overflow:hidden;padding:26px 0 82px;
  background:radial-gradient(1100px 560px at 50% 0%,rgba(255,255,255,.025),transparent 65%),
             linear-gradient(180deg,#0a0a0c,#040405);
  border:1px solid rgba(255,255,255,.05);}
.iso-wrap .skystars{opacity:.7;}
.iso-moon{position:absolute;top:26px;right:44px;width:64px;height:64px;border-radius:50%;z-index:1;
  background:radial-gradient(circle at 34% 30%,#fdfcff,#cfc8dd 60%,#928aa9);
  box-shadow:0 0 60px 12px rgba(230,220,255,.16),inset -10px -8px 22px rgba(60,50,90,.45);}
.iso-moon.sun{background:radial-gradient(circle at 34% 30%,#fff6e2,#ffcf5c 62%,#e59a3a);
  box-shadow:0 0 60px 14px rgba(255,207,92,.24),inset -10px -8px 22px rgba(120,70,20,.4);}
.stage3d{transition:height .28s ease;perspective:3600px;display:flex;justify-content:center;align-items:center;
  position:relative;z-index:2;user-select:none;-webkit-user-select:none;}
.iso{transform-style:preserve-3d;transform:rotateX(56deg) rotateZ(-42deg);position:relative;
  flex:0 0 auto;transition:transform .8s cubic-bezier(.2,.8,.2,1);}

.flatview .room{transform:translateZ(0)!important;}
.flatview .side,.flatview .front,.flatview .beam{opacity:0;}
.side,.front,.beam{transition:opacity .4s .3s;}
.iso .floor{position:absolute;inset:-60px;transform:translateZ(-2px);border-radius:38px;
  background:repeating-linear-gradient(0deg,rgba(255,255,255,.045) 0 1px,transparent 1px 60px),
             repeating-linear-gradient(90deg,rgba(255,255,255,.045) 0 1px,transparent 1px 60px),
             radial-gradient(closest-side,rgba(255,255,255,.02),#050506 78%);
  border:1px solid rgba(255,255,255,.09);}
.room{position:absolute;transform-style:preserve-3d;cursor:pointer;
  transition:transform .35s cubic-bezier(.2,.9,.3,1.2);
  /* Tarayıcının çift-dokunuş beklemesi yok, mavi vurgu yok: parmak
   * kalkmadan tepki verilsin. */
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
/* İzometrik sahnede dikey sürükleme evi öne/arkaya yatırır; manipulation
 * onu tarayıcının kaydırmasına kaptırıyordu. Izgara/telefon düzeninde kart
 * bir liste öğesi, orada kaydırma kullanıcının hakkı — bu yüzden yalnız
 * sahnede. */
.stage3d .room{touch-action:none;}
/* Basıldığı an görünen tek şey: kart hafifçe içeri gider. Işığın gelmesi
 * yarım saniye sürse de dokunuşun duyulduğu belli olur. */
.room.pressed .face.top{transform:scale(.985);filter:brightness(1.12);}
.face.top{transition:transform .12s ease,filter .12s ease,
  border-color .35s,box-shadow .45s;}
.room:hover{filter:brightness(1.08);}
/* Sınıf çarpışması: .top panelin yapışkan başlığı için yazıldı, ama oda
 * kartının yüzü de "face top". Sekiz kartın her biri, hiç istenmediği hâlde
 * 12px'lik bir backdrop blur taşıyordu — yüz zaten donuk olduğu için
 * görünmüyor, ama hareket eden sahnede her kare yeniden hesaplanıyordu. */
.face.top{backdrop-filter:none;}
:host(.moving) .stage3d *{animation-play-state:paused!important;}
:host(.moving) .modestrip,:host(.moving) .cardbar button{backdrop-filter:none;}
:host(.moving) .beam,:host(.moving) .glow,
:host(.moving) .mwalk .fig .shadow,:host(.moving) .luxorb,
:host(.moving) .lx-line,:host(.moving) .iso-lux .lx-head{filter:none;}
.room.editing{cursor:grab;}
.room.editing .face.top{border-color:rgba(236,75,136,.35);
  box-shadow:0 0 0 1px rgba(236,75,136,.18) inset;}
.room.lifted{opacity:.45;}
.orbit-hint.editing{color:#ff9cc1;}
.face{position:absolute;inset:0;}
.face.top{border-radius:22px;border:1px solid rgba(255,255,255,.11);
  background:linear-gradient(135deg,#101012,#070708);padding:19px 21px;display:flex;
  flex-direction:column;gap:10px;overflow:hidden;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
.face.side,.face.front{background:linear-gradient(#1b1b1f,#08080a);
  border:1px solid rgba(255,255,255,.08);border-top:none;}
.room.on .face.top{background:linear-gradient(135deg,#231c0c,#0b0a07);
  border-color:rgba(255,207,92,.55);
  box-shadow:0 0 34px rgba(255,207,92,.28),inset 0 0 26px rgba(255,207,92,.08);}
.room.on .face.side,.room.on .face.front{background:linear-gradient(#43300f,#0b0a07);
  border-color:rgba(255,207,92,.3);}
.room.on::after{content:"";position:absolute;inset:-26px;border-radius:30px;
  background:radial-gradient(closest-side,rgba(255,207,92,.24),transparent 70%);
  transform:translateZ(-6px);pointer-events:none;}
.room.warn .face.top{border-color:rgba(255,184,107,.35);border-style:dashed;}
.room.picked .face.top{outline:2px solid #ec4b88;outline-offset:-2px;}
.beam{position:absolute;left:50%;top:50%;width:155px;height:155px;
  transform:translate(-50%,-50%) translateZ(2px);pointer-events:none;
  background:radial-gradient(closest-side,rgba(255,207,92,.4),transparent 70%);
  filter:blur(4px);animation:breathe 3.4s ease-in-out infinite;}
@keyframes breathe{50%{opacity:.55}}
/* The width is spelled out rather than left to the two offsets. An <svg> with
 * a viewBox is a replaced element with an intrinsic ratio, and for one that is
 * absolutely positioned with width:auto the browser takes the ratio over the
 * two offsets — so this graph was drawing itself 102 x 2.5 = 255px wide on
 * every card, whatever the room's size, and the day ended a third of the way
 * across instead of under the NOW mark. */
.iso-lux{display:block;width:100%;height:auto;flex:1 1 auto;min-height:38px;
  pointer-events:none;overflow:visible;color:#5fd0e3;}
.rname,.rmeta,.rchips,.rtl,.rtools{flex:0 0 auto;}
.face.top > *:not(.iso-lux):not(.luxorb):not(.photo){position:relative;z-index:1;}
.iso-lux .lx-area{stroke:none;}
.iso-lux .lx-zero{stroke:rgba(255,255,255,.13);stroke-width:1;
  vector-effect:non-scaling-stroke;}
.iso-lux .lx-gate{fill:none;stroke:#ec4b88;stroke-width:1;stroke-opacity:.5;
  stroke-dasharray:5 4;vector-effect:non-scaling-stroke;}
.room.on .iso-lux .lx-gate{stroke-opacity:.65;}
.iso-lux .lx-line{stroke-width:1.5;
  filter:drop-shadow(0 0 3px color-mix(in srgb,currentColor 55%,transparent));}
.iso-lux .lx-head{fill:currentColor;
  filter:drop-shadow(0 0 4px color-mix(in srgb,currentColor 80%,transparent));}
.iso-lux .lx-ping{fill:none;stroke:currentColor;stroke-width:.9;
  vector-effect:non-scaling-stroke;transform-box:fill-box;transform-origin:center;
  animation:lxbeat 2.6s cubic-bezier(.2,.7,.3,1) infinite;}
@keyframes lxbeat{
  0%{transform:scale(.6);opacity:.85;}
  18%{transform:scale(3);opacity:0;}
  100%{transform:scale(3);opacity:0;}}
.room.on .iso-lux{color:#ffcf5c;}
.room:hover .iso-lux .lx-line{filter:drop-shadow(0 0 6px currentColor);}
@media(prefers-reduced-motion:reduce){.iso-lux .lx-ping{animation:none;opacity:0;}}
.luxorb{position:absolute;top:16px;right:16px;width:76px;height:76px;z-index:2;
  border-radius:50%;color:#5fd0e3;padding:3px;
  background:conic-gradient(currentColor calc(var(--p,0)*1turn),
    rgba(255,255,255,.09) 0);
  filter:drop-shadow(0 0 9px color-mix(in srgb,currentColor 30%,transparent));}
.luxorb .in{width:100%;height:100%;border-radius:50%;display:flex;
  flex-direction:column;align-items:center;justify-content:center;
  background:radial-gradient(circle at 32% 26%,#1c1c22,#0a0a0d 72%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.07);}
.luxorb .v{font-size:22px;font-weight:700;color:#e7dce6;line-height:1;
  font-variant-numeric:tabular-nums;}
.luxorb .u{font-size:10px;letter-spacing:2px;color:#8d8290;margin-top:3px;
  text-transform:uppercase;}
.room.on .luxorb{color:#ffcf5c;}
.roomgrid .luxorb{width:46px;height:46px;top:12px;right:12px;padding:2px;}
.roomgrid .luxorb .v{font-size:13px;}
.roomgrid .luxorb .u{font-size:7px;margin-top:1px;}
.rchip.temp ha-icon{color:#ff9d76;}
.rname{display:flex;align-items:center;gap:13px;font-family:Georgia,serif;font-size:34px;}
.rmeta{font-size:24px;color:#8d8290;font-variant-numeric:tabular-nums;}
.rmeta b{color:#ffcf5c;}
.rchips{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;}
.rchip{display:inline-flex;align-items:center;gap:7px;font-size:20px;font-weight:600;
  padding:6px 14px;border-radius:12px;border:1px solid rgba(160,140,220,.16);
  background:rgba(255,255,255,.03);color:#e7dce6;font-variant-numeric:tabular-nums;}
.rchip ha-icon{--mdc-icon-size:22px;}
.rchip.presence{color:#8d8290;}
.rchip.presence.here{color:#ffcf5c;border-color:rgba(255,207,92,.45);
  background:rgba(255,207,92,.10);}
.rchip.presence.here ha-icon{color:#ffcf5c;filter:drop-shadow(0 0 6px rgba(255,207,92,.7));}
.rago{color:#5fd0e3;}
.artgrid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;}
@media(max-width:560px){.artgrid{grid-template-columns:1fr;}}
.artslot{position:relative;height:118px;border-radius:15px;cursor:pointer;
  border:1px dashed rgba(255,255,255,.16);background:rgba(255,255,255,.03);
  background-size:cover;background-position:center;display:flex;
  flex-direction:column;justify-content:space-between;padding:11px 13px;
  transition:.15s;overflow:hidden;}
.artslot:hover{border-color:rgba(236,75,136,.55);}
.artslot.over{border-color:#ec4b88;background-color:rgba(236,75,136,.12);
  box-shadow:0 0 0 3px rgba(236,75,136,.2);}
.artslot.busy{opacity:.5;pointer-events:none;}
.artslot.full{border-style:solid;}
.artslot.full::after{content:"";position:absolute;inset:0;
  background:linear-gradient(180deg,rgba(8,7,12,.72),rgba(8,7,12,.25));}
.as-l{position:relative;z-index:1;font-size:11px;letter-spacing:1.5px;
  text-transform:uppercase;color:#cfc4ce;}
.as-h{position:relative;z-index:1;display:flex;align-items:center;gap:7px;
  font-size:11.5px;color:#8d8290;}
.artslot.full .as-h{opacity:0;}
.as-h ha-icon{--mdc-icon-size:15px;}
.as-x{position:absolute;top:8px;right:8px;z-index:2;width:26px;height:26px;
  border-radius:8px;border:1px solid rgba(255,255,255,.16);background:rgba(10,9,14,.8);
  color:#e7dce6;display:flex;align-items:center;justify-content:center;cursor:pointer;
  padding:0;}
.as-x ha-icon{--mdc-icon-size:14px;}
.iso-wrap.hasart{background-size:cover;background-position:center;}
.iso .floor.hasart{background-size:cover;background-position:center;
  background-blend-mode:normal;}
.pick-box{position:relative;margin-bottom:14px;}
.pick-hints{display:none;position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:5;
  background:#1b1721;border:1px solid rgba(255,255,255,.12);border-radius:12px;
  overflow:hidden;box-shadow:0 18px 40px rgba(0,0,0,.6);max-height:230px;overflow-y:auto;}
.pick-hints.on{display:block;}
.pick-hint{padding:9px 13px;font-size:13px;color:#9a90a0;cursor:pointer;}
.pick-hint b{color:#fff;font-weight:600;}
.pick-hint:hover{background:rgba(236,75,136,.14);color:#e7dce6;}
.rchip.mot{color:#ff8fb3;border-color:rgba(236,75,136,.35);}
.rchip.per{color:#c9a8ff;border-color:rgba(139,61,255,.4);}
.rchip.lux{color:#5fd0e3;border-color:rgba(95,208,227,.35);}
.rchip.warnc{color:#ffb86b;border-color:rgba(255,184,107,.45);background:rgba(255,184,107,.06);}
.rchip.live{box-shadow:0 0 10px rgba(236,75,136,.45);}
.rtl{position:relative;height:30px;border-radius:15px;overflow:hidden;display:flex;
  font-size:16px;letter-spacing:.1em;font-weight:700;}
.rtl span.seg{display:flex;align-items:center;padding-left:10px;overflow:hidden;white-space:nowrap;}
.rtl .rnow{position:absolute;top:-3px;bottom:-3px;width:2px;background:#ec4b88;
  box-shadow:0 0 8px #ec4b88;}
.rtl .rnow::before{content:"";position:absolute;top:-4px;left:-3px;width:8px;height:8px;
  border-radius:50%;background:#ff9cc1;box-shadow:0 0 10px #ec4b88;}
/* Always on the card. It used to appear on hover, which meant it did not exist
 * at all on a touchscreen, and was a guess on a tilted one. */
.iconprev{display:flex;align-items:center;gap:11px;margin:10px 0 12px;
  font-size:13px;color:#8d8290;font-variant-numeric:tabular-nums;}
.iconprev ha-icon{--mdc-icon-size:30px;color:#ffcf5c;}
.iconrow{display:flex;gap:9px;align-items:center;margin-bottom:12px;}
.icon-hints{top:auto;}
.icon-hints .pick-hint{display:flex;align-items:center;gap:10px;}
.icon-hints ha-icon{--mdc-icon-size:19px;color:#ffcf5c;}
.iconrow .nin{flex:1;min-width:0;}
.rtoggle{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);
  border-radius:13px;padding:7px;display:flex;align-items:center;justify-content:center;
  cursor:pointer;color:#8d8290;flex:0 0 auto;transition:.15s;
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
.rtoggle:hover{border-color:rgba(236,75,136,.5);color:#e7dce6;}
.rtoggle:active{transform:scale(.92);}
.rtoggle.on{color:#3a2c10;background:rgba(255,207,92,.9);
  border-color:rgba(255,207,92,.95);
  box-shadow:0 0 18px rgba(255,207,92,.45);}
.rtoggle ha-icon{--mdc-icon-size:30px;}
.roomgrid .rtoggle{padding:5px;border-radius:10px;}
.roomgrid .rtoggle ha-icon{--mdc-icon-size:20px;}
.ov.logbox .ed{max-width:760px;}
.ov.logbox .loglist{max-height:62vh;overflow:auto;padding-left:30px;margin-top:14px;
  scrollbar-width:none;-ms-overflow-style:none;}
.ov.logbox .loglist::-webkit-scrollbar{width:0;height:0;}
.rgear{z-index:4;width:38px;height:38px;border-radius:12px;
  border:1px solid rgba(255,255,255,.16);background:rgba(12,10,16,.8);color:#cfc4ce;
  display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;opacity:.62;
  transition:.15s;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
.room:hover .rgear{opacity:1;border-color:rgba(236,75,136,.55);}
.rgear:active{transform:scale(.92);}
.room.on .rgear{opacity:.95;color:#3a2c10;background:rgba(255,207,92,.85);border-color:rgba(255,207,92,.9);}
.rgear ha-icon{--mdc-icon-size:23px;}
.roomgrid .rgear{width:36px;height:36px;border-radius:11px;opacity:.8;}
.rtools{display:flex;gap:10px;align-items:center;flex:0 0 auto;}
.roomgrid .face.top{padding:15px 16px;gap:8px;border-radius:16px;}
.roomgrid .rmeta{font-size:13px;}
.roomgrid .rchip{font-size:12px;padding:4px 9px;border-radius:9px;}
.roomgrid .rchip ha-icon{--mdc-icon-size:13px;}
.roomgrid .rtl{height:18px;font-size:10px;}
.roomgrid .iso-lux{min-height:30px;}
.roomgrid .rgear ha-icon{--mdc-icon-size:18px;}
.orbit-hint{position:absolute;left:20px;bottom:14px;z-index:3;font-size:11px;color:#5d5464;
  pointer-events:none;}
.floorname{position:relative;z-index:2;text-align:center;font-size:11px;letter-spacing:2.6px;
  text-transform:uppercase;color:#5d5464;margin-bottom:6px;}
/* the room list, moved under the house */
.roomstrip{display:flex;flex-wrap:wrap;gap:8px;}
.rs-item{display:inline-flex;align-items:center;gap:8px;
  padding:8px 14px;border-radius:16px;
  border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.035);cursor:pointer;
  transition:.15s;}
.lx-base{stroke:rgba(255,255,255,.09);stroke-width:1;vector-effect:non-scaling-stroke;}
.lx-line{fill:none;stroke-width:1.3;vector-effect:non-scaling-stroke;
  stroke-linejoin:round;stroke-linecap:round;}
.lx-head{fill:#5fd0e3;}
.rs-item:hover{border-color:rgba(236,75,136,.5);background:rgba(236,75,136,.08);}
.rs-item.on{border-color:rgba(255,207,92,.5);background:rgba(255,207,92,.1);}
.rs-item ha-icon{--mdc-icon-size:17px;color:#9a90a0;}
.rs-item.on ha-icon{color:#ffcf5c;}
.rs-item .n{font-size:13.5px;color:#e7dce6;}
.rs-item .c{margin-left:auto;font-size:11px;color:#6f6675;font-variant-numeric:tabular-nums;}
.rs-item .w{--mdc-icon-size:14px;color:#ffb86b;}
.roomgrid{display:grid;grid-template-columns:1fr;gap:12px;position:relative;z-index:2;}
@media(min-width:520px){.roomgrid{grid-template-columns:1fr 1fr;}}
/* A grid item will not shrink below its content unless it is told it may, and
 * the slot ribbon's three words are wider than a phone. Without this the card
 * pushes the page sideways and everything on the right — the gear included —
 * ends up off the screen. */
.roomgrid .room{position:relative;left:auto;top:auto;width:auto;height:auto;
  transform:none;min-width:0;}
.roomgrid .face.top,.roomgrid .rtl,.roomgrid .rname{min-width:0;}
.roomgrid .rname span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.roomgrid .face.top{position:relative;inset:auto;min-height:138px;}
.roomgrid .room.on::after{display:none;}
.roomgrid .rname{font-size:17px;gap:11px;}
@media(max-width:760px){
  .orbit-hint{display:none;}
  .iso-wrap{padding:12px 12px 16px;min-height:0;}
  .hud{position:static;max-width:none;margin:0 0 12px;}
  .iso-moon{top:auto;bottom:14px;right:14px;width:44px;height:44px;opacity:.5;}
  .modestrip{position:static;transform:none;bottom:auto;left:auto;margin:14px 0 0;
    justify-content:center;flex-wrap:wrap;}
}
`;

class LumenPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._built = false;
    this._loaded = false;
    this._cfg = null;
    this._types = [];
    this._st = null;
    this._page = localStorage.getItem("lumen_page") || "home";
    this._slotSel = {};        // room -> slot key being edited
    this._editHome = false;
    this._sel = null;          // room picked up in the touch layout path
    this._dragRoom = null;     // room id currently being dragged
    this._dragging = false;
    this._liveTimer = null;
    this._pollTimer = null;
    this._canvasBlockClick = 0;
  }

  /* ---------------------------------------------------------------- lifecycle */
  set hass(hass) {
    this._hass = hass;
    if (!this._loaded) { this._loaded = true; this._load(); return; }
    this._liveThrottle();
  }
  set narrow(_v) { /* HA sets this; the layout is already responsive. */ }
  set route(_v) { }
  set panel(_v) { }

  connectedCallback() {
    if (!this._pollTimer) {
      this._pollTimer = setInterval(() => this._loadState(), 2000);
    }
  }
  disconnectedCallback() {
    clearInterval(this._pollTimer); this._pollTimer = null;
    clearTimeout(this._liveTimer); this._liveTimer = null;
    clearTimeout(this._saveTimer);
  }

  T(key, vars) {
    const row = I18N[key];
    let out = row ? (row[this._lang()] || row.en || key) : key;
    if (vars) for (const k of Object.keys(vars)) out = out.replace("{" + k + "}", vars[k]);
    return out;
  }
  _lang() { return this._cfg && this._cfg.lang === "tr" ? "tr" : "en"; }

  /* Where this panel's own files live. Handed to CSS once, so a stylesheet
   * never has to guess the integration's URL. */
  _assets() {
    this.style.setProperty("--walk", "url('" + ASSETS + "/walk.gif')");
  }

  async _load() {
    try {
      const res = await this._hass.callApi("GET", "lumen_ha/config");
      this._cfg = res.config;
      this._types = res.room_types || [];
    } catch (err) {
      this._cfg = null;
      /* Home Assistant rejects with a plain object, so "err.message" is
       * usually undefined and the box used to read "[object Object]" — the
       * least useful sentence a panel can say. */
      const why = err && (err.message || err.body || err.error ||
        (err.status_code ? "HTTP " + err.status_code : "")) || String(err);
      const stale = !customElements.get("lumen-panel") ? "" :
        "<br><br>If this page was open before an update, reload it with " +
        "Ctrl+F5 — the browser keeps the old panel until you do." +
        "<br>Sayfa güncellemeden önce açıksa Ctrl+F5 ile yenile.";
      this.shadowRoot.innerHTML =
        '<div style="padding:40px;font-family:Inter,system-ui;color:#ff8296">' +
        "LUMEN: " + esc(String(why)) + stale + "</div>";
      return;
    }
    this._assets();
    await this._loadState();
    this._loadLux(true).then(() => this._render());
    this._render();
  }

  /* The graph used to draw a sunrise/sunset shape — the same curve in every
   * room, which is exactly what it looked like: wrong. This fetches what each
   * room's own light sensor actually recorded today, so a dark hallway and a
   * sunny office no longer share a picture. */
  async _loadLux(force) {
    if (!this._hass || !this._cfg) return;
    const now = Date.now();
    if (!force && this._luxAt && now - this._luxAt < 300000) return;
    const wanted = [];
    for (const room of Object.values(this._cfg.rooms || {})) {
      if (room.lux && !wanted.includes(room.lux)) wanted.push(room.lux);
    }
    this._luxAt = now;
    if (!wanted.length) { this._lux = {}; return; }
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const url = "history/period/" + start.toISOString() +
      "?filter_entity_id=" + wanted.join(",") +
      "&minimal_response&no_attributes";
    let raw;
    try {
      raw = await this._hass.callApi("GET", url);
    } catch (err) {
      this._lux = this._lux || {};      // no recorder: simply no curve
      return;
    }
    const out = {};
    /* The history API answers with a list of series — except when it answers
     * with an error object instead, and then the loop throws in the middle of
     * a render. Anything that is not a list is simply no curve. */
    for (const series of (Array.isArray(raw) ? raw : [])) {
      if (!Array.isArray(series) || !series.length) continue;
      const eid = series[0].entity_id;
      const points = [];
      for (const row of series) {
        const value = Number(row.state);
        if (!Number.isFinite(value)) continue;
        const when = new Date(row.last_changed || row.last_updated);
        if (isNaN(when)) continue;
        points.push([when.getHours() * 60 + when.getMinutes(), value]);
      }
      if (points.length) out[eid] = points;
    }
    this._lux = out;
  }

  async _loadInsight(force) {
    if (!this._hass) return;
    if (!force && this._insightAt && Date.now() - this._insightAt < 60000) return;
    this._insightAt = Date.now();
    try {
      this._insight = await this._hass.callApi("GET", "lumen_ha/insight");
    } catch (err) { this._insight = this._insight || null; }
  }

  async _loadState() {
    if (!this._hass || !this._cfg) return;
    try {
      this._st = await this._hass.callApi("GET", "lumen_ha/state");
    } catch (err) { return; }
    this._liveThrottle();
  }

  /* Never redraw while a device is in the air, a dialog is open or something is
   * being typed — that is exactly how a drag loses its payload. */
  _liveThrottle() {
    if (this._liveTimer) return;
    /* Dokunuştan hemen sonraki yeniden çizim, basılan kartı ayağının altından
     * çeker: animasyon başa döner, "pressed" gider, tablet takılıyor gibi
     * hissettirir. Yarım saniye bekle. */
    if (this._touchedAt && Date.now() - this._touchedAt < 600) {
      this._liveTimer = setTimeout(() => {
        this._liveTimer = null;
        this._liveThrottle();
      }, 600);
      return;
    }
    this._loadLux();
    this._liveTimer = setTimeout(() => {
      this._liveTimer = null;
      if (!this._cfg || !this._built) { this._render(); return; }
      if (this._dragging || this._tapRoom) return;
      if (this.shadowRoot.querySelector(".ov")) return;
      const ae = this.shadowRoot.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" ||
                 ae.tagName === "SELECT")) return;
      this._renderHero();
      this._renderRail();
      /* The memory is a fixed picture of the past; rebuilding it every second
       * only throws away where the cursor was. */
      if (!this._memory) this._renderStage();
    }, 1200);
  }

  _save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._hass.callApi("POST", "lumen_ha/config", this._cfg)
        .then(() => { this._flash(this.T("saved")); this._loadState(); })
        .catch(() => this._flash(this.T("save_err"), true));
    }, 400);
  }

  async _act(body) {
    try {
      const res = await this._hass.callApi("POST", "lumen_ha/action", body);
      if (res && res.ok === false) this._flash(res.error || "error", true);
      return res;
    } catch (err) {
      this._flash(this.T("save_err"), true);
      return null;
    }
  }

  _flash(text, err) {
    const s = this.shadowRoot.getElementById("status");
    if (!s) return;
    s.textContent = "● " + text;
    s.style.color = err ? "#ff6b7d" : "#5fe39a";
    s.style.opacity = "1";
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => { s.style.opacity = "0"; }, 1800);
  }

  /* ------------------------------------------------------------------ helpers */
  _name(eid) {
    const st = this._hass.states[eid];
    if (st && st.attributes && st.attributes.friendly_name) return st.attributes.friendly_name;
    return eid;
  }
  _dc(eid) {
    const st = this._hass.states[eid];
    return (st && st.attributes && st.attributes.device_class) || "";
  }
  _stateOf(eid) {
    const st = this._hass.states[eid];
    return st ? st.state : "unavailable";
  }
  _areaName(id) {
    const areas = this._hass.areas || {};
    return (areas[id] && areas[id].name) || id;
  }
  _typeMeta(key) {
    return this._types.find((t) => t.key === key) ||
      { key: "other", tr: "Diğer", en: "Other", icon: "mdi:shape-outline" };
  }
  _typeName(key) {
    const meta = this._typeMeta(key);
    return this._lang() === "tr" ? meta.tr : meta.en;
  }
  _roomIcon(rid) {
    const room = (this._cfg.rooms || {})[rid] || {};
    /* The type carries a sensible icon, but a type list can never cover
     * everybody's home. Whatever the owner writes here wins. */
    return room.icon || this._typeMeta(room.type).icon;
  }
  /* Bir görselin adresi bu evin içinden olmalı.
   *
   * Eskiden yalnız tırnak ve parantez siliniyordu; dışarıdan bir adres
   * kalabiliyordu. Paylaşılan bir ayar dosyası, açan herkesin tarayıcısına
   * yabancı bir sunucuya istek attırabilirdi — o istek IP adresini, saatini
   * ve tarayıcısını taşır. Görseller zaten /local/... altına yükleniyor. */
  _safeUrl(url) {
    const ham = String(url || "").replace(/["'()\\\n\r]/g, "").trim();
    if (!ham) return "";
    if (ham.startsWith("//")) return "";          // protokole miras kalan adres
    if (/^[a-z][a-z0-9+.-]*:/i.test(ham)) return "";   // http:, data:, javascript:
    // Baştaki bütün ./ ve ../ basamakları — biri yetmiyor, hepsi.
    return ham.startsWith("/") ? ham : "/" + ham.replace(/^(\.{1,2}\/)+/, "");
  }
  /* One place decides what a photograph looks like, so the card, the memory
   * and anything added later can never drift apart. */
  _photoFilter(lit) {
    const cfg = Object.assign({ off_style: "dark", off: 62, on: 14 },
      this._cfg.photo || {});
    const cut = clamp(Number(lit ? cfg.on : cfg.off) || 0, 0, 92) / 100;
    const bits = ["brightness(" + (1 - cut).toFixed(3) + ")"];
    if (!lit && (cfg.off_style === "gray" || cfg.off_style === "both")) {
      bits.push("grayscale(1)");
    }
    if (!lit && cfg.off_style === "gray") bits.push("contrast(1.05)");
    bits.push(lit ? "saturate(1.05)" : "saturate(.9)");
    return bits.join(" ");
  }

  _roomImage(rid) {
    const room = (this._cfg.rooms || {})[rid] || {};
    return room.image ? String(room.image) : "";
  }
  _room(rid) { return (this._cfg.rooms || {})[rid]; }
  _rst(rid) { return ((this._st && this._st.rooms) || {})[rid] || {}; }

  /* area_id -> [entity_id] — every device in the room, device area included.
   * Skipping the device fallback is what leaves half the rooms looking empty. */
  _byRoom() {
    const h = this._hass;
    const out = {};
    if (!h) return out;
    const over = this._cfg.overrides || {};
    const push = (area, eid) => {
      const key = area || "__none";
      (out[key] = out[key] || []).push(eid);
    };
    for (const [eid, ent] of Object.entries(h.entities || {})) {
      if (ent && (ent.hidden || ent.hidden_by || ent.disabled_by || ent.entity_category)) continue;
      if (!DOM_ICON[eid.split(".")[0]]) continue;
      let area = over[eid] || ent.area_id;
      if (!area && ent.device_id && h.devices && h.devices[ent.device_id]) {
        area = h.devices[ent.device_id].area_id;
      }
      push(area, eid);
    }
    for (const key of Object.keys(out)) {
      out[key].sort((a, b) => this._name(a).localeCompare(this._name(b), "tr"));
    }
    return out;
  }

  /* Rooms shown in the rail: everything configured, plus HA areas that have
   * something to offer. Areas always come from Home Assistant. */
  _roomList() {
    const h = this._hass;
    const cfgRooms = this._cfg.rooms || {};
    const byRoom = this._byRoom();
    const areas = h && h.areas ? Object.values(h.areas) : [];
    areas.sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr"));
    const out = [];
    for (const area of areas) {
      const ents = byRoom[area.area_id] || [];
      const room = cfgRooms[area.area_id];
      if (!room && !ents.some((e) => {
        const dom = e.split(".")[0];
        return ROLE_OK.lights(dom) || ROLE_OK.trigger(dom, this._dc(e)) ||
               ROLE_OK.hold(dom, this._dc(e));
      })) continue;
      out.push({ id: area.area_id, name: area.name, ents });
    }
    // Keep configured rooms visible even if their HA area was later renamed or
    // removed. A distributable overview must never silently lose a room.
    const listed = new Set(out.map((room) => room.id));
    for (const id of Object.keys(cfgRooms)) {
      if (!listed.has(id)) out.push({ id, name: this._areaName(id), ents: byRoom[id] || [] });
    }
    return out;
  }

  _placedRooms() {
    const ids = new Set();
    for (const floor of ((this._cfg.layout || {}).floors) || []) {
      for (const item of floor.rooms || []) ids.add(item.id);
    }
    return ids;
  }

  /* Does this rectangle sit inside the plan without landing on another room?
   * Rejecting an overlap is deliberate: pushing the neighbours aside would move
   * half the home every time you nudge one room. */
  _fits(floor, id, x, y, w, h) {
    const cols = Math.max(1, floor.cols || 4);
    const rows = Math.max(1, floor.rows_n || 3);
    if (x < 0 || y < 0 || x + w > cols || y + h > rows) return false;
    for (const other of floor.rooms || []) {
      if (other.id === id) continue;
      if (x < other.x + other.w && other.x < x + w &&
          y < other.y + other.h && other.y < y + h) return false;
    }
    return true;
  }

  _ensureRoom(rid) {
    const rooms = this._cfg.rooms = this._cfg.rooms || {};
    if (!rooms[rid]) {
      rooms[rid] = {
        on: true, type: "other", image: "", trigger: [], hold: [], lux: "",
        lights: [], groups: [], delay_on: 0,
        dim_warn: 0, transition: 0, neighbors: [], slot_follow: true,
        mode_off: [], slots: {},
      };
      const meta = this._types.find((t) =>
        norm(this._areaName(rid)).includes(norm(this._lang() === "tr" ? t.tr : t.en)));
      if (meta) rooms[rid].type = meta.key;
    }
    return rooms[rid];
  }

  /* --------------------------------------------------------------------- shell */
  _build() {
    const style = el("style");
    style.textContent = CSS + CSS2 + CSS7 + CSS8;
    this.shadowRoot.appendChild(style);
    const root = el("div");
    root.innerHTML =
      '<div class="top"><div class="topwrap">' +
        '<div class="brand"><span class="logo"></span><span id="brand"></span></div>' +
        '<nav class="nav" id="nav"></nav>' +
        '<span class="status" id="status"></span>' +
        '<button class="gear" id="gear"></button>' +
      "</div></div>" +
      '<div class="wrap">' +
        '<div class="hero-l" id="heroL"></div>' +
        '<div class="hero-h" id="heroH"></div>' +
        '<div class="hero-s" id="heroS"></div>' +
        '<div class="layout">' +
          '<div class="stage"><div class="glow"></div><div id="stage"></div></div>' +
        "</div>" +
      "</div>";
    this.shadowRoot.appendChild(root);
    this.shadowRoot.querySelector(".brand .logo").appendChild(icon("mdi:lightbulb-auto"));
    const gear = this.shadowRoot.getElementById("gear");
    gear.appendChild(icon("mdi:cog-outline"));
    gear.onclick = () => this._openSettings();

    this.shadowRoot.addEventListener("dragstart", () => { this._dragging = true; }, true);
    this.shadowRoot.addEventListener("dragend", () => { this._dragging = false; }, true);
    this._built = true;
  }

  _render() {
    if (!this._hass || !this._cfg) return;
    if (!this._built) this._build();
    this._renderHero();
    this._renderRail();
    this._renderStage();
  }

  /* Only a room page carries a header up here — its own name and vitals.
   * Every list page opens directly with its first section; the old manifesto
   * ("look at your home from outside") said the same thing on five pages and
   * pushed the actual content below the fold on all of them. */
  _renderHero() {
    const sr = this.shadowRoot;
    sr.getElementById("brand").textContent = this.T("brand");
    const room = this._page.startsWith("room:") ? this._page.slice(5) : "";
    sr.querySelector(".wrap").classList.toggle("bare", !room);
    if (!room) return;
    sr.getElementById("heroL").textContent = this.T("hero_l");
    sr.getElementById("heroH").textContent = this._areaName(room);
    const st = this._rst(room);
    const bits = [];
    if (st.lights_total) bits.push(this.T("lights_n", { n: st.lights_total }));
    if (st.lit && st.bri) bits.push("%" + st.bri);
    if (st.lux != null) bits.push("☀ " + st.lux);
    if (st.off_in) bits.push("⏱ " + mmss(st.off_in));
    sr.getElementById("heroS").textContent = bits.join(" · ");
  }

  /* Navigation sits in the top strip now: the house needs the whole width, and
   * a five-item menu never needed a column of its own. */
  _renderRail() {
    const nav = this.shadowRoot.getElementById("nav");
    if (!nav) return;
    nav.innerHTML = "";
    const st = this._st || {};

    const item = (page, label, mdi, count) => {
      const btn = el("button", "navb" + (this._page === page ||
        (page === "home" && this._page.startsWith("room:")) ? " on" : ""));
      btn.appendChild(icon(mdi));
      btn.appendChild(el("span", "n", esc(label)));
      if (count !== undefined && count !== null) {
        btn.appendChild(el("span", "c", String(count)));
      }
      btn.onclick = () => this._go(page);
      return btn;
    };

    nav.appendChild(item("home", this.T("page_home"), "mdi:home-outline",
      this._roomList().length));
    nav.appendChild(item("modes", this.T("page_modes"), "mdi:theme-light-dark",
      (this._cfg.modes || []).length));
    nav.appendChild(item("slots", this.T("page_slots"), "mdi:clock-outline",
      (this._cfg.slots || []).length));
    nav.appendChild(item("stats", this.T("page_stats"), "mdi:chart-box-outline"));
    nav.appendChild(item("log", this.T("page_log"), "mdi:text-long",
      (st.events || []).length));
    nav.appendChild(item("other", this.T("other_dev"), "mdi:shape-outline",
      this._looseDevices().length));

    const pages = [
      ["home", this.T("page_home"), this._roomList().length],
      ["modes", this.T("page_modes"), (this._cfg.modes || []).length],
      ["slots", this.T("page_slots"), (this._cfg.slots || []).length],
      ["stats", this.T("page_stats"), null],
      ["log", this.T("page_log"), (st.events || []).length],
      ["other", this.T("other_dev"), this._looseDevices().length],
    ];
    const here = this._page.startsWith("room:") ? "home" : this._page;
    const pick = el("select", "nsel navsel");
    for (const [page, label, count] of pages) {
      const opt = el("option");
      opt.value = page;
      opt.textContent = label + (count == null ? "" : "  ·  " + count);
      if (here === page) opt.selected = true;
      pick.appendChild(opt);
    }
    pick.onchange = () => this._go(pick.value);
    nav.appendChild(pick);
  }

  /* Dropping a device on a rail room moves it there. This is the trick that
   * makes fixing a wrong area painless: the room list never scrolls away. */
  _railDrop(row, rid) {
    row.ondragover = (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "move";
      row.classList.add("raildrop");
    };
    row.ondragleave = (ev) => {
      if (!row.contains(ev.relatedTarget)) row.classList.remove("raildrop");
    };
    row.ondrop = (ev) => {
      ev.preventDefault();
      row.classList.remove("raildrop");
      const raw = ev.dataTransfer.getData("text/plain");
      if (!raw) return;
      const eids = raw.split(",").filter(Boolean);
      const from = this._page.startsWith("room:") ? this._page.slice(5) : "";
      let moved = 0;
      for (const eid of eids) {
        if (rid === from) continue;
        if (from) this._detach(from, eid);
        /* the same rule the house uses: the device's kind picks its role */
        if (this._assignToRoom(rid, eid)) moved++;
      }
      if (moved) this._render();
    };
  }

  _detach(rid, eid) {
    const room = this._room(rid);
    if (!room) return;
    for (const key of ["trigger", "hold", "lights"]) {
      room[key] = (room[key] || []).filter((e) => e !== eid);
    }
    if (room.lux === eid) room.lux = "";
    for (const grp of room.groups || []) {
      grp.lights = (grp.lights || []).filter((e) => e !== eid);
    }
  }

  _go(page) {
    this._page = page;
    localStorage.setItem("lumen_page", page);
    this._editHome = false;
    this._sel = null;
    this._render();
    const wrap = this.shadowRoot.querySelector(".wrap");
    if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ block: "start" });
  }

  _renderStage() {
    if (!this._built) return;
    this._refreshRoomDialog();
    const stage = this.shadowRoot.getElementById("stage");
    /* Emptying the stage makes the page briefly almost empty. The browser has
     * to put the scroll position somewhere, so it clamps it to the new bottom —
     * and when the content comes back a millisecond later you are at the top
     * again. On a panel that redraws itself every few seconds, that means the
     * page climbs out from under you while you are reading it.
     *
     * Holding the height it already had across the rebuild means the page never
     * shrinks, so there is nothing to clamp. Released once the new content has
     * had time to settle, in case it really is shorter. */
    const held = stage.offsetHeight;
    if (held) {
      stage.style.minHeight = held + "px";
      clearTimeout(this._holdTimer);
      this._holdTimer = setTimeout(() => { stage.style.minHeight = ""; }, 450);
    }
    stage.innerHTML = "";
    if (this._page.startsWith("room:")) this._pageRoom(stage, this._page.slice(5));
    else if (this._page === "modes") this._pageModes(stage);
    else if (this._page === "slots") this._pageSlots(stage);
    else if (this._page === "stats") this._pageStats(stage);
    else if (this._page === "log") this._pageLog(stage);
    else if (this._page === "other") this._pageOther(stage);
    else this._pageHome(stage);
  }

  /* ---------------------------------------------------------- small builders */
  /* A sub-heading inside a section, for the room's own kit. */
  _sub(stage, title, meta) {
    const head = el("div", "kind-h");
    head.appendChild(el("span", "kind-n", esc(title)));
    if (meta != null && meta !== "") head.appendChild(el("span", "kind-c", esc(String(meta))));
    stage.appendChild(head);
    const body = el("div", "subbody");
    stage.appendChild(body);
    return body;
  }

  _sec(parent, name, count, actions) {
    const sec = el("div", "sec");
    const head = el("div", "sec-h");
    head.appendChild(el("span", "sec-name", esc(name)));
    if (count !== undefined && count !== null) {
      head.appendChild(el("span", "sec-count", esc(String(count))));
    }
    if (actions) {
      const act = el("div", "sec-act");
      for (const node of actions) act.appendChild(node);
      head.appendChild(act);
    }
    sec.appendChild(head);
    /* The caller may want it a different width; it says so before the section
     * reaches the page, where a change would be animated. */
    if (this._secWidth) {
      sec.style.width = this._secWidth + "px";
      sec.style.marginLeft = "calc(50% - " + Math.round(this._secWidth / 2) + "px)";
      this._secWidth = 0;
    }
    parent.appendChild(sec);
    return sec;
  }

  _row(parent, label, sub) {
    const row = el("div", "row");
    const left = el("div", "rl");
    left.appendChild(el("b", null, esc(label)));
    if (sub) left.appendChild(el("small", null, esc(sub)));
    row.appendChild(left);
    const right = el("div", "rr2");
    row.appendChild(right);
    parent.appendChild(row);
    return right;
  }

  _toggle(on, onChange) {
    const t = el("div", "tgl" + (on ? " on" : ""));
    t.appendChild(el("span", "k"));
    t.onclick = () => { onChange(!on); };
    return t;
  }

  /* A slider over a list of sensible values rather than a raw range: the low
   * end gets the resolution, the high end stays reachable. */
  _stepSlider(steps, value, fmt, onChange) {
    let index = steps.indexOf(Number(value));
    if (index < 0) {
      index = 0;
      let best = Infinity;
      steps.forEach((v, i) => {
        const d = Math.abs(v - Number(value));
        if (d < best) { best = d; index = i; }
      });
    }
    return this._slider(index, 0, steps.length - 1, 1,
      (i) => fmt(steps[i]), (i) => onChange(steps[i]));
  }

  _slider(value, min, max, step, fmt, onChange, cls) {
    const wrap = el("div", "sl" + (cls ? " " + cls : ""));
    const input = el("input");
    input.type = "range";
    input.min = min; input.max = max; input.step = step;
    input.value = value;
    const out = el("span", "v", esc(fmt(value)));
    input.oninput = () => { out.textContent = fmt(Number(input.value)); };
    input.onchange = () => onChange(Number(input.value));
    wrap.appendChild(input);
    wrap.appendChild(out);
    return wrap;
  }

  _pill(label, on, onClick, mdi, tiny) {
    const p = el("span", "pick" + (on ? " on" : "") + (tiny ? " tiny" : ""));
    if (mdi) p.appendChild(icon(mdi));
    p.appendChild(el("span", null, esc(label)));
    p.onclick = onClick;
    return p;
  }

  _btnAdd(label, onClick, tiny) {
    const b = el("button", "addsec" + (tiny ? " tiny" : ""));
    b.appendChild(icon("mdi:plus"));
    b.appendChild(el("span", null, esc(label)));
    b.onclick = onClick;
    return b;
  }

  _chip(eid, opts) {
    opts = opts || {};
    const dom = eid.split(".")[0];
    const dev = el("div", "dev");
    const state = this._stateOf(eid);
    const isOn = state === "on";
    if (isOn && (dom === "light" || dom === "switch")) dev.classList.add("on");
    if (isOn && dom === "binary_sensor") dev.classList.add("pulse");
    if (state === "unavailable") dev.classList.add("dead");
    if (opts.locked) dev.classList.add("locked");
    if (opts.inzone) dev.classList.add("inzone");

    dev.appendChild(el("span", "dot"));
    dev.appendChild(icon(DOM_ICON[dom] || "mdi:shape-outline"));
    dev.appendChild(el("span", "dn", esc(this._name(eid))));

    let sub = opts.sub;
    if (sub === undefined) {
      if (dom === "sensor") {
        const unit = (this._hass.states[eid] || {}).attributes || {};
        sub = state + (unit.unit_of_measurement ? " " + unit.unit_of_measurement : "");
      } else if (dom === "binary_sensor") sub = this._dc(eid) || "";
      else sub = isOn ? "on" : "";
    }
    if (sub) dev.appendChild(el("span", "ds", esc(sub)));

    if (opts.draggable && !opts.locked) {
      dev.draggable = true;
      dev.ondragstart = (ev) => {
        ev.dataTransfer.setData("text/plain", eid);
        ev.dataTransfer.effectAllowed = "copyMove";
        dev.classList.add("drag");
      };
      dev.ondragend = () => dev.classList.remove("drag");
    }
    if (opts.onTap && !opts.locked) {
      dev.classList.add("tapedit");
      dev.onclick = (ev) => {
        if (ev.target.closest(".dev-x")) return;
        opts.onTap(eid);
      };
    }
    if (opts.onRemove) {
      const x = el("button", "dev-x");
      x.appendChild(icon("mdi:close"));
      x.onclick = (ev) => { ev.stopPropagation(); opts.onRemove(eid); };
      dev.appendChild(x);
    }
    return dev;
  }

  /* A section that accepts dropped devices. `preventDefault` in dragover is not
   * optional — without it the drop event never fires at all. */
  _dropTarget(sec, accept, onDrop) {
    sec.ondragover = (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      sec.classList.add("dropok");
    };
    sec.ondragleave = (ev) => {
      if (!sec.contains(ev.relatedTarget)) sec.classList.remove("dropok");
    };
    sec.ondrop = (ev) => {
      ev.preventDefault();
      sec.classList.remove("dropok");
      const raw = ev.dataTransfer.getData("text/plain");
      if (!raw) return;
      let added = 0;
      for (const eid of raw.split(",").filter(Boolean)) {
        if (accept && !accept(eid)) continue;
        if (onDrop(eid)) added++;
      }
      if (added) { this._save(); this._render(); }
    };
  }
}


/* ── Pages ───────────────────────────────────────────────────────────────── */
Object.assign(LumenPanel.prototype, {

  /* ============================================================ NIGHT HOUSE */
  _pageHome(stage) {
    stage.classList.add("home-stage");
    const st = this._st || {};
    const rooms = this._roomList();
    const configured = Object.keys(this._cfg.rooms || {}).length;

    const head = el("div", "stage-h");
    head.appendChild(el("div", "room-title", esc(this.T("page_home"))));
    const lit = rooms.filter((r) => this._rst(r.id).lit).length;
    head.appendChild(el("div", "room-meta",
      "<b>" + lit + "</b> / " + rooms.length + " " + esc(this.T("rooms_lit").toLowerCase()) +
      " · " + esc(this.T("house_mode").toLowerCase()) + ": <b>" +
      esc(st.mode_name || "—") + "</b>"));
    const act = el("div", "head-act");
    if (configured) {
      if (!this._narrow()) {
        act.appendChild(this._pill(
          this._memory ? this.T("view_live") : this.T("view_memory"),
          !!this._memory, () => {
            this._memory = !this._memory;
            this._memStop();
            this._render();
            if (this._memory) this._memLoad();
          }, this._memory ? "mdi:home-lightbulb-outline" : "mdi:history"));
        act.appendChild(this._pill(
          this._flatView() ? this.T("view_iso") : this.T("view_flat"), false, () => {
            localStorage.setItem("lumen_flat", this._flatView() ? "0" : "1");
            this._render();
          }, this._flatView() ? "mdi:cube-outline" : "mdi:square-outline"));
        act.appendChild(this._pill(this.T("zoom_in"), false,
          () => this._zoomBy(1.25), "mdi:magnify-plus-outline"));
        act.appendChild(this._pill(this.T("zoom_out"), false,
          () => this._zoomBy(0.8), "mdi:magnify-minus-outline"));
        act.appendChild(this._pill(this.T("view_reset"), false,
          () => this._resetCamera(), "mdi:restore"));
      }
      act.appendChild(this._pill(this._edit ? this.T("edit_done") : this.T("edit_do"),
        !!this._edit, () => {
          this._edit = !this._edit;
          this._render();
        }, this._edit ? "mdi:check" : "mdi:cursor-move"));
      act.appendChild(this._pill(this.T("tonight"), false,
        () => this._openTonight(), "mdi:chart-box-outline"));
    }
    head.appendChild(act);
    stage.appendChild(head);

    if (!configured) { this._emptyHouse(stage); return; }

    /* Nobody lays the house out by hand any more: any room that is missing from
     * the drawing is placed automatically, so the home is always complete. */
    this._autoPlace();
    this._newDeviceNote(stage);

    /* Full width, decided before the section is built rather than after it is
     * on screen — otherwise the page watches it grow. */
    if (!this._narrow()) this._secWidth = this._stageWidth();
    if (this._memory) {
      const memSec = this._sec(stage, this.T("view_memory"),
        this.T(this._memRangeKey()));
      memSec.appendChild(this._memScene());
      return;
    }
    const sec = this._sec(stage, this.T("night_house"),
      this.T("live") + " · " + (st.clock || ""));
    sec.appendChild(this._scene(st, rooms));

    /* The rail leads with the rooms actually lived in, which means the running
     * tally has to be here. It is fetched once and kept for a minute; the rail
     * is drawn alphabetically until it lands, then once more in order. */
    if (!this._insight) {
      this._loadInsight().then(() => { if (this._insight) this._render(); });
    }

  },

  /* The room list used to live in the left rail. Under the house it sits where
   * you are already looking, and the rail stops competing with the drawing. */
  /* A room card carries its own day: the light its sensor actually measured,
   * drawn as one thin line through the middle of the card. Dark sits on the
   * middle line, bright climbs above it, and the line stops at this minute —
   * so it grows as the day does. Rooms with no light sensor get no line;
   * an invented curve would only look like knowledge. */
  _luxLine(rid, cls, always) {
    const cfg = this._room(rid);
    const eid = cfg && cfg.lux;
    if (!eid && !always) return null;
    const pts = (eid && (this._lux || {})[eid]) || [];

    const W = 100, H = 40, MID = 20, TOP = 6;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", cls || "rs-lux");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("preserveAspectRatio", "none");

    const live = this._luxNow(rid);
    if (!pts.length && live == null) return svg;

    /* lux spans four orders of magnitude; one fixed logarithmic ruler for
     * every room, so 30 lx of window light sits mid-card in each of them */
    const span = Math.log10(1 + 3000);
    const y = (v) => MID - Math.min(1, Math.log10(1 + Math.max(v, 0)) / span) *
      (MID - TOP);

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    /* a reading holds until the next one; the live value closes the series */
    const series = pts.filter((one) => one[0] <= nowMin);
    if (live != null) series.push([nowMin, live]);
    if (!series.length) return svg;
    const bucket = [];
    let idx = 0;
    let hold = series[0][1];
    for (let m = 0; m <= nowMin; m += 20) {
      while (idx < series.length && series[idx][0] <= m) {
        hold = series[idx][1];
        idx += 1;
      }
      bucket.push([m, hold]);
    }
    bucket.push([nowMin, series[series.length - 1][1]]);

    const dots = bucket.map(([m, v]) => [(m / 1440) * W, y(v)]);
    const last = dots[dots.length - 1];

    /* one smooth line through the buckets (Catmull-Rom, clamped so the curve
     * never dips under its own floor) */
    const cy = (v) => Math.max(TOP - 1, Math.min(MID, v));
    let path = "M" + dots[0][0].toFixed(2) + " " + dots[0][1].toFixed(2);
    for (let i = 0; i < dots.length - 1; i++) {
      const p0 = dots[Math.max(0, i - 1)];
      const p1 = dots[i];
      const p2 = dots[i + 1];
      const p3 = dots[Math.min(dots.length - 1, i + 2)];
      path += "C" +
        (p1[0] + (p2[0] - p0[0]) / 6).toFixed(2) + " " +
        cy(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2) + "," +
        (p2[0] - (p3[0] - p1[0]) / 6).toFixed(2) + " " +
        cy(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2) + "," +
        p2[0].toFixed(2) + " " + p2[1].toFixed(2);
    }

    const gid = "lxg-" + String(rid).replace(/[^a-z0-9_-]/gi, "");
    const defs = document.createElementNS(ns, "defs");
    const sweep = document.createElementNS(ns, "linearGradient");
    sweep.setAttribute("id", gid);
    sweep.setAttribute("x1", "0"); sweep.setAttribute("x2", "1");
    sweep.setAttribute("y1", "0"); sweep.setAttribute("y2", "0");
    for (const [at, op] of [[0, 0.12], [0.5, 0.4], [0.85, 0.8], [1, 1]]) {
      const stop = document.createElementNS(ns, "stop");
      stop.setAttribute("offset", String(at));
      stop.setAttribute("stop-color", "currentColor");
      stop.setAttribute("stop-opacity", String(op));
      sweep.appendChild(stop);
    }
    defs.appendChild(sweep);
    const fall = document.createElementNS(ns, "linearGradient");
    fall.setAttribute("id", gid + "a");
    fall.setAttribute("x1", "0"); fall.setAttribute("x2", "0");
    fall.setAttribute("y1", "0"); fall.setAttribute("y2", "1");
    for (const [at, op] of [[0, 0.32], [1, 0]]) {
      const stop = document.createElementNS(ns, "stop");
      stop.setAttribute("offset", String(at));
      stop.setAttribute("stop-color", "currentColor");
      stop.setAttribute("stop-opacity", String(op));
      fall.appendChild(stop);
    }
    defs.appendChild(fall);
    svg.appendChild(defs);

    /* the day pools under the curve and fades out — enough to see at a
     * glance when the room had light, nothing competing with the text */
    const area = document.createElementNS(ns, "path");
    area.setAttribute("class", "lx-area");
    area.setAttribute("fill", "url(#" + gid + "a)");
    area.setAttribute("d", path +
      "L" + last[0].toFixed(2) + " " + MID +
      "L" + dots[0][0].toFixed(2) + " " + MID + "Z");
    svg.appendChild(area);

    /* Dark. Without it the curve floats with nothing to be high or low
     * against — and every card's floor is the same height, so one room's
     * evening can be read against another's at a glance. */
    const zero = document.createElementNS(ns, "line");
    zero.setAttribute("class", "lx-zero");
    zero.setAttribute("x1", 0); zero.setAttribute("x2", W);
    zero.setAttribute("y1", MID); zero.setAttribute("y2", MID);
    svg.appendChild(zero);

    /* And the line that actually decides: below it the room counts as dark and
     * the lamp may come on, above it LUMEN stays out of the way. It steps at
     * every slot boundary, because each part of the day has its own idea of
     * dark — so the whole rule reads off one picture. */
    const gates = (this._rst(rid) || {}).gates || {};
    const steps = [];
    for (const seg of this._segments()) {
      const level = gates[seg.slot.key];
      if (level == null) continue;
      steps.push([(seg.start / 1440) * W, y(Number(level))]);
      steps.push([(seg.end / 1440) * W, y(Number(level))]);
    }
    if (steps.length) {
      const gate = document.createElementNS(ns, "polyline");
      gate.setAttribute("class", "lx-gate");
      gate.setAttribute("points", steps.map(([x, v]) =>
        x.toFixed(2) + "," + v.toFixed(2)).join(" "));
      svg.appendChild(gate);
    }

    const line = document.createElementNS(ns, "path");
    line.setAttribute("class", "lx-line");
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", "url(#" + gid + ")");
    line.setAttribute("d", path);
    svg.appendChild(line);

    /* the pen: a bright dot with a beat going out of it */
    const ping = document.createElementNS(ns, "circle");
    ping.setAttribute("class", "lx-ping");
    ping.setAttribute("cx", last[0].toFixed(2));
    ping.setAttribute("cy", last[1].toFixed(2));
    ping.setAttribute("r", 1.6);
    svg.appendChild(ping);

    const head = document.createElementNS(ns, "circle");
    head.setAttribute("class", "lx-head");
    head.setAttribute("cx", last[0].toFixed(2));
    head.setAttribute("cy", last[1].toFixed(2));
    head.setAttribute("r", 1.5);
    svg.appendChild(head);
    return svg;
  },

  _shortAgo(sec) {
    const n = Math.max(0, Number(sec) || 0);
    if (n < 60) return n + this.T("u_sec");
    if (n < 3600) return Math.round(n / 60) + this.T("u_min");
    return Math.round(n / 3600) + this.T("u_hour");
  },

  _luxNow(rid) {
    const cfg = this._room(rid);
    if (!cfg || !cfg.lux) return null;
    const st = this._hass && this._hass.states[cfg.lux];
    const v = st ? Number(st.state) : NaN;
    return Number.isFinite(v) ? v : null;
  },

  _roomWeight(rid) {
    const rooms = ((this._insight || {}).usage || {}).rooms || {};
    return Number((rooms[rid] || {}).seconds || 0);
  },

  /* Setting up four slots by hand is the same eleven decisions four times over.
   * Copying is explicit about what it will overwrite — you pick the targets by
   * name — and it leaves an undo, because it replaces rules you may have spent
   * a while on. */
  _copySlot(rid, fromKey) {
    const st = this._st || {};
    const all = (st.slots || []).filter((x) => x.key !== fromKey);
    const fromName = ((st.slots || []).find((x) => x.key === fromKey) || {}).name
      || fromKey;
    if (!all.length) { this._flash(this.T("copy_none"), true); return; }

    const { ov, box } = this._dialog("editor", this.T("copy_h", { s: fromName }),
      this.T("copy_s"), true);
    const chosen = new Set();
    const pills = el("div", "gpills");
    const foot = el("div", "ed-foot");
    const ok = el("button", "btn");
    const label = () => {
      ok.textContent = chosen.size
        ? this.T("copy_do_n", { n: chosen.size })
        : this.T("copy_do");
      ok.disabled = !chosen.size;
    };
    for (const one of all) {
      const pill = this._pill(one.name || one.key, false, () => {
        if (chosen.has(one.key)) chosen.delete(one.key);
        else chosen.add(one.key);
        pill.classList.toggle("on");
        label();
      }, "mdi:clock-outline");
      pills.appendChild(pill);
    }
    box.appendChild(pills);

    const cancel = el("button", "btn ghost");
    cancel.textContent = this.T("cancel");
    cancel.onclick = () => ov.remove();
    ok.onclick = () => {
      const room = this._room(rid);
      const src = JSON.parse(JSON.stringify(room.slots[fromKey] || {}));
      const before = {};
      const names = [];
      for (const target of chosen) {
        before[target] = JSON.parse(JSON.stringify(room.slots[target] || {}));
        room.slots[target] = JSON.parse(JSON.stringify(src));
        names.push(((st.slots || []).find((x) => x.key === target) || {}).name
          || target);
      }
      this._slotUndo = { rid, before };
      ov.remove();
      this._save();
      this._flash(this.T("copy_done", { s: names.join(", ") }));
      this._renderStage();
    };
    label();
    foot.appendChild(cancel);
    foot.appendChild(ok);
    box.appendChild(foot);
  },

  /* One room's habit: every moment you reached for the switch, laid on a day,
   * with the threshold drawn across it. If the dots sit well above the line,
   * the room is asking for a higher threshold — and says so in words. */
  /* Taking a room out is not deleting a room: Home Assistant keeps its area and
   * its devices, LUMEN simply stops treating it as somewhere you walk into.
   * Remembered, so filling in from the areas does not quietly put it back. */
  _dropRoom(rid, after) {
    const name = this._areaName(rid);
    this._confirm(this.T("room_drop_q", { s: name }), this.T("room_drop_b"),
      this.T("room_drop"), async () => {
        const res = await this._act({ action: "remove_room", room: rid });
        if (res && res.ok) {
          this._flash(this.T("room_dropped", { s: name }));
          await this._load();
          if (after) after();
        }
      });
  },

  /* A picture you drop into a box. The drop target is the box itself, so
   * there is nothing to find and nothing to click first. */
  _artSlot(art, key, label) {
    const slot = el("div", "artslot" + (art[key] ? " full" : ""));
    const clearBtn = () => {
      const clear = el("button", "as-x");
      clear.appendChild(icon("mdi:close"));
      clear.onclick = (ev) => {
        ev.stopPropagation();
        art[key] = "";
        this._save();
        slot.classList.remove("full");
        slot.style.backgroundImage = "";
        clear.remove();
        this._renderStage();
      };
      return clear;
    };
    if (art[key]) slot.style.backgroundImage = "url('" + this._safeUrl(art[key]) + "')";
    slot.appendChild(el("div", "as-l", esc(label)));

    const hint = el("div", "as-h");
    hint.appendChild(icon("mdi:tray-arrow-up"));
    hint.appendChild(el("span", null, esc(this.T("art_drop"))));
    slot.appendChild(hint);

    const input = el("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    const send = async (file) => {
      if (!file) return;
      slot.classList.add("busy");
      const form = new FormData();
      form.append("file", file);
      try {
        const res = await fetch("/api/lumen_ha/image", {
          method: "POST",
          headers: { Authorization: "Bearer " + this._hass.auth.data.access_token },
          body: form,
        });
        const json = await res.json();
        if (!res.ok || !json.url) throw new Error(json.message || "upload failed");
        art[key] = json.url;
        this._save();
        this._flash(this.T("art_done"));
        slot.classList.add("full");
        slot.style.backgroundImage = "url('" + this._safeUrl(json.url) + "')";
        if (!slot.querySelector(".as-x")) slot.appendChild(clearBtn());
        this._renderStage();
      } catch (err) {
        this._flash(String(err.message || err), true);
      }
      slot.classList.remove("busy");
    };
    input.onchange = () => send(input.files && input.files[0]);
    slot.appendChild(input);
    slot.onclick = () => input.click();
    slot.ondragover = (ev) => { ev.preventDefault(); slot.classList.add("over"); };
    slot.ondragleave = () => slot.classList.remove("over");
    slot.ondrop = (ev) => {
      ev.preventDefault();
      slot.classList.remove("over");
      const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      send(file);
    };
    if (art[key]) slot.appendChild(clearBtn());
    return slot;
  },

  /* Everything the panel knows, in one file you can keep. */
  _exportConfig() {
    const stamp = (this._st && this._st.clock ? this._st.clock : "").replace(":", "");
    const blob = new Blob([JSON.stringify(this._cfg, null, 2)],
      { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a");
    a.href = url;
    a.download = "lumen-ayarlar" + (stamp ? "-" + stamp : "") + ".json";
    this.shadowRoot.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    this._flash(this.T("export_done"));
  },

  /* Kaydedilmiş bir ayar dosyasını geri yükler.
   *
   * Kaydetmenin karşılığı olmadan yedek diye bir şey yok; bu, o karşılık.
   * Dosya panelin kendi yazdığı biçimde olmak zorunda — içinde odalar ve
   * dilimler yoksa dokunmuyoruz, çünkü yanlış bir dosya bütün evi siler.
   * Yükleme kaydetmeden geçtiği için mevcut ayarlar önce sürüm geçmişine
   * düşer: yanlış dosyayı seçen kullanıcı geri dönebilir. */
  async _importConfig(file) {
    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch (err) {
      this._flash(this.T("import_bad"), true);
      return;
    }
    const cfg = raw && raw.config ? raw.config : raw;
    const rooms = cfg && cfg.rooms;
    if (!cfg || typeof cfg !== "object" || !rooms || typeof rooms !== "object"
        || !Array.isArray(cfg.slots)) {
      this._flash(this.T("import_bad"), true);
      return;
    }
    const n = Object.keys(rooms).length;
    this._confirm(this.T("import_do"), this.T("import_ask", { n }),
      this.T("import_do"), async () => {
        try {
          await this._hass.callApi("POST", "lumen_ha/config", cfg);
        } catch (err) {
          this._flash(String((err && err.message) || err), true);
          return;
        }
        this._flash(this.T("import_done"));
        await this._load();
        this._render();
      });
  },

  _openRoomSettings(rid) {
    const { ov, box } = this._dialog("editor", "", "", false);
    box.classList.add("wide");
    box.id = "roomdlg";
    this._dlgRoom = rid;
    ov.addEventListener("remove", () => { this._dlgRoom = null; });
    const close = () => { this._dlgRoom = null; ov.remove(); this._render(); };
    this._fillRoomDialog(box, rid, close);
  },

  /* Rebuilt in place whenever something inside it changes — the dialog owns its
   * own refresh, instead of hoping the page behind it redraws. */
  _fillRoomDialog(box, rid, close) {
    const st = this._rst(rid);
    box.innerHTML = "";
    const title = el("div", "ed-t ed-room");
    title.appendChild(icon(this._roomIcon(rid)));
    title.appendChild(el("span", null, esc(st.name || this._areaName(rid))));
    /* All that is left of the old "room settings" block: what kind of room this
     * is. Everything else in it turned out to belong to a slot. */
    const room = this._room(rid);
    const kind = el("select", "nsel roomtype");
    kind.title = this.T("room_type");
    for (const meta of this._types) {
      const opt = el("option");
      opt.value = meta.key;
      opt.textContent = this._lang() === "tr" ? meta.tr : meta.en;
      if (room.type === meta.key) opt.selected = true;
      kind.appendChild(opt);
    }
    kind.onchange = () => {
      room.type = kind.value;
      this._save();
      this._render();
      this._openRoomSettings(rid);
    };
    title.appendChild(kind);
    box.appendChild(title);

    this._iconSection(box, rid);

    const river = this._sec(box, this.T("room_river"), this.T("river_hint"));
    river.appendChild(this._riverBar(rid, {}));
    river.appendChild(this._slotCard(rid));

    const engine = this._row(box, this.T("room_on"), this.T("room_on_s"));
    engine.appendChild(this._toggle(room.on !== false, (val) => {
      room.on = val; this._save(); this._renderStage();
    }));

    this._row(box, this.T("transition"), this.T("transition_s")).appendChild(
      this._slider(Number(room.transition || 0), 0, 5, 1,
        (v) => (v ? v + this.T("u_sec") : this.T("off")),
        (v) => { room.transition = v; room.fade_set = true; this._save(); }));

    /* Everything this room owns, in one place and grouped by what it does.
     * Three sections that each said "one device" made the room look like a
     * form to fill in rather than a room. */
    const shot = this._sec(box, this.T("room_photo"), this.T("room_photo_s"));
    const shots = el("div", "artgrid one");
    shots.appendChild(this._artSlot(room, "image", this.T("room_photo")));
    shot.appendChild(shots);

    const kit = this._sec(box, this.T("room_kit"), this.T("room_kit_s"));
    this._lightSection(kit, rid, true);
    this._groupSection(kit, rid, true);
    this._luxSection(kit, rid, true);
    this._tempSection(kit, rid, true);
    this._poolSection(box, rid);

    const foot = el("div", "ed-foot");
    const drop = el("button", "btn ghost");
    drop.textContent = this.T("room_drop");
    drop.onclick = () => {
      const shut = close || this._dlgClose;
      this._dropRoom(rid, () => { if (shut) shut(); });
    };
    foot.appendChild(drop);
    const done = el("button", "btn");
    done.textContent = this.T("done");
    done.onclick = close || (() => { this._dlgRoom = null;
      const ov = box.parentNode; if (ov) ov.remove(); this._render(); });
    foot.appendChild(done);
    box.appendChild(foot);
    this._dlgClose = done.onclick;
  },

  _refreshRoomDialog() {
    if (!this._dlgRoom) return;
    const box = this.shadowRoot.getElementById("roomdlg");
    if (!box) { this._dlgRoom = null; return; }
    const ae = this.shadowRoot.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "SELECT")) return;
    this._fillRoomDialog(box, this._dlgRoom, this._dlgClose);
  },

  /* The night's numbers and the last decisions — on request, not in the way. */
  _openTonight() {
    const st = this._st || {};
    const rooms = this._roomList();
    const lit = rooms.filter((r) => this._rst(r.id).lit).length;
    const { ov, box } = this._dialog("editor", this.T("tonight"), "", false);

    const grid = el("div", "statgrid");
    const stat = (value, small, name, gold) => {
      const cell = el("div", "stat" + (gold ? " gold" : ""));
      cell.appendChild(el("div", "sv", esc(String(value)) +
        (small ? "<small>" + esc(small) + "</small>" : "")));
      cell.appendChild(el("div", "sn", esc(name)));
      return cell;
    };
    let sensors = 0;
    for (const room of Object.values(this._cfg.rooms || {})) {
      sensors += (room.trigger || []).length + (room.hold || []).length;
    }
    grid.appendChild(stat(lit, "/" + rooms.length, this.T("rooms_lit"), true));
    grid.appendChild(stat((st.events || []).length, "", this.T("decisions")));
    grid.appendChild(stat(sensors, "", this.T("watching")));
    box.appendChild(grid);

    const list = el("div");
    list.style.marginTop = "18px";
    for (const ev of (st.events || []).slice(0, 12)) list.appendChild(this._logRow(ev));
    if (!(st.events || []).length) list.appendChild(el("div", "empty", this.T("no_log")));
    box.appendChild(list);

    const foot = el("div", "ed-foot");
    const all = el("button", "btn ghost");
    all.textContent = this.T("page_log");
    all.onclick = () => { ov.remove(); this._go("log"); };
    const close = el("button", "btn");
    close.textContent = this.T("close");
    close.onclick = () => ov.remove();
    foot.appendChild(all);
    foot.appendChild(close);
    box.appendChild(foot);
  },

  /* ------------------------------------------------- the room, opened in place */
  /* Any configured room that is missing from the drawing gets a place of its own
   * — first free cell, and the floor grows a row when it is genuinely full. */
  /* Two rooms trade places. Their order in the plan is swapped rather than
   * their coordinates: widths differ, and exchanging x/y between a wide room
   * and a narrow one leaves a hole on one side and an overlap on the other.
   * Swapping the order and laying the floor out again cannot do either. */
  _swapRooms(from, to) {
    if (!from || !to || from === to) return;
    const floor = ((this._cfg.layout || {}).floors || [])[0];
    if (!floor) return;
    const order = (floor.rooms || []).slice()
      .sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const i = order.findIndex((r) => r.id === from);
    const j = order.findIndex((r) => r.id === to);
    if (i < 0 || j < 0) return;
    const keep = order[i];
    order[i] = order[j];
    order[j] = keep;
    let y = 0;
    floor.rooms = order.map((r, n) => Object.assign({}, r, { x: n, y: y }));
    this._reflow();
    this._flash(this.T("swapped", {
      a: this._areaName(from), b: this._areaName(to),
    }));
  },

  /* Double click a room and it takes another column; a fourth click gives it
   * back. The rest of the floor flows around it, so the plan never has to be
   * arranged by hand — you only ever say "this room is a big one". */
  _widen(rid) {
    const floors = ((this._cfg.layout || {}).floors) || [];
    const room = floors.flatMap((f) => f.rooms || []).find((r) => r.id === rid);
    if (!room) return;
    const cols = Math.max(1, floors[0].cols || 3);
    const now = Number(room.cw || room.w) || 1;
    room.cw = now % Math.min(3, cols) + 1;
    this._reflow();
    this._flash(this.T("widen_n", { s: this._areaName(rid), n: room.cw }));
  },

  /* Fill each row exactly, without overruling anybody.
   *
   * The first attempt simply stretched the last room of every row to close it,
   * which meant almost every room ended up as wide as the floor — the widths
   * you chose were silently overwritten. So instead the rows are *filled*: for
   * each row we take the next room that fits, preferring one that finishes the
   * row exactly. Only when nothing can finish it does the last room stretch,
   * and that is rare enough to be invisible.
   */
  _reflow(colsWanted) {
    const layout = this._cfg.layout || { floors: [] };
    const floor = (layout.floors || [])[0];
    if (!floor) return;
    const cols = Math.max(1, colsWanted || floor.cols || 3);
    /* Two widths per room: the one you chose, and the one it is drawn at after
     * a row has been closed. Keeping them apart is the whole trick — the first
     * version wrote the stretch back as if you had asked for it, so every room
     * crept wider on every redraw until the floor was one room per row. */
    const pending = (floor.rooms || []).slice()
      .sort((a, b) => (a.y - b.y) || (a.x - b.x))
      .map((r) => {
        const want = Math.max(1, Math.min(cols, Number(r.cw || r.w) || 1));
        return { id: r.id, cw: want, w: want };
      });

    const rows = [];
    while (pending.length) {
      const line = [];
      let left = cols;
      while (left > 0) {
        /* The order matters — it is "busiest first", or whatever arrangement
         * was there before — so the next room in line gets the place if it
         * fits at all. Only when it does not do we look ahead, and then only
         * for one that closes the row exactly. */
        let pick = pending.findIndex((r) => r.w <= left);
        if (pick > 0 && pending[pick].w < left) {
          const exact = pending.findIndex((r) => r.w === left);
          if (exact >= 0) pick = exact;
        }
        if (pick < 0) break;
        const one = pending.splice(pick, 1)[0];
        line.push(one);
        left -= one.w;
      }
      if (!line.length) break;
      rows.push(line);
    }

    /* The floor keeps the footprint it has. Growing it a column when the rooms
     * stopped fitting was solving the wrong problem — the drawing is a plan of
     * a home, and a home does not get wider because a room did. Rooms rearrange
     * inside it; the ground stays where it is. */
    const placed = [];
    rows.forEach((line, y) => {
      let x = 0;
      for (const one of line) {
        placed.push({ id: one.id, x, y, w: one.w, h: 1, cw: one.cw });
        x += one.w;
      }
    });
    floor.cols = cols;
    floor.rooms = placed;
    floor.rows_n = Math.max(1, rows.length);
    for (const extra of (layout.floors || []).slice(1)) extra.rooms = [];
    layout.floors = [floor];
    this._save();
    this._render();
  },

  _autoPlace() {
    const layout = this._cfg.layout = this._cfg.layout || { floors: [] };
    const floors = layout.floors = layout.floors || [];
    if (!floors.length) {
      floors.push({ id: "f" + uid(), name: this._lang() === "tr" ? "Daire" : "Flat",
                    cols: 3, rows_n: 3, rooms: [] });
    }
    const placed = this._placedRooms();
    /* Only rooms that have never been seated. An existing plan is never
     * rearranged: it is a drawing of somebody's home, and they know where the
     * kitchen is. */
    const missing = Object.keys(this._cfg.rooms || {})
      .filter((rid) => !placed.has(rid))
      .sort((a, b) => this._areaName(a).localeCompare(this._areaName(b), "tr"));
    if (!missing.length) return;
    const floor = floors[floors.length - 1];
    floor.rooms = floor.rooms || [];
    for (const rid of missing) {
      const cols = Math.max(1, floor.cols || 3);
      let done = false;
      for (let y = 0; y < Math.max(1, floor.rows_n || 3) && !done; y++) {
        for (let x = 0; x < cols && !done; x++) {
          if (this._fits(floor, rid, x, y, 1, 1)) {
            floor.rooms.push({ id: rid, x, y, w: 1, h: 1 });
            done = true;
          }
        }
      }
      if (!done) {
        floor.rows_n = Math.min(16, Math.max(1, floor.rows_n || 3) + 1);
        floor.rooms.push({ id: rid, x: 0, y: floor.rows_n - 1, w: 1, h: 1 });
      }
    }
    this._save();
  },

  /* One tap, one answer: the room's lights the other way round. */
  _toggleRoom(rid) {
    if (this._readonly) return;     // ekran koruyucu: bakılır, dokunulmaz
    const lit = !!this._rst(rid).lit;
    /* Sunucunun cevabını beklemeden kartı çevir. Işık gerçekten yanmazsa bir
     * sonraki durum okuması onu geri alır — ama olağan durumda parmak kalkar
     * kalkmaz kart değişir, ki dokunuşun ulaştığı anlaşılsın. */
    this._paint(rid, !lit);
    this._flash(this.T(lit ? "turn_off" : "turn_on") + " · " + this._areaName(rid));
    this._act({ action: lit ? "room_off" : "room_on", room: rid })
      .then(() => this._loadState());
  },

  /* Kartın ikinci satırı: odanın ne yaptığı. Kurulurken de tazelenirken de
   * buradan çıkar. */
  _metaBits(rid) {
    const rst = this._rst(rid);
    const bits = [];
    const onNow = Number(rst.lights_lit || 0);
    if (!rst.lights_total && !rst.groups_total) {
      bits.push(esc(this.T("empty_lights")));
    } else if (onNow) {
      bits.push(this.T("lights_lit_n", { n: "<b>" + onNow + "</b>" }));
      if (rst.bri) bits.push("<b>%" + rst.bri + "</b>");
      if (rst.on_ago != null) bits.push('<span class="rago">' +
        esc(this.T("since_n", { t: this._shortAgo(rst.on_ago) })) + "</span>");
    } else {
      bits.push(esc(this.T("idle")));
    }
    return bits.join(" · ");
  },

  /* Sahneyi yeniden kurmadan, değişen sayıları yerinde güncelle.
   *
   * Beş saniyede bir sekiz oda kartını fotoğrafıyla ve eğrisiyle baştan
   * kurmak, ucuz bir tablette hem gözle görülür bir titreme hem de tam
   * dokunduğun anda kartı elinin altından çeken bir şey. Değişen şey bir
   * sayıysa, değişmesi gereken de o sayıdır. */
  _refreshLive() {
    const nodes = this.shadowRoot.querySelectorAll(".room[data-rid]");
    if (!nodes.length) return false;
    for (const node of nodes) {
      const rid = node.dataset.rid;
      const rst = this._rst(rid);
      const lit = !!rst.lit;
      node.classList.toggle("on", lit);
      if (!node.classList.contains("plain")) {
        const height = lit ? (rst.bri ? Math.round(18 + rst.bri * 0.38) : 34) : 14;
        node.style.transform = "translateZ(" + height + "px)";
      }
      const knob = node.querySelector(".rtoggle");
      if (knob) {
        knob.classList.toggle("on", lit);
        knob.title = this.T(lit ? "turn_off" : "turn_on");
      }
      const meta = node.querySelector(".rmeta");
      if (meta) {
        const next = this._metaBits(rid);
        if (meta.innerHTML !== next) meta.innerHTML = next;
      }
      const here = !!(rst.motion || rst.hold);
      const chip = node.querySelector(".rchip.presence");
      if (chip) {
        chip.classList.toggle("here", here);
        chip.classList.toggle("live", here);
        const label = chip.querySelector("span:last-child");
        if (label) label.textContent = this.T(here ? "here_yes" : "here_no");
      }
      const timer = node.querySelector(".rchip.timer");
      if (timer) {
        timer.classList.toggle("gone", !rst.off_in);
        const label = timer.querySelector("span:last-child");
        if (label && rst.off_in) label.textContent = mmss(rst.off_in);
      }
      const orb = node.querySelector(".luxorb");
      if (orb && rst.lux != null) {
        const v = orb.querySelector(".v");
        if (v && v.textContent !== String(rst.lux)) v.textContent = String(rst.lux);
        orb.style.setProperty("--p",
          Math.min(1, Math.log10(1 + Math.max(0, rst.lux)) / Math.log10(3001))
            .toFixed(3));
      }
      const walk = node.querySelector(".mwalk");
      if (walk) walk.classList.toggle("gone", !here);
    }
    return true;
  },

  /* Bir odayı beklemeden yanmış/sönmüş göstermek. Yalnız görüntü: motorun
   * kararı değişmez, bir sonraki durum okuması son sözü söyler. */
  _paint(rid, lit) {
    const rst = this._rst(rid);
    rst.lit = lit;
    rst.lights_lit = lit ? Math.max(1, rst.lights_lit || 1) : 0;
    for (const node of this.shadowRoot.querySelectorAll(".room")) {
      if (node.dataset.rid !== rid) continue;
      node.classList.toggle("on", lit);
      const btn = node.querySelector(".rtoggle");
      if (btn) btn.classList.toggle("on", lit);
    }
  },

  /* What this room did, over the picture rather than under it. */
  _openRoomLog(rid) {
    const st = this._rst(rid);
    const { box } = this._dialog("logbox", st.name || this._areaName(rid),
      this.T("room_log"), false);
    const mine = ((this._st || {}).events || []).filter((e) => e.room === rid);
    const line = el("div", "lg loglist");
    let lastDay = "";
    for (const ev of mine.slice(0, 60)) {
      const day = String(ev.ts || "").slice(0, 10);
      if (day && day !== lastDay) {
        lastDay = day;
        line.appendChild(el("div", "lg-day", esc(day)));
      }
      line.appendChild(this._logItem(ev, true));
    }
    if (!mine.length) line.appendChild(el("div", "empty", this.T("no_log")));
    box.appendChild(line);
  },

  _openInline(rid) {
    this._inlineRoom = this._inlineRoom === rid ? null : rid;
    this._render();
    if (!this._inlineRoom) return;
    requestAnimationFrame(() => {
      const dock = this.shadowRoot.getElementById("roomdock");
      if (dock && dock.scrollIntoView) {
        dock.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  },

  /* Everything the room page shows, opened underneath the house. The sections
   * are the very same builders — a room must never have two editors that can
   * drift apart. */
  /* Entities Home Assistant knows but no LUMEN room claims. This is the pool
   * you assign from — and the answer to "where is that sensor?". */
  _looseDevices() {
    const byRoom = this._byRoom();
    const rooms = this._cfg.rooms || {};
    const out = [];
    for (const [area, list] of Object.entries(byRoom)) {
      if (area !== "__none" && rooms[area]) continue;
      for (const eid of list) out.push(eid);
    }
    /* Lights and sensors first: a thermostat is listed for completeness, but it
     * is not what you came here to drag. */
    return out.sort((a, b) => {
      const ua = this._usable(a) ? 0 : 1;
      const ub = this._usable(b) ? 0 : 1;
      if (ua !== ub) return ua - ub;
      return this._name(a).localeCompare(this._name(b), "tr");
    });
  },

  /* Every device LUMEN can see, and the room it currently answers to. Search
   * runs over this: a device that is already assigned must still be findable,
   * otherwise an empty result means both "does not exist" and "already yours". */
  _allDevices() {
    const byRoom = this._byRoom();
    const out = [];
    for (const [area, list] of Object.entries(byRoom)) {
      for (const eid of list) out.push([eid, area === "__none" ? "" : area]);
    }
    out.sort((a, b) => {
      const ua = this._usable(a[0]) ? 0 : 1;
      const ub = this._usable(b[0]) ? 0 : 1;
      if (ua !== ub) return ua - ub;
      return this._name(a[0]).localeCompare(this._name(b[0]), "tr");
    });
    return out;
  },

  _roomOf(eid) {
    for (const [rid, room] of Object.entries(this._cfg.rooms || {})) {
      if ((room.lights || []).includes(eid) || (room.trigger || []).includes(eid) ||
          (room.hold || []).includes(eid) || room.lux === eid) return rid;
    }
    return "";
  },

  /* A Hue room, a zone, a light group helper: it carries its members in
   * `entity_id`. Telling one from a single bulb matters — assign the group and
   * one step into the office switches the whole house on. */
  _groupSize(eid) {
    if (eid.split(".")[0] !== "light") return 0;
    const st = this._hass.states[eid];
    const members = st && st.attributes ? st.attributes.entity_id : null;
    return Array.isArray(members) && members.length > 1 ? members.length : 0;
  },

  _usable(eid) {
    const dom = eid.split(".")[0];
    const dc = this._dc(eid);
    return ROLE_OK.lights(dom) || ROLE_OK.trigger(dom, dc) ||
           ROLE_OK.hold(dom, dc) || ROLE_OK.lux(dom, dc);
  },

  /* One device, dropped on a room: what it *is* decides what it becomes. */
  _assignToRoom(rid, eid) {
    this._unignore(eid);
    const dom = eid.split(".")[0];
    const dc = this._dc(eid);
    const room = this._ensureRoom(rid);
    let kind = "";
    if (ROLE_OK.lights(dom)) {
      if (!(room.lights || []).includes(eid)) room.lights = (room.lights || []).concat([eid]);
      kind = this.T("as_light");
    } else if (ROLE_OK.lux(dom, dc)) {
      room.lux = eid;
      kind = this.T("as_lux");
    } else if (ROLE_OK.hold(dom, dc) && dc !== "motion") {
      if (!(room.trigger || []).includes(eid)) room.trigger = (room.trigger || []).concat([eid]);
      if (!(room.hold || []).includes(eid)) room.hold = (room.hold || []).concat([eid]);
      kind = this.T("as_hold");
    } else if (ROLE_OK.trigger(dom, dc)) {
      if (!(room.trigger || []).includes(eid)) room.trigger = (room.trigger || []).concat([eid]);
      kind = this.T("as_trigger");
    } else {
      this._flash(this.T("cant_assign"), true);
      return false;
    }
    /* It belongs to that room for LUMEN now — the Home Assistant registry is
     * left exactly as the user set it. */
    this._cfg.overrides = this._cfg.overrides || {};
    this._cfg.overrides[eid] = rid;
    this._save();
    this._flash(this.T("assigned",
      { d: this._name(eid), r: this._areaName(rid), k: kind }));
    return true;
  },

  /* Touch has no drag: tap a device, pick the room. */
  _pickRoomFor(eid) {
    const rooms = this._roomList();
    const { ov, box } = this._dialog("picker", this._name(eid), this.T("pick_room_h"), true);
    const flow = el("div", "gpills");
    for (const room of rooms) {
      flow.appendChild(this._pill(room.name, false, () => {
        this._assignToRoom(room.id, eid);
        ov.remove();
        this._render();
      }, this._roomIcon(room.id)));
    }
    if (!rooms.length) flow.appendChild(el("div", "empty", this.T("none")));
    box.appendChild(flow);
    const foot = el("div", "ed-foot");
    const cancel = el("button", "btn ghost");
    cancel.textContent = this.T("cancel");
    cancel.onclick = () => ov.remove();
    foot.appendChild(cancel);
    box.appendChild(foot);
  },

  /* A device belongs to a kind, and the kind is what you are looking for:
   * "where are my motion sensors" is a far more common question than "where is
   * binary_sensor.antre_motion". Groups LUMEN can use come first. */
  _deviceKind(eid) {
    const dom = eid.split(".")[0];
    const dc = this._dc(eid);
    if (dom === "light") return this._groupSize(eid) ? "lightgroup" : "light";
    if (dom === "switch") return "switch";
    if (dom === "binary_sensor" && dc === "motion") return "motion";
    if (dom === "binary_sensor" && (dc === "occupancy" || dc === "presence")) return "presence";
    if (dom === "binary_sensor" && (dc === "door" || dc === "window" || dc === "opening")) {
      return "opening";
    }
    if (dom === "sensor" && dc === "illuminance") return "lux";
    if (dom === "binary_sensor") return "binary";
    if (dom === "sensor") return "sensor";
    return "rest";
  },

  _kindGroups(list) {
    const groups = new Map();
    for (const eid of list) {
      const key = this._deviceKind(eid);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(eid);
    }
    const out = [];
    for (const def of KIND_DEF) {
      const items = groups.get(def.key);
      if (items && items.length) out.push({ def, items });
    }
    return out;
  },

  _deviceFlow(list, limit, showIds) {
    const holder = el("div");
    for (const group of this._kindGroups(list)) {
      const head = el("div", "kind-h");
      head.appendChild(icon(group.def.icon));
      head.appendChild(el("span", "kind-n", esc(this.T(group.def.tk))));
      head.appendChild(el("span", "kind-c", String(group.items.length)));
      if (!group.def.usable) head.classList.add("mute");
      holder.appendChild(head);

      const flow = el("div", "devflow");
      const shown = limit ? group.items.slice(0, limit) : group.items;
      for (const eid of shown) {
        const usable = this._usable(eid);
        const home = showIds ? this._roomOf(eid) : "";
        flow.appendChild(this._chip(eid, {
          draggable: usable, locked: !usable,
          inzone: !!home,
          sub: showIds ? (home ? eid + " · " + this._areaName(home) : eid) : undefined,
          onTap: usable ? (e) => this._pickRoomFor(e) : null,
        }));
      }
      if (limit && group.items.length > limit) {
        flow.appendChild(el("span", "kind-more",
          "+" + (group.items.length - limit)));
      }
      holder.appendChild(flow);
    }
    if (!list.length) holder.appendChild(el("div", "empty", esc(this.T("none"))));
    return holder;
  },

  /* Search matches the friendly name *and* the entity id, through `norm` so
   * "isik" finds "Işık". Only the result list is rebuilt as you type — redrawing
   * the page would take the caret with it. */
  _matches(eid, query) {
    if (!query) return true;
    const hay = norm(this._name(eid)) + " " + norm(eid);
    return query.split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
  },

  _pageOther(stage) {
    const loose = this._looseDevices();
    const head = el("div", "stage-h");
    head.appendChild(el("div", "room-title", esc(this.T("other_h"))));
    head.appendChild(el("div", "room-meta", "<b>" + loose.length + "</b>"));
    stage.appendChild(head);

    const sec = this._sec(stage, this.T("other_dev"), loose.length);
    sec.appendChild(el("div", "empty", esc(this.T("other_s"))));

    const search = el("div", "searchbar");
    search.appendChild(icon("mdi:magnify"));
    const input = el("input", "searchin");
    input.type = "search";
    input.placeholder = this.T("search_ph");
    input.value = this._otherQ || "";
    search.appendChild(input);
    const count = el("span", "searchn");
    const clear = el("button", "searchx");
    clear.appendChild(icon("mdi:close"));
    clear.onclick = () => {
      this._otherQ = "";
      input.value = "";
      draw();
      input.focus();
    };
    search.appendChild(count);
    search.appendChild(clear);
    sec.appendChild(search);
    sec.appendChild(el("div", "hint", esc(this.T("drag_rail"))));

    const results = el("div");
    sec.appendChild(results);

    const draw = () => {
      const query = norm(this._otherQ || "").trim();
      results.innerHTML = "";
      clear.style.visibility = query ? "visible" : "hidden";
      if (!query) {
        count.textContent = "";
        results.appendChild(this._deviceFlow(loose, null, false));
        return;
      }
      /* typing searches the whole house, not just the unassigned pile */
      const all = this._allDevices();
      const hits = all.filter((row) => this._matches(row[0], query));
      count.textContent = this.T("search_n", { n: hits.length, t: all.length });
      if (!hits.length) {
        results.appendChild(el("div", "empty", esc(this.T("search_none"))));
        return;
      }
      results.appendChild(el("div", "hint", esc(this.T("search_all"))));
      results.appendChild(this._deviceFlow(hits.map((row) => row[0]), null, true));
    };
    input.oninput = () => { this._otherQ = input.value; draw(); };
    draw();
  },

  /* Home Assistant grows: a new bulb, another sensor. These are the ones a
   * fresh autofill would pick up — announced, never added behind your back. */
  /* Removing a device from a room and being offered it again a minute later is
   * the panel arguing with you. What you took out stays out — until you say
   * otherwise, from the settings. */
  _ignored() {
    if (!Array.isArray(this._cfg.ignored)) this._cfg.ignored = [];
    return this._cfg.ignored;
  },

  _ignore(eid) {
    const list = this._ignored();
    if (eid && !list.includes(eid)) list.push(eid);
  },

  _unignore(eid) {
    this._cfg.ignored = this._ignored().filter((e) => e !== eid);
  },

  _newCandidates() {
    const byRoom = this._byRoom();
    const rooms = this._cfg.rooms || {};
    const out = [];
    for (const [area, list] of Object.entries(byRoom)) {
      const room = rooms[area];
      if (!room) continue;
      const skip = this._ignored();
      for (const eid of list) {
        if (this._roomOf(eid) || skip.includes(eid)) continue;
        const dom = eid.split(".")[0];
        const dc = this._dc(eid);
        if (dom === "light") out.push(eid);
        else if (dom === "binary_sensor" &&
                 ["motion", "occupancy", "presence"].includes(dc)) out.push(eid);
        else if (dom === "sensor" && dc === "illuminance" && !room.lux) out.push(eid);
      }
    }
    return out;
  },

  _newDeviceNote(stage) {
    const fresh = this._newCandidates();
    if (!fresh.length) return;
    const box = el("div", "freshnote");
    box.appendChild(icon("mdi:new-box"));
    const text = el("div", "fresh-t");
    text.appendChild(el("b", null, esc(this.T("fresh_h", { n: fresh.length }))));
    text.appendChild(el("span", null, esc(fresh.slice(0, 4)
      .map((e) => this._name(e)).join(" · ") + (fresh.length > 4 ? " …" : ""))));
    box.appendChild(text);
    const add = el("button", "btn");
    add.textContent = this.T("fresh_add");
    add.onclick = async () => {
      add.disabled = true;
      const res = await this._act({ action: "autofill", layout: true });
      if (res && res.ok) {
        this._flash(this.T("filled", { n: res.found }));
        await this._load();
      }
      add.disabled = false;
    };
    box.appendChild(add);

    const no = el("button", "btn ghost");
    no.textContent = this.T("fresh_no");
    no.onclick = () => {
      for (const eid of fresh) this._ignore(eid);
      this._save();
      this._flash(this.T("fresh_no_done", { n: fresh.length }));
      this._render();
    };
    box.appendChild(no);
    stage.appendChild(box);
  },

  _emptyHouse(stage) {
    const sec = this._sec(stage, this.T("no_rooms_h"));
    sec.appendChild(el("div", "empty", esc(this.T("no_rooms_s"))));
    const btn = el("button", "btn");
    btn.style.marginTop = "14px";
    btn.textContent = this.T("autofill");
    btn.onclick = async () => {
      btn.disabled = true;
      const res = await this._act({ action: "autofill", layout: true });
      if (res && res.ok) {
        this._flash(this.T("filled", { n: res.found }));
        await this._load();
      }
      btn.disabled = false;
    };
    sec.appendChild(btn);
  },


  _isoTimeline(rid) {
    const st = this._st || {};
    const tl = el("div", "rtl");
    const segs = this._segments();
    for (const seg of segs) {
      const node = el("span", "seg");
      node.style.width = ((seg.end - seg.start) / 1440 * 100) + "%";
      const [bg, ink] = slotTint(seg.slot.key, segs.indexOf(seg));
      node.style.background = bg;
      node.style.color = ink;
      if (!seg.cont) node.textContent = (seg.slot.name || "").slice(0, 6).toUpperCase();
      tl.appendChild(node);
    }
    const clock = String(st.clock || "00:00").split(":");
    const now = el("span", "rnow");
    now.style.left = ((Number(clock[0]) * 60 + Number(clock[1] || 0)) / 1440 * 100) + "%";
    tl.appendChild(now);
    return tl;
  },

  _isoRoom(item, cellW, cellH, gap, plain) {
    const rid = item.id;
    const cfg = this._room(rid);
    const rst = this._rst(rid);
    const lit = !!rst.lit;
    const height = lit ? (rst.bri ? Math.round(18 + rst.bri * 0.38) : 34) : 14;

    const node = el("div", "room" + (lit ? " on" : "") +
      (rst.warn === "no_lights" || rst.warn === "no_sensor" ? " warn" : "") +
      (this._inlineRoom === rid ? " picked" : ""));
    const w = (item.w || 1) * cellW - gap;
    const h = (item.h || 1) * cellH - gap;
    if (!plain) {
      node.style.cssText = "left:" + ((item.x || 0) * cellW) + "px;top:" +
        ((item.y || 0) * cellH) + "px;width:" + w + "px;height:" + h + "px;" +
        "transform:translateZ(" + height + "px)";

      if (lit) node.appendChild(el("div", "beam"));
      const side = el("div", "face side");
      side.style.cssText = "width:" + height + "px;height:" + h + "px;left:0;top:0;" +
        "transform-origin:left top;transform:rotateY(-90deg)";
      node.appendChild(side);
      const front = el("div", "face front");
      front.style.cssText = "width:" + w + "px;height:" + height + "px;left:0;top:" +
        (h - height) + "px;transform-origin:left top;transform:translateY(" + height +
        "px) rotateX(-90deg)";
      node.appendChild(front);
    }

    if (!plain && this._cfg.sitter !== false) {
      const walk = el("div", "mwalk live" +
        ((rst.motion || rst.hold) ? "" : " gone"));
      const fig = el("div", "fig");
      const figBody = el("div", "body");
      const who = el("div", "who");
      figBody.appendChild(who);
      fig.appendChild(figBody);
      fig.appendChild(el("div", "shadow"));
      walk.appendChild(fig);
      walk.title = this.T("sitter");
      const phase = -(Date.now() % 26000) + "ms";
      fig.style.animationDelay = phase;
      who.style.animationDelay = phase;
      node.appendChild(walk);
    }

    const top = el("div", "face top");
    const photo = this._roomImage(rid);
    if (photo) {
      top.classList.add("hasphoto");
      const layer = el("div", "photo");
      layer.style.backgroundImage = "url('" + this._safeUrl(photo) + "')";
      layer.style.filter = this._photoFilter(false);
      if (lit) layer.style.filter = this._photoFilter(true);
      top.appendChild(layer);
    }
    /* The day's light, drawn straight across the middle of the card. Its x axis
     * is the same 24 hours as the slot ribbon underneath, so the curve and the
     * ribbon read as one picture: what the room saw, and what it was told. */
    const name = el("div", "rname");
    /* The room's own icon is the switch. Everything else on this card tells
     * you what happened; this is the one thing you can do to it, and it sits
     * where you already look for the room's name. */
    const knob = el("button", "rtoggle" + (lit ? " on" : ""));
    knob.appendChild(icon(this._roomIcon(rid)));
    knob.title = this.T(lit ? "turn_off" : "turn_on");
    knob.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._toggleRoom(rid);
    };
    name.appendChild(knob);
    name.appendChild(el("span", null, esc(rst.name || this._areaName(rid))));
    top.appendChild(name);

    /* What the room is doing, not what is installed in it. How many lamps a
     * room owns is a fact for the settings page; standing in the doorway you
     * want to know how many are alight and how long ago they came on. */
    top.appendChild(el("div", "rmeta", this._metaBits(rid)));
    top.appendChild(this._luxLine(rid, "iso-lux", true));

    const chips = el("div", "rchips");
    const chip = (cls, mdi, text, live) => {
      const c = el("span", "rchip " + cls + (live ? " live" : ""));
      c.appendChild(icon(mdi));
      c.appendChild(el("span", null, esc(String(text))));
      return c;
    };
    /* One lamp that is lit when somebody is here beats two counters of how
     * many sensors were installed. */
    const here = rst.motion || rst.hold;
    if (cfg && ((cfg.trigger || []).length || (cfg.hold || []).length)) {
      chips.appendChild(chip("presence" + (here ? " here" : ""),
        here ? "mdi:lightbulb-on-outline" : "mdi:lightbulb-outline",
        here ? this.T("here_yes") : this.T("here_no"), here));
    }
    const temp = this._tempNow(rid);
    if (temp != null) {
      chips.appendChild(chip("temp", "mdi:thermometer",
        temp.toFixed(1).replace(".0", "") + "°"));
    }
    if (rst.warn === "no_sensor") {
      chips.appendChild(chip("warnc", "mdi:alert-outline", this.T("empty_sensor")));
    }
    if (rst.warn === "no_lights") {
      chips.appendChild(chip("warnc", "mdi:alert-outline", this.T("empty_lights")));
    }
    /* Sayaç çipi hep kurulur, yalnız görünürlüğü değişir: gelip gitmesi
     * kartın yeniden kurulmasını gerektirirdi. */
    chips.appendChild(chip("lux timer" + (rst.off_in ? "" : " gone"),
                           "mdi:timer-outline", mmss(rst.off_in || 0)));
    top.appendChild(chips);
    top.appendChild(this._isoTimeline(rid));

    if (rst.lux != null) {
      const orb = el("div", "luxorb");
      orb.style.setProperty("--p",
        Math.min(1, Math.log10(1 + Math.max(0, rst.lux)) / Math.log10(3001))
          .toFixed(3));
      const inner = el("div", "in");
      inner.appendChild(el("span", "v", esc(String(rst.lux))));
      inner.appendChild(el("span", "u", "lx"));
      orb.appendChild(inner);
      top.appendChild(orb);
    }

    const tools = el("div", "rtools");
    const diary = el("button", "rgear rlog");
    diary.appendChild(icon("mdi:text-long"));
    diary.title = this.T("room_log");
    diary.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this._openRoomLog(rid);
    };
    tools.appendChild(diary);

    const gear = el("button", "rgear");
    gear.appendChild(icon("mdi:tune-variant"));
    gear.title = this.T("room_settings");
    gear.onclick = (ev) => { ev.stopPropagation(); this._openRoomSettings(rid); };
    tools.appendChild(gear);
    top.appendChild(tools);

    node.appendChild(top);
    node.dataset.rid = rid;
    /* Basıldığı an: iz bırak, saati tut. Tıklamayı beklemek 300 ms geç
     * kalmak demek — dokunmatikte fark ediliyor. */
    node.onpointerdown = () => {
      if (this._edit) return;
      this._touchedAt = Date.now();
      node.classList.add("pressed");
    };
    const unpress = () => node.classList.remove("pressed");
    node.onpointerup = unpress;
    node.onpointercancel = unpress;
    node.onpointerleave = unpress;
    node.onclick = (ev) => {
      const stage = ev.currentTarget.closest(".stage3d");
      if (stage) return;             // the stage reads its own taps
      if (this._tapToggles) { this._toggleRoom(rid); return; }
      this._openInline(rid);         // phone cards: no capture, no delay
    };
    node.ondblclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      clearTimeout(this._tapTimer);
      this._widen(rid);
    };
    if (this._edit) {
      node.classList.add("editing");
      node.dataset.id = rid;
      let from = null;
      const under = (ev) => {
        const spot = this.shadowRoot.elementFromPoint(ev.clientX, ev.clientY);
        const room = spot && spot.closest ? spot.closest(".room") : null;
        return room && room.dataset.id && room.dataset.id !== rid ? room : null;
      };
      const clearMarks = () => {
        for (const other of this.shadowRoot.querySelectorAll(".room.picked")) {
          other.classList.remove("picked");
        }
      };
      node.onpointerdown = (ev) => {
        if (ev.button) return;
        from = { x: ev.clientX, y: ev.clientY, id: ev.pointerId, moved: false };
        node.setPointerCapture(ev.pointerId);
        ev.preventDefault();
      };
      node.onpointermove = (ev) => {
        if (!from || ev.pointerId !== from.id) return;
        if (!from.moved &&
            Math.abs(ev.clientX - from.x) + Math.abs(ev.clientY - from.y) < 5) return;
        if (!from.moved) {
          from.moved = true;
          this._dragging = true;
          node.classList.add("lifted");
        }
        clearMarks();
        const target = under(ev);
        if (target) target.classList.add("picked");
      };
      const letGo = (ev) => {
        if (!from || ev.pointerId !== from.id) return;
        const target = from.moved ? under(ev) : null;
        node.classList.remove("lifted");
        clearMarks();
        try { node.releasePointerCapture(from.id); } catch (err) { /* gitti */ }
        from = null;
        this._dragging = false;
        if (target) this._swapRooms(rid, target.dataset.id);
      };
      node.onpointerup = letGo;
      node.onpointercancel = letGo;
    }
    node.ondragover = (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      node.classList.add("picked");
    };
    node.ondragleave = () => node.classList.remove("picked");
    node.ondrop = (ev) => {
      ev.preventDefault();
      node.classList.remove("picked");
      const raw = ev.dataTransfer.getData("text/plain");
      if (!raw) return;
      if (raw.startsWith("room:")) { this._swapRooms(raw.slice(5), rid); return; }
      let added = 0;
      for (const one of raw.split(",").filter(Boolean)) {
        if (this._assignToRoom(rid, one)) added++;
      }
      if (added) this._render();
    };
    return node;
  },

  _scene(st, rooms) {
    const wrap = el("div", "iso-wrap" +
      (this._flatView() || this._edit ? " flatview" : "") +
      (this._edit ? " editing" : ""));
    wrap.appendChild(el("div", "skystars"));
    const daylight = st.slot === "day" || st.slot === "morning";
    wrap.appendChild(el("div", "iso-moon" + (daylight ? " sun" : "")));

    const CELL_W = 480, CELL_H = 378, GAP = 34;
    this._bindResize();
    /* Two pictures per surface, because a house at noon and a house at midnight
     * are not the same picture; which one shows follows the slot. */
    const art = this._cfg.scene_art || {};
    const dark = !daylight;
    const backdrop = dark ? art.back_night : art.back_day;
    const floorArt = dark ? art.floor_night : art.floor_day;
    if (backdrop) {
      wrap.classList.add("hasart");
      wrap.style.backgroundImage = "url('" + this._safeUrl(backdrop) + "')";
    }
    this._floorArt = floorArt || "";
    if (this._narrow()) {
      for (const floor of ((this._cfg.layout || {}).floors) || []) {
        if ((((this._cfg.layout || {}).floors) || []).length > 1) {
          wrap.appendChild(el("div", "floorname", esc(floor.name || "")));
        }
        const grid = el("div", "roomgrid");
        for (const item of floor.rooms || []) {
          grid.appendChild(this._isoRoom(item, CELL_W, CELL_H, GAP, true));
        }
        wrap.appendChild(grid);
      }
      wrap.appendChild(this._modeStrip(st));
      return wrap;
    }
    for (const floor of ((this._cfg.layout || {}).floors) || []) {
      if ((((this._cfg.layout || {}).floors) || []).length > 1) {
        wrap.appendChild(el("div", "floorname", esc(floor.name || "")));
      }
      const stage = el("div", "stage3d");
      const iso = el("div", "iso");
      if (this._floorArt) iso.dataset.art = this._floorArt;
      const cols = Math.max(1, floor.cols || 3);
      const rows = Math.max(1, floor.rows_n || 3);
      iso.style.width = (cols * CELL_W) + "px";
      iso.style.height = (rows * CELL_H) + "px";
      const plan = el("div", "floor" + (this._floorArt ? " hasart" : ""));
      if (this._floorArt) {
        plan.style.backgroundImage = "url('" + this._safeUrl(this._floorArt) + "')";
      }
      iso.appendChild(plan);
      for (const item of floor.rooms || []) {
        iso.appendChild(this._isoRoom(item, CELL_W, CELL_H, GAP));
      }
      stage.appendChild(iso);
      wrap.appendChild(stage);
      this._bindOrbit(stage, iso);
      this._fitStage(stage, iso);
    }

    wrap.appendChild(el("div", "orbit-hint" + (this._edit ? " editing" : ""),
      esc(this._edit ? this.T("edit_hint") : this.T("widen_hint"))));
    wrap.appendChild(this._modeStrip(st));
    return wrap;
  },


  /* ═══════════════════════════════════════════ IŞIK HAFIZASI ═══════════
   * The same house, driven by what the lights actually did rather than by
   * what they are doing. Every room keeps a column whose height is the share
   * of that room that was lit at the moment under the cursor, and the rail
   * below carries the whole house's day so you can see the shape of an
   * evening before you go looking inside it.
   *
   * Nothing here is invented: the numbers come from Home Assistant's own
   * recorder. A house with no recorder simply has no memory, and says so. */

  _days() { return DAYS_SHORT[this._lang() === "tr" ? "tr" : "en"]; },

  _memRangeKey() {
    return this._memRange === "3d" ? "mem_3d"
      : this._memRange === "2d" ? "mem_2d" : "mem_24h";
  },

  _memDays() {
    return this._memRange === "3d" ? 3 : this._memRange === "2d" ? 2 : 1;
  },

  async _memLoad() {
    const days = this._memDays();
    const rooms = this._roomList();
    const want = [];
    /* The lights say what the house did; the sensors say who it did it for.
     * Both come out of the same recorder in the same request. */
    for (const room of rooms) {
      const cfg = this._room(room.id);
      for (const eid of (cfg.lights || []).concat(cfg.trigger || [], cfg.hold || [])) {
        if (!want.includes(eid)) want.push(eid);
      }
    }
    this._mem = null;
    this._memBusy = true;
    this._renderStage();
    if (!want.length) { this._memBusy = false; this._renderStage(); return; }

    const STEPS = 720;
    const now = Date.now();
    const t0 = now - days * 86400000;
    const stepMs = (days * 86400000) / STEPS;
    const url = "history/period/" + new Date(t0).toISOString() +
      "?filter_entity_id=" + want.join(",") + "&minimal_response&no_attributes";
    let raw = null;
    try {
      raw = await this._hass.callApi("GET", url);
    } catch (err) {
      raw = null;
    }
    this._memBusy = false;
    if (!Array.isArray(raw)) { this._mem = { empty: true }; this._renderStage(); return; }

    /* Each entity's own on/off staircase, sampled onto the shared ruler. */
    const lit = {};
    for (const series of raw) {
      if (!Array.isArray(series) || !series.length) continue;
      const eid = series[0].entity_id;
      const rows = [];
      for (const row of series) {
        const when = new Date(row.last_changed || row.last_updated).getTime();
        if (!Number.isFinite(when)) continue;
        rows.push([when, row.state === "on" ? 1 : 0]);
      }
      if (!rows.length) continue;
      const line = new Uint8Array(STEPS);
      let idx = 0;
      let hold = rows[0][1];
      for (let i = 0; i < STEPS; i += 1) {
        const at = t0 + i * stepMs;
        while (idx < rows.length && rows[idx][0] <= at) { hold = rows[idx][1]; idx += 1; }
        line[i] = hold;
      }
      lit[eid] = line;
    }

    /* A room is as lit as the share of its own lamps that were on, and it is
     * occupied when any one of its sensors said so. */
    const out = {};
    const here = {};
    const total = new Float32Array(STEPS);
    let seen = 0;
    for (const room of rooms) {
      const cfg = this._room(room.id);
      const lights = (cfg.lights || []).filter((e) => lit[e]);
      const line = new Float32Array(STEPS);
      if (lights.length) {
        seen += 1;
        for (let i = 0; i < STEPS; i += 1) {
          let on = 0;
          for (const eid of lights) on += lit[eid][i];
          line[i] = on / lights.length;
        }
      }
      out[room.id] = line;
      const eyes = (cfg.trigger || []).concat(cfg.hold || []).filter((e) => lit[e]);
      const seenLine = new Uint8Array(STEPS);
      for (const eid of eyes) {
        for (let i = 0; i < STEPS; i += 1) if (lit[eid][i]) seenLine[i] = 1;
      }
      here[room.id] = seenLine;
      for (let i = 0; i < STEPS; i += 1) total[i] += line[i];
    }
    if (rooms.length) {
      for (let i = 0; i < STEPS; i += 1) total[i] /= rooms.length;
    }
    this._mem = { t0, stepMs, steps: STEPS, rooms: out, here, total, empty: !seen };
    if (this._memPos == null || this._memPos >= STEPS) this._memPos = STEPS - 1;
    this._renderStage();
  },

  _memScene() {
    const wrap = el("div", "iso-wrap memory");
    wrap.appendChild(el("div", "skystars"));
    if (this._memBusy || !this._mem) {
      wrap.appendChild(el("div", "memnote", esc(this.T("mem_loading"))));
      wrap.appendChild(this._memBar());
      return wrap;
    }
    if (this._mem.empty) {
      wrap.appendChild(el("div", "memnote", esc(this.T("mem_none"))));
      wrap.appendChild(this._memBar());
      return wrap;
    }

    const CELL_W = 300, CELL_H = 236, GAP = 24;
    this._bindResize();
    this._memRooms = [];
    for (const floor of ((this._cfg.layout || {}).floors) || []) {
      const stage = el("div", "stage3d");
      const iso = el("div", "iso");
      const cols = Math.max(1, floor.cols || 3);
      const rows = Math.max(1, floor.rows_n || 3);
      iso.style.width = (cols * CELL_W) + "px";
      iso.style.height = (rows * CELL_H) + "px";
      iso.appendChild(el("div", "memground"));
      for (const item of floor.rooms || []) {
        iso.appendChild(this._memRoom(item, CELL_W, CELL_H, GAP));
      }
      stage.appendChild(iso);
      wrap.appendChild(stage);
      this._bindOrbit(stage, iso);
      this._fitStage(stage, iso);
    }
    wrap.appendChild(el("div", "orbit-hint", esc(this.T("mem_hint"))));
    wrap.appendChild(this._memBar());
    /* Put the house at the moment the cursor is on before it is handed back,
     * so it is never on screen without its columns. */
    this._memApply(this._memPos == null ? this._mem.steps - 1 : this._memPos);
    return wrap;
  },

  /* A room's colour is its own and never changes, so a week of evenings can be
   * told apart at a glance: the kitchen is always the same green, the bedroom
   * always the same violet. Kept to a small palette — a house of eight hues
   * would be a chart, not a home. */
  _memColor(rid) {
    const type = String(this._room(rid).type || "other");
    const BY_TYPE = {
      office: "#f5b942", bedroom: "#8b7bf7", kids: "#8b7bf7",
      living: "#6fd9e8", kitchen: "#7be3a8", bath: "#6fd9e8",
      hall: "#9aa4c8", corridor: "#9aa4c8", closet: "#c9a8ff",
    };
    if (BY_TYPE[type]) return BY_TYPE[type];
    const POOL = ["#6fd9e8", "#f5b942", "#8b7bf7", "#7be3a8", "#ff8fb3"];
    let sum = 0;
    for (let i = 0; i < rid.length; i += 1) sum += rid.charCodeAt(i);
    return POOL[sum % POOL.length];
  },

  _memRoom(item, cellW, cellH, gap) {
    const rid = item.id;
    const w = (item.w || 1) * cellW - gap;
    const h = (item.h || 1) * cellH - gap;
    const node = el("div", "mroom");
    node.dataset.id = rid;
    /* The mockup's own proportions: a blade about a tenth of the room across,
     * rising to half its width. Small rooms get slim columns, which is what
     * keeps a corridor from looking like a lighthouse. */
    const bw = Math.max(9, Math.min(30, Math.round(Math.min(w, h) * 0.095)));
    const bmax = Math.round(Math.max(55, Math.min(170, w * 0.52)));
    node.style.cssText = "left:" + ((item.x || 0) * cellW) + "px;top:" +
      ((item.y || 0) * cellH) + "px;width:" + w + "px;height:" + h + "px;" +
      "--bw:" + bw + "px;--bmax:" + bmax + "px;--mc:" + this._memColor(rid);

    const plate = el("div", "plate");
    const shot = this._roomImage(rid);
    if (shot) {
      const layer = el("div", "mphoto");
      layer.style.backgroundImage = "url('" + this._safeUrl(shot) + "')";
      plate.appendChild(layer);
      node.classList.add("hasphoto");
    }
    const face = el("div", "mface");
    face.appendChild(el("span", "rname",
      esc(this._rst(rid).name || this._areaName(rid) || rid)));
    const meta = el("span", "rmeta");
    const count = (this._room(rid).lights || []).length;
    meta.innerHTML = esc(count + " " + this.T("mem_lights")) +
      ' · <b class="pct">—</b>';
    face.appendChild(meta);
    plate.appendChild(face);
    node.appendChild(plate);
    node.appendChild(el("div", "halo"));
    /* A room that was occupied carries a small figure pacing across its plate.
     * Light is what the house did; this is who it was for, and the two are
     * worth telling apart at a glance. */
    const walk = el("div", "mwalk");
    const fig = el("div", "fig");
    const body = el("div", "body");
    const who = el("div", "who");
    body.appendChild(who);
    fig.appendChild(body);
    fig.appendChild(el("div", "shadow"));
    walk.appendChild(fig);
    const phase = -(Date.now() % 26000) + "ms";
    fig.style.animationDelay = phase;
    who.style.animationDelay = phase;
    walk.title = this.T("mem_here");
    node.appendChild(walk);
    const beam = el("div", "mbeam");
    beam.appendChild(el("div", "b1"));
    beam.appendChild(el("div", "b2"));
    beam.appendChild(el("div", "cap"));
    node.appendChild(beam);
    this._memRooms.push({ id: rid, node, pct: meta.querySelector(".pct") });
    return node;
  },

  _memBar() {
    const bar = el("div", "tm");
    const top = el("div", "tm-top");
    const play = el("button", "play");
    play.textContent = this._memTimer ? "⏸" : "▶";
    play.onclick = () => this._memPlay();
    top.appendChild(play);
    top.appendChild(el("div", "tm-title",
      esc(this.T("mem_title") + " — " + this.T(this._memRangeKey()).toUpperCase())));
    const pills = el("div", "gpills memranges");
    for (const [key, word] of [["24h", "mem_24h"], ["2d", "mem_2d"], ["3d", "mem_3d"]]) {
      pills.appendChild(this._pill(this.T(word), this._memRange === key, () => {
        if (this._memRange === key) return;
        this._memStop();
        this._memRange = key;
        this._memPos = null;
        this._memLoad();
      }));
    }
    top.appendChild(pills);
    const step = (by, label) => {
      const btn = el("button", "play step");
      btn.textContent = by < 0 ? "◀" : "▶";
      btn.title = this.T(label);
      /* Stepping is something you do while looking; playing would only take
       * the picture away from you again. */
      btn.onclick = () => {
        this._memStop();
        const steps = (this._mem && this._mem.steps) || 1;
        this._memApply(((this._memPos || 0) + by + steps) % steps);
      };
      return btn;
    };
    top.appendChild(step(-1, "mem_back"));
    const clock = el("div", "tm-clock");
    top.appendChild(clock);
    top.appendChild(step(1, "mem_fwd"));
    const phase = el("div", "tm-phase");
    top.appendChild(phase);
    bar.appendChild(top);

    const rail = el("div", "tmrail");
    const canvas = document.createElement("canvas");
    rail.appendChild(canvas);
    const cursor = el("div", "cursor");
    rail.appendChild(cursor);
    /* The ghost is where your hand is; the cursor is where the house is. Until
     * you press, they are allowed to disagree — that is the whole trick a
     * video player's progress bar plays, and the reason it feels like one. */
    const ghost = el("div", "ghost");
    ghost.appendChild(el("div", "gtime"));
    rail.appendChild(ghost);
    const scrub = document.createElement("input");
    scrub.type = "range";
    scrub.min = "0";
    scrub.max = String((this._mem && this._mem.steps ? this._mem.steps : 720) - 1);
    scrub.value = String(this._memPos || 0);
    scrub.setAttribute("aria-label", this.T("mem_title"));
    scrub.oninput = () => { this._memStop(); this._memApply(+scrub.value); };
    rail.appendChild(scrub);

    const atX = (ev) => {
      const box = rail.getBoundingClientRect();
      const steps = (this._mem && this._mem.steps) || 1;
      const share = clamp((ev.clientX - box.left) / Math.max(1, box.width), 0, 1);
      return Math.round(share * (steps - 1));
    };
    const showGhost = (ev) => {
      const box = rail.getBoundingClientRect();
      const share = clamp((ev.clientX - box.left) / Math.max(1, box.width), 0, 1);
      ghost.style.left = (share * 100) + "%";
      ghost.classList.add("on");
      const idx = atX(ev);
      ghost.firstChild.textContent = this._memStamp(idx);
    };
    rail.onpointermove = (ev) => {
      showGhost(ev);
      if (this._memScrub) this._memApply(atX(ev));
    };
    rail.onpointerleave = () => { ghost.classList.remove("on"); };
    rail.onpointerdown = (ev) => {
      this._memScrub = true;
      this._memStop();
      rail.setPointerCapture(ev.pointerId);
      rail.classList.add("scrubbing");
      showGhost(ev);
      this._memApply(atX(ev));
      ev.preventDefault();
    };
    const drop = (ev) => {
      if (!this._memScrub) return;
      this._memScrub = false;
      rail.classList.remove("scrubbing");
      try { rail.releasePointerCapture(ev.pointerId); } catch (err) { /* gone */ }
    };
    rail.onpointerup = drop;
    rail.onpointercancel = drop;
    bar.appendChild(rail);

    const ticks = el("div", "ticks");
    for (const label of this._memTicks()) ticks.appendChild(el("span", null, esc(label)));
    bar.appendChild(ticks);

    this._memUI = { play, clock, phase, cursor, scrub, canvas, rail };
    requestAnimationFrame(() => this._memRail());
    return bar;
  },

  _memTicks() {
    const days = this._memDays();
    if (days === 1) return ["00", "03", "06", "09", "12", "15", "18", "21", "24"];
    const out = [];
    const step = (days * 86400000) / 6;
    const t0 = this._mem ? this._mem.t0 : Date.now() - days * 86400000;
    for (let i = 0; i <= 6; i += 1) {
      const when = new Date(t0 + i * step);
      out.push(this._days()[when.getDay()] + " " + String(when.getHours()).padStart(2, "0"));
    }
    return out;
  },

  _memStamp(idx) {
    const mem = this._mem;
    if (!mem) return "";
    const when = new Date(mem.t0 + idx * mem.stepMs);
    const hh = String(when.getHours()).padStart(2, "0");
    const mm = String(when.getMinutes()).padStart(2, "0");
    return (this._memDays() > 1 ? this._days()[when.getDay()] + " " : "") +
      hh + ":" + mm;
  },

  _memApply(i) {
    const mem = this._mem;
    if (!mem || !mem.steps || !this._memUI) return;
    const idx = Math.max(0, Math.min(mem.steps - 1, Math.round(i || 0)));
    this._memPos = idx;
    const when = new Date(mem.t0 + idx * mem.stepMs);
    const hh = String(when.getHours()).padStart(2, "0");
    const mm = String(when.getMinutes()).padStart(2, "0");
    const label = this._memStamp(idx);
    this._memUI.clock.textContent = label;
    const hour = when.getHours() + when.getMinutes() / 60;
    const band = hour < 6.5 ? ["GECE", "#8b7bf7"] : hour < 18 ? ["GÜNDÜZ", "#6fd9e8"]
      : hour < 22 ? ["AKŞAM", "#ff4d8f"] : ["GECE", "#8b7bf7"];
    const wordEn = { "GECE": "NIGHT", "GÜNDÜZ": "DAY", "AKŞAM": "EVENING" };
    this._memUI.phase.textContent =
      this._lang() === "tr" ? band[0] : wordEn[band[0]];
    this._memUI.phase.style.color = band[1];
    this._memUI.phase.style.background =
      "color-mix(in srgb, " + band[1] + " 13%, transparent)";
    const wrap = this._memUI.phase.closest(".iso-wrap") ||
      this.shadowRoot.querySelector(".iso-wrap.memory");
    if (wrap) {
      wrap.style.setProperty("--skytint",
        "color-mix(in srgb, " + band[1] + " 12%, transparent)");
    }
    this._memUI.cursor.style.left = (idx / (mem.steps - 1) * 100) + "%";
    this._memUI.cursor.dataset.t = label;
    if (this._memUI.scrub.value !== String(idx)) this._memUI.scrub.value = String(idx);
    this._memRail();
    for (const one of (this._memRooms || [])) {
      const line = mem.rooms[one.id];
      const value = line ? line[idx] : 0;
      one.node.style.setProperty("--b", value.toFixed(3));
      one.node.classList.toggle("on", value > 0.02);
      const here = mem.here && mem.here[one.id];
      one.node.classList.toggle("here", !!(here && here[idx]));
      one.pct.textContent = value < 0.02 ? this.T("mem_off") : "%" + Math.round(value * 100);
    }
  },

  _memPlay() {
    if (this._memTimer) { this._memStop(); return; }
    if (!this._mem || !this._mem.steps) return;
    if (this._memUI) this._memUI.play.textContent = "⏸";
    /* Every range plays in about the same fifteen seconds, so a week goes by
     * faster than a day — which is the point of asking for a week. */
    this._memTimer = setInterval(() => {
      const steps = this._mem.steps;
      this._memApply(((this._memPos || 0) + 2) % steps);
    }, 40);
  },

  _memStop() {
    if (this._memTimer) clearInterval(this._memTimer);
    this._memTimer = null;
    if (this._memUI && this._memUI.play) this._memUI.play.textContent = "▶";
  },

  _memRail() {
    const mem = this._mem;
    if (!mem || !this._memUI || !this._memUI.canvas) return;
    const canvas = this._memUI.canvas;
    const ratio = window.devicePixelRatio || 1;
    const W = canvas.width = Math.max(1, canvas.offsetWidth * ratio);
    const H = canvas.height = Math.max(1, canvas.offsetHeight * ratio);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    /* Night behind the curve, so an evening reads as an evening. Painted in
     * runs rather than per step: eight hundred abutting rectangles leave a
     * seam at every edge, and the bar ends up looking like corduroy. */
    const tintAt = (i) => {
      const hour = new Date(mem.t0 + i * mem.stepMs).getHours();
      return hour < 6 || hour >= 22 ? "139,123,247"
        : hour < 18 ? "111,217,232" : "255,77,143";
    };
    let runStart = 0;
    let runTint = tintAt(0);
    for (let i = 1; i <= mem.steps; i += 1) {
      const tint = i < mem.steps ? tintAt(i) : null;
      if (tint === runTint) continue;
      ctx.fillStyle = "rgba(" + runTint + ",.13)";
      ctx.fillRect((runStart / mem.steps) * W, 0,
                   ((i - runStart) / mem.steps) * W, H);
      runStart = i;
      runTint = tint;
    }
    ctx.beginPath();
    for (let i = 0; i < mem.steps; i += 1) {
      const x = (i / (mem.steps - 1)) * W;
      const y = H - 4 * ratio - mem.total[i] * (H - 10 * ratio);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,235,245,.9)";
    ctx.lineWidth = 2 * ratio;
    ctx.stroke();
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = "rgba(236,75,136,.14)";
    ctx.fill();
    /* What has been played is solid, what is ahead is not — the same thing a
     * video's bar says, and the reason you can read your place without
     * hunting for the cursor. */
    const done = ((this._memPos || 0) / Math.max(1, mem.steps - 1)) * W;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, done, H);
    ctx.clip();
    ctx.fillStyle = "rgba(236,75,136,.12)";
    ctx.fillRect(0, 0, done, H);
    ctx.strokeStyle = "rgba(255,255,255,.10)";
    ctx.lineWidth = 1 * ratio;
    ctx.beginPath();
    ctx.moveTo(done, 0);
    ctx.lineTo(done, H);
    ctx.stroke();
    ctx.restore();
  },

  /* Which mode the house is in changes what every room does, so it is always
   * on screen — but as one line rather than a row of buttons the size of the
   * house. */
  _modeStrip(st) {
    const strip = el("div", "modestrip");
    const modes = (this._cfg.modes || []).filter((m) => HOUSE_MODES.includes(m.key));
    const live = modes.find((m) => m.key === st.mode) || modes[0];
    if (live) strip.appendChild(icon(live.icon || "mdi:circle-outline"));
    const pick = el("select", "nsel modesel");
    for (const mode of modes) {
      const opt = el("option");
      opt.value = mode.key;
      opt.textContent = this._modeName(mode);
      if (st.mode === mode.key) opt.selected = true;
      pick.appendChild(opt);
    }
    pick.onchange = () => this._act({ action: "set_mode", mode: pick.value })
      .then(() => this._loadState());
    strip.appendChild(pick);
    strip.appendChild(icon("mdi:chevron-down", "modechev"));
    return strip;
  },

  _flatView() { return localStorage.getItem("lumen_flat") === "1"; },

  /* A drawn house needs width, and a phone has none to give: fitting the plan
   * into 390px puts every room at a fifth of its size, which is a picture of a
   * home rather than a way to run one. Below this width the rooms become plain
   * cards in a column — same content, same controls, no camera. */
  /* Dar olan ekran değil, çizimin sığacağı yer. Panelde bu ikisi aynı;
   * kartta değil — bir panonun sütunu telefondan da dar olabilir. */
  _narrow() {
    const room = Math.min(window.innerWidth, this.clientWidth || window.innerWidth);
    return room < 760;
  },

  _frameHeight() {
    const share = this._memory ? 0.72 : 0.86;
    return Math.round(clamp(window.innerHeight * share, 400, 1120));
  },

  _bindResize() {
    this._watchWidth();
    if (this._fitBound) return;
    this._fitBound = true;
    window.addEventListener("resize", () => {
      this._stageW = 0;
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._renderStage(), 220);
    });
  },

  /* How wide the house may be drawn — worked out once and then remembered.
   *
   * It used to be measured on every redraw, and the panel redraws itself every
   * few seconds to stay live. During a redraw the page is briefly empty, the
   * scrollbar disappears, and the window is fifteen pixels wider than it really
   * is; a moment later the content comes back and takes those pixels away. The
   * house was reading that flicker and stepping sideways with it, on a timer.
   *
   * So: measured only when the panel itself actually changes size, and rounded
   * to a coarse step, which a scrollbar's width can never cross.
   */
  _measureStageWidth() {
    const host = this.clientWidth || 1200;
    /* Everything the panel has, less a hand's breadth. Quantised to 40px so a
     * scrollbar appearing or a pixel of rounding cannot start a redraw. */
    return Math.max(280, Math.floor((host - 32) / 40) * 40);
  },

  _stageWidth() {
    if (!this._stageW) this._stageW = this._measureStageWidth();
    return this._stageW;
  },

  _watchWidth() {
    if (this._widthObs || typeof ResizeObserver === "undefined") return;
    this._widthObs = new ResizeObserver(() => {
      const next = this._measureStageWidth();
      if (Math.abs(next - (this._stageW || 0)) < 24) return;
      this._stageW = next;
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this._renderStage(), 200);
    });
    this._widthObs.observe(this);
  },

  /* A phone is about a third as wide as a laptop, and the 56 degree tilt is
   * the angle that spends the most of that width. Looking down more steeply
   * makes the same house narrower without giving up the third dimension. */
  _camDefault() {
    return window.innerWidth < 760
      ? { rx: 72, rz: -30, zoom: 1, tx: 0, ty: 0 }
      : { rx: 56, rz: -42, zoom: 1, tx: 0, ty: 0 };
  },

  /* Sınırın ötesinde parmağı büsbütün yok saymak yerine, gittikçe direnen
   * birkaç derece bırak. Parmak kalkınca yerine döner — bu, sınırda "öldü"
   * hissini "yaylandı" hissine çevirir. */
  _tiltGive(ham) {
    const taban = this._tiltFloor();
    if (ham > TILT_MAX) {
      return Math.min(TILT_MAX + TILT_OVER, TILT_MAX + (ham - TILT_MAX) * TILT_GIVE);
    }
    if (ham < taban) {
      return Math.max(taban - TILT_OVER, taban - (taban - ham) * TILT_GIVE);
    }
    return ham;
  },

  _tiltFloor() {
    return typeof this._tiltMin === "number" ? this._tiltMin : TILT_MIN;
  },

  _camera() {
    if (!this._cam) {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem("lumen_cam") || "null"); } catch (e) { }
      const base = this._camDefault();
      this._cam = (saved && Number.isFinite(saved.rx))
        ? {
          /* a tilt saved before the range settled must be brought inside it,
           * or the house would sit flatter than the box was fitted for */
          rx: clamp(saved.rx, 0, TILT_MAX), rz: saved.rz,
          zoom: Number.isFinite(saved.zoom) ? saved.zoom : 1,
          tx: Number.isFinite(saved.tx) ? saved.tx : 0,
          ty: Number.isFinite(saved.ty) ? saved.ty : 0,
        }
        : base;
    }
    return this._cam;
  },

  _resetCamera() {
    this._cam = this._camDefault();
    localStorage.setItem("lumen_flat", "0");
    this._saveCamera();
    this._render();
  },



  /* One finger turns the house. Two fingers zoom and slide it — without them
   * a phone has no way back once the house gets small, because there is no
   * wheel and we have taken the browser's own pinch away. */
  _bindOrbit(stage, iso) {
    if (this._edit) {            // the pointer is busy moving rooms
      this._applyCamera(iso, stage);
      stage.style.cursor = "default";
      return;
    }
    const cam = this._camera();
    const live = new Map();
    let mode = null, from = null, moved = false;
    const gap = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    const begin = () => {
      const list = [...live.values()];
      iso.style.transition = "none";
      this._dragging = true;
      if (list.length === 1 && this._ctrlDown) {
        /* Decided when the hand goes down, not while it moves: a gesture that
         * changes its mind half way is a gesture you cannot aim. */
        mode = "shift";
        from = { x: list[0].x, y: list[0].y, tx: cam.tx, ty: cam.ty };
      } else if (list.length === 1) {
        mode = "turn";
        from = { x: list[0].x, y: list[0].y, rx: cam.rx, rz: cam.rz };
      } else if (list.length >= 2) {
        mode = "pinch";
        from = {
          d: Math.max(1, gap(list[0], list[1])),
          mx: (list[0].x + list[1].x) / 2,
          my: (list[0].y + list[1].y) / 2,
          zoom: cam.zoom, tx: cam.tx, ty: cam.ty,
        };
      } else {
        mode = null; from = null;
      }
    };

    stage.onpointerdown = (ev) => {
      if (ev.target.closest && ev.target.closest(".rgear, .rtoggle, .rlog")) return;
      this._ctrlDown = !!(ev.ctrlKey || ev.metaKey);
      /* Which card is under the finger, remembered before capture moves the
       * target out from under us. */
      const card = ev.target.closest && ev.target.closest(".room");
      this._tapRoom = card ? card.dataset.rid : null;
      this._touchedAt = Date.now();
      if (card) card.classList.add("pressed");
      this._tapAt = Date.now();
      live.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      this.classList.add("moving");   // sadeleş: aşağıdaki CSS'in işi
      if (stage.setPointerCapture) stage.setPointerCapture(ev.pointerId);
      moved = false;
      stage.style.cursor = "grabbing";
      iso.style.willChange = "transform";   // smooth while turning...
      begin();
    };

    stage.onpointermove = (ev) => {
      if (!live.has(ev.pointerId) || !from) return;
      live.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const list = [...live.values()];
      if (mode === "turn") {
        const dx = list[0].x - from.x, dy = list[0].y - from.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) <= 3) return;
        moved = true;
        cam.rz = from.rz - dx * 0.35;   // parmak sağa: ev sağa döner
        cam.rx = this._tiltGive(from.rx - dy * TILT_PER_PX);
        /* Leaving the flat view is a decision, not a side effect of a finger
         * moving five pixels while tapping a room. The button does it. */
      } else if (mode === "shift") {
        const dx = list[0].x - from.x, dy = list[0].y - from.y;
        if (!moved && Math.abs(dx) + Math.abs(dy) <= 3) return;
        moved = true;
        cam.tx = from.tx + dx;
        cam.ty = from.ty + dy;
      } else if (mode === "pinch" && list.length >= 2) {
        moved = true;
        cam.zoom = clamp(from.zoom * (gap(list[0], list[1]) / from.d), 0.35, 3);
        if (!this._pinchBase) this._pinchBase = (this._fitScale || 1) * from.zoom;
        cam.tx = from.tx + ((list[0].x + list[1].x) / 2 - from.mx);
        cam.ty = from.ty + ((list[0].y + list[1].y) / 2 - from.my);
      }
      paint();
    };

    /* Dokunmatik ekran parmağı ekranın yenilenmesinden daha sık okur; her
     * okumada çizmek, aynı kareyi üç kez çizmek demek. Kare başına bir. */
    const paint = () => {
      if (this._camRaf) return;
      this._camRaf = requestAnimationFrame(() => {
        this._camRaf = null;
        this._applyCamera(iso, stage);
      });
    };

    const lift = (ev) => {
      if (!live.has(ev.pointerId)) return;
      live.delete(ev.pointerId);
      if (live.size) { begin(); return; }   // a finger left, the gesture goes on
      mode = null; from = null;
      this._dragging = false;
      this._panBox = null;
      this.classList.remove("moving");
      /* Parmak kalktı: geçici büyütmeyi gerçek zoom'a yaz. Bir kez yerleşim
       * hesabı, karşılığında hareket boyunca hiç. */
      if (this._camRaf) { cancelAnimationFrame(this._camRaf); this._camRaf = null; }
      if (this._pinchBase) { this._pinchBase = null; this._applyCamera(iso, stage); }
      stage.style.cursor = "grab";
      iso.style.transition = "";
      iso.style.willChange = "";            // ...crisp once it settles
      /* Esneme geri alınır — geçiş zaten üstte devreye girdiği için kayarak. */
      const yerine = clamp(cam.rx, this._tiltFloor(), TILT_MAX);
      if (yerine !== cam.rx) { cam.rx = yerine; this._applyCamera(iso, stage); }
      
      this._saveCamera();
      if (moved) {                          // a drag is not a tap on a room
        stage.dataset.justDragged = "1";
        setTimeout(() => { delete stage.dataset.justDragged; }, 160);
        this._tapRoom = null;
        return;
      }
      const rid = this._tapRoom;
      const quick = Date.now() - (this._tapAt || 0) < 600;
      this._tapRoom = null;
      if (!rid || !quick || !(this._cfg.rooms || {})[rid]) return;
      /* No waiting to see whether a second tap is coming: a light that answers
       * a quarter of a second late feels broken. Widening a room is a thing you
       * do while arranging the plan, and that is what Düzenle is for. */
      this._toggleRoom(rid);
    };
    stage.onpointerup = lift;
    stage.onpointercancel = lift;

    stage.onwheel = (ev) => {
      /* The house covers most of the screen, so a wheel that zooms is a wheel
       * that will not let you leave the page. Ctrl (or a trackpad pinch, which
       * arrives as the same thing) zooms; a plain wheel scrolls, as everywhere
       * else. The +/- buttons are there for anyone who wants neither. */
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      cam.zoom = clamp(cam.zoom * (ev.deltaY > 0 ? 0.92 : 1.08), 0.35, 3);
      this._applyCamera(iso, stage);
      clearTimeout(this._zoomTimer);
      this._zoomTimer = setTimeout(() => this._saveCamera(), 250);
    };
    /* Double click belongs to the rooms now — resetting the view is a button,
     * and two things on one gesture is one thing too many. */

    stage.style.cursor = "grab";
    stage.style.touchAction = "none";
    /* The cursor says which of the two the next drag will be. */
    stage.onpointermove = ((inner) => (ev) => {
      if (!live.size) {
        stage.style.cursor = (ev.ctrlKey || ev.metaKey) ? "move" : "grab";
      }
      return inner(ev);
    })(stage.onpointermove);
    this._applyCamera(iso, stage);
  },

  _zoomBy(factor) {
    const cam = this._camera();
    cam.zoom = clamp(cam.zoom * factor, 0.35, 3);
    this._saveCamera();
    for (const stage of this.shadowRoot.querySelectorAll(".stage3d")) {
      const iso = stage.querySelector(".iso");
      if (!iso) continue;
      this._applyCamera(iso, stage);
    }
  },

  _saveCamera() {
    try { localStorage.setItem("lumen_cam", JSON.stringify(this._cam)); } catch (e) { }
  },

  /* Nothing here reads a size, so nothing here can move the page. The stage is
   * a box of a settled height with the house centred in it; turning the house
   * only rewrites one transform. Every wobble this panel had came from letting
   * the layout depend on the angle. */
  /* Panning is kept honest: whatever the zoom, the middle of the house stays
   * somewhere inside the frame, so it can never be pushed out of sight. */
  _clampPan(cam, stage) {
    const w = Number(stage && stage.dataset.pw) || 0;
    const h = Number(stage && stage.dataset.ph) || 0;
    if (!w || !h) return;
    const scale = (this._fitScale || 1) * cam.zoom;
    let box = this._panBox;
    if (!box) {
      box = { wide: stage.clientWidth || this._stageWidth(),
              tall: 0 };
      box.tall = parseFloat(stage.style.height) || box.wide;
      if (this._dragging) this._panBox = box;   // yalnız hareket boyunca
    }
    const wide = box.wide, tall = box.tall;
    const drawnW = (w * Math.abs(Math.cos(cam.rz * Math.PI / 180)) +
      h * Math.abs(Math.sin(cam.rz * Math.PI / 180))) * scale;
    const drawnH = this._projHeight(w, h, cam.rx, cam.rz, this._tiltMin || 0) * scale;
    const roomX = Math.max(0, (drawnW - wide) / 2) + 40;
    const roomY = Math.max(0, (drawnH - tall) / 2) + 40;
    cam.tx = clamp(cam.tx, -roomX, roomX);
    cam.ty = clamp(cam.ty, -roomY, roomY);
  },

  _applyCamera(iso, stage) {
    const cam = this._camera();
    if (stage) this._clampPan(cam, stage);
    if (!iso.dataset.posed) {
      iso.dataset.posed = "1";
      iso.style.transition = "none";
      setTimeout(() => { iso.style.transition = ""; }, 120);
    }
    /* Editing happens from directly above. On a tilted plane the pointer and
     * the cell under it are two different places, and every drag becomes a
     * guess; flat, the grid is an ordinary table and the drop lands where you
     * let go. */
    const flat = this._flatView() || this._edit;
    /* a tilt saved on a wider screen may be flatter than this one can hold */
    /* Esneme payı yalnız parmak ekrandayken açık. Dışarıda kalırsa, eski bir
     * sürümden kalma ya da başka bir ekranda kaydedilmiş bir açı sınırın
     * altında çizilir ve ev çerçeveden taşar. */
    const yay = this._dragging ? TILT_OVER : 0;
    const rx = flat ? 0
      : clamp(cam.rx, this._tiltFloor() - yay, TILT_MAX + yay);
    const rz = flat ? 0 : cam.rz;
    const scale = (this._fitScale || 1) * cam.zoom;
    const base = this._pinchBase || scale;
    const k = scale / base;
    const zoomStr = base.toFixed(4);
    if (iso.style.zoom !== zoomStr) iso.style.zoom = zoomStr;
    /* Labels counter-turn by exactly what the house turned, so they read
     * straight from any angle instead of lying down with the floor. */
    const rzStr = (-rz) + "deg";
    if (iso.dataset.rz !== rzStr) {
      iso.dataset.rz = rzStr;
      iso.style.setProperty("--rz", rzStr);
    }
    /* the pan arrives in screen pixels but is applied inside the zoomed
     * coordinate space, so it is divided back out to stay 1:1 with the hand */
    /* Half the lift, so what a lit room adds above the plan is paid for out of
     * the space below it rather than out of the top of the frame. */
    const drop = flat ? 0 : ROOM_LIFT * Math.sin(rx * Math.PI / 180) / 2;
    /* scale(k) önde: kaydırma zoom'lu uzayda uygulandığı için ölçekle
     * bölünüyor, k ile çarpılınca ekranda birebir aynı yere düşüyor. */
    iso.style.transform =
      (k === 1 ? "" : "scale(" + k.toFixed(4) + ") ") +
      "translate(" + Math.round(cam.tx / scale) + "px," +
      Math.round(cam.ty / scale + drop) + "px) " +
      "rotateX(" + rx + "deg) rotateZ(" + rz + "deg)";
  },



  /* The tilted house is wider and shorter than the box it is built from, and
   * how much depends on the room grid. Measure the drawn shape and scale it to
   * the space available, rather than guessing a number that clips someone's
   * home. */


  /* Sized from the plan and the screen, never from the house's current angle.
   * Re-measuring after every turn is what used to shrink the view a notch at a
   * time until there was nothing left of it. */
  /* Sized for the worst angle, not the current one.
   *
   * Turn a w x h plan far enough and the widest it can ever be is its diagonal;
   * tilt it up and the tallest it can be is that same diagonal times the cosine
   * of the shallowest tilt allowed. Fit *that*, and the house fits at every
   * angle in between — so the box never has to be recomputed while you turn it,
   * and nothing is ever clipped.
   *
   * The cost is a little size, and it is smaller than it looks: at the default
   * angle the plan already spans 1300 of its 1305px diagonal, so the width
   * costs nothing. Only the tilt limit costs anything, which is why it is 45
   * degrees and not zero. Going properly flat is its own button, and re-fits.
   */
  _fitStage(stage, iso) {
    const w = parseFloat(iso.style.width) || 900;
    const h = parseFloat(iso.style.height) || 700;
    stage.dataset.pw = w;
    stage.dataset.ph = h;
    const diag = Math.hypot(w, h);

    const fit = () => {
      const flatNow = this._flatView() || this._edit;
      /* Edge to edge, less a little air. The width comes from the panel, never
       * from 100vw: that counts the scrollbar and puts the page half a finger
       * off the right of the screen. */
      const across = Math.max(200, this._stageWidth() - 40);

      if (flatNow) {
        /* The flat plan is a drawing seen from straight above; it is as tall
         * as it is and the page simply carries it. */
        const scale = Math.min(STAGE_ZOOM_MAX, across / w);
        this._fitScale = scale;
        this._tiltMin = 0;
        stage.style.height = Math.round(h * scale + 24) + "px";
        this._applyCamera(iso, stage);
        return;
      }

      /* A frame, not a box: one height, a plain share of the screen. It is
       * deliberately not measured from anything on the page — the frame
       * changes the page's height, and anything on the page that answers back
       * closes a loop. It knows nothing about the angle either, so no angle
       * can move it. */
      /* The memory carries a time machine along its bottom edge, and a house
       * that fills the screen would push it off the end of the page. */
      const frame = this._frameHeight();
      stage.style.height = frame + "px";

      /* The drawing is fitted to the width — the widest the house can ever be
       * is its diagonal, so turning it never runs off the sides. */
      let scale = Math.min(STAGE_ZOOM_MAX, across / diag);
      /* And it must fit the frame at the angle it is normally left at, so the
       * everyday view is never clipped. */
      const resting = this._projHeight(w, h, TILT_REST, -45, TILT_MIN) + ROOM_LIFT;
      const air = frame - 30;          // the drawing should not graze the edges
      if (resting * scale > air) scale = air / resting;
      this._fitScale = scale;
      /* Flatter than that is allowed and the frame simply crops it: the frame
       * is a window, and a window you can move about behind. Fitting the whole
       * range instead would cost the everyday view a third of its size. */
      this._tiltMin = TILT_MIN;
      this._applyCamera(iso, stage);
    };
    fit();
    requestAnimationFrame(fit);   // the panel may not have been measured yet
    if (!this._fitBound) {
      this._fitBound = true;
      window.addEventListener("resize", () => {
        this._stageW = 0;
        clearTimeout(this._resizeTimer);
        this._resizeTimer = setTimeout(() => this._renderStage(), 220);
      });
    }
  },

  /* How tall a w x h plan draws once it has been turned by rz and tilted up by
   * rx. Worked out rather than measured: measuring the drawn shape means
   * measuring something the last measurement already scaled, and that loop is
   * what used to shrink the house a notch with every drag. */
  _projHeight(w, h, rx, rz, floor) {
    const rad = (d) => d * Math.PI / 180;
    const tilt = clamp(Number(rx) || 0, floor, TILT_MAX);
    const turn = rad(Number(rz) || 0);
    const flat = w * Math.abs(Math.sin(turn)) + h * Math.abs(Math.cos(turn));
    return flat * Math.cos(rad(tilt));
  },

  /* Once the hand lets go, the page takes back whatever the new angle does not
   * need. Nothing here touches the scale, so the house never changes size out
   * from under the person turning it. */
  _sceneOld(st, rooms) {
    const scene = el("div", "scene");
    scene.appendChild(el("div", "skystars"));
    const daylight = st.slot === "day" || st.slot === "morning";
    scene.appendChild(el("div", "moon" + (daylight ? " sun" : "")));

    const last = (st.events || [])[0];
    const hud = el("div", "hud");
    hud.appendChild(el("span", "dot"));
    hud.appendChild(el("span", "txt",
      "<b>" + esc(this.T("what_now").replace("?", "")) + ":</b> " +
      esc(last ? last.text : this.T("no_log"))));
    scene.appendChild(hud);

    const house = el("div", "house");
    house.appendChild(el("div", "roof"));
    const body = el("div", "body2");
    const floors = ((this._cfg.layout || {}).floors) || [];
    const many = floors.length > 1;
    floors.forEach((floor) => {
      const wrap = el("div", "floor");
      if (many) wrap.appendChild(el("span", "floor-l", esc(floor.name || "")));
      const inner = el("div", "floor-rows");
      inner.appendChild(this._floorPlan(floor));
      wrap.appendChild(inner);
      body.appendChild(wrap);
    });
    house.appendChild(body);
    scene.appendChild(house);

    scene.appendChild(el("div", "lamp on"));

    /* The house shows the two modes you actually flip; the rest live on the
     * Modes page, where they are configured anyway. */
    const strip = el("div", "modestrip");
    for (const mode of (this._cfg.modes || []).filter((m) => HOUSE_MODES.includes(m.key))) {
      const on = st.mode === mode.key;
      const chip = el("div", "mchip" + (on ? " on" : ""));
      chip.appendChild(icon(mode.icon || "mdi:circle-outline"));
      chip.appendChild(el("span", null, esc(this._modeName(mode))));
      chip.onclick = () => this._act({ action: "set_mode", mode: mode.key })
        .then(() => this._loadState());
      strip.appendChild(chip);
    }
    scene.appendChild(strip);
    scene.appendChild(el("div", "ground"));

    return scene;
  },

  /* One floor, drawn as a grid. Every room carries x/y/w/h, so a corridor can
   * run past three rooms and neighbours share a single wall line. */
  _floorPlan(floor) {
    const cols = Math.max(1, floor.cols || 4);
    const rows = Math.max(1, floor.rows_n || 3);
    const grid = el("div", "plan");
    grid.style.gridTemplateColumns = "repeat(" + cols + ",1fr)";
    grid.style.gridAutoRows = "var(--cellh)";

    const taken = new Set();
    for (const item of floor.rooms || []) {
      for (let dx = 0; dx < (item.w || 1); dx++) {
        for (let dy = 0; dy < (item.h || 1); dy++) {
          taken.add((item.x + dx) + "," + (item.y + dy));
        }
      }
    }
    /* Gaps in the plan are just outside walls now — nothing to drop onto. */
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (taken.has(x + "," + y)) continue;
        const gap = el("div", "cellx");
        gap.style.gridColumn = (x + 1) + " / span 1";
        gap.style.gridRow = (y + 1) + " / span 1";
        grid.appendChild(gap);
      }
    }
    for (const item of floor.rooms || []) {
      grid.appendChild(this._roomCell(item, floor, grid));
    }
    return grid;
  },

  _roomCell(item, floor, grid) {
    const rid = item.id;
    const cfg = this._room(rid);
    const st = this._rst(rid);
    const win = el("div", "win");
    win.style.gridColumn = ((item.x || 0) + 1) + " / span " + (item.w || 1);
    win.style.gridRow = ((item.y || 0) + 1) + " / span " + (item.h || 1);
    if (this._inlineRoom === rid) win.classList.add("picked");
    if (st.lit) win.classList.add(st.dim ? "dim" : "lit");
    if (st.warn === "no_lights" || st.warn === "no_sensor") win.classList.add("dashed");
    if (st.paused_in) win.classList.add("paused");
    if (cfg && (cfg.type === "hallway" || cfg.type === "stairway")) {
      win.classList.add("corridor");
    }

    /* No artwork behind the room: the picture and the day graph were fighting
     * for the same few pixels, and the graph is the part you actually read. */
    const title = el("div", "wn");
    title.appendChild(icon(this._roomIcon(rid)));
    title.appendChild(el("span", null, esc(st.name || this._areaName(rid))));
    win.appendChild(title);

    const bits = [];
    if (st.lights_total || st.groups_total) {
      if (st.lights_total) bits.push(this.T("lights_n", { n: st.lights_total }));
      if (st.groups_total) bits.push(this.T("groups_n", { n: st.groups_total }));
      if (st.lit) {
        if (st.bri) bits.push("%" + st.bri);
      } else bits.push(this.T("idle"));
    } else bits.push(this.T("empty_lights"));
    win.appendChild(el("div", "ws", esc(bits.join(" · "))));

    const tags = el("div", "wb");
    /* What the room can sense, not just what it can switch: a bathroom with two
     * sensors and no lamp looked empty, which is exactly the thing you want to
     * notice. */
    if (cfg) {
      const trig = (cfg.trigger || []).length;
      const hold = (cfg.hold || []).length;
      const sensTag = (mdi, n, live, title) => {
        const tag = el("span", "tag sens" + (live ? " live" : ""));
        tag.appendChild(icon(mdi));
        tag.appendChild(el("span", null, String(n)));
        tag.title = title;
        return tag;
      };
      if (trig) {
        tags.appendChild(sensTag("mdi:motion-sensor", trig, st.motion,
          this.T("sec_trigger")));
      }
      if (hold) {
        tags.appendChild(sensTag("mdi:account-check-outline", hold, st.hold,
          this.T("sec_hold")));
      }
      if (!trig && !hold) {
        tags.appendChild(el("span", "tag wrn", "⚠ " + esc(this.T("empty_sensor"))));
      }
    }
    if (st.lux != null) tags.appendChild(el("span", "tag lux", "☀ " + esc(String(st.lux))));
    if (st.off_in) tags.appendChild(el("span", "tag tmr", "⏱ " + mmss(st.off_in)));
    if (st.paused_in) {
      tags.appendChild(el("span", "tag wrn", esc(this.T("fuse_for", { t: mmss(st.paused_in) }))));
    } else if (st.locked_in) {
      tags.appendChild(el("span", "tag", esc(this.T("locked_for", { t: mmss(st.locked_in) }))));
    }
    /* "no sensor" is already said by the badges above — saying it twice just
     * makes the card look broken. */
    if (st.warn === "no_lights") {
      tags.appendChild(el("span", "tag wrn", "⚠ " + esc(this.T("empty_lights"))));
    } else if (st.warn === "neighbor" && cfg) {
      tags.appendChild(el("span", "tag", esc(this.T("from_neighbor") + " " +
        (cfg.neighbors || []).map((n) => this._areaName(n)).join(", "))));
    }
    win.appendChild(tags);

    if (st.hold) {
      const who = el("span", "person");
      who.appendChild(el("span", null, "🧍"));
      who.title = this.T("someone_here");
      win.appendChild(who);
    }
    else if (st.motion) win.appendChild(el("span", "ping"));

    /* Tapping a room opens it underneath the house; the gear opens its rules. */
    win.onclick = () => this._openInline(rid);
    win.ondragover = (ev) => {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
      win.classList.add("dropin");
    };
    win.ondragleave = (ev) => {
      if (!win.contains(ev.relatedTarget)) win.classList.remove("dropin");
    };
    win.ondrop = (ev) => {
      ev.preventDefault();
      win.classList.remove("dropin");
      const raw = ev.dataTransfer.getData("text/plain");
      if (!raw) return;
      let added = 0;
      for (const one of raw.split(",").filter(Boolean)) {
        if (this._assignToRoom(rid, one)) added++;
      }
      if (added) this._render();
    };
    const gear = el("button", "wgear");
    gear.appendChild(icon("mdi:tune-variant"));
    gear.title = this.T("room_settings");
    gear.onclick = (ev) => { ev.stopPropagation(); this._openRoomSettings(rid); };
    win.appendChild(gear);

    /* The room's own day at a glance: which slot we are in, and where the
     * daylight sits. It belongs on the room, not in a panel of its own. */
    const graph = el("div", "wriver");
    graph.appendChild(this._riverBar(rid, { mini: true }));
    win.appendChild(graph);
    return win;
  },
  /* ================================================================= RIVER */
  _segments() {
    const slots = (this._st && this._st.slots) || [];
    const segs = [];
    slots.forEach((slot, i) => {
      let start = slot.start, end = slot.end;
      if (start == null || end == null) return;
      const [bg, ink] = slotTint(slot.key, i);
      if (start <= end) segs.push({ slot, start, end, bg, ink });
      else {
        segs.push({ slot, start, end: 1440, bg, ink });
        segs.push({ slot, start: 0, end, bg, ink, cont: true });
      }
    });
    segs.sort((a, b) => a.start - b.start);
    return segs;
  },

  slotRuleFor(rid, slotKey) {
    const room = this._room(rid);
    if (!room) return null;
    return (room.slots || {})[slotKey] || null;
  },

  _riverBar(rid, opts) {
    opts = opts || {};
    const room = this._room(rid) || {};
    const st = this._st || {};
    const wrap = el("div");
    const bar = el("div", "riverbar" + (opts.mini ? " mini" : ""));
    const segs = this._segments();
    const total = 1440;
    const sel = this._slotSel[rid] || st.slot;

    for (const seg of segs) {
      const rule = (room.slots || {})[seg.slot.key] || {};
      const node = el("div", "rs");
      node.style.width = ((seg.end - seg.start) / total * 100) + "%";
      node.style.background = "linear-gradient(180deg," + seg.bg + ",rgba(20,15,26,.55))";
      if (rule.on === false) node.classList.add("off");
      if (seg.slot.key === sel && !opts.mini && !opts.plain) node.classList.add("sel");
      if (!seg.cont) {
        const name = el("div", "rsn", esc(seg.slot.name || seg.slot.key));
        name.style.color = seg.ink;
        node.appendChild(name);
        if (!opts.mini) {
          node.appendChild(el("div", "rst", esc(String(seg.slot.from || ""))));
        }
      }
      if (!opts.mini) {
        node.onclick = () => {
          this._slotSel[rid] = seg.slot.key;
          this._renderStage();
        };
      }
      bar.appendChild(node);
    }

    /* What this room's own sensor measured today, plus the threshold the rules
     * compare it against. Rooms without a light sensor get no curve at all —
     * an invented one is worse than none. */
    const series = (this._lux || {})[room.lux || ""] || null;
    if (series && series.length > 1) {
      const rule = this.slotRuleFor(rid, sel);
      const gate = rule && rule.lux_max != null ? Number(rule.lux_max) : null;
      let peak = 1;
      for (const [, v] of series) peak = Math.max(peak, v);
      /* A dark hallway with a 200 lux threshold would be squashed flat if the
       * axis had to reach the threshold, so the room's own readings own the
       * scale and a far-off threshold is pinned to the top edge instead. */
      const gateFits = gate != null && gate <= peak * 2;
      if (gateFits) peak = Math.max(peak, gate * 1.15);
      else peak = peak * 1.15;
      /* square-root scale: lux spans 0-1000+, and the interesting decisions all
       * happen down at the dark end where a linear axis would flatten them */
      const y = (v) => 68 - 62 * Math.sqrt(Math.max(0, v) / peak);
      const x = (min) => (min / total) * 1000;

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "luxline");
      svg.setAttribute("viewBox", "0 0 1000 74");
      svg.setAttribute("preserveAspectRatio", "none");

      let d = "";
      let prev = null;
      for (const [min, v] of series) {
        const px = x(min).toFixed(1);
        if (prev === null) d += "M" + px + "," + y(v).toFixed(1);
        else d += " L" + px + "," + y(prev).toFixed(1) + " L" + px + "," + y(v).toFixed(1);
        prev = v;
      }
      const nowMinLocal = (() => {
        const c = String(st.clock || "00:00").split(":");
        return Number(c[0]) * 60 + Number(c[1] || 0);
      })();
      if (prev !== null) d += " L" + x(nowMinLocal).toFixed(1) + "," + y(prev).toFixed(1);

      const fill = document.createElementNS("http://www.w3.org/2000/svg", "path");
      fill.setAttribute("d", d + " L" + x(nowMinLocal).toFixed(1) + ",74 L0,74 Z");
      fill.setAttribute("fill", "rgba(95,208,227,.10)");
      svg.appendChild(fill);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "rgba(95,208,227,.85)");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("stroke-linejoin", "round");
      svg.appendChild(path);

      if (gate != null) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const gy = (gateFits ? y(gate) : 5).toFixed(1);
        line.setAttribute("d", "M0," + gy + " L1000," + gy);
        line.setAttribute("stroke", "rgba(255,207,92,.75)");
        line.setAttribute("stroke-width", "1.5");
        line.setAttribute("stroke-dasharray", "7 6");
        line.setAttribute("fill", "none");
        svg.appendChild(line);
      }
      bar.appendChild(svg);
      if (!opts.mini) {
        const legend = el("div", "luxleg");
        legend.appendChild(el("span", "lx", "☀ " + Math.round(peak) + " lx"));
        if (gate != null) {
          legend.appendChild(el("span", "gate",
            (gateFits ? "" : "↑ ") + this.T("gate_lbl") + " " + gate));
        }
        bar.appendChild(legend);
      }
    } else if (!room.lux && !opts.plain) {
      bar.appendChild(el("div", "noluxs", esc(this.T("no_lux"))));
    }

    const clock = String(st.clock || "00:00").split(":");
    const nowMin = Number(clock[0]) * 60 + Number(clock[1] || 0);
    const now = el("div", "nowline");
    now.style.left = (nowMin / total * 100) + "%";
    now.appendChild(el("span", null, this.T("now_at") + " " + esc(st.clock || "")));
    bar.appendChild(now);

    wrap.appendChild(bar);
    if (!opts.mini) {
      const marks = el("div", "rivermarks");
      for (const label of ["00", "04", "08", "12", "16", "20", "24"]) {
        marks.appendChild(el("span", null, label));
      }
      wrap.appendChild(marks);
    }
    return wrap;
  },

  /* ============================================================== ROOM PAGE */
  _pageRoom(stage, rid) {
    const room = this._room(rid);
    const st = this._rst(rid);
    if (!room) {
      const sec = this._sec(stage, this._areaName(rid));
      sec.appendChild(el("div", "empty", esc(this.T("no_rooms_s"))));
      const btn = el("button", "btn");
      btn.textContent = this.T("autofill");
      btn.style.marginTop = "12px";
      btn.onclick = async () => {
        this._ensureRoom(rid);
        this._save();
        this._render();
      };
      sec.appendChild(btn);
      return;
    }

    const head = el("div", "stage-h");
    head.appendChild(el("div", "room-title", esc(st.name || this._areaName(rid))));
    const meta = [];
    meta.push("<b>" + (st.lights_on || 0) + "</b>/" + (st.lights_total || 0) + " " +
      esc(this.T("sec_lights").toLowerCase()));
    if (st.lux != null) meta.push("lux <b>" + st.lux + "</b>");
    if (st.off_in) meta.push("⏱ <b>" + mmss(st.off_in) + "</b>");
    head.appendChild(el("div", "room-meta", meta.join(" · ")));
    const act = el("div", "head-act");
    act.appendChild(this._pill(this.T("room_settings"), false,
      () => this._openRoomSettings(rid), "mdi:tune-variant"));
    act.appendChild(this._pill(this.T("room_on"), room.on !== false, () => {
      room.on = room.on === false;
      this._save(); this._render();
    }, "mdi:power"));
    act.appendChild(this._pill(st.lit ? this.T("turn_off") : this.T("turn_on"), false,
      () => this._act({ action: st.lit ? "room_off" : "room_on", room: rid })
        .then(() => this._loadState()),
      st.lit ? "mdi:lightbulb-off-outline" : "mdi:lightbulb-on-outline"));
    head.appendChild(act);
    stage.appendChild(head);

    if (st.warn === "no_lights") {
      const box = el("div", "warnbox");
      box.appendChild(icon("mdi:alert-outline"));
      box.appendChild(el("span", null, esc(this.T("empty_lights"))));
      stage.appendChild(box);
    }

    /* ---- river + the selected slot's rule */
    const river = this._sec(stage, this.T("room_river"), this.T("river_hint"));
    river.appendChild(this._riverBar(rid, {}));
    river.appendChild(this._slotCard(rid));

    /* Sensors, lights, groups and settings all open in the room's own dialog —
     * one place to set things, wherever you came from. */
    const log = this._sec(stage, this.T("room_log"));
    const mine = ((this._st || {}).events || []).filter((e) => e.room === rid);
    for (const ev of mine.slice(0, 12)) log.appendChild(this._logRow(ev, true));
    if (!mine.length) log.appendChild(el("div", "empty", this.T("no_log")));
  },

  /* Scenes Home Assistant knows for this room, plus every scene when the room
   * has none of its own — you may well want a house-wide one. */
  /* Same rule as the engine's `rule_lights`, so the count under the pills can
   * never disagree with what actually switches on. */
  _chosenChip(label, mdi, onRemove) {
    const chip = el("div", "dev inzone");
    chip.appendChild(el("span", "dot"));
    chip.appendChild(icon(mdi));
    chip.appendChild(el("span", "dn", esc(label)));
    const x = el("button", "dev-x");
    x.appendChild(icon("mdi:close"));
    x.onclick = (ev) => { ev.stopPropagation(); onRemove(); };
    chip.appendChild(x);
    return chip;
  },

  /* How many bulbs actually light up: a group counts as its members, not as
   * one entity, and a bulb listed twice counts once. */
  _bulbCount(rid, rule) {
    const bulbs = new Set();
    for (const eid of this.rule_lights_preview(rid, rule)) {
      const st = this._hass.states[eid];
      const members = st && st.attributes ? st.attributes.entity_id : null;
      if (Array.isArray(members) && members.length > 1) {
        for (const m of members) bulbs.add(m);
      } else bulbs.add(eid);
    }
    return bulbs.size;
  },

  /* Sensors belong to the slot, all of them: which ones wake the room, which
   * ones keep it awake, and whether one is enough or they all have to agree.
   * There is no second place to edit them — that was the whole confusion. */
  _slotRole(card, rid, rule, role) {
    const room = this._room(rid) || {};
    const pool = room[role] || [];
    const key = role + "_pick";
    const picked = (rule[key] || []).filter((e) => pool.includes(e));
    const live = picked.length ? picked : pool;
    const mode = rule[role + "_mode"] || "any";

    const row = this._row(card, this.T("slot_" + role),
      live.length > 1 ? (mode === "all" ? this.T("slot_" + role + "_all")
                                        : this.T("slot_" + role + "_any"))
                      : this.T("slot_" + role + "_s"));
    const wrap = el("div", "rolebox");

    const pills = el("div", "gpills");
    for (const eid of live) {
      pills.appendChild(this._chosenChip(this._name(eid),
        this._dc(eid) === "motion" ? "mdi:motion-sensor"
                                   : "mdi:account-check-outline",
        () => {
          rule[key] = live.filter((e) => e !== eid);
          this._save(); this._renderStage();
        }));
    }
    const add = el("button", "addsec tiny");
    add.appendChild(icon("mdi:plus"));
    add.appendChild(el("span", null, esc(this.T("pick_sensor"))));
    add.onclick = () => this._pickSensors(rid, role, this.T("slot_" + role), rule);
    pills.appendChild(add);
    wrap.appendChild(pills);

    if (live.length > 1) {
      const modes = el("div", "gpills");
      for (const [val, label] of [["any", this.T("mode_any")],
                                  ["all", this.T("mode_all")]]) {
        modes.appendChild(this._pill(label, mode === val, () => {
          rule[role + "_mode"] = val; this._save(); this._renderStage();
        }, val === "any" ? "mdi:set-none" : "mdi:set-all", true));
      }
      wrap.appendChild(modes);
    }
    row.appendChild(wrap);

    if (live.length > 1 && mode === "all") {
      if (role === "trigger") {
        this._row(card, this.T("and_window"), this.T("and_window_s")).appendChild(
          this._slider(Number(rule.and_window || 30), 5, 180, 5,
            (v) => v + " " + this.T("secs"),
            (v) => { rule.and_window = v; this._save(); }));
        const st = this._rst(rid);
        const line = el("div", "safenote" + (st.t_ready ? "" : " warn"));
        line.appendChild(icon(st.t_ready ? "mdi:check-circle-outline"
                                         : "mdi:circle-outline"));
        line.appendChild(el("span", null,
          esc(st.t_ready ? this.T("and_ok") : this.T("and_waiting"))));
        card.appendChild(line);
      } else {
        const warn = el("div", "safenote warn");
        warn.appendChild(icon("mdi:alert-outline"));
        warn.appendChild(el("span", null, esc(this.T("hold_all_w"))));
        card.appendChild(warn);
      }
    }
  },

  /* Dragging works, until it does not: a touchscreen, a stylus, a browser that
   * swallows the drop. Picking from a list always works, so that is the way in.
   */
  _sensorChoices(rid, role, rule) {
    const ok = ROLE_OK[role];
    const pool = this._room(rid)[role] || [];
    const picked = ((rule && rule[role + "_pick"]) || []).filter((e) => pool.includes(e));
    const mine = new Set(picked.length ? picked : pool);
    const inRoom = new Set((this._byRoom() || {})[rid] || []);
    const here = [], elsewhere = [], rest = [];
    for (const eid of Object.keys((this._hass && this._hass.states) || {})) {
      if (mine.has(eid)) continue;
      if (!ok(eid.split(".")[0], this._dc(eid))) continue;
      if (inRoom.has(eid)) here.push(eid);
      else if (this._roomOf(eid)) elsewhere.push(eid);
      else rest.push(eid);
    }
    const byName = (a, b) => this._name(a).localeCompare(this._name(b), "tr");
    return { here: here.sort(byName), rest: rest.sort(byName),
             elsewhere: elsewhere.sort(byName) };
  },

  _pickSensors(rid, role, title, rule) {
    const room = this._room(rid);
    const groups = this._sensorChoices(rid, role, rule);
    const chosen = new Set();
    const { ov, box } = this._dialog("picker", title, this.T("pick_sensor_s"), false);
    const ok = el("button", "btn");

    const section = (label, mdi, items, showRoom) => {
      if (!items.length) return;
      const head = el("div", "kind-h");
      head.appendChild(icon(mdi));
      head.appendChild(el("span", "kind-n", esc(label)));
      head.appendChild(el("span", "kind-c", String(items.length)));
      box.appendChild(head);
      const flow = el("div", "gpills");
      for (const eid of items) {
        const home = showRoom ? this._roomOf(eid) : "";
        const pill = this._pill(this._name(eid) +
          (home ? " · " + this._areaName(home) : ""), false, () => {
          if (chosen.has(eid)) chosen.delete(eid); else chosen.add(eid);
          pill.classList.toggle("on");
          ok.textContent = chosen.size
            ? this.T("pick_add_n", { n: chosen.size }) : this.T("done");
        }, this._dc(eid) === "motion" ? "mdi:motion-sensor"
                                      : "mdi:account-check-outline");
        flow.appendChild(pill);
      }
      box.appendChild(flow);
    };

    section(this.T("pick_here"), "mdi:home-outline", groups.here, false);
    section(this.T("pick_free"), "mdi:help-circle-outline", groups.rest, false);
    section(this.T("pick_taken"), "mdi:swap-horizontal", groups.elsewhere, true);
    if (!groups.here.length && !groups.rest.length && !groups.elsewhere.length) {
      box.appendChild(el("div", "empty", esc(this.T("pick_none"))));
    }

    const foot = el("div", "ed-foot");
    const cancel = el("button", "btn ghost");
    cancel.textContent = this.T("cancel");
    cancel.onclick = () => ov.remove();
    ok.textContent = this.T("done");
    ok.onclick = () => {
      if (chosen.size) {
        const fresh = Array.from(chosen);
        room[role] = (room[role] || []).concat(
          fresh.filter((e) => !(room[role] || []).includes(e)));
        if (rule) {
          /* Added to this slot only. The room's list is merely the sum of what
           * the slots listen to, so it grows too — but no other slot starts
           * listening because of it. */
          const key = role + "_pick";
          const pool = room[role] || [];
          const live = (rule[key] || []).filter((e) => pool.includes(e));
          const base = live.length ? live : pool.filter((e) => !fresh.includes(e));
          rule[key] = base.concat(fresh);
        }
        for (const eid of fresh) this._unignore(eid);
        this._save();
      }
      ov.remove();
      this._render();
    };
    foot.appendChild(cancel);
    foot.appendChild(ok);
    box.appendChild(foot);
  },


  _pickLights(rid, rule, going) {
    const gkey = going === "off" ? "off_groups" : "groups";
    const pkey = going === "off" ? "off_picks" : "picks";
    const room = this._room(rid) || {};
    const own = room.groups || [];
    const lights = room.lights || [];
    const groupSet = new Set(rule[gkey] || []);
    const pickSet = new Set(rule[pkey] || []);
    const { ov, box } = this._dialog("picker",
      this.T(going === "off" ? "which_off" : "which_lights"),
      this.T(going === "off" ? "which_off_s" : "which_lights_s"), false);

    const section = (label, mdi, items, render) => {
      if (!items.length) return;
      const head = el("div", "kind-h");
      head.appendChild(icon(mdi));
      head.appendChild(el("span", "kind-n", esc(label)));
      head.appendChild(el("span", "kind-c", String(items.length)));
      box.appendChild(head);
      const flow = el("div", "gpills");
      for (const item of items) flow.appendChild(render(item));
      box.appendChild(flow);
    };

    section(this.T("sec_groups"), "mdi:lightbulb-group-outline", own, (grp) => {
      const pill = this._pill(grp.name + " · " + (grp.lights || []).length,
        groupSet.has(grp.key), () => {
          if (groupSet.has(grp.key)) groupSet.delete(grp.key);
          else groupSet.add(grp.key);
          pill.classList.toggle("on");
        });
      return pill;
    });
    const haGroups = lights.filter((e) => this._groupSize(e));
    const singles = lights.filter((e) => !this._groupSize(e));
    const lightPill = (eid) => {
      const pill = this._pill(this._name(eid) +
        (this._groupSize(eid) ? " · " + this._groupSize(eid) : ""),
        pickSet.has(eid), () => {
          if (pickSet.has(eid)) pickSet.delete(eid); else pickSet.add(eid);
          pill.classList.toggle("on");
        });
      return pill;
    };
    section(this.T("ha_groups"), "mdi:lightbulb-group-outline", haGroups, lightPill);
    section(this.T("sec_lights"), "mdi:lightbulb-outline", singles, lightPill);

    const foot = el("div", "ed-foot");
    const all = el("button", "btn ghost");
    all.textContent = this.T("all_lights");
    all.onclick = () => {
      rule[gkey] = []; rule[pkey] = [];
      ov.remove(); this._save(); this._renderStage();
    };
    const ok = el("button", "btn");
    ok.textContent = this.T("done");
    ok.onclick = () => {
      rule[gkey] = Array.from(groupSet);
      rule[pkey] = Array.from(pickSet);
      ov.remove(); this._save(); this._renderStage();
    };
    foot.appendChild(all);
    const right = el("div", "right");
    right.appendChild(ok);
    foot.appendChild(right);
    box.appendChild(foot);
  },

  rule_lights_preview(rid, rule) {
    const room = this._room(rid) || {};
    const keys = rule.groups || [];
    const picks = (rule.picks || []).filter((e) => (room.lights || []).includes(e));
    if (!keys.length && !picks.length) return room.lights || [];
    const seen = new Set();
    for (const grp of room.groups || []) {
      if (!keys.includes(grp.key)) continue;
      for (const eid of grp.lights || []) seen.add(eid);
    }
    for (const eid of picks) seen.add(eid);
    return Array.from(seen);
  },

  _scenesFor(rid) {
    const byRoom = this._byRoom();
    const mine = (byRoom[rid] || []).filter((e) => e.startsWith("scene."));
    if (mine.length) return mine;
    return Object.keys(this._hass.states || {})
      .filter((e) => e.startsWith("scene."))
      .sort((a, b) => this._name(a).localeCompare(this._name(b), "tr"));
  },

  _slotCard(rid) {
    const room = this._room(rid);
    const st = this._st || {};
    const key = this._slotSel[rid] || st.slot;
    const slot = (st.slots || []).find((s) => s.key === key) || { key, name: key };
    room.slots = room.slots || {};
    const rule = room.slots[key] = Object.assign(
      { on: true, lux_max: 40, groups: [], bri: 70, kelvin: 2700, off_after: 300,
        delay_on: 0, dim_warn: 20, off_on_enter: false,
        trigger_pick: [], hold_pick: [], trigger_mode: "any", hold_mode: "any",
        and_window: 30, watch_dark: false, check_every: 30 },
      room.slots[key] || {});

    const card = el("div", "slotcard");
    const head = el("div", "sc-h");
    head.appendChild(el("span", "sc-t", esc(slot.name || key)));
    head.appendChild(el("span", "sc-s", esc((slot.from || "") + " → " + (slot.to || ""))));
    if (key === st.slot) head.appendChild(el("span", "sc-badge", esc(this.T("in_slot"))));
    const tools = el("div", "sc-tools");
    tools.appendChild(this._pill(this.T("copy_to"), false,
      () => this._copySlot(rid, key), "mdi:content-copy", true));
    if (this._slotUndo && this._slotUndo.rid === rid) {
      tools.appendChild(this._pill(this.T("undo"), false, () => {
        const back = this._slotUndo;
        const target = this._room(back.rid);
        for (const [k, was] of Object.entries(back.before)) {
          target.slots[k] = JSON.parse(JSON.stringify(was));
        }
        this._slotUndo = null;
        this._save();
        this._flash(this.T("copy_undone"));
        this._renderStage();
      }, "mdi:undo-variant", true));
    }
    head.appendChild(tools);
    card.appendChild(head);

    this._row(card, this.T("slot_on"), this.T("slot_on_s")).appendChild(
      this._toggle(rule.on !== false, (val) => {
        rule.on = val; this._save(); this._renderStage();
      }));

    /* The other kind of hour: one that ends the light instead of shaping it. */
    this._row(card, this.T("enter_off"), this.T("enter_off_s")).appendChild(
      this._toggle(rule.off_on_enter === true, (val) => {
        rule.off_on_enter = val; this._save(); this._renderStage();
      }));

    /* Movement is not the only thing that can change the answer. */
    this._row(card, this.T("watch_dark"), this.T("watch_dark_s")).appendChild(
      this._toggle(rule.watch_dark === true, (val) => {
        rule.watch_dark = val; this._save(); this._renderStage();
      }));

    /* The darkness threshold stands on its own: even a slot that is switched
     * off lights the room when it is genuinely dark. */
    const ignore = rule.lux_max == null;
    const luxRow = this._row(card, this.T("lux_max"),
      ignore ? this.T("lux_max_none")
             : (rule.on === false ? this.T("lux_max_off") : this.T("lux_max_s")));
    if (!ignore) {
      luxRow.appendChild(this._slider(Number(rule.lux_max), 0, 500, 5,
        (v) => "≤ " + v + " lux", (v) => { rule.lux_max = v; this._save(); }));
    }
    luxRow.appendChild(this._toggle(!ignore, (val) => {
      rule.lux_max = val ? 40 : null;
      this._save(); this._renderStage();
    }));
    if (!ignore) {
      this._row(card, this.T("check_every"), this.T("check_every_s")).appendChild(
        this._slider(Number(rule.check_every || 30), 5, 300, 5,
          (v) => (v < 60 ? v + this.T("u_sec")
            : (v % 60 ? (v / 60).toFixed(1) : v / 60) + this.T("u_min")),
          (v) => { rule.check_every = v; this._save(); }));
    }

    if (rule.on === false && ignore) {
      const warnBox = el("div", "safenote warn");
      warnBox.appendChild(icon("mdi:alert-outline"));
      warnBox.appendChild(el("span", null, esc(this.T("never_on"))));
      card.appendChild(warnBox);
    }

    this._row(card, this.T("delay_on"), this.T("delay_on_s")).appendChild(
      this._slider(Number(rule.delay_on || 0), 0, 60, 1,
        (v) => v ? v + " " + this.T("secs") : this.T("off"),
        (v) => { rule.delay_on = v; this._save(); }));

    /* The room owns the sensors; the slot chooses among them. A bathroom woken
     * by movement at noon may want only the presence sensor at three in the
     * morning — same room, same sensors, different hour. */


    this._slotRole(card, rid, rule, "trigger");
    this._slotRole(card, rid, rule, "hold");

    /* Which lights this slot switches. Groups and single lamps sit in the same
     * row on purpose: "the desk lamp plus the ambience group" is a normal wish,
     * and forcing a group to be built for every one-off pick is busywork. */
    const groups = room.groups || [];
    const lights = room.lights || [];
    const picks = rule.picks || [];
    const chosen = rule.groups || [];
    const nothing = !chosen.length && !picks.length;
    const lRow = this._row(card, this.T("which_lights"), this.T("which_lights_s"));
    const pills = el("div", "gpills");
    if (nothing) {
      pills.appendChild(this._pill(this.T("all_lights"), true,
        () => this._pickLights(rid, rule), "mdi:lightbulb-multiple-outline"));
    } else {
      /* Only what is chosen is shown; the full list lives behind the button.
       * Sixteen lamps laid out as pills is a wall, not a choice. */
      for (const key of chosen) {
        const grp = groups.find((g) => g.key === key);
        if (!grp) continue;
        pills.appendChild(this._chosenChip(grp.name + " · " + (grp.lights || []).length,
          "mdi:lightbulb-group-outline", () => {
            rule.groups = (rule.groups || []).filter((k) => k !== key);
            this._save(); this._renderStage();
          }));
      }
      for (const eid of picks) {
        pills.appendChild(this._chosenChip(this._name(eid),
          this._groupSize(eid) ? "mdi:lightbulb-group-outline" : "mdi:lightbulb-outline",
          () => {
            rule.picks = (rule.picks || []).filter((e) => e !== eid);
            this._save(); this._renderStage();
          }));
      }
    }
    const pickBtn = el("button", "addsec tiny");
    pickBtn.appendChild(icon("mdi:playlist-edit"));
    pickBtn.appendChild(el("span", null, esc(nothing ? this.T("pick_lights")
                                                     : this.T("pick_change"))));
    pickBtn.onclick = () => this._pickLights(rid, rule);
    pills.appendChild(pickBtn);
    lRow.appendChild(pills);
    if (!nothing) {
      lRow.appendChild(el("span", "pickinfo",
        esc(this.T("picked_n", { n: this._bulbCount(rid, rule) }))));
    }

    /* And which of them go out. Empty means the whole room, which is what
     * most people mean by "off" — but a room that lights only its reading
     * corner may want only that corner put out. */
    const offPicks = rule.off_picks || [];
    const offGroups = rule.off_groups || [];
    const offNothing = !offGroups.length && !offPicks.length;
    const oRow = this._row(card, this.T("which_off"), this.T("which_off_s"));
    const oPills = el("div", "gpills");
    if (offNothing) {
      oPills.appendChild(this._pill(this.T("all_lights"), true,
        () => this._pickLights(rid, rule, "off"), "mdi:lightbulb-multiple-off-outline"));
    } else {
      for (const key of offGroups) {
        const grp = groups.find((g) => g.key === key);
        if (!grp) continue;
        oPills.appendChild(this._chosenChip(grp.name + " · " + (grp.lights || []).length,
          "mdi:lightbulb-group-outline", () => {
            rule.off_groups = (rule.off_groups || []).filter((k) => k !== key);
            this._save(); this._renderStage();
          }));
      }
      for (const eid of offPicks) {
        oPills.appendChild(this._chosenChip(this._name(eid),
          this._groupSize(eid) ? "mdi:lightbulb-group-outline" : "mdi:lightbulb-outline",
          () => {
            rule.off_picks = (rule.off_picks || []).filter((e) => e !== eid);
            this._save(); this._renderStage();
          }));
      }
    }
    const offBtn = el("button", "addsec tiny");
    offBtn.appendChild(icon("mdi:playlist-edit"));
    offBtn.appendChild(el("span", null, esc(offNothing ? this.T("pick_lights")
                                                       : this.T("pick_change"))));
    offBtn.onclick = () => this._pickLights(rid, rule, "off");
    oPills.appendChild(offBtn);
    oRow.appendChild(oPills);

    /* How it comes on: a fixed setting, a scene, or simply as you left it. */
    const how = rule.mode || "set";
    const howRow = this._row(card, this.T("how_on"), this.T("how_on_s"));
    const howPills = el("div", "gpills");
    for (const [key, label, mdi] of [
      ["set", this.T("how_set"), "mdi:tune"],
      ["scene", this.T("how_scene"), "mdi:palette-outline"],
      ["last", this.T("how_last"), "mdi:history"],
    ]) {
      howPills.appendChild(this._pill(label, how === key, () => {
        rule.mode = key; this._save(); this._renderStage();
      }, mdi));
    }
    howRow.appendChild(howPills);

    if (how === "set") {
      const briRow = this._row(card, this.T("bri_kelvin"));
      briRow.appendChild(this._slider(Number(rule.bri || 70), 1, 100, 1,
        (v) => "%" + v, (v) => { rule.bri = v; this._save(); }));
      briRow.appendChild(this._slider(Number(rule.kelvin || 2700), 2000, 6500, 100,
        (v) => v + "K", (v) => { rule.kelvin = v; this._save(); }, "kel"));

      const colRow = this._row(card, this.T("color"), this.T("color_s"));
      const swatches = el("div", "gpills");
      const cur = rule.color;
      const same = (c) => cur && c && cur[0] === c[0] && cur[1] === c[1] && cur[2] === c[2];
      swatches.appendChild(this._pill(this.T("no_color"), !cur, () => {
        rule.color = null; this._save(); this._renderStage();
      }, "mdi:thermometer"));
      for (const [name, rgb] of COLOR_SET) {
        const dot = el("span", "swatch" + (same(rgb) ? " on" : ""));
        dot.style.background = "rgb(" + rgb.join(",") + ")";
        dot.title = name;
        dot.onclick = () => { rule.color = rgb; this._save(); this._renderStage(); };
        swatches.appendChild(dot);
      }
      colRow.appendChild(swatches);
    } else if (how === "last") {
      /* "The last setting" needs a first setting. This is the level used the
       * first time a lamp is lit, and whenever LUMEN has never seen it on —
       * it used to be an invisible number, which is how a slot ended up
       * switching a room on at ten percent with nothing on screen saying so. */
      this._row(card, this.T("bri_first"), this.T("bri_first_s")).appendChild(
        this._slider(Number(rule.bri || 70), 1, 100, 1,
          (v) => "%" + v, (v) => { rule.bri = v; this._save(); }));
    } else if (how === "scene") {
      const scRow = this._row(card, this.T("scene"), this.T("scene_s"));
      const sel = el("select", "nsel");
      const none = el("option");
      none.value = ""; none.textContent = this.T("none");
      sel.appendChild(none);
      for (const eid of this._scenesFor(rid)) {
        const opt = el("option");
        opt.value = eid;
        opt.textContent = this._name(eid);
        if (rule.scene === eid) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = () => { rule.scene = sel.value; this._save(); this._renderStage(); };
      scRow.appendChild(sel);
    }

    const offRow = this._row(card, this.T("off_after"), this.T("off_after_s"));
    const offOn = rule.off_enabled !== false;
    if (offOn) {
      offRow.appendChild(this._stepSlider(OFF_STEPS, rule.off_after || 0,
        (v) => v <= 0 ? this.T("at_once")
          : (v < 120 ? v + " " + this.T("secs")
                     : Math.round(v / 60) + " " + this.T("mins")),
        (v) => { rule.off_after = v; this._save(); }));
    }
    offRow.appendChild(this._toggle(offOn, (val) => {
      rule.off_enabled = val; this._save(); this._renderStage();
    }));

    if (offOn) {
      this._row(card, this.T("dim_warn"), this.T("dim_warn_s")).appendChild(
        this._slider(Number(rule.dim_warn || 0), 0, 60, 5,
          (v) => v ? v + " " + this.T("secs") : this.T("off"),
          (v) => { rule.dim_warn = v; this._save(); }));
    }

    if (key === st.slot) {
      const rst = this._rst(rid);
      const line = el("div", "decide" + (rst.would ? "" : " no"));
      line.appendChild(el("span", "dot"));
      line.appendChild(el("span", null,
        "<b>" + esc(this.T("what_now")) + "</b>&nbsp; " +
        "<b>" + esc(rst.would ? this.T("would_on") : this.T("would_off")) + "</b> · " +
        esc(rst.why || "")));
      card.appendChild(line);
    }
    return card;
  },


  _tempNow(rid) {
    const list = (this._room(rid) || {}).temp || [];
    const vals = [];
    for (const eid of list) {
      const st = this._hass && this._hass.states[eid];
      const v = st ? Number(st.state) : NaN;
      if (Number.isFinite(v)) vals.push(v);
    }
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  },

  /* More than one sensor is an average: a room has one temperature, however
   * many thermometers disagree about it. */
  _tempSection(stage, rid, inner) {
    const room = this._room(rid);
    room.temp = (room.temp || []).filter((e) => typeof e === "string" && e);
    const sec = (inner ? this._sub : this._sec).call(this, stage, this.T("sec_temp"),
      room.temp.length || this.T("none"));
    const flow = el("div", "devflow");
    for (const eid of room.temp) {
      const st = this._hass.states[eid];
      const unit = (st && st.attributes &&
        st.attributes.unit_of_measurement) || "°";
      flow.appendChild(this._chip(eid, {
        inzone: true,
        sub: st && Number.isFinite(Number(st.state))
          ? st.state + " " + unit : "—",
        onRemove: () => {
          room.temp = room.temp.filter((e) => e !== eid);
          this._save(); this._render();
        },
      }));
    }
    if (!room.temp.length) {
      flow.appendChild(el("div", "hint", esc(this.T("temp_s"))));
    }
    sec.appendChild(flow);
    const pick = el("button", "btn ghost");
    pick.style.marginTop = "10px";
    pick.textContent = this.T("temp_pick");
    pick.onclick = () => {
      const pool = Object.keys(this._hass.states).filter((eid) => {
        if (eid.split(".")[0] !== "sensor") return false;
        const attrs = this._hass.states[eid].attributes || {};
        return attrs.device_class === "temperature" ||
          attrs.unit_of_measurement === "°C" ||
          attrs.unit_of_measurement === "°F";
      });
      this._pickMany(this.T("sec_temp"),
        pool.map((e) => ({ key: e, name: this._name(e) })),
        room.temp, (list) => {
          room.temp = list;
          this._save(); this._render();
        }, this.T("temp_s"));
    };
    sec.appendChild(pick);
  },

  /* Any Material Design icon by name, plus a handful of common ones to save
   * the typing. Left empty the room wears whatever its type suggests. */
  _iconSection(stage, rid) {
    const room = this._room(rid);
    const sec = this._sec(stage, this.T("room_icon"),
      room.icon ? room.icon : this.T("icon_auto"));
    sec.appendChild(el("div", "hint", esc(this.T("room_icon_s"))));

    const preview = el("div", "iconprev");
    const draw = () => {
      preview.textContent = "";
      preview.appendChild(icon(this._roomIcon(rid)));
      preview.appendChild(el("span", null, esc(this._roomIcon(rid))));
    };
    draw();
    sec.appendChild(preview);

    const row = el("div", "iconrow");
    const input = el("input", "nin");
    input.placeholder = "mdi:sofa";
    input.value = room.icon || "";
    const apply = (value) => {
      const clean = String(value || "").trim().toLowerCase();
      room.icon = clean && clean.startsWith("mdi:") ? clean : "";
      input.value = room.icon;
      this._save();
      draw();
      this._renderStage();
    };
    input.onchange = () => apply(input.value);
    row.style.position = "relative";
    row.appendChild(input);
    const clear = el("button", "btn ghost");
    clear.textContent = this.T("icon_reset");
    clear.onclick = () => apply("");
    row.appendChild(clear);
    sec.appendChild(row);

    /* Suggestions appear under the field as you type. The list is a shortlist
     * of the icons rooms are usually given — anything else Material Design has
     * still works, it simply will not be offered. */
    const hints = el("div", "pick-hints icon-hints");
    row.appendChild(hints);
    const suggest = () => {
      hints.textContent = "";
      const needle = String(input.value || "").trim().toLowerCase()
        .replace(/^mdi:/, "");
      if (needle.length < 2) { hints.classList.remove("on"); return; }
      /* Names that begin with what was typed first, then the rest — typing
       * "lamp" should offer floor-lamp, but the plain lamps first. */
      const all = ICON_CHOICES.filter((mdi) => mdi.slice(4).includes(needle));
      all.sort((x, y) => x.slice(4).indexOf(needle) - y.slice(4).indexOf(needle)
        || x.length - y.length);
      const hits = all.slice(0, 9);
      if (!hits.length) { hints.classList.remove("on"); return; }
      for (const mdi of hits) {
        const line = el("div", "pick-hint");
        line.appendChild(icon(mdi));
        const at = mdi.slice(4).indexOf(needle);
        line.appendChild(el("span", null,
          esc(mdi.slice(4, 4 + at)) + "<b>" +
          esc(mdi.slice(4 + at, 4 + at + needle.length)) + "</b>" +
          esc(mdi.slice(4 + at + needle.length))));
        line.onclick = () => { hints.classList.remove("on"); apply(mdi); };
        hints.appendChild(line);
      }
      hints.classList.add("on");
    };
    input.oninput = suggest;
    input.onfocus = suggest;
  },

  _luxSection(stage, rid, inner) {
    const room = this._room(rid);
    const st = this._rst(rid);
    const sec = (inner ? this._sub : this._sec).call(this, stage, this.T("sec_lux"),
      room.lux ? "1" : this.T("none"));
    const flow = el("div", "devflow");
    if (room.lux) {
      const frozen = st.lux_frozen != null && st.lit;
      flow.appendChild(this._chip(room.lux, {
        inzone: true, draggable: true,
        sub: (st.lux != null ? st.lux + " lux" : "—") +
             (frozen ? " · " + this.T("frozen") + " " + st.lux_frozen : ""),
        onRemove: () => { room.lux = ""; this._save(); this._render(); },
      }));
    } else {
      const ghost = el("div", "dev ghost");
      ghost.appendChild(el("span", "dot"));
      ghost.appendChild(el("span", "dn", esc(this.T("drop_here"))));
      flow.appendChild(ghost);
    }
    sec.appendChild(flow);
    const box = el("div", "safenote");
    box.appendChild(icon("mdi:snowflake"));
    box.appendChild(el("span", null, esc(this.T("lux_note"))));
    sec.appendChild(box);
    this._dropTarget(sec,
      (eid) => ROLE_OK.lux(eid.split(".")[0], this._dc(eid)),
      (eid) => { room.lux = eid; return true; });
  },

  _lightSection(stage, rid, inner) {
    const room = this._room(rid);
    const list = room.lights || [];
    const singles = list.filter((eid) => !this._groupSize(eid));
    const groups = list.filter((eid) => this._groupSize(eid));
    const sec = (inner ? this._sub : this._sec).call(this, stage, this.T("sec_lights"),
      list.length);

    const chipOf = (eid) => {
      const marks = (room.groups || [])
        .filter((g) => (g.lights || []).includes(eid)).map((g) => g.name);
      const size = this._groupSize(eid);
      return this._chip(eid, {
        inzone: true, draggable: true,
        sub: size ? this.T("members_n", { n: size }) +
          (marks.length ? " · " + marks.join(", ") : "")
          : (marks.length ? marks.join(", ") : undefined),
        onTap: (e) => this._pickGroups(rid, e),
        onRemove: (e) => {
          room.lights = list.filter((x) => x !== e);
          for (const grp of room.groups || []) {
            grp.lights = (grp.lights || []).filter((x) => x !== e);
          }
          this._ignore(e);
          this._save(); this._render();
        },
      });
    };

    const flow = el("div", "devflow");
    for (const eid of singles) flow.appendChild(chipOf(eid));
    const ghost = el("div", "dev ghost");
    ghost.appendChild(el("span", "dot"));
    ghost.appendChild(el("span", "dn", esc(this.T("drop_here"))));
    flow.appendChild(ghost);
    sec.appendChild(flow);

    /* Home Assistant's own groups, kept apart from the bulbs so nobody assigns
     * "All House Lights" to a bedroom by accident. */
    if (groups.length) {
      const head = el("div", "kind-h");
      head.appendChild(icon("mdi:lightbulb-group-outline"));
      head.appendChild(el("span", "kind-n", esc(this.T("ha_groups"))));
      head.appendChild(el("span", "kind-c", String(groups.length)));
      sec.appendChild(head);
      const gflow = el("div", "devflow");
      for (const eid of groups) gflow.appendChild(chipOf(eid));
      sec.appendChild(gflow);
      const note = el("div", "safenote warn");
      note.appendChild(icon("mdi:alert-outline"));
      note.appendChild(el("span", null, esc(this.T("ha_groups_note"))));
      sec.appendChild(note);
    }
    this._dropTarget(sec,
      (eid) => ROLE_OK.lights(eid.split(".")[0]),
      (eid) => {
        if (list.includes(eid)) return false;
        room.lights = list.concat([eid]);
        return true;
      });
  },

  _groupSection(stage, rid, inner) {
    const room = this._room(rid);
    room.groups = room.groups || [];
    const sec = inner
      ? this._sub(stage, this.T("sec_groups"), room.groups.length)
      : this._sec(stage, this.T("sec_groups"), room.groups.length,
      [this._btnAdd(this.T("add_group"), () => {
        this._promptText(this.T("group_name"), "", (name) => {
          if (!name) return;
          room.groups.push({ key: uid(), name, lights: [] });
          this._save(); this._render();
        });
      }, true)]);

    if (!room.groups.length) {
      sec.appendChild(el("div", "empty", esc(this.T("all_lights"))));
      return;
    }
    for (const grp of room.groups) {
      const box = el("div");
      box.style.cssText = "padding:6px 0 10px;";
      const head = el("div");
      head.style.cssText = "display:flex;align-items:center;gap:9px;margin-bottom:7px;";
      const name = el("span");
      name.style.cssText = "font-size:12.5px;color:#c4b9d0;letter-spacing:1.2px;" +
        "text-transform:uppercase;font-weight:600;cursor:pointer;";
      name.textContent = grp.name;
      name.onclick = () => this._promptText(this.T("group_name"), grp.name, (val) => {
        grp.name = val || grp.name; this._save(); this._render();
      });
      head.appendChild(name);
      head.appendChild(el("span", "sec-count", String((grp.lights || []).length)));
      const del = el("button", "dev-x");
      del.style.marginLeft = "auto";
      del.appendChild(icon("mdi:trash-can-outline"));
      del.onclick = () => {
        room.groups = room.groups.filter((g) => g !== grp);
        for (const rule of Object.values(room.slots || {})) {
          rule.groups = (rule.groups || []).filter((k) => k !== grp.key);
        }
        this._save(); this._render();
      };
      head.appendChild(del);
      box.appendChild(head);
      const flow = el("div", "devflow");
      for (const eid of grp.lights || []) {
        flow.appendChild(this._chip(eid, {
          inzone: true, draggable: true,
          onRemove: (e) => {
            grp.lights = grp.lights.filter((x) => x !== e);
            this._save(); this._render();
          },
        }));
      }
      const ghost = el("div", "dev ghost");
      ghost.appendChild(el("span", "dot"));
      ghost.appendChild(el("span", "dn", esc(this.T("drop_here"))));
      flow.appendChild(ghost);
      box.appendChild(flow);
      sec.appendChild(box);
      this._dropTarget(box,
        (eid) => ROLE_OK.lights(eid.split(".")[0]),
        (eid) => {
          if ((grp.lights || []).includes(eid)) return false;
          grp.lights = (grp.lights || []).concat([eid]);
          if (!(room.lights || []).includes(eid)) {
            room.lights = (room.lights || []).concat([eid]);
          }
          return true;
        });
    }
  },

  _poolSection(stage, rid) {
    const room = this._room(rid);
    const byRoom = this._byRoom();
    const ents = byRoom[rid] || [];
    const used = new Set([...(room.trigger || []), ...(room.hold || []),
                          ...(room.lights || []), room.lux].filter(Boolean));
    const free = ents.filter((e) => !used.has(e));
    const sec = this._sec(stage, this.T("sec_pool"),
      free.length + " · " + this.T("sec_pool_s"));
    const flow = el("div", "devflow");
    for (const eid of free) {
      const dom = eid.split(".")[0];
      const dc = this._dc(eid);
      const usable = ROLE_OK.lights(dom) || ROLE_OK.trigger(dom, dc) ||
                     ROLE_OK.hold(dom, dc) || ROLE_OK.lux(dom, dc);
      flow.appendChild(this._chip(eid, {
        draggable: usable, locked: !usable,
        onTap: usable ? (e) => this._pickRole(rid, e) : null,
      }));
    }
    if (!free.length) flow.appendChild(el("div", "empty", esc(this.T("none"))));
    sec.appendChild(flow);
    sec.appendChild(el("div", "hint", esc(this.T("dnd_hint"))));
  },



  /* ============================================================== MODES PAGE */
  _modeCfg(key) {
    return (this._cfg.modes || []).find((m) => m.key === key) || { key, name: key };
  },
  /* One Room mode. It does one thing, so it is described in a sentence and
   * then asks only what it cannot work out: which sensor counts as arriving,
   * and which rooms are none of its business. */
  _aloneCard(card, mode, st) {
    card.appendChild(el("div", "alone-lead", esc(this.T("alone_lead"))));

    mode.enter = mode.enter || {};
    mode.keep = mode.keep || [];
    const rooms = Object.keys(this._cfg.rooms || {})
      .map((rid) => ({ id: rid, name: this._areaName(rid) }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
    if (!rooms.length) {
      card.appendChild(el("div", "empty", esc(this.T("no_rooms_h"))));
      return;
    }

    const head = el("div", "al-head");
    head.appendChild(el("span", null, esc(this.T("alone_room"))));
    head.appendChild(el("span", null, esc(this.T("alone_enter"))));
    head.appendChild(el("span", null, esc(this.T("alone_keep"))));
    card.appendChild(head);

    for (const room of rooms) {
      const cfg = this._cfg.rooms[room.id] || {};
      /* Only this room's own sensors can mean "I am in this room". */
      const pool = [].concat(cfg.trigger || [], cfg.hold || [])
        .filter((e, i, all) => all.indexOf(e) === i);
      const picked = (mode.enter[room.id] || []).filter((e) => pool.includes(e));
      const live = picked.length ? picked : (cfg.trigger || []);
      const kept = mode.keep.includes(room.id);

      const row = el("div", "al-row" + (kept ? " kept" : ""));
      const name = el("div", "al-n");
      name.appendChild(icon(this._roomIcon(room.id)));
      name.appendChild(el("span", null, esc(room.name)));
      row.appendChild(name);

      const pick = el("div", "al-s");
      if (!pool.length) {
        pick.appendChild(el("span", "al-none", esc(this.T("alone_nosensor"))));
      } else {
        pick.appendChild(this._pill(
          picked.length
            ? picked.map((e) => this._name(e)).join(", ")
            : (live.length
                ? this.T("alone_auto", { s: live.map((e) => this._name(e)).join(", ") })
                : this.T("none")),
          picked.length > 0,
          () => this._pickMany(this.T("alone_enter"),
            pool.map((e) => ({ key: e, name: this._name(e) })),
            picked, (list) => {
              mode.enter[room.id] = list;
              this._save(); this._render();
            }, this.T("alone_pick_s", { s: room.name })), "mdi:motion-sensor"));
      }
      row.appendChild(pick);

      const keep = el("div", "al-k");
      keep.appendChild(this._toggle(kept, (val) => {
        mode.keep = val ? mode.keep.concat([room.id])
                        : mode.keep.filter((r) => r !== room.id);
        this._save(); this._renderStage();
      }));
      row.appendChild(keep);
      card.appendChild(row);
    }

    if (mode.keep.length) {
      const note = el("div", "safenote");
      note.appendChild(icon("mdi:home-heart"));
      note.appendChild(el("span", null, esc(this.T("alone_keep_n", {
        s: mode.keep.map((r) => this._areaName(r)).join(", "),
      }))));
      card.appendChild(note);
    }
  },

  _modeName(mode) {
    if (!mode) return "";
    const name = mode.name;
    if (name && typeof name === "object") {
      return name[this._lang()] || name.en || mode.key;
    }
    return String(name || mode.key);
  },

  _pageModes(stage) {
    const st = this._st || {};
    const head = el("div", "stage-h");
    head.appendChild(el("div", "room-title", esc(this.T("modes_h"))));
    head.appendChild(el("div", "room-meta", esc(this.T("house_mode")) + ": <b>" +
      esc(st.mode_name || "") + "</b>"));
    stage.appendChild(head);

    const sec = this._sec(stage, this.T("modes_h"), (this._cfg.modes || []).length,
      [this._btnAdd(this.T("add_mode"), () => {
        this._promptText(this.T("mode_name"), "", (name) => {
          if (!name) return;
          this._cfg.modes.push({
            key: "m" + uid(), name: { tr: name, en: name }, icon: "mdi:circle-outline",
            bri: null, kelvin: null, expire_h: 0,
          });
          this._save(); this._render();
        });
      }, true)]);
    sec.appendChild(el("div", "empty", esc(this.T("modes_s"))));

    const rooms = this._roomList().map((r) => ({ key: r.id, name: r.name }));
    for (const mode of this._cfg.modes || []) {
      const card = el("div", "mode-card" + (st.mode === mode.key ? " on" : ""));
      const cardHead = el("div", "mc-h");
      cardHead.appendChild(icon(mode.icon || "mdi:circle-outline"));
      const title = el("span", "mc-t", esc(this._modeName(mode)));
      title.style.cursor = "pointer";
      title.onclick = () => this._promptText(this.T("mode_name"), this._modeName(mode),
        (val) => {
          if (!val) return;
          mode.name = { tr: val, en: val };
          this._save(); this._render();
        });
      cardHead.appendChild(title);
      if (st.mode === mode.key) {
        cardHead.appendChild(el("span", "mc-badge", esc(this.T("active") +
          (st.mode_in ? " · " + mmss(st.mode_in) : ""))));
      }
      const tools = el("div", "mc-act");
      tools.appendChild(this._pill(this.T("active"), st.mode === mode.key,
        () => this._act({ action: "set_mode", mode: mode.key }).then(() => this._loadState()),
        "mdi:play-outline", true));
      if (mode.key !== "normal") {
        const del = el("span", "pick tiny");
        del.appendChild(icon("mdi:trash-can-outline"));
        del.onclick = () => this._confirm(this.T("del_mode"), this._modeName(mode),
          this.T("yes"), () => {
            this._cfg.modes = this._cfg.modes.filter((m) => m !== mode);
            for (const room of Object.values(this._cfg.rooms || {})) {
              room.mode_off = (room.mode_off || []).filter((k) => k !== mode.key);
            }
            if (this._cfg.mode === mode.key) this._cfg.mode = "normal";
            this._save(); this._render();
          });
        tools.appendChild(del);
      }
      cardHead.appendChild(tools);
      card.appendChild(cardHead);

      if (mode.key === "alone") {
        this._aloneCard(card, mode, st);
        sec.appendChild(card);
        continue;
      }
      if (mode.key === "normal") {
        /* Normal is what "no mode" looks like. A setting here would be a
         * second opinion about something the rooms have already answered. */
        card.appendChild(el("div", "alone-lead", esc(this.T("m_normal_s"))));
        sec.appendChild(card);
        continue;
      }

      const briRow = this._row(card, this.T("m_bri"));
      const briOff = mode.bri == null;
      briRow.appendChild(this._pill(this.T("m_free"), briOff, () => {
        mode.bri = briOff ? 60 : null; this._save(); this._renderStage();
      }, null, true));
      if (!briOff) {
        briRow.appendChild(this._slider(Number(mode.bri), 1, 100, 1, (v) => "%" + v,
          (v) => { mode.bri = v; this._save(); }));
      }

      const kelRow = this._row(card, this.T("m_kelvin"));
      const kelOff = mode.kelvin == null;
      kelRow.appendChild(this._pill(this.T("m_free"), kelOff, () => {
        mode.kelvin = kelOff ? 2700 : null; this._save(); this._renderStage();
      }, null, true));
      if (!kelOff) {
        kelRow.appendChild(this._slider(Number(mode.kelvin), 2000, 6500, 100,
          (v) => v + "K", (v) => { mode.kelvin = v; this._save(); }, "kel"));
      }

      this._row(card, this.T("m_expire"), this.T("m_expire_s")).appendChild(
        this._slider(Number(mode.expire_h || 0), 0, 24, 1,
          (v) => v ? v + " " + this.T("hours") : this.T("off"),
          (v) => { mode.expire_h = v; this._save(); }));

      sec.appendChild(card);
    }
  },

  /* ============================================================== SLOTS PAGE */
  /* "sunrise+60" is a fine thing to store and a poor thing to ask anyone to
   * type. Three dropdowns say the same thing, and the resolved clock time is
   * printed underneath so there is nothing to work out in your head. */
  _parseSpec(spec) {
    const raw = String(spec || "").trim().toLowerCase();
    for (const base of ["sunrise", "sunset"]) {
      if (raw.startsWith(base)) {
        const rest = raw.slice(base.length).replace(/\s+/g, "");
        return { base, offset: rest ? parseInt(rest, 10) || 0 : 0 };
      }
    }
    return { base: "clock", time: /^\d{1,2}:\d{2}$/.test(raw) ? raw : "06:00" };
  },

  _buildSpec(part) {
    if (part.base === "clock") return part.time || "06:00";
    const off = Number(part.offset || 0);
    return part.base + (off > 0 ? "+" + off : (off < 0 ? String(off) : ""));
  },

  _specClock(spec) {
    const sun = (this._st && this._st.sun) || {};
    const part = this._parseSpec(spec);
    if (part.base === "clock") return part.time;
    const base = part.base === "sunrise" ? sun.sunrise_min : sun.sunset_min;
    if (base == null) return "";
    const total = ((base + Number(part.offset || 0)) % 1440 + 1440) % 1440;
    return String(Math.floor(total / 60)).padStart(2, "0") + ":" +
           String(total % 60).padStart(2, "0");
  },

  _timeField(label, spec, onChange) {
    const part = this._parseSpec(spec);
    const wrap = el("div", "timefield");
    wrap.appendChild(el("span", "tf-l", esc(label)));
    const line = el("div", "tf-line");

    const base = el("select", "nsel tf-base");
    for (const [key, text] of [["clock", this.T("tf_clock")],
                               ["sunrise", this.T("tf_sunrise")],
                               ["sunset", this.T("tf_sunset")]]) {
      const opt = el("option");
      opt.value = key;
      opt.textContent = text;
      if (part.base === key) opt.selected = true;
      base.appendChild(opt);
    }
    base.onchange = () => {
      onChange(this._buildSpec(base.value === "clock"
        ? { base: "clock", time: part.time || "06:00" }
        : { base: base.value, offset: part.offset || 0 }));
    };
    line.appendChild(base);

    if (part.base === "clock") {
      const time = el("input", "nin tf-time");
      time.type = "time";
      time.value = part.time;
      time.onchange = () => {
        if (time.value) onChange(this._buildSpec({ base: "clock", time: time.value }));
      };
      line.appendChild(time);
    } else {
      const off = el("select", "nsel tf-off");
      for (const minutes of TIME_OFFSETS) {
        const opt = el("option");
        opt.value = String(minutes);
        opt.textContent = minutes === 0 ? this.T("tf_exact")
          : (minutes < 0 ? Math.abs(minutes) + " " + this.T("tf_before")
                         : minutes + " " + this.T("tf_after"));
        if (Number(part.offset || 0) === minutes) opt.selected = true;
        off.appendChild(opt);
      }
      off.onchange = () => onChange(this._buildSpec(
        { base: part.base, offset: Number(off.value) }));
      line.appendChild(off);
    }
    wrap.appendChild(line);
    const clock = this._specClock(spec);
    if (clock) wrap.appendChild(el("span", "tf-now", esc(this.T("tf_today", { t: clock }))));
    return wrap;
  },

  /* Hours nobody owns: the engine has to fall back to the first slot there, and
   * a rule you did not choose is worse than one you did. */
  /* Who inherits a deleted slot's hours: the one that ends where it starts,
   * otherwise the one that starts where it ends. */
  _slotHeir(slot) {
    const live = (this._st && this._st.slots) || [];
    const me = live.find((x) => x.key === slot.key);
    if (!me || me.start == null) return null;
    const before = live.find((x) => x.key !== slot.key && x.end === me.start);
    if (before) {
      const found = (this._cfg.slots || []).find((x) => x.key === before.key);
      if (found) { found._takes = "to"; return found; }
    }
    const after = live.find((x) => x.key !== slot.key && x.start === me.end);
    if (after) {
      const found = (this._cfg.slots || []).find((x) => x.key === after.key);
      if (found) { found._takes = "from"; return found; }
    }
    return null;
  },

  /* One button that leaves the day in a state that always works: slots in clock
   * order, no two starting at the same minute, and no leftover end times from
   * the version where ends were typed by hand. */
  _tidySlots() {
    const live = (this._st && this._st.slots) || [];
    const at = (key) => {
      const found = live.find((x) => x.key === key);
      return found && found.start != null ? found.start : 9999;
    };
    const slots = (this._cfg.slots || []).slice()
      .sort((a, b) => at(a.key) - at(b.key));
    let moved = 0;
    let prev = -1;
    for (const slot of slots) {
      delete slot.to;                       // ends are derived now
      let start = at(slot.key);
      if (start === 9999) { slot.from = "12:00"; start = 720; moved++; }
      if (start === prev) {                 // two slots on the same minute
        const bumped = (start + 30) % 1440;
        slot.from = String(Math.floor(bumped / 60)).padStart(2, "0") + ":" +
          String(bumped % 60).padStart(2, "0");
        start = bumped;
        moved++;
      }
      prev = start;
    }
    this._cfg.slots = slots;
    this._save();
    this._render();
    this._flash(moved ? this.T("tidy_fixed", { n: moved }) : this.T("tidy_ok"));
  },

  _slotGaps() {
    const slots = (this._st && this._st.slots) || [];
    const covered = new Array(1440).fill(false);
    for (const sl of slots) {
      if (sl.start == null || sl.end == null) continue;
      let m = sl.start;
      const end = sl.end;
      for (let i = 0; i < 1440; i++) {
        if (m === end) break;
        covered[m] = true;
        m = (m + 1) % 1440;
      }
    }
    const gaps = [];
    let run = null;
    for (let m = 0; m <= 1440; m++) {
      const free = m < 1440 && !covered[m];
      if (free && run === null) run = m;
      if (!free && run !== null) { gaps.push([run, m]); run = null; }
    }
    return gaps;
  },

  _pageSlots(stage) {
    const st = this._st || {};
    const head = el("div", "stage-h");
    head.appendChild(el("div", "room-title", esc(this.T("slots_h"))));
    const sun = st.sun || {};
    head.appendChild(el("div", "room-meta",
      esc(this.T("sun_now", { a: sun.sunrise || "—", b: sun.sunset || "—" }))));
    stage.appendChild(head);

    const tidy = this._pill(this.T("slots_tidy"), false, () => this._tidySlots(),
      "mdi:auto-fix");
    const sec = this._sec(stage, this.T("slots_h"), (this._cfg.slots || []).length,
      [tidy, this._btnAdd(this.T("add_slot"), () => {
        this._promptText(this.T("mode_name"), "", (name) => {
          if (!name) return;
          this._cfg.slots.push({
            key: "s" + uid(), name: { tr: name, en: name }, from: "12:00", to: "",
          });
          this._save(); this._render();
        });
      }, true)]);
    sec.classList.add("slots");
    sec.appendChild(el("div", "empty", esc(this.T("slots_s"))));
    const bar = el("div");
    bar.style.marginTop = "14px";
    bar.appendChild(this._riverBar("__preview", { plain: true }));
    sec.appendChild(bar);

    const order = ((this._st && this._st.slots) || []).map((x) => x.key);
    const ordered = (this._cfg.slots || []).slice().sort((a, b) => {
      const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
      const sa = ((this._st.slots || []).find((x) => x.key === a.key) || {}).start;
      const sb = ((this._st.slots || []).find((x) => x.key === b.key) || {}).start;
      if (sa != null && sb != null) return sa - sb;
      return ia - ib;
    });
    for (const slot of ordered) {
      const row = el("div", "row");
      const left = el("div", "rl");
      const name = el("b");
      name.style.cursor = "pointer";
      name.textContent = this._modeName(slot);
      name.onclick = () => this._promptText(this.T("mode_name"), this._modeName(slot),
        (val) => {
          if (!val) return;
          slot.name = { tr: val, en: val };
          this._save(); this._render();
        });
      left.appendChild(name);
      left.appendChild(el("small", null, esc(slot.key)));
      row.appendChild(left);
      const right = el("div", "rr2");

      right.appendChild(this._timeField(this.T("slot_from"), slot.from, (val) => {
        slot.from = val; this._save(); this._render();
      }));
      const live = ((this._st && this._st.slots) || []).find((x) => x.key === slot.key);
      const ends = el("div", "timefield");
      ends.appendChild(el("span", "tf-l", esc(this.T("slot_to"))));
      const hm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" +
        String(m % 60).padStart(2, "0");
      ends.appendChild(el("div", "tf-derived",
        live && live.end != null ? esc(hm(live.end)) : "—"));
      const nxt = live && live.end != null
        ? ((this._st.slots || []).find((x) => x.key !== slot.key && x.start === live.end))
        : null;
      ends.appendChild(el("span", "tf-now",
        esc(nxt ? this.T("until_next", { s: nxt.name }) : this.T("until_wrap"))));
      right.appendChild(ends);

      if ((this._cfg.slots || []).length > 1) {
        const del = el("button", "dev-x");
        del.appendChild(icon("mdi:trash-can-outline"));
        del.onclick = () => {
          const n = Object.keys(this._cfg.rooms || {}).length;
          /* Removing a slot must never leave hours unowned: the neighbour that
           * ran up to it takes over its span. */
          const before = ((this._st.slots || []).find((x) => {
            const me = (this._st.slots || []).find((y) => y.key === slot.key);
            return me && x.key !== slot.key && x.end === me.start;
          }) || {}).name;
          const body = this.T("del_slot_b", { n }) +
            (before ? " " + this.T("del_slot_heir", { s: before }) : "");
          this._confirm(this.T("del_slot_q"), body, this.T("yes"), () => {
            this._cfg.slots = this._cfg.slots.filter((s) => s !== slot);
            for (const room of Object.values(this._cfg.rooms || {})) {
              if (room.slots) delete room.slots[slot.key];
            }
            this._save(); this._render();
          });
        };
        right.appendChild(del);
      }
      row.appendChild(right);
      sec.appendChild(row);
    }
  },

  /* ================================================================ LOG PAGE */
  _logRow(ev, hideRoom) {
    const row = el("div", "logrow");
    row.appendChild(el("span", "lt", esc(String(ev.ts || "").slice(11, 16))));
    const labels = {
      on: this._lang() === "tr" ? "AÇ" : "ON",
      off: this._lang() === "tr" ? "KAPAT" : "OFF",
      dim: this._lang() === "tr" ? "KIS" : "DIM",
      block: this._lang() === "tr" ? "AÇMADI" : "HELD",
      manual: this._lang() === "tr" ? "ELLE" : "MANUAL",
      slot: this._lang() === "tr" ? "DİLİM" : "SLOT",
      mode: this._lang() === "tr" ? "MOD" : "MODE",
      fuse: this._lang() === "tr" ? "SİGORTA" : "FUSE",
      lock: this._lang() === "tr" ? "KİLİT" : "LOCK",
      setup: this._lang() === "tr" ? "KURULUM" : "SETUP",
      engine: this._lang() === "tr" ? "MOTOR" : "ENGINE",
    };
    row.appendChild(el("span", "la " + (ev.action || ""),
      esc(labels[ev.action] || String(ev.action || "").toUpperCase())));
    let text = ev.text || "";
    if (hideRoom && ev.room) {
      const name = this._areaName(ev.room);
      if (text.startsWith(name)) text = text.slice(name.length).replace(/^[\s—·-]+/, "");
    }
    row.appendChild(el("span", "lr", esc(text)));
    return row;
  },

  /* What the lights actually cost. Measured by the engine as it runs, so it
   * starts the day you install this and grows — no back-dating, and the page
   * says which day it started counting rather than pretending to know more. */
  _pageStats(stage) {
    const head = el("div", "stage-h");
    head.appendChild(el("div", "room-title", esc(this.T("page_stats"))));
    const meta = el("div", "room-meta");
    head.appendChild(meta);
    stage.appendChild(head);

    const sec = this._sec(stage, this.T("stats_use"), this.T("stats_use_s"));
    const body = el("div");
    sec.appendChild(body);

    /* Where the time actually goes, straight from the sensors — not what the
     * lighting did, but where somebody was. */
    const stay = this._sec(stage, this.T("stats_stay"), this.T("stats_stay_s"));
    const stayBody = el("div");
    stay.appendChild(stayBody);

    const draw = () => {
      body.innerHTML = "";
      const data = (this._insight && this._insight.usage) || null;
      const rooms = (data && data.rooms) || {};
      const ids = Object.keys(rooms).sort(
        (a, b) => rooms[b].seconds - rooms[a].seconds);
      if (!ids.length) {
        body.appendChild(el("div", "empty", esc(this.T("stats_none"))));
        return;
      }
      const total = ids.reduce((sum, r) => sum + rooms[r].seconds, 0);
      meta.innerHTML = "<b>" + (total / 3600).toFixed(1) + "</b> " +
        esc(this.T("hours")) + " · " +
        esc(this.T("stats_since", { d: data.first || "—" }));

      const most = rooms[ids[0]].seconds || 1;
      const table = el("div", "statlist");
      for (const rid of ids) {
        const one = rooms[rid];
        const row = el("div", "sl-row");
        const name = el("div", "sl-n");
        name.appendChild(icon(this._roomIcon(rid)));
        name.appendChild(el("span", null, esc(this._areaName(rid))));
        row.appendChild(name);
        const bar = el("div", "sl-bar");
        const fill = el("span");
        fill.style.width = Math.max(2, one.seconds / most * 100) + "%";
        bar.appendChild(fill);
        row.appendChild(bar);
        row.appendChild(el("div", "sl-v",
          "<b>" + this._span(one.seconds) + "</b>"));
        table.appendChild(row);
      }
      body.appendChild(table);

      /* The same picture for time spent in the room. Rooms with no sensor
       * simply are not here — nothing counted them. */
      stayBody.innerHTML = "";
      const stayed = (data && data.stayed) || {};
      const sids = Object.keys(stayed).sort(
        (a, b) => stayed[b].seconds - stayed[a].seconds);
      if (!sids.length) {
        stayBody.appendChild(el("div", "empty", esc(this.T("stats_stay_none"))));
      } else {
        const top = stayed[sids[0]].seconds || 1;
        const list = el("div", "statlist");
        for (const rid of sids) {
          const row = el("div", "sl-row");
          const name = el("div", "sl-n");
          name.appendChild(icon(this._roomIcon(rid)));
          name.appendChild(el("span", null, esc(this._areaName(rid))));
          row.appendChild(name);
          const bar = el("div", "sl-bar");
          const fill = el("span");
          fill.style.width = Math.max(2, stayed[rid].seconds / top * 100) + "%";
          bar.appendChild(fill);
          row.appendChild(bar);
          row.appendChild(el("div", "sl-v",
            "<b>" + this._span(stayed[rid].seconds) + "</b>"));
          list.appendChild(row);
        }
        stayBody.appendChild(list);
      }
    };
    draw();
    this._loadInsight(true).then(draw);
  },

  /* Hours once there are hours; minutes while there are not. */
  _span(seconds) {
    const secs = Math.max(0, Number(seconds) || 0);
    if (secs < 3600) return Math.round(secs / 60) + " " + this.T("u_min");
    return (secs / 3600).toFixed(1) + " " + this.T("hours");
  },

  _numField(value, onChange) {
    const input = el("input", "nin mini");
    input.type = "number";
    input.step = "0.1";
    input.min = "0";
    input.value = String(value);
    input.onchange = () => {
      const num = parseFloat(input.value);
      if (Number.isFinite(num) && num >= 0) onChange(num);
    };
    return input;
  },

  _pageLog(stage) {
    const st = this._st || {};
    const all = st.events || [];
    /* The filter follows the house: it is built from the configured rooms on
     * every draw, so a new room appears here by itself and a removed one goes
     * by itself — including areas taken out with "Odayı çıkar". */
    const rooms = Object.keys(this._cfg.rooms || {})
      .map((rid) => ({ id: rid, name: this._areaName(rid) }))
      .sort((a, b) => a.name.localeCompare(b.name, "tr"));
    if (this._logRoom && !rooms.some((r) => r.id === this._logRoom)) {
      this._logRoom = "";
    }
    const events = this._logRoom
      ? all.filter((ev) => ev.room === this._logRoom) : all;

    const head = el("div", "stage-h");
    head.appendChild(el("div", "room-title", esc(this.T("log_h"))));
    head.appendChild(el("div", "room-meta", events.length + " / " + all.length));
    const act = el("div", "head-act");
    const pick = el("select", "nsel");
    const any = el("option");
    any.value = ""; any.textContent = this.T("log_all");
    pick.appendChild(any);
    for (const room of rooms) {
      const opt = el("option");
      opt.value = room.id;
      opt.textContent = room.name;
      if (this._logRoom === room.id) opt.selected = true;
      pick.appendChild(opt);
    }
    pick.onchange = () => { this._logRoom = pick.value; this._renderStage(); };
    act.appendChild(pick);
    act.appendChild(this._pill(this.T("clear_log"), false, () => {
      this._confirm(this.T("clear_log_q"), "", this.T("yes"),
        () => this._act({ action: "clear_log" }).then(() => this._loadState()));
    }, "mdi:broom"));
    head.appendChild(act);
    stage.appendChild(head);

    const sec = this._sec(stage, this.T("log_h"), events.length);
    sec.appendChild(el("div", "empty", esc(this.T("log_s"))));
    const line = el("div", "lg");
    let lastDay = "";
    for (const ev of events.slice(0, 200)) {
      const day = String(ev.ts || "").slice(0, 10);
      if (day && day !== lastDay) {
        lastDay = day;
        line.appendChild(el("div", "lg-day", esc(day)));
      }
      line.appendChild(this._logItem(ev, !!this._logRoom));
    }
    sec.appendChild(line);
    if (!events.length) sec.appendChild(el("div", "empty", this.T("no_log")));
  },

  /* One decision on the timeline. An "on" carries its own reconstruction:
   * which sensor saw you and how many seconds before the light moved — the
   * exact thing you go looking for when a room felt slow. */
  _logItem(ev, hideRoom) {
    const KIND = {
      on: ["ok", "mdi:lightbulb-on-outline"],
      off: ["bad", "mdi:lightbulb-off-outline"],
      dim: ["warn", "mdi:lightbulb-on-40"],
      block: ["warn", "mdi:hand-back-right-outline"],
      manual: ["hand", "mdi:gesture-tap"],
      fuse: ["bad", "mdi:fuse-alert"],
      slot: ["mut", "mdi:clock-outline"],
      mode: ["mut", "mdi:theme-light-dark"],
      engine: ["mut", "mdi:engine-outline"],
      room: ["mut", "mdi:home-minus-outline"],
      setup: ["mut", "mdi:wrench-outline"],
      lock: ["mut", "mdi:lock-outline"],
    };
    const [cls, mdi] = KIND[ev.action] || ["mut", "mdi:circle-small"];
    const item = el("div", "lg-item " + cls);
    const dot = el("span", "lg-dot");
    dot.appendChild(icon(mdi));
    item.appendChild(dot);
    const body = el("div", "lg-body");
    const top = el("div", "lg-top");
    top.appendChild(el("span", "lg-time", esc(String(ev.ts || "").slice(11, 19))));
    if (ev.room && !hideRoom) {
      top.appendChild(icon(this._roomIcon(ev.room)));
      top.appendChild(el("span", "lg-room", esc(this._areaName(ev.room))));
    }
    body.appendChild(top);
    body.appendChild(el("div", "lg-text", esc(ev.text || "")));

    const d = ev.d;
    if (d && (d.sensors || []).length) {
      const flow = el("div", "lg-detail");
      for (const one of d.sensors) {
        const chip = el("span", "lg-chip " + (one.s === "on" ? "saw" : "blind"));
        chip.appendChild(icon(one.s === "on" ? "mdi:eye-outline" : "mdi:eye-off-outline"));
        chip.appendChild(el("span", null,
          esc(one.n + " · " + this._agoText(one.s, one.a))));
        flow.appendChild(chip);
      }
      body.appendChild(flow);
      if ((d.lights || []).length) {
        const lit = el("div", "lg-lights");
        lit.appendChild(icon("mdi:lightbulb-multiple-outline"));
        lit.appendChild(el("span", null, esc(
          d.lights.join(", ") + (d.more ? " +" + d.more : "") +
          (d.bri ? " · %" + d.bri : ""))));
        body.appendChild(lit);
      }
    }
    item.appendChild(body);
    return item;
  },

  _agoText(state, ago) {
    if (ago == null) return this.T("ago_unknown");
    const span = ago >= 120 ? Math.round(ago / 60) + " " + this.T("mins")
                            : ago + " " + this.T("secs");
    if (state === "on") {
      return ago <= 1 ? this.T("ago_now") : this.T("ago_saw", { t: span });
    }
    return this.T("ago_lost", { t: span });
  },

  /* ================================================================= MODALS */
  _overlay(cls) {
    const ov = el("div", "ov" + (cls ? " " + cls : ""));
    ov.onclick = (ev) => { if (ev.target === ov) ov.remove(); };
    this.shadowRoot.appendChild(ov);
    return ov;
  },

  _dialog(cls, title, subtitle, slim) {
    const ov = this._overlay(cls);
    const box = el("div", "ed" + (slim ? " slim" : ""));
    box.onclick = (ev) => ev.stopPropagation();
    if (title) box.appendChild(el("div", "ed-t", esc(title)));
    if (subtitle) box.appendChild(el("div", "ed-s", esc(subtitle)));
    ov.appendChild(box);
    return { ov, box };
  },

  _confirm(title, body, okLabel, onOk) {
    const { ov, box } = this._dialog("confirm", title, body, true);
    const foot = el("div", "ed-foot");
    const cancel = el("button", "btn ghost");
    cancel.textContent = this.T("cancel");
    cancel.onclick = () => ov.remove();
    const ok = el("button", "btn");
    ok.textContent = okLabel || this.T("yes");
    ok.onclick = () => { ov.remove(); onOk(); };
    foot.appendChild(cancel);
    foot.appendChild(ok);
    box.appendChild(foot);
  },

  _promptText(label, value, onOk) {
    const { ov, box } = this._dialog("editor", label, "", true);
    const input = el("input", "nin");
    input.style.width = "100%";
    input.value = value || "";
    box.appendChild(input);
    const foot = el("div", "ed-foot");
    const cancel = el("button", "btn ghost");
    cancel.textContent = this.T("cancel");
    cancel.onclick = () => ov.remove();
    const ok = el("button", "btn");
    ok.textContent = this.T("yes");
    ok.onclick = () => { ov.remove(); onOk(input.value.trim()); };
    foot.appendChild(cancel);
    foot.appendChild(ok);
    box.appendChild(foot);
    setTimeout(() => input.focus(), 40);
    input.onkeydown = (ev) => { if (ev.key === "Enter") ok.onclick(); };
  },

  /* Pick several things from a list. The search box is always there — a box
   * that comes and goes depending on how many items you happen to have is a
   * box you cannot rely on, and looking for it is worse than ignoring it. The
   * ones already chosen stay on screen while you filter, so you can always see
   * what you are about to save. */
  _pickMany(title, items, selected, onDone, subtitle) {
    const { ov, box } = this._dialog("picker", title, subtitle || "", true);
    const set = new Set(selected);
    let query = "";

    const search = el("input", "nin pick-search");
    search.type = "search";
    search.placeholder = this.T("search_ph");
    search.autocomplete = "off";
    /* Written by hand rather than with <datalist>: that element is looked up by
     * id in the *document*, and this panel lives in a shadow root, so the
     * browser never finds it and quietly offers nothing. */
    const wrap = el("div", "pick-box");
    wrap.appendChild(search);
    const hints = el("div", "pick-hints");
    wrap.appendChild(hints);
    box.appendChild(wrap);

    const flow = el("div", "gpills");
    box.appendChild(flow);
    const count = el("div", "hint pick-count");
    box.appendChild(count);

    const ok = el("button", "btn");
    const draw = () => {
      flow.innerHTML = "";
      const needle = query.trim().toLocaleLowerCase("tr");
      const hits = items.filter((item) => !needle ||
        String(item.name).toLocaleLowerCase("tr").includes(needle) ||
        String(item.key).toLocaleLowerCase("tr").includes(needle) ||
        set.has(item.key));      // never hide something already chosen
      for (const item of hits) {
        const pill = this._pill(item.name, set.has(item.key), () => {
          if (set.has(item.key)) set.delete(item.key); else set.add(item.key);
          pill.classList.toggle("on");
          label();
        });
        if (item.key !== item.name) pill.title = item.key;
        flow.appendChild(pill);
      }
      if (!items.length) flow.appendChild(el("div", "empty", this.T("none")));
      else if (!hits.length) flow.appendChild(el("div", "empty", this.T("search_none")));
      label();
    };
    const label = () => {
      count.textContent = set.size
        ? this.T("picked_sel", { n: set.size, t: items.length })
        : this.T("pick_nothing");
      ok.textContent = set.size ? this.T("save_n", { n: set.size }) : this.T("save");
    };
    const suggest = () => {
      hints.innerHTML = "";
      const needle = query.trim().toLocaleLowerCase("tr");
      if (!needle) { hints.classList.remove("on"); return; }
      const words = [];
      for (const item of items) {
        for (const word of [item.name, item.key]) {
          const text = String(word || "");
          if (!text || words.includes(text)) continue;
          if (text.toLocaleLowerCase("tr").includes(needle)) words.push(text);
        }
      }
      if (!words.length || (words.length === 1 && words[0] === search.value)) {
        hints.classList.remove("on");
        return;
      }
      for (const word of words.slice(0, 8)) {
        const row = el("div", "pick-hint");
        const at = word.toLocaleLowerCase("tr").indexOf(needle);
        row.innerHTML = esc(word.slice(0, at)) + "<b>" +
          esc(word.slice(at, at + needle.length)) + "</b>" +
          esc(word.slice(at + needle.length));
        row.onclick = () => {
          search.value = word;
          query = word;
          hints.classList.remove("on");
          draw();
          search.focus();
        };
        hints.appendChild(row);
      }
      hints.classList.add("on");
    };
    search.oninput = () => { query = search.value; draw(); suggest(); };
    search.onkeydown = (ev) => {
      if (ev.key === "Escape") { hints.classList.remove("on"); }
      if (ev.key === "Enter") {
        const first = hints.querySelector(".pick-hint");
        if (hints.classList.contains("on") && first) { ev.preventDefault(); first.onclick(); }
      }
    };
    draw();

    const foot = el("div", "ed-foot");
    const cancel = el("button", "btn ghost");
    cancel.textContent = this.T("cancel");
    cancel.onclick = () => ov.remove();
    ok.onclick = () => { ov.remove(); onDone(Array.from(set)); };
    foot.appendChild(cancel);
    foot.appendChild(ok);
    box.appendChild(foot);
    // only grab the keyboard when there is really something to hunt through
    if (items.length > 6) setTimeout(() => search.focus(), 30);
  },

  /* Touch fallback for the drag & drop: tap a device, pick its role. */
  _pickRole(rid, eid) {
    const room = this._room(rid);
    const dom = eid.split(".")[0];
    const dc = this._dc(eid);
    const { ov, box } = this._dialog("picker", this._name(eid),
      this.T("sec_pool_s"), true);
    const flow = el("div", "gpills");
    const add = (label, fn) => {
      flow.appendChild(this._pill(label, false, () => {
        fn(); this._save(); ov.remove(); this._render();
      }));
    };
    if (ROLE_OK.trigger(dom, dc)) {
      add(this.T("sec_trigger"), () => {
        room.trigger = (room.trigger || []).concat([eid]);
      });
    }
    if (ROLE_OK.hold(dom, dc)) {
      add(this.T("sec_hold"), () => {
        room.hold = (room.hold || []).concat([eid]);
      });
    }
    if (ROLE_OK.trigger(dom, dc) && ROLE_OK.hold(dom, dc)) {
      add(this.T("sec_trigger") + " + " + this.T("sec_hold"), () => {
        room.trigger = (room.trigger || []).concat([eid]);
        room.hold = (room.hold || []).concat([eid]);
      });
    }
    if (ROLE_OK.lux(dom, dc)) add(this.T("sec_lux"), () => { room.lux = eid; });
    if (ROLE_OK.lights(dom)) {
      add(this.T("sec_lights"), () => {
        room.lights = (room.lights || []).concat([eid]);
      });
    }
    box.appendChild(flow);
    const foot = el("div", "ed-foot");
    const cancel = el("button", "btn ghost");
    cancel.textContent = this.T("cancel");
    cancel.onclick = () => ov.remove();
    foot.appendChild(cancel);
    box.appendChild(foot);
  },

  _pickGroups(rid, eid) {
    const room = this._room(rid);
    room.groups = room.groups || [];
    if (!room.groups.length) {
      this._promptText(this.T("group_name"), "", (name) => {
        if (!name) return;
        room.groups.push({ key: uid(), name, lights: [eid] });
        this._save(); this._render();
      });
      return;
    }
    this._pickMany(this._name(eid),
      room.groups.map((g) => ({ key: g.key, name: g.name })),
      room.groups.filter((g) => (g.lights || []).includes(eid)).map((g) => g.key),
      (list) => {
        for (const grp of room.groups) {
          const has = list.includes(grp.key);
          const inside = (grp.lights || []).includes(eid);
          if (has && !inside) grp.lights = (grp.lights || []).concat([eid]);
          if (!has && inside) grp.lights = grp.lights.filter((x) => x !== eid);
        }
        this._save(); this._render();
      });
  },

  _refreshSettings() {
    const open = this.shadowRoot.querySelector(".ov");
    if (!open) return;
    open.remove();
    this._openSettings();
  },

  async _openSettings() {
    const { ov, box } = this._dialog("editor", this.T("settings"), "");

    box.appendChild(el("div", "ed-l first", esc(this.T("language"))));
    const langs = el("div", "gpills");
    for (const [code, label] of [["tr", "Türkçe"], ["en", "English"]]) {
      langs.appendChild(this._pill(label, this._lang() === code, () => {
        this._cfg.lang = code;
        this._save();
        ov.remove();
        this._render();
      }));
    }
    box.appendChild(langs);

    box.appendChild(el("div", "ed-l", esc(this.T("photo_head"))));
    const ph = this._cfg.photo = Object.assign(
      { off_style: "dark", off: 62, on: 14 }, this._cfg.photo || {});
    const styleRow = this._row(box, this.T("photo_off_style"),
      this.T("photo_off_style_s"));
    const styles = el("div", "gpills");
    for (const [key, word] of [["dark", "photo_dark"], ["gray", "photo_gray"],
                               ["both", "photo_both"]]) {
      styles.appendChild(this._pill(this.T(word), ph.off_style === key, () => {
        ph.off_style = key;
        this._save();
        this._renderStage();
        this._refreshSettings();
      }));
    }
    styleRow.appendChild(styles);

    this._row(box, this.T("photo_off_amt"), this.T("photo_off_amt_s")).appendChild(
      this._slider(Number(ph.off), 0, 92, 2, (v) => "%" + v, (v) => {
        ph.off = v; this._save(); this._renderStage();
      }));

    this._row(box, this.T("photo_on_amt"), this.T("photo_on_amt_s")).appendChild(
      this._slider(Number(ph.on), 0, 80, 2, (v) => "%" + v, (v) => {
        ph.on = v; this._save(); this._renderStage();
      }));

    const seatRow = this._row(box, this.T("sitter"), this.T("sitter_s"));
    seatRow.appendChild(this._toggle(this._cfg.sitter !== false, (val) => {
      this._cfg.sitter = val;
      this._save();
      this._renderStage();
    }));

    box.appendChild(el("div", "ed-l", esc(this.T("autofill"))));
    const fill = el("button", "btn");
    fill.textContent = this.T("autofill");
    fill.onclick = async () => {
      fill.disabled = true;
      const res = await this._act({ action: "autofill", layout: true });
      if (res && res.ok) {
        this._flash(this.T("filled", { n: res.found }));
        ov.remove();
        await this._load();
      }
      fill.disabled = false;
    };
    box.appendChild(fill);

    /* Everything about this setup that cannot work, and somewhere to be told
     * about it without opening the panel. */
    box.appendChild(el("div", "ed-l", esc(this.T("health"))));
    const healthBox = el("div");
    box.appendChild(healthBox);
    const drawHealth = () => {
      healthBox.innerHTML = "";
      const list = (this._insight && this._insight.health) || [];
      if (!list.length) {
        const good = el("div", "hz-ok");
        good.appendChild(icon("mdi:check-circle-outline"));
        good.appendChild(el("span", null, esc(this.T("health_ok"))));
        healthBox.appendChild(good);
      } else {
        /* Read down the spine: the things that are broken first, then the
         * things that are merely unfinished. Each one says which room it is
         * about, because "no sensors" means nothing on its own. */
        const KIND = {
          missing: ["mdi:link-variant-off", this.T("hk_missing")],
          offline: ["mdi:wifi-off", this.T("hk_offline")],
          stale: ["mdi:battery-alert-variant-outline", this.T("hk_stale")],
          no_lights: ["mdi:lightbulb-off-outline", this.T("hk_no_lights")],
          no_sensor: ["mdi:motion-sensor-off", this.T("hk_no_sensor")],
          dead_slot: ["mdi:clock-alert-outline", this.T("hk_dead_slot")],
      zero_bri: ["mdi:lightbulb-question-outline", this.T("hk_zero_bri")],
          gone_pick: ["mdi:playlist-remove", this.T("hk_gone_pick")],
        };
        const bad = list.filter((x) => x.level === "bad").length;
        const sum = el("div", "hz-sum");
        if (bad) {
          sum.appendChild(el("span", "hz-tag bad",
            esc(this.T("health_bad_n", { n: bad }))));
        }
        if (list.length - bad) {
          sum.appendChild(el("span", "hz-tag warn",
            esc(this.T("health_warn_n", { n: list.length - bad }))));
        }
        healthBox.appendChild(sum);

        /* A room with neither lights nor sensors is usually not a room at all —
         * a street, a garage, an area somebody made to group things. Offer the
         * way out right where the complaint is. */
        const hollow = new Set();
        for (const rid of new Set(list.map((x) => x.room))) {
          const kinds = list.filter((x) => x.room === rid).map((x) => x.kind);
          if (kinds.includes("no_lights") && kinds.includes("no_sensor")) {
            hollow.add(rid);
          }
        }

        const line = el("div", "hz");
        const order = list.slice().sort((a, b) =>
          (a.level === "bad" ? 0 : 1) - (b.level === "bad" ? 0 : 1));
        const seen = new Set();
        for (const one of order.slice(0, 40)) {
          const item = el("div", "hz-item " + (one.level === "bad" ? "bad" : "warn"));
          const [mdi, label] = KIND[one.kind] || ["mdi:alert-outline", one.kind];
          const dot = el("span", "hz-dot");
          dot.appendChild(icon(mdi));
          item.appendChild(dot);
          const body = el("div", "hz-body");
          const top = el("div", "hz-top");
          if (one.room) {
            top.appendChild(icon(this._roomIcon(one.room)));
            top.appendChild(el("span", "hz-room", esc(this._areaName(one.room))));
          }
          top.appendChild(el("span", "hz-kind", esc(label)));
          body.appendChild(top);
          body.appendChild(el("div", "hz-text", esc(one.text)));
          if (hollow.has(one.room) && !seen.has(one.room)) {
            seen.add(one.room);
            const drop = el("button", "btn ghost tiny");
            drop.textContent = this.T("room_drop");
            drop.onclick = () => this._dropRoom(one.room, () => {
              this._loadInsight(true).then(drawHealth);
            });
            body.appendChild(drop);
          }
          item.appendChild(body);
          line.appendChild(item);
        }
        healthBox.appendChild(line);
        if (list.length > 40) {
          healthBox.appendChild(el("div", "hint",
            esc(this.T("health_more", { n: list.length - 40 }))));
        }
      }

      const nt = this._cfg.notify = Object.assign(
        { service: "", enabled: false, every_h: 24, after_min: 5,
          stuck: true, stuck_min: 10 },
        this._cfg.notify || {});
      const services = (this._insight && this._insight.notify_services) || [];
      const pick = this._row(healthBox, this.T("health_notify"),
        services.length ? this.T("health_notify_s") : this.T("health_no_service"));
      const sel = el("select", "nsel");
      const none = el("option");
      none.value = ""; none.textContent = this.T("none");
      sel.appendChild(none);
      for (const one of services) {
        const opt = el("option");
        opt.value = one;
        opt.textContent = one.replace("notify.", "");
        if (nt.service === one) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = () => {
        nt.service = sel.value;
        if (!sel.value) nt.enabled = false;
        this._save(); drawHealth();
      };
      pick.appendChild(sel);
      pick.appendChild(this._toggle(nt.enabled === true && !!nt.service, (val) => {
        if (val && !nt.service) { this._flash(this.T("health_pick_first"), true); return; }
        nt.enabled = val; this._save(); drawHealth();
      }));

      if (nt.service) {
        /* A device that blinks has not stopped working. This is how long it
         * has to stay away before anybody is told. */
        this._row(healthBox, this.T("health_after"), this.T("health_after_s"))
          .appendChild(this._stepSlider([1, 2, 3, 4, 5, 10, 15, 30],
            Number(nt.after_min || 5),
            (v) => v + " " + this.T("u_min"),
            (v) => { nt.after_min = v; this._save(); }));
        const stuck = this._row(healthBox, this.T("stuck_notify"),
          this.T("stuck_notify_s"));
        stuck.appendChild(this._toggle(nt.stuck !== false, (val) => {
          nt.stuck = val; this._save(); drawHealth();
        }));
        if (nt.stuck !== false) {
          this._row(healthBox, this.T("stuck_after"), this.T("stuck_after_s"))
            .appendChild(this._stepSlider([3, 5, 10, 15, 30, 60],
              Number(nt.stuck_min || 10),
              (v) => v + this.T("u_min"),
              (v) => { nt.stuck_min = v; this._save(); }));
        }

        this._row(healthBox, this.T("health_every"), this.T("health_every_s"))
          .appendChild(this._stepSlider([1, 3, 6, 12, 24, 48, 168],
            Number(nt.every_h || 24),
            (v) => v < 24 ? v + " " + this.T("hours")
              : (v === 168 ? this.T("weekly") : Math.round(v / 24) + " " + this.T("days")),
            (v) => { nt.every_h = v; this._save(); }));
        const test = el("button", "btn ghost");
        test.textContent = this.T("health_test");
        test.onclick = async () => {
          test.disabled = true;
          try {
            const res = await this._hass.callApi("POST", "lumen_ha/insight",
              { action: "test_notify" });
            this._flash(res && res.ok ? this.T("health_sent", { n: res.issues })
                                      : (res && res.error) || "?", !(res && res.ok));
          } catch (err) { this._flash(this.T("save_err"), true); }
          test.disabled = false;
        };
        healthBox.appendChild(test);
      }
    };
    drawHealth();
    this._loadInsight(true).then(drawHealth);

    const dropped = (this._cfg.skip_areas || []).filter(Boolean);
    if (dropped.length) {
      box.appendChild(el("div", "ed-l", esc(this.T("dropped_h"))));
      box.appendChild(el("div", "hint", esc(this.T("dropped_s"))));
      const flow = el("div", "gpills");
      for (const rid of dropped) {
        flow.appendChild(this._chosenChip(this._areaName(rid),
          "mdi:home-minus-outline", async () => {
            const res = await this._act({ action: "restore_room", room: rid });
            if (res && res.ok) {
              this._flash(this.T("dropped_back", { s: this._areaName(rid) }));
              ov.remove();
              await this._load();
            }
          }));
      }
      box.appendChild(flow);
    }

    const skipped = this._ignored();
    if (skipped.length) {
      box.appendChild(el("div", "ed-l", esc(this.T("ignored_h"))));
      box.appendChild(el("div", "hint", esc(this.T("ignored_s"))));
      const flow = el("div", "gpills");
      for (const eid of skipped.slice(0, 30)) {
        flow.appendChild(this._chosenChip(this._name(eid), "mdi:eye-off-outline",
          () => {
            this._unignore(eid);
            this._save();
            this._flash(this.T("ignored_back", { s: this._name(eid) }));
            ov.remove();
            this._render();
          }));
      }
      box.appendChild(flow);
    }

    box.appendChild(el("div", "ed-l", esc(this.T("art_h"))));
    box.appendChild(el("div", "hint", esc(this.T("art_s"))));
    const art = this._cfg.scene_art = Object.assign(
      { floor_day: "", floor_night: "", back_day: "", back_night: "" },
      this._cfg.scene_art || {});
    const grid = el("div", "artgrid");
    for (const [key, label] of [
      ["floor_day", this.T("art_floor_day")],
      ["floor_night", this.T("art_floor_night")],
      ["back_day", this.T("art_back_day")],
      ["back_night", this.T("art_back_night")],
    ]) {
      grid.appendChild(this._artSlot(art, key, label));
    }
    box.appendChild(grid);

    box.appendChild(el("div", "ed-l", esc(this.T("export_h"))));
    box.appendChild(el("div", "hint", esc(this.T("export_s"))));
    const save = el("button", "btn");
    save.textContent = this.T("export_do");
    save.onclick = () => this._exportConfig();
    box.appendChild(save);

    /* Kaydedilen dosyanın geri okunabilmesi: dışa aktarmanın tek başına bir
     * anlamı yok — geri dönüş yolu olmayan yedek, yedek değildir. */
    box.appendChild(el("div", "hint", esc(this.T("import_s"))));
    const load = el("button", "btn ghost");
    load.textContent = this.T("import_do");
    const picker = el("input");
    picker.type = "file";
    picker.accept = "application/json,.json";
    picker.style.display = "none";
    picker.onchange = () => {
      const file = picker.files && picker.files[0];
      picker.value = "";
      if (file) this._importConfig(file);
    };
    load.onclick = () => picker.click();
    box.appendChild(load);
    box.appendChild(picker);

    box.appendChild(el("div", "ed-l", esc(this.T("report_h"))));
    box.appendChild(el("div", "hint", esc(this.T("report_s"))));
    box.appendChild(el("div", "hint", esc(this.T("report_priv"))));
    const bug = el("button", "btn ghost");
    bug.textContent = this.T("report_do");
    bug.onclick = () => window.open(
      "https://github.com/berkansezer77/lumen-ha/issues/new/choose", "_blank");
    box.appendChild(bug);
    const where = el("button", "btn ghost");
    where.textContent = this.T("report_diag");
    where.onclick = () => window.open("/config/integrations/integration/lumen_ha",
                                      "_blank");
    box.appendChild(where);

    box.appendChild(el("div", "ed-l", esc(this.T("backups"))));
    box.appendChild(el("div", "ed-s", esc(this.T("backups_s"))));
    const list = el("div");
    box.appendChild(list);
    try {
      const res = await this._hass.callApi("GET", "lumen_ha/backups");
      const items = (res && res.backups) || [];
      if (!items.length) list.appendChild(el("div", "empty", this.T("no_backups")));
      for (const item of items.slice(0, 10)) {
        const row = el("div", "bkrow");
        row.appendChild(el("span", "bt", esc(String(item.ts || "").replace("T", " "))));
        row.appendChild(el("span", "bm",
          esc(item.rooms + " " + this.T("rail_rooms").toLowerCase() + " · " +
              item.lights + " " + this.T("sec_lights").toLowerCase())));
        const btn = el("button", "btn ghost");
        btn.textContent = this.T("restore");
        btn.onclick = () => this._confirm(this.T("restore_q"), this.T("restore_b"),
          this.T("restore"), async () => {
            await this._hass.callApi("POST", "lumen_ha/backups", { index: item.index });
            ov.remove();
            await this._load();
          });
        row.appendChild(btn);
        list.appendChild(row);
      }
    } catch (err) {
      list.appendChild(el("div", "empty", esc(err && err.message || err)));
    }

    const foot = el("div", "ed-foot");
    const close = el("button", "btn ghost");
    close.textContent = this.T("close");
    close.onclick = () => ov.remove();
    foot.appendChild(close);
    box.appendChild(foot);
  },
});

if (!customElements.get("lumen-panel")) {
  customElements.define("lumen-panel", LumenPanel);
}
console.info("%c LUMEN %c panel loaded ", "background:#ec4b88;color:#fff;border-radius:3px 0 0 3px",
  "background:#8b3dff;color:#fff;border-radius:0 3px 3px 0");


/* ═══════════════════════════════════════════ custom:lumen-house-card ═══
 * Panelin evi, bir Lovelace kartının içinde. Ayrı bir uygulama değil —
 * panelin sınıfını miras alır, yalnız kabuğunu değiştirir: menü, başlık ve
 * sayfa gezintisi yok, geriye ev kalıyor. Sahneyi çizen kod tek olduğu için
 * panele eklenen her şey kartta da kendiliğinden görünür.
 *
 * Seçenekler (hepsi isteğe bağlı):
 *   height       kartın yüksekliği, piksel (varsayılan 620)
 *   interactive  dokunuş ışığı çevirsin mi (varsayılan true)
 *   toolbar      üstteki düğme şeridi görünsün mü (varsayılan false)
 *   header       "GECE EVİ · canlı" başlığı görünsün mü (varsayılan false)
 *   modes        alttaki ev modu şeridi (varsayılan true)
 *   refresh      kaç saniyede bir sorulsun (varsayılan 5)
 */
/* Yazılmamış bir seçenek ile sıfır aynı şey değil. Number(null) sıfır döner;
 * bu ikisi karışırsa hiç açı vermeyen kart da "benim kendi açım var" der ve
 * panelde çevirdiğin açıyı görmezden gelir. */
function sayi(v, yedek) { return sayi.var(v) ? Number(v) : yedek; }
sayi.var = (v) => v !== null && v !== undefined && v !== "" &&
  Number.isFinite(Number(v));

const CARD_CSS = `
:host{display:block;}
.cardhost{padding:0;margin:0;max-width:none;}
.cardhost .layout{display:block;}
.cardhost .stage{margin:0;}
.cardhost .sec{margin:0;border:none;background:transparent;padding:0;}
.cardhost .iso-wrap{border-radius:16px;}
:host(.ro) .rtools,:host(.ro) .rtoggle,:host(.ro) .orbit-hint{display:none;}
:host(.ro) .room{cursor:default;}
.cardhost .head-act{display:none;}
.cardhost .cardbar{position:absolute;right:10px;top:10px;z-index:7;
  display:none;flex-direction:column;gap:6px;}
.cardhost.withbar .cardbar{display:flex;}
.cardbar button{width:38px;height:38px;border-radius:11px;cursor:pointer;
  background:rgba(12,10,16,.72);border:1px solid rgba(255,255,255,.12);
  color:#e7dce6;display:flex;align-items:center;justify-content:center;
  backdrop-filter:blur(6px);padding:0;
  /* Tabletin çift-dokunuş beklemesi ve mavi vurgusu olmasın. */
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;}
.cardbar button:active{transform:scale(.94);border-color:#ec4b88;}
.cardbar ha-icon{--mdc-icon-size:19px;}
@media(max-width:520px){.cardbar button{width:34px;height:34px;}}
.cardhost .modestrip{display:flex;}
.cardhost.nomodes .modestrip{display:none;}
`;

class LumenHouseCard extends LumenPanel {
  static getStubConfig() { return { height: 620 }; }

  setConfig(config) {
    this._card = Object.assign(
      { height: 620, interactive: true, toolbar: false, header: false,
        modes: true, refresh: 5, isometric: true, align: false, walk: false,
        tilt: null, turn: null, zoom: null }, config || {});
    /* Hizalı kart kendi kamerasını kullanır: panelde çevirdiğin açı tarayıcıda
     * saklanıyor ve kart onu paylaşıyordu — bir panoda istenen şey değil. */
    if (this._card.align) this._cam = null;
    this._page = "home";
    this._readonly = this._card.interactive === false;
    /* Kartın gidilecek bir oda sayfası yok; dar ekranda karta dokunmak da
     * tabletteki izometrik evdeki gibi ışığı çevirsin. */
    this._tapToggles = !this._readonly;
    if (this._built) { this._built = false; this.shadowRoot.innerHTML = ""; }
    if (this._hass) this._render();
  }

  /* Kartın kendi açısı var mı? Varsa tarayıcıda saklanan açı (panelde
   * çevirdiğin) karta karışmaz — YAML'a yazdığın açının yok sayılması
   * beklenecek en son şey. */
  _ownAngle() {
    const c = this._card || {};
    return c.align === true || [c.tilt, c.turn, c.zoom].some(sayi.var);
  }

  /* Evin hangi açıyla açılacağı. tilt: geriye yatma (0 = tepeden, büyüdükçe
   * yandan), turn: çevirme (0 = düz karşıdan, -42 varsayılan elmas duruş). */
  _camDefault() {
    const base = super._camDefault();
    const c = this._card || {};
    return {
      rx: clamp(sayi(c.tilt, base.rx), 0, TILT_MAX),
      rz: sayi(c.turn, base.rz),
      zoom: clamp(sayi(c.zoom, 1), 0.35, 3),
      tx: 0, ty: 0,
    };
  }

  /* İzometri kapatılabilsin: kutunun düz kuşbakışı hâli. */
  _flatView() {
    if (this._cardFlat != null) return this._cardFlat;
    if (this._card && this._card.isometric === false) return true;
    return super._flatView();
  }

  _resetCamera() {
    this._cam = this._camDefault();
    this._cardFlat = null;          // YAML'daki tercihe geri dön
    this._builtSig = null;
    this._render();
  }

  /* Yakınlaş · uzaklaş · düz/izometrik · başa dön. */
  _renderBar() {
    const bar = this.shadowRoot.getElementById("cardbar");
    if (!bar) return;
    if (!this._card.toolbar) { bar.innerHTML = ""; return; }
    const duz = this._flatView();
    const dugmeler = [
      ["mdi:magnify-plus-outline", this.T("zoom_in"), () => this._zoomBy(1.25)],
      ["mdi:magnify-minus-outline", this.T("zoom_out"), () => this._zoomBy(0.8)],
      [duz ? "mdi:cube-outline" : "mdi:square-outline",
       this.T(duz ? "view_iso" : "view_flat"), () => {
         this._cardFlat = !duz;
         this._builtSig = null;      // görünüm değişti: sahne yeniden kurulur
         this._render();
       }],
      ["mdi:restore", this.T("view_reset"), () => this._resetCamera()],
    ];
    const imza = dugmeler.map((d) => d[0]).join("|");
    if (bar.dataset.imza === imza) return;   // her nabızda yeniden kurma
    bar.dataset.imza = imza;
    bar.innerHTML = "";
    for (const [ad, baslik, isle] of dugmeler) {
      const b = el("button");
      b.title = baslik;
      b.setAttribute("aria-label", baslik);
      b.appendChild(icon(ad));
      b.onclick = (ev) => { ev.stopPropagation(); isle(); };
      bar.appendChild(b);
    }
  }

  /* Otomatik hizala: ev her kurulusunda ortalanmış ve sığdırılmış başlar,
   * panelin saklanan açısı karta bulaşmaz — ve kartta çevirdiğin açı da
   * panele bulaşmaz. */
  _camera() {
    if (!this._cam && this._ownAngle()) this._cam = this._camDefault();
    return super._camera();
  }

  _saveCamera() {
    if (this._ownAngle()) return;   // panelin açısını kirletme
    return super._saveCamera();
  }

  getCardSize() {
    return Math.max(3, Math.round((Number(this._card.height) || 620) / 50));
  }

  /* Bir pano birkaç dakikada bir bakılan bir şey; panelin iki saniyelik nabzı
   * burada boşuna pil yakar. */
  connectedCallback() {
    const every = Math.max(2, Number((this._card || {}).refresh) || 5) * 1000;
    if (!this._pollTimer) {
      this._pollTimer = setInterval(() => this._loadState(), every);
    }
  }

  _frameHeight() {
    return Math.round(clamp(Number((this._card || {}).height) || 620, 220, 1600));
  }

  /* Kartın kabuğunda ne başlık ne de sol raf var; panelin canlı döngüsü yine
   * de ikisini de tazelemeye çalışıyor. Burada ikisi de sessizce hiçbir şey
   * yapmaz — yoksa her yenilemede "yok olan öğeye yazamam" hatası düşer. */
  _renderHero() {}

  _renderRail() {}

  _build() {
    const style = el("style");
    style.textContent = CSS + CSS2 + CSS7 + CSS8 + CARD_CSS;
    this.shadowRoot.appendChild(style);
    const root = el("div", "wrap bare cardhost");
    root.innerHTML =
      '<div class="layout"><div class="stage">' +
        '<div class="glow"></div><div class="cardbar" id="cardbar"></div>' +
        '<div id="stage"></div>' +
      "</div></div>";
    this.shadowRoot.appendChild(root);
    this._built = true;
  }

  /* Sahnenin göründüğünü belirleyen her şey tek bir dizede. Aynıysa yeniden
   * çizmeye gerek yok — ve çizmemek, tablette akıcılığın kendisi: sekiz oda
   * kartını fotoğrafıyla, eğrisiyle baştan kurmak ucuz bir işlemcide
   * gözle görülür bir takılma. */
  _sceneSig() {
    const st = this._st || {};
    const bits = [st.slot, st.mode, this._narrow() ? "n" : "w",
                  this._flatView() ? "d" : "i"];
    /* Yalnız yapıyı belirleyenler. Lux her okumada bir iki birim oynuyor;
     * onu imzaya koymak, sahneyi beş saniyede bir baştan kurmak demekti —
     * tabletteki titremenin sebebi buydu. Oynayan sayılar yerinde
     * güncelleniyor (_refreshLive), imzaya girmiyor. */
    for (const [rid, r] of Object.entries(st.rooms || {})) {
      bits.push(rid, r.lights_total, r.groups_total, r.warn || "",
                r.lux == null ? "-" : "+");
    }
    /* Ayarın kendisi de sahneyi değiştirir: yeni bir fotoğraf, taşınan bir
     * oda, eklenen bir ışık. Onlar da imzaya girsin, yoksa değişiklik
     * ekrana hiç ulaşmaz. */
    for (const [rid, room] of Object.entries((this._cfg || {}).rooms || {})) {
      bits.push(rid, room.image || "", (room.lights || []).length,
                room.icon || "", room.type || "");
    }
    bits.push(JSON.stringify(((this._cfg || {}).layout || {}).floors || []));
    return bits.join("|");
  }

  /* Lovelace bu kutuya evdeki HER durum değişiminde haber verir — kalabalık
   * bir evde saniyede birkaç kez. Kartın kendi nabzı var; her habere bir
   * çizim koymak, tablette hiç durmayan bir titreme demek. */
  set hass(hass) {
    this._hass = hass;
    if (!this._loaded) { this._loaded = true; this._load(); }
  }

  /* Sahneyi yeniden kurmanın tek kapısı. Canlı yenileme buradan geçiyor,
   * _render'dan değil — kontrolün duracağı yer burası. */
  _renderStage() {
    if (!this._built) return;
    const sig = this._sceneSig();
    if (this._builtSig === sig && this._refreshLive()) return;
    this._builtSig = sig;
    if (this._card.align) this._cam = this._camDefault();
    super._renderStage();
  }

  _render() {
    if (!this._hass || !this._cfg || !this._card) return;
    if (!this._built) this._build();
    const host = this.shadowRoot.querySelector(".cardhost");
    host.classList.toggle("withbar", !!this._card.toolbar);
    /* Cihazın animasyonları kapalı olsa da yürüsün. */
    this.classList.toggle("walkalways",
      this._card.walk === true || this._card.walk === "always");
    this._renderBar();
    host.classList.toggle("nomodes", this._card.modes === false);
    this.classList.toggle("ro", !!this._readonly);
    this._renderStage();
  }

  /* Kartın kendi sahnesi: panelin ev sayfası, başlığı isteğe bağlı. */
  _pageHome(stage) {
    const st = this._st || {};
    if (!Object.keys(this._cfg.rooms || {}).length) {
      this._emptyHouse(stage);
      return;
    }
    this._autoPlace();
    if (!this._narrow()) this._secWidth = this._stageWidth();
    const holder = this._card.header
      ? this._sec(stage, this.T("night_house"),
                  this.T("live") + " · " + (st.clock || ""))
      : stage;
    holder.appendChild(this._scene(st, this._roomList()));
  }
}

if (!customElements.get("lumen-house-card")) {
  customElements.define("lumen-house-card", LumenHouseCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "lumen-house-card")) {
  window.customCards.push({
    type: "lumen-house-card",
    name: "LUMEN — Gece Evi",
    description: "Evin izometrik çizimi: yanan odalar, fotoğraflar, sensörler.",
    preview: false,
    documentationURL: "https://github.com/berkansezer77/lumen-ha",
  });
}
