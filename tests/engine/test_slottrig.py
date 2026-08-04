import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# A slot may listen to only some of the room's wakers.
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
        self.entity_id = eid; self.state = state; self.attributes = {}
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


PIR, MMW = "binary_sensor.pir", "binary_sensor.mmwave"


def build(picks):
    """picks: slot key -> list of wakers for that slot"""
    HASS.services.calls = []
    eng = LumenEngine(HASS, Store())
    eng.config["rooms"] = {"banyo": {
        "trigger": [PIR, MMW], "hold": [], "lights": ["light.a"], "lux": "",
        "trigger_mode": "any",
        "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                      "off_after": 300, "mode": "set", "bri": 60, "kelvin": 3000,
                      "dim_warn": 0, "delay_on": 0,
                      "trigger_pick": picks.get(k, [])}
                  for k in ("morning", "day", "evening", "night")},
    }}
    eng._boot_at = time.time() - BOOT_GRACE - 5
    HASS.states.set("light.a", "off")
    HASS.states.set(PIR, "off", ago=600)
    HASS.states.set(MMW, "off", ago=600)
    return eng


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


now_slot = LumenEngine(HASS, Store()).slot_now()
print("su anki dilim:", now_slot)

print("1) bu dilim sadece mmWave dinliyor -> PIR tetiklemez")
eng = build({now_slot: [MMW]})
HASS.states.set(PIR, "on")
eng._sensor_event(Ev(PIR, St("x", "off"), St("x", "on")))
check("isik kapali", HASS.states.get("light.a").state == "off", str(HASS.services.calls))

print("2) ayni dilim, mmWave tetiklerse -> acilmali")
eng = build({now_slot: [MMW]})
HASS.states.set(MMW, "on")
eng._sensor_event(Ev(MMW, St("x", "off"), St("x", "on")))
check("isik acildi", HASS.states.get("light.a").state == "on")

print("3) baska bir dilime secim, bu dilim bos -> ikisi de tetikler")
other = [k for k in ("morning", "day", "evening", "night") if k != now_slot][0]
eng = build({other: [MMW]})
HASS.states.set(PIR, "on")
eng._sensor_event(Ev(PIR, St("x", "off"), St("x", "on")))
check("isik acildi (secim yok = hepsi)", HASS.states.get("light.a").state == "on")

print("4) secilen sensor odadan silinmisse yine hepsine duser")
eng = build({now_slot: ["binary_sensor.silinmis"]})
HASS.states.set(PIR, "on")
eng._sensor_event(Ev(PIR, St("x", "off"), St("x", "on")))
check("isik acildi", HASS.states.get("light.a").state == "on",
      "gecersiz secim odayi sagir birakmadi")

print("5) tutucu tarafi degismedi: PIR hala odayi dolu sayar")
eng = build({now_slot: [MMW]})
HASS.states.set(PIR, "on")
check("oda dolu", eng.occupied("banyo"), "sonme erken tetiklenmez")

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
