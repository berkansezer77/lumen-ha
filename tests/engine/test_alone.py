import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# One Room mode: enter a room, the rest go dark — and nothing else does.
import io, sys, types, time, asyncio, datetime as dt
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_sweep.py'), encoding='utf-8').read()
             .split('import importlib.util')[0], 'stub', 'exec'), globals())
import importlib.util
_pkg = types.ModuleType("lumen_ha"); _pkg.__path__ = [Z + "/lumen_ha"]; sys.modules["lumen_ha"] = _pkg
_spec = importlib.util.spec_from_file_location("lumen_ha.engine", Z + "/lumen_ha/engine.py")
_m = importlib.util.module_from_spec(_spec); sys.modules["lumen_ha.engine"] = _m
_spec.loader.exec_module(_m)
LumenEngine, BOOT_GRACE = _m.LumenEngine, _m.BOOT_GRACE
UTC = dt.timezone.utc
DIM = {"supported_color_modes": ["color_temp"]}
ROOMS = ("ofis", "salon", "mutfak")


class St:
    def __init__(self, eid, state, attrs=None):
        self.entity_id = eid
        self.state = state
        self.attributes = dict(DIM, **(attrs or {}))
        self.last_changed = dt.datetime.now(UTC)


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, st, attrs=None): self.d[e] = St(e, st, attrs)


class Services:
    def __init__(self): self.calls = []
    def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append((svc, tuple(data.get("entity_id") or []), dict(data)))
        for e in (data.get("entity_id") or []):
            HASS.states.d[e] = St(e, "on" if svc == "turn_on" else "off",
                                  {"brightness": 200} if svc == "turn_on" else {})


class Hass:
    def __init__(self):
        self.states = States(); self.services = Services(); self.data = {}
    def async_create_task(self, c):
        try:
            c.close()
        except Exception:
            pass


HASS = Hass()


class Store:
    def __init__(self, *a, **k): pass
    async def async_load(self): return None
    async def async_save(self, *a): return None
    def async_delay_save(self, *a, **k): return None


class Ev:
    def __init__(self, eid, old, new):
        self.data = {"entity_id": eid, "old_state": old, "new_state": new}
        self.context = None


def build():
    TIMERS.clear()
    HASS.services.calls = []
    eng = LumenEngine(HASS, Store())
    cfg = {"rooms": {}}
    for r in ROOMS:
        cfg["rooms"][r] = {
            "trigger": ["binary_sensor.%s_pir" % r, "binary_sensor.%s_var" % r],
            "hold": ["binary_sensor.%s_var" % r],
            "lights": ["light.%s" % r], "lux": "",
            "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                          "off_after": 300, "mode": "set", "bri": 70,
                          "kelvin": 2700, "dim_warn": 0, "delay_on": 0}
                      for k in ("morning", "day", "evening", "night")},
        }
    eng.config = _m._deep_default(cfg)
    eng._boot_at = time.time() - BOOT_GRACE - 5
    for r in ROOMS:
        HASS.states.set("binary_sensor.%s_pir" % r, "off")
        HASS.states.set("binary_sensor.%s_var" % r, "off")
        HASS.states.set("light.%s" % r, "on", {"brightness": 200})
        eng._state(r)["was_seen"] = True
    return eng


def fire():
    for box in list(TIMERS):
        if not box[2]:
            box[2] = True
            box[1](None)


def lit():
    return sorted(r for r in ROOMS if HASS.states.get("light.%s" % r).state == "on")


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond:
        ok = False


def mode_of(eng, key):
    for m in eng.config["modes"]:
        if m["key"] == key:
            return m
    raise KeyError(key)


def arrive(eng, room, sensor="pir"):
    eid = "binary_sensor.%s_%s" % (room, sensor)
    HASS.states.set(eid, "on")
    eng._sensor_event(Ev(eid, St(eid, "off"), St(eid, "on")))


print("0) uyku/sinema/tatil kaldirildi")
eng = build()
keys = [m["key"] for m in eng.config["modes"]]
print("   modlar:", keys)
# Guest went with the rest before release: nobody was setting it up, and a
# mode nobody uses is one more thing to explain.
check("kullanilmayan modlar gitti",
      not ({"sleep", "cinema", "holiday", "guest"} & set(keys)))
check("normal ve tek oda duruyor", set(keys) == {"normal", "alone"})
alone = eng.mode_cfg("alone")
# a mode bends the light and nothing else: the room filters and the auto
# on/off switches are gone from every mode, not just this one
check("Tek Oda'nin fazla ayari yok",
      alone["bri"] is None and alone["kelvin"] is None and alone["expire_h"] == 0)
check("oda filtreleri ve aç/söndür anahtarlari hicbir modda yok",
      all(k not in m for m in eng.config["modes"]
          for k in ("auto_on", "auto_off", "only_rooms", "rooms_off")),
      str([sorted(m) for m in eng.config["modes"]]))

print("1) mod KAPALIYKEN odaya girmek digerlerine dokunmaz")
eng = build()
arrive(eng, "ofis")
check("hepsi yaniyor", lit() == ["mutfak", "ofis", "salon"], str(lit()))

print("2) mod ACIKKEN ofise girince digerleri soner")
eng = build()
asyncio.run(eng.async_set_mode("alone"))
arrive(eng, "ofis")
check("sadece ofis yaniyor", lit() == ["ofis"], str(lit()))

print("3) az once cikilan oda (sensoru hala 'on') da sonduruluyor")
eng = build()
asyncio.run(eng.async_set_mode("alone"))
HASS.states.set("binary_sensor.salon_var", "on")   # PIR henuz sifirlanmadi
arrive(eng, "ofis")
check("salon sondu", lit() == ["ofis"], str(lit()))
print("   (istisna 'Dokunma' ile verilir — 4. maddede)")

print("4) 'Dokunma' isaretli oda sondurulmez")
eng = build()
mode_of(eng, "alone")["keep"] = ["salon"]
asyncio.run(eng.async_set_mode("alone"))
HASS.states.set("binary_sensor.salon_var", "on")
arrive(eng, "ofis")
check("salon sabit kaldi (dolu olsa da olmasa da)", lit() == ["ofis", "salon"], str(lit()))
HASS.states.set("binary_sensor.salon_var", "off")
HASS.states.set("light.salon", "on", {"brightness": 200})
arrive(eng, "mutfak")
check("bos olsa da korunuyor", "salon" in lit(), str(lit()))

print("5) oda bazinda sensor secimi")
eng = build()
mode_of(eng, "alone")["enter"] = {"ofis": ["binary_sensor.ofis_var"]}
asyncio.run(eng.async_set_mode("alone"))
arrive(eng, "ofis", "pir")
check("secilmeyen sensor tetiklemedi", lit() == ["mutfak", "ofis", "salon"], str(lit()))
arrive(eng, "ofis", "var")
check("secilen sensor tetikledi", lit() == ["ofis"], str(lit()))

print("6) KULLANICI MODU: kendi modunun ayarlari Tek Oda'ya sizmaz")
eng = build()
# somebody's own mode, the way the panel adds one
eng.config["modes"].append({"key": "parti", "name": {"tr": "Parti", "en": "Party"},
                            "icon": "mdi:party-popper", "bri": 100, "kelvin": 2200,
                            "expire_h": 0})
asyncio.run(eng.async_set_mode("alone"))
check("etkin mod alone", eng.mode_cfg()["key"] == "alone")
check("baska modun parlakligi sizmiyor", eng.mode_cfg().get("bri") is None)
check("baska modun tonu sizmiyor", eng.mode_cfg().get("kelvin") is None)
d = eng.decide("ofis")
check("karar %100 kullanmiyor", d["bri"] == 70, str(d["bri"]))
arrive(eng, "ofis")
check("sonduruyor (Tek Oda calisiyor)", lit() == ["ofis"], str(lit()))

print("7) TERSI: baska moda gecince Tek Oda calismiyor")
eng = build()
eng.config["modes"].append({"key": "parti", "name": {"tr": "Parti", "en": "Party"},
                            "icon": "mdi:party-popper", "bri": 100, "kelvin": None,
                            "expire_h": 0})
asyncio.run(eng.async_set_mode("alone"))
asyncio.run(eng.async_set_mode("parti"))
arrive(eng, "ofis")
check("hepsi yaniyor", lit() == ["mutfak", "ofis", "salon"], str(lit()))
check("etkin mod parti", eng.mode_cfg()["key"] == "parti")

print("8) sondurme ANINDA olur, sayac kurulmaz")
eng = build()
asyncio.run(eng.async_set_mode("alone"))
arrive(eng, "ofis")
check("beklemeden sondu", lit() == ["ofis"], str(lit()))
# Acilistan sonra 7 sn'lik dogrulama sayaci mesru (komutu yutan anahtar
# kontrolu); onemli olan, kalan sayaclarin hicbirinin isik SONDURMEMESI.
once = lit()
for box in list(TIMERS):
    if not box[2]:
        box[2] = True
        box[1](None)
check("kalan sayaclar isik sondurmedi", lit() == once, str(lit()))
check("bekleme ayari hicbir modda yok",
      all("grace" not in m for m in eng.config["modes"]),
      str([m.get("grace") for m in eng.config["modes"]]))

print("9) isiklar LUMEN'in oda tanimindan geliyor")
eng = build()
asyncio.run(eng.async_set_mode("alone"))
eng.config["rooms"]["salon"]["lights"] = []
arrive(eng, "ofis")
fire()
targets = sorted({e for c in HASS.services.calls if c[0] == "turn_off" for e in c[1]})
print("   sondurulenler:", targets)
check("salon'a dokunulmadi", "light.salon" not in targets)

print("10) cikip HEMEN geri donmek: sensor hic degismese de oda yeniden yanar")
eng = build()
asyncio.run(eng.async_set_mode("alone"))
# ofiste oturuyorsun, sensorun surekli "on"
HASS.states.set("binary_sensor.ofis_var", "on")
HASS.states.set("light.ofis", "on", {"brightness": 200})
# bir an salona ciktin: Tek Oda ofisi sondurdu
arrive(eng, "salon")
check("ofis sonduruldu", "ofis" not in lit(), str(lit()))
# geri dondun ama ofis sensoru zaten "on" idi -> hicbir olay yok
eng._tick(None)
check("supurge ofisi geri yakti", "ofis" in lit(), str(lit()))
check("salon yanik kaldi", "salon" in lit(), str(lit()))

print("11) disaridan sondurulen oda, mod acikken geri yanar")
# Nothing protects it any more, because nothing can tell a hand from an app.
# The mode promises one lit room and that is what it keeps.
eng = build()
asyncio.run(eng.async_set_mode("alone"))
HASS.states.set("binary_sensor.ofis_var", "on")
eng._state("ofis")["acted_at"] = 0.0
HASS.states.set("light.ofis", "off")
eng._light_event(Ev("light.ofis", St("light.ofis", "on"), St("light.ofis", "off")))
eng._tick(None)
check("geri geldi", "ofis" in lit(), str(lit()))
check("kim yapti diye bir kayit yok", "manual_dir" not in eng._state("ofis"))

print("12) mod kapaliyken supurge bu isi yapmaz")
eng = build()
HASS.states.set("binary_sensor.ofis_var", "on")
HASS.states.set("light.ofis", "off")
eng._tick(None)
check("normal modda kendiliginden yanmadi", "ofis" not in lit(), str(lit()))



print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
