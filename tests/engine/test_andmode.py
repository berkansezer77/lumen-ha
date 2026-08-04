import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# "All of them" on the wakers: the light must wait for every sensor, but must
# not wait for them to fire in the same instant.
import io, sys, types, time, datetime as dt
src = io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_sweep.py'), encoding='utf-8').read()
exec(compile(src.split('import importlib.util')[0], 'stub', 'exec'), globals())
import importlib.util
_pkg = types.ModuleType("lumen_ha"); _pkg.__path__ = [Z + "/lumen_ha"]; sys.modules["lumen_ha"] = _pkg
_spec = importlib.util.spec_from_file_location("lumen_ha.engine", Z + "/lumen_ha/engine.py")
_m = importlib.util.module_from_spec(_spec); sys.modules["lumen_ha.engine"] = _m
_spec.loader.exec_module(_m)
LumenEngine, BOOT_GRACE = _m.LumenEngine, _m.BOOT_GRACE

UTC = dt.timezone.utc


class St:
    def __init__(self, eid, state, ago=0.0):
        self.entity_id = eid
        self.state = state
        self.attributes = {}
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


def build(mode="all", window=30):
    HASS.services.calls = []
    eng = LumenEngine(HASS, Store())
    eng.config["rooms"] = {"banyo": {
        "trigger": ["binary_sensor.pir", "binary_sensor.mmwave"],
        "hold": [], "lights": ["light.a"], "lux": "",
        # every sensor setting lives on the slot now
        "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                      "off_after": 300, "mode": "set", "bri": 60, "kelvin": 3000,
                      "dim_warn": 0, "delay_on": 0,
                      "trigger_mode": mode, "and_window": window}
                  for k in ("morning", "day", "evening", "night")},
    }}
    eng._boot_at = time.time() - BOOT_GRACE - 5
    HASS.states.set("light.a", "off")
    return eng


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


print("1) HEPSI: sadece biri tetiklendi -> acilmamali")
eng = build("all")
HASS.states.set("binary_sensor.pir", "on")
HASS.states.set("binary_sensor.mmwave", "off", ago=600)   # long gone
eng._sensor_event(Ev("binary_sensor.pir", St("x", "off"), St("x", "on")))
check("isik kapali", HASS.states.get("light.a").state == "off", str(HASS.services.calls))

print("2) HEPSI: ikisi de acik -> acilmali")
eng = build("all")
HASS.states.set("binary_sensor.pir", "on")
HASS.states.set("binary_sensor.mmwave", "on")
eng._sensor_event(Ev("binary_sensor.pir", St("x", "off"), St("x", "on")))
check("isik acildi", HASS.states.get("light.a").state == "on", str(HASS.services.calls))

print("3) HEPSI: biri 10 sn once sonmus (pencere 30) -> yine de acilmali")
eng = build("all", window=30)
HASS.states.set("binary_sensor.pir", "off", ago=10)       # PIR already reset
HASS.states.set("binary_sensor.mmwave", "on")
eng._sensor_event(Ev("binary_sensor.mmwave", St("x", "off"), St("x", "on")))
check("isik acildi", HASS.states.get("light.a").state == "on",
      "pencere ici gecmis sayiliyor")

print("4) HEPSI: biri 45 sn once sonmus (pencere 30) -> acilmamali")
eng = build("all", window=30)
HASS.states.set("binary_sensor.pir", "off", ago=45)
HASS.states.set("binary_sensor.mmwave", "on")
eng._sensor_event(Ev("binary_sensor.mmwave", St("x", "off"), St("x", "on")))
check("isik kapali", HASS.states.get("light.a").state == "off")

print("5) HERHANGI BIRI (varsayilan): biri yeter")
eng = build("any")
HASS.states.set("binary_sensor.pir", "on")
HASS.states.set("binary_sensor.mmwave", "off", ago=600)
eng._sensor_event(Ev("binary_sensor.pir", St("x", "off"), St("x", "on")))
check("isik acildi", HASS.states.get("light.a").state == "on")

print("6) HEPSI acikken bile sonme tarafi degismemeli (biri hala dolu -> sonmez)")
eng = build("all")
HASS.states.set("binary_sensor.pir", "off", ago=1)
HASS.states.set("binary_sensor.mmwave", "on")
HASS.states.d["light.a"] = St("light.a", "on")
eng._state("banyo")["on_by_us"] = True
eng._tick(None)          # the sweep
check("isik yaniyor", HASS.states.get("light.a").state == "on",
      "oda hala dolu sayiliyor")

print("7) tutucu HEPSI: ikisinden biri bosalinca oda bos sayilmali")
eng = build("any")
room = eng.config["rooms"]["banyo"]
room["hold"] = ["binary_sensor.h1", "binary_sensor.h2"]
slot = eng.slot_now()
room["slots"][slot]["hold_mode"] = "all"
HASS.states.set("binary_sensor.h1", "on")
HASS.states.set("binary_sensor.h2", "off", ago=1)
check("tutucu bos", not eng.hold_active("banyo"))
room["slots"][slot]["hold_mode"] = "any"
check("herhangi biri secilince dolu", eng.hold_active("banyo"))

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
