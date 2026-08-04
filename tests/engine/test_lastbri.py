import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# "Son ayar" must never switch a lamp on into the dark.
import io, sys, types, time, datetime as dt
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_sweep.py'), encoding='utf-8').read()
             .split('import importlib.util')[0], 'stub', 'exec'), globals())
import importlib.util
_pkg = types.ModuleType("lumen_ha"); _pkg.__path__ = [Z + "/lumen_ha"]; sys.modules["lumen_ha"] = _pkg
_spec = importlib.util.spec_from_file_location("lumen_ha.engine", Z + "/lumen_ha/engine.py")
_m = importlib.util.module_from_spec(_spec); sys.modules["lumen_ha.engine"] = _m
_spec.loader.exec_module(_m)
LumenEngine, BOOT_GRACE = _m.LumenEngine, _m.BOOT_GRACE
UTC = dt.timezone.utc
ZONE = "light.ark_zone"


class St:
    def __init__(self, eid, state, attrs=None, ago=0.0):
        self.entity_id = eid; self.state = state; self.attributes = attrs or {}
        self.last_changed = dt.datetime.now(UTC) - dt.timedelta(seconds=ago)


DIMMABLE = {"supported_color_modes": ["color_temp", "xy"]}


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, st, attrs=None):
        self.d[e] = St(e, st, dict(DIMMABLE, **(attrs or {})))


class Services:
    def __init__(self): self.calls = []
    def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append((svc, tuple(data.get("entity_id") or []), dict(data)))


class Hass:
    def __init__(self): self.states = States(); self.services = Services(); self.data = {}
    def async_create_task(self, c):
        try: c.close()
        except Exception: pass


HASS = Hass()


class Store:
    def __init__(self, *a, **k): pass
    async def async_load(self): return None
    async def async_save(self, *a): return None
    def async_delay_save(self, *a, **k): return None


def build():
    HASS.services.calls = []
    eng = LumenEngine(HASS, Store())
    eng.config["rooms"] = {"ofis": {
        "trigger": ["binary_sensor.p"], "hold": ["binary_sensor.p"],
        "lights": [ZONE], "lux": "",
        "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                      "off_after": 300, "mode": "last", "bri": 80, "kelvin": 3000,
                      "dim_warn": 0, "delay_on": 0, "picks": [ZONE]}
                  for k in ("morning", "day", "evening", "night")},
    }}
    eng._boot_at = time.time() - BOOT_GRACE - 5
    HASS.states.set("binary_sensor.p", "on")
    return eng


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


def bri_of(calls):
    for svc, ents, data in calls:
        if svc == "turn_on" and ZONE in ents:
            return data.get("brightness_pct", data.get("brightness"))
    return "CAGRI YOK"


print("1) hicbir sey hatirlanmiyorsa dilimin parlakligi kullanilir")
eng = build()
HASS.states.set(ZONE, "off")
eng.trigger("ofis", "sensor")
b = bri_of(HASS.services.calls)
check("parlaklik gonderildi", b == 80, "gonderilen: %s" % b)

print("2) lamba once %35'te goruldiyse o hatirlanir")
eng = build()
HASS.states.set(ZONE, "on", {"brightness": 90})     # ~%35
eng._account(30)                                     # tik: parlakligi not al
HASS.states.set(ZONE, "off")
HASS.services.calls = []
eng.trigger("ofis", "sensor")
b = bri_of(HASS.services.calls)
check("hatirlanan deger gonderildi", b == 35, "gonderilen: %s" % b)

print("3) 'acik ama parlaklik 0' hatirlanmaz")
eng = build()
HASS.states.set(ZONE, "on", {"brightness": 0})
eng._account(30)
check("hafizaya girmedi", not (eng._state("ofis").get("last_bri") or {}),
      str(eng._state("ofis").get("last_bri")))
HASS.states.set(ZONE, "off")
HASS.services.calls = []
eng.trigger("ofis", "sensor")
b = bri_of(HASS.services.calls)
check("dilimin degerine dusuldu", b == 80, "gonderilen: %s" % b)

print("4) parlakliksiz cagri hic yapilmiyor")
eng = build()
HASS.states.set(ZONE, "off")
eng.trigger("ofis", "sensor")
naked = [c for c in HASS.services.calls
         if c[0] == "turn_on" and "brightness_pct" not in c[2] and "brightness" not in c[2]]
check("ciplak turn_on yok", not naked, str(naked))

print("5) saglik kontrolu 'acik ama karanlik' diyor")
eng = build()
HASS.states.set(ZONE, "on", {"brightness": 0, "friendly_name": "Ark Zone"})
kinds = [x["kind"] for x in eng.health()]
check("zero_bri yakalandi", "zero_bri" in kinds, str(kinds))

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
