import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# Every sensor setting belongs to the slot; the room's lists are only the sum.
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
SLOTS = ("morning", "day", "evening", "night")


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


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


print("1) eski oda ayarlari her dilime tasinmali")
old = {"rooms": {"salon": {
    "trigger": ["binary_sensor.pir", "binary_sensor.mmw"],
    "hold": ["binary_sensor.mmw"],
    "trigger_mode": "all", "hold_mode": "any", "and_window": 45,
    "lights": ["light.a"],
}}}
cfg = _m._deep_default(old)
room = cfg["rooms"]["salon"]
for k in SLOTS:
    r = room["slots"][k]
    check(k + " uyandiranlari devraldi",
          r["trigger_pick"] == ["binary_sensor.pir", "binary_sensor.mmw"], str(r["trigger_pick"]))
    check(k + " modu ve penceresi devraldi",
          r["trigger_mode"] == "all" and r["and_window"] == 45,
          "%s / %s" % (r["trigger_mode"], r["and_window"]))
check("oda seviyesindeki ayarlar silindi",
      not any(k in room for k in ("trigger_mode", "hold_mode", "and_window")))

print("2) oda listesi dilimlerin toplami olmali")
room["slots"]["night"]["trigger_pick"] = ["binary_sensor.pir"]
room["slots"]["day"]["trigger_pick"] = ["binary_sensor.kapi"]
for k in ("morning", "evening"):
    room["slots"][k]["trigger_pick"] = []
cfg2 = _m._deep_default(cfg)
check("birlesim dogru",
      cfg2["rooms"]["salon"]["trigger"] == ["binary_sensor.kapi", "binary_sensor.pir"],
      str(cfg2["rooms"]["salon"]["trigger"]))

print("3) dilim tutucusu odayi dolu sayarken yalniz kendi listesine bakar")
eng = LumenEngine(HASS, Store())
eng.config = cfg2
now = eng.slot_now()
other = [k for k in SLOTS if k != now][0]
room = eng.config["rooms"]["salon"]
room["hold"] = ["binary_sensor.h1", "binary_sensor.h2"]
room["slots"][now]["hold_pick"] = ["binary_sensor.h1"]
room["slots"][other]["hold_pick"] = ["binary_sensor.h2"]
HASS.states.set("binary_sensor.h1", "off")
HASS.states.set("binary_sensor.h2", "on")
check("bu dilim: h2 acik ama listede degil -> bos", not eng.hold_active("salon"))
room["slots"][now]["hold_pick"] = ["binary_sensor.h2"]
check("listeye alinca -> dolu", eng.hold_active("salon"))

print("4) 'hepsi birden' dilim basina okunuyor")
room["slots"][now]["hold_pick"] = ["binary_sensor.h1", "binary_sensor.h2"]
room["slots"][now]["hold_mode"] = "all"
room["slots"][other]["hold_mode"] = "any"
check("bu dilim (hepsi) -> bos", not eng.hold_active("salon"))
room["slots"][now]["hold_mode"] = "any"
check("bu dilim (herhangi) -> dolu", eng.hold_active("salon"))

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
