import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# The warning dim is a gesture, not a setting: it must always be handed back,
# and must never become what the room remembers itself at.
import io, sys, types, time, asyncio, datetime as dt
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_sweep.py'), encoding='utf-8').read()
             .split('import importlib.util')[0], 'stub', 'exec'), globals())
import importlib.util
_pkg = types.ModuleType("lumen_ha"); _pkg.__path__ = [Z + "/lumen_ha"]; sys.modules["lumen_ha"] = _pkg
_spec = importlib.util.spec_from_file_location("lumen_ha.engine", Z + "/lumen_ha/engine.py")
_m = importlib.util.module_from_spec(_spec); sys.modules["lumen_ha.engine"] = _m
_spec.loader.exec_module(_m)
LumenEngine, BOOT_GRACE, DIM_PCT = _m.LumenEngine, _m.BOOT_GRACE, _m.DIM_WARN_PCT
UTC = dt.timezone.utc
DIM = {"supported_color_modes": ["color_temp"]}
SENS, LIGHT = "binary_sensor.p", "light.a"


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
            if svc == "turn_off":
                HASS.states.d[e] = St(e, "off", {})
                continue
            pct = data.get("brightness_pct")
            cur = HASS.states.get(e)
            keep = (cur.attributes.get("brightness") if cur else None) or 255
            HASS.states.d[e] = St(e, "on", {
                "brightness": int(round(pct * 2.55)) if pct else keep})


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


def build(mode="last", bri=100):
    TIMERS.clear()
    HASS.services.calls = []
    eng = LumenEngine(HASS, Store())
    eng.config["rooms"] = {"ofis": {
        "trigger": [SENS], "hold": [SENS], "lights": [LIGHT], "lux": "",
        "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                      "off_after": 60, "mode": mode, "bri": bri, "kelvin": 2700,
                      "dim_warn": 20, "delay_on": 0}
                  for k in ("morning", "day", "evening", "night")},
    }}
    eng._boot_at = time.time() - BOOT_GRACE - 5
    HASS.states.set(SENS, "on")
    HASS.states.set(LIGHT, "on", {"brightness": 200})     # ~%78
    st = eng._state("ofis")
    st["on_by_us"] = True
    st["was_seen"] = True
    return eng


def pct():
    st = HASS.states.get(LIGHT)
    raw = st.attributes.get("brightness") if st else None
    return round(raw / 2.55) if raw else None


def leave(eng):
    HASS.states.set(SENS, "off")
    eng._sensor_event(Ev(SENS, St(SENS, "on"), St(SENS, "off")))


def come_back(eng):
    HASS.states.set(SENS, "on")
    eng._sensor_event(Ev(SENS, St(SENS, "off"), St(SENS, "on")))


def fire(name=None):
    for box in list(TIMERS):
        if not box[2]:
            box[2] = True
            box[1](None)


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond:
        ok = False


print("1) kisildiktan sonra geri girince eski parlakligina doner")
eng = build()
before = pct()
leave(eng)
eng._do_dim("ofis")
check("kisildi", pct() == DIM_PCT, "%s%%" % pct())
come_back(eng)
check("eski parlaklik geri geldi", pct() == before, "%s%% (onceki %s%%)" % (pct(), before))
check("not defteri bosaldi", not eng._state("ofis").get("predim"))

print("2) SONME ANINDA odaya donmek: isik kisik kalmamali (asil hata)")
eng = build()
before = pct()
leave(eng)
eng._do_dim("ofis")
HASS.states.set(SENS, "on")          # geri girdin ama olay gelmedi
eng._do_off("ofis", "empty")         # sonme sayaci atesledi, odayi dolu buldu
check("isik hala yaniyor", HASS.states.get(LIGHT).state == "on")
check("kisiklik geri alindi", pct() == before, "%s%% (onceki %s%%)" % (pct(), before))
check("not defteri bosaldi", not eng._state("ofis").get("predim"))

print("3) kisikken hafizaya %30 yazilmaz")
eng = build()
leave(eng)
eng._do_dim("ofis")
eng._account(30)
mem = eng._state("ofis").get("last_bri") or {}
check("hafiza kirlenmedi", mem.get(LIGHT) != DIM_PCT, str(mem))

print("4) kis -> son -> yeniden ac: kisik degil, eski parlaklikta acilir")
eng = build()
before = pct()
leave(eng)
eng._do_dim("ofis")
fire()                                # sonme
check("sondu", HASS.states.get(LIGHT).state == "off")
come_back(eng)
check("eski parlaklikta acildi", pct() == before, "%s%% (onceki %s%%)" % (pct(), before))

print("5) acilamayacak bir dilimde bile kisiklik geri alinir")
eng = build()
before = pct()
leave(eng)
eng._do_dim("ofis")
for rule in eng.config["rooms"]["ofis"]["slots"].values():
    rule["on"] = False               # artik acmaz
come_back(eng)
check("isik kisik birakilmadi", pct() == before, "%s%%" % pct())

print("6) hafiza diske yazilip geri okunur")
saved = {}


class RecStore(Store):
    def __init__(self, *a, **k):
        self.key = a[2] if len(a) > 2 else ""
    def async_delay_save(self, fn, delay=0):
        saved[self.key] = fn()
    async def async_load(self):
        return saved.get(self.key)


_m.Store = RecStore
eng = build()
eng._account(30)
check("diske yazildi", bool(saved.get("lumen_bri", {}).get("rooms", {}).get("ofis")),
      str(saved.get("lumen_bri")))
eng2 = LumenEngine(HASS, RecStore(None, 1, "lumen"))
eng2.config = eng.config
asyncio.run(eng2.async_load())
check("yeniden okundu",
      (eng2._state("ofis").get("last_bri") or {}).get(LIGHT) == 78,
      str(eng2._state("ofis").get("last_bri")))

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
