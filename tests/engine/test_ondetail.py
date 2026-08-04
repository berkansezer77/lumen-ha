import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# The "on" log line carries its reconstruction: sensor timings and lights.
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


class St:
    def __init__(self, eid, state, ago=0.0):
        self.entity_id = eid; self.state = state
        self.attributes = {"friendly_name": eid.split(".")[-1]}
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


eng = LumenEngine(HASS, Store())
eng.config["rooms"] = {"salon": {
    "trigger": ["binary_sensor.pir", "binary_sensor.var"],
    "hold": ["binary_sensor.var"], "lights": ["light.a", "light.b"], "lux": "",
    "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                  "off_after": 300, "mode": "set", "bri": 70, "kelvin": 2700,
                  "dim_warn": 0, "delay_on": 0}
              for k in ("morning", "day", "evening", "night")},
}}
eng._boot_at = time.time() - BOOT_GRACE - 5
HASS.states.set("binary_sensor.pir", "on", ago=3)
HASS.states.set("binary_sensor.var", "off", ago=200)
HASS.states.set("light.a", "off")
HASS.states.set("light.b", "off")

eng.trigger("salon", "sensor")

ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


on = next((e for e in eng.events if e["action"] == "on"), None)
check("AC satiri yazildi", on is not None)
d = (on or {}).get("d") or {}
print("  ayrinti:", d)
sens = {x["n"]: x for x in d.get("sensors") or []}
check("iki sensor da listede", len(sens) == 2, str(list(sens)))
check("PIR ~3 sn ile kaydedildi", 2 <= (sens.get("pir") or {}).get("a", -1) <= 5)
check("varlik 'off' olarak kaydedildi", (sens.get("var") or {}).get("s") == "off")
check("isiklar listede", sorted(d.get("lights") or []) == ["a", "b"], str(d.get("lights")))
check("parlaklik listede", d.get("bri") == 70)
# events without detail stay small
off_evt = {"ts": "x", "room": "salon", "action": "off", "text": "t"}
eng.log("salon", "off", "kapandi")
check("ayrintisiz satirda 'd' yok", "d" not in eng.events[0])

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
