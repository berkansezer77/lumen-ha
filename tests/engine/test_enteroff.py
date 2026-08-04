import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# "Switch off when this slot begins": at the boundary the lights must go out
# even with somebody in the room — and must not touch rooms that did not ask.
import io, sys, types, time
src = io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_sweep.py'), encoding='utf-8').read()
exec(compile(src.split('import importlib.util')[0], 'stub', 'exec'), globals())
import importlib.util
_pkg = types.ModuleType("lumen_ha"); _pkg.__path__ = [Z + "/lumen_ha"]; sys.modules["lumen_ha"] = _pkg
_spec = importlib.util.spec_from_file_location("lumen_ha.engine", Z + "/lumen_ha/engine.py")
_m = importlib.util.module_from_spec(_spec); sys.modules["lumen_ha.engine"] = _m
_spec.loader.exec_module(_m)
LumenEngine, BOOT_GRACE = _m.LumenEngine, _m.BOOT_GRACE


class St:
    def __init__(self, eid, state, attrs=None):
        self.entity_id = eid; self.state = state; self.attributes = attrs or {}


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, st, at=None): self.d[e] = St(e, st, at)


class Services:
    def __init__(self): self.calls = []
    def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append((svc, tuple(data.get("entity_id") or [])))
        for e in (data.get("entity_id") or []):
            HASS.states.set(e, "on" if svc == "turn_on" else "off")


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


def build(enter_off, occupied=True):
    HASS.services.calls = []
    eng = LumenEngine(HASS, Store())
    eng.config["rooms"] = {"salon": {
        "trigger": ["binary_sensor.p"], "hold": ["binary_sensor.p"],
        "lights": ["light.a"], "lux": "",
        "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                      "off_after": 300, "mode": "last", "dim_warn": 0,
                      "off_on_enter": enter_off}
                  for k in ("morning", "day", "evening", "night")},
    }}
    eng._boot_at = time.time() - BOOT_GRACE - 5
    HASS.states.set("binary_sensor.p", "on" if occupied else "off")
    HASS.states.set("light.a", "on", {"brightness": 200})
    eng._state("salon")["on_by_us"] = False      # switched on by hand
    eng._slot_now = "__other__"                  # force a slot change on the tick
    return eng


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


print("1) ayar acik + odada biri var -> yine de sonmeli")
eng = build(True, occupied=True)
eng._tick(None)
check("isik sondu", HASS.states.get("light.a").state == "off", str(HASS.services.calls))
check("gunluge yazildi",
      any(e["action"] == "off" and "başladı" in e["text"] for e in eng.events),
      "; ".join(e["text"] for e in eng.events[:2]))

print("2) ayar acik + oda bos -> sonmeli")
eng = build(True, occupied=False)
eng._tick(None)
check("isik sondu", HASS.states.get("light.a").state == "off")

print("3) ayar kapali -> dokunmamali (eski davranis)")
eng = build(False, occupied=True)
eng._tick(None)
check("isik yaniyor", HASS.states.get("light.a").state == "on", str(HASS.services.calls))

print("4) ayar acik ama isik zaten kapali -> bos yere servis cagrisi yok")
eng = build(True, occupied=True)
HASS.states.set("light.a", "off")
HASS.services.calls = []
eng._tick(None)
check("cagri yok", not HASS.services.calls, str(HASS.services.calls))

print("5) ayar sadece bir dilimde acikken digerine gecince dokunmamali")
eng = build(False, occupied=True)
for k in eng.config["rooms"]["salon"]["slots"]:
    eng.config["rooms"]["salon"]["slots"][k]["off_on_enter"] = (k == "__none__")
eng._tick(None)
check("isik yaniyor", HASS.states.get("light.a").state == "on")

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
