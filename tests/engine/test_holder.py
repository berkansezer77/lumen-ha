import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# "Uyanık tutan" bir sensör ışığı açmaz; yanan ışığın sönmesini geciktirir.
import io, sys, types, time, datetime as dt
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_sweep.py'), encoding='utf-8').read()
             .split('import importlib.util')[0], 'stub', 'exec'), globals())
import importlib.util
_pkg = types.ModuleType("lumen_ha"); _pkg.__path__ = [Z + "/lumen_ha"]; sys.modules["lumen_ha"] = _pkg
_spec = importlib.util.spec_from_file_location("lumen_ha.engine", Z + "/lumen_ha/engine.py")
_m = importlib.util.module_from_spec(_spec); sys.modules["lumen_ha.engine"] = _m
_spec.loader.exec_module(_m)
LumenEngine, BOOT_GRACE = _m.LumenEngine, _m.BOOT_GRACE
UTC = dt.timezone.utc
MOTION = "binary_sensor.salon_motion"
GIRIS = "binary_sensor.salon_giris_presence"
TV = "binary_sensor.salon_tv_presence"
LIGHT = "light.salon"
SLOTS = ("morning", "day", "evening", "night")


class St:
    def __init__(self, eid, state, ago=0.0, attrs=None):
        self.entity_id = eid; self.state = state; self.attributes = attrs or {}
        self.last_changed = dt.datetime.now(UTC) - dt.timedelta(seconds=ago)


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, st, ago=0.0): self.d[e] = St(e, st, ago)


class Services:
    def __init__(self): self.calls = []
    def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append((svc, tuple(data.get("entity_id") or [])))
        for e in (data.get("entity_id") or []):
            HASS.states.d[e] = St(e, "on" if svc == "turn_on" else "off")


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


class Ev:
    def __init__(self, eid, old, new):
        self.data = {"entity_id": eid, "old_state": old, "new_state": new}
        self.context = None


def build(mode="all"):
    TIMERS.clear()
    HASS.services.calls = []
    eng = LumenEngine(HASS, Store())
    eng.config["rooms"] = {"salon": {
        "trigger": [MOTION, GIRIS], "hold": [GIRIS, TV], "lights": [LIGHT],
        "lux": "", "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                                 "off_after": 0, "mode": "set", "bri": 60,
                                 "kelvin": 3000, "dim_warn": 0, "delay_on": 0,
                                 "trigger_mode": mode, "and_window": 10}
                             for k in SLOTS},
    }}
    eng._boot_at = time.time() - BOOT_GRACE - 5
    for e in (MOTION, GIRIS, TV):
        HASS.states.set(e, "off", ago=600)
    HASS.states.set(LIGHT, "off")
    return eng


def fire():
    now = time.time()
    for box in list(TIMERS):
        if not box[2] and box[0] <= now + 1.0:
            box[2] = True
            box[1](None)


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


print("1) SADECE uyanik tutan listesindeki sensor isigi acamaz")
eng = build()
HASS.states.set(TV, "on")
eng._sensor_event(Ev(TV, St(TV, "off"), St(TV, "on")))
fire()
check("acmadi", HASS.states.get(LIGHT).state == "off", str(HASS.services.calls))

print("2) 'hepsi birden' sarti korunuyor: tek uyandiran yetmez")
eng = build(mode="all")
HASS.states.set(MOTION, "on")
eng._sensor_event(Ev(MOTION, St(MOTION, "off"), St(MOTION, "on")))
fire()
check("tek basina acmadi", HASS.states.get(LIGHT).state == "off")
HASS.states.set(GIRIS, "on")
eng._sensor_event(Ev(GIRIS, St(GIRIS, "off"), St(GIRIS, "on")))
fire()
check("ikisi anlasinca acti", HASS.states.get(LIGHT).state == "on",
      str(HASS.services.calls))

print("3) uyanik tutan gorevini yapiyor: yanan isigin sayacini iptal eder")
eng = build(mode="any")
HASS.states.set(MOTION, "on")
eng._sensor_event(Ev(MOTION, St(MOTION, "off"), St(MOTION, "on")))
fire()
check("isik yandi", HASS.states.get(LIGHT).state == "on")
HASS.states.set(TV, "on")            # sen kanepedesin, TV sensoru goruyor
HASS.states.set(MOTION, "off")       # hareket bitti
eng._sensor_event(Ev(MOTION, St(MOTION, "on"), St(MOTION, "off")))
fire()
check("uyanik tutan sondurmedi", HASS.states.get(LIGHT).state == "on",
      str(HASS.services.calls))

print("4) uyanik tutan da cekilince oda soner")
HASS.states.set(TV, "off")
eng._sensor_event(Ev(TV, St(TV, "on"), St(TV, "off")))
fire()
check("sondu", HASS.states.get(LIGHT).state == "off")

print("5) sondukten sonra uyanik tutan tek basina geri yakamaz (gercekte yasandi: salon)")
HASS.states.set(TV, "on")
eng._sensor_event(Ev(TV, St(TV, "off"), St(TV, "on")))
fire()
check("kapali kaldi", HASS.states.get(LIGHT).state == "off", str(HASS.services.calls))

print("6) her iki listede olan sensor hala uyandirabilir")
eng = build(mode="any")
HASS.states.set(GIRIS, "on")
eng._sensor_event(Ev(GIRIS, St(GIRIS, "off"), St(GIRIS, "on")))
fire()
check("acti", HASS.states.get(LIGHT).state == "on", str(HASS.services.calls))

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
