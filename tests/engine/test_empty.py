import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# Sondurme bir AYRILISA cevaptir: biri girip cikmadikca hicbir isik sonmez.
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
SENS, LIGHT = "binary_sensor.p", "light.a"
DIM = {"supported_color_modes": ["color_temp"]}


class St:
    def __init__(self, eid, state, attrs=None, ago=0.0):
        self.entity_id = eid; self.state = state
        self.attributes = dict(DIM, **(attrs or {}))
        self.last_changed = dt.datetime.now(UTC) - dt.timedelta(seconds=ago)


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, st, attrs=None): self.d[e] = St(e, st, attrs)


class Services:
    def __init__(self): self.calls = []
    def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append((svc, tuple(data.get("entity_id") or [])))
        for e in (data.get("entity_id") or []):
            HASS.states.d[e] = St(e, "on" if svc == "turn_on" else "off",
                                  {"brightness": 200} if svc == "turn_on" else {})


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


TIMERS_LOCAL = []


def build(off_after=0):
    global TIMERS
    TIMERS.clear()
    HASS.services.calls = []
    eng = LumenEngine(HASS, Store())
    eng.config["rooms"] = {"bedroom": {
        "trigger": [SENS], "hold": [SENS], "lights": [LIGHT], "lux": "",
        "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                      "off_after": off_after, "mode": "set", "bri": 40,
                      "kelvin": 2400, "dim_warn": 0, "delay_on": 0}
                  for k in ("morning", "day", "evening", "night")},
    }}
    eng._boot_at = time.time() - BOOT_GRACE - 5
    HASS.states.set(SENS, "off")
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


print("1) bos odada disaridan yanan isiga DOKUNULMAZ (gercek kullanimda yasandi)")
eng = build()
HASS.states.set(LIGHT, "on", {"brightness": 200})
eng._state("bedroom")["acted_at"] = 0.0
eng._light_event(Ev(LIGHT, St(LIGHT, "off"), St(LIGHT, "on")))
fire()
for _ in range(6):
    eng._tick(None); fire()
check("sondurmedi", HASS.states.get(LIGHT).state == "on", str(HASS.services.calls))

print("2) ama unutulmus isik haber konusudur")
eng._state("bedroom")["stuck_since"] = time.time() - 11 * 60
news = eng._watch_stuck()
check("bildirime dustu", len(news) == 1, str(news))

print("3) biri girip cikinca soner")
HASS.states.set(SENS, "on")
eng._sensor_event(Ev(SENS, St(SENS, "off"), St(SENS, "on")))
check("girince gorevli not etti", eng._state("bedroom")["seen"])
HASS.states.set(SENS, "off")
eng._sensor_event(Ev(SENS, St(SENS, "on"), St(SENS, "off")))
fire()
check("cikinca sondu", HASS.states.get(LIGHT).state == "off")
check("ayrilis cevaplandi, not silindi", not eng._state("bedroom")["seen"])

print("5) normal akis: gir, motor acsin, cik, sonsun")
eng = build()
HASS.states.set(SENS, "on")
eng._sensor_event(Ev(SENS, St(SENS, "off"), St(SENS, "on")))
check("motor acti", HASS.states.get(LIGHT).state == "on", str(HASS.services.calls))
HASS.states.set(SENS, "off")
eng._sensor_event(Ev(SENS, St(SENS, "on"), St(SENS, "off")))
fire()
check("cikinca sondu", HASS.states.get(LIGHT).state == "off")

print("6) kacirilan ayrilis supurgeyle yakalanir")
eng = build()
HASS.states.set(SENS, "on")
eng._sensor_event(Ev(SENS, St(SENS, "off"), St(SENS, "on")))
HASS.states.set(SENS, "off")          # olay kaybedildi, haber verilmedi
eng._tick(None); fire()
check("supurge yakaladi", HASS.states.get(LIGHT).state == "off")

print("7) odadayken disaridan yakilan isik: cikinca soner")
eng = build()
HASS.states.set(SENS, "on")
eng._sensor_event(Ev(SENS, St(SENS, "off"), St(SENS, "on")))   # girdi (isiksiz da olsa)
HASS.states.set(LIGHT, "on", {"brightness": 200})
eng._state("bedroom")["acted_at"] = 0.0
eng._light_event(Ev(LIGHT, St(LIGHT, "off"), St(LIGHT, "on")))
fire()
check("odadayken sondurmedi", HASS.states.get(LIGHT).state == "on")
HASS.states.set(SENS, "off")
eng._sensor_event(Ev(SENS, St(SENS, "on"), St(SENS, "off")))
fire()
check("cikinca sondu", HASS.states.get(LIGHT).state == "off")

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
