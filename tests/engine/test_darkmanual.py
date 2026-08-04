import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# "Switch on when it gets dark" — and nothing at all about who switched it off.
import io, sys, types, time, datetime as dt
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_sweep.py'), encoding='utf-8').read()
             .split('import importlib.util')[0], 'stub', 'exec'), globals())
import importlib.util
_pkg = types.ModuleType("lumen_ha"); _pkg.__path__ = [Z + "/lumen_ha"]; sys.modules["lumen_ha"] = _pkg
_spec = importlib.util.spec_from_file_location("lumen_ha.engine", Z + "/lumen_ha/engine.py")
_m = importlib.util.module_from_spec(_spec); sys.modules["lumen_ha.engine"] = _m
_spec.loader.exec_module(_m)
LumenEngine, BOOT_GRACE, ACT_ECHO = _m.LumenEngine, _m.BOOT_GRACE, _m.ACT_ECHO
UTC = dt.timezone.utc
SLOTS = ("morning", "day", "evening", "night")


class St:
    def __init__(self, eid, state, ago=0.0, attrs=None):
        self.entity_id = eid; self.state = state; self.attributes = attrs or {}
        self.last_changed = dt.datetime.now(UTC) - dt.timedelta(seconds=ago)


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, st, ago=0.0, attrs=None): self.d[e] = St(e, st, ago, attrs)


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


SENS, LIGHT, LUX = "binary_sensor.p", "light.a", "sensor.lux"


def build(watch=False, lux=12):
    HASS.services.calls = []
    eng = LumenEngine(HASS, Store())
    eng.config["rooms"] = {"ofis": {
        "trigger": [SENS], "hold": [SENS], "lights": [LIGHT], "lux": LUX,
        "slots": {k: {"on": False, "lux_max": 20, "off_enabled": True,
                      "off_after": 300, "mode": "set", "bri": 60, "kelvin": 3000,
                      "dim_warn": 0, "delay_on": 0,
                      "watch_dark": watch}
                  for k in SLOTS},
    }}
    eng._boot_at = time.time() - BOOT_GRACE - 5
    HASS.states.set(SENS, "on", ago=1800)      # sitting still for half an hour
    HASS.states.set(LIGHT, "off", ago=1800)
    HASS.states.set(LUX, str(lux))
    return eng


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


print("1) gozcu KAPALI: karanlik cokse de kimse kipirdamadikca acilmaz")
eng = build(watch=False)
eng._tick(None)
check("isik kapali", HASS.states.get(LIGHT).state == "off", str(HASS.services.calls))

print("2) gozcu ACIK: oturuyorken oda kararinca acilir")
eng = build(watch=True)
check("motorun karari 'acardim'", eng.decide("ofis")["on"])
eng._tick(None)
check("isik acildi", HASS.states.get(LIGHT).state == "on", str(HASS.services.calls))
check("gunluge yazildi",
      any("karardı" in e["text"] for e in eng.events),
      "; ".join(e["text"] for e in eng.events[:1]))

print("3) gozcu ACIK ama oda aydinlik -> dokunmaz")
eng = build(watch=True, lux=300)
eng._tick(None)
check("isik kapali", HASS.states.get(LIGHT).state == "off")

print("4) disaridan sondurulen isik, gozcu acikken geri gelir")
# Bunu kimin yaptigi bilinemez (duvar anahtari, uygulama, MQTT, ampulun kendisi),
# o yuzden bir sey varsayilmiyor: oda dolu ve karanlik, kural 'ac' diyor.
eng = build(watch=True)
eng._state("ofis")["acted_at"] = 0.0
HASS.states.set(LIGHT, "off")
eng._light_event(Ev(LIGHT, St(LIGHT, "on"), St(LIGHT, "off")))
eng._tick(None)
check("geri geldi", HASS.states.get(LIGHT).state == "on", str(HASS.services.calls))

print("5) gunluk kimin dokundugunu iddia etmez")
texts = " | ".join(e.get("text") or "" for e in eng.events)
for word in ("elle", "dışarıdan"):
    check("'%s' iddiasi yok" % word, word not in texts, texts[:80])

print("6) oda kilidi hala calisir (panelden istenen, tahmin degil)")
eng = build(watch=True)
eng._state("ofis")["locked_until"] = time.time() + 3600
check("kilitliyken acmaz", not eng.decide("ofis")["on"], eng.decide("ofis")["reason"])
eng._state("ofis")["locked_until"] = 0.0
check("kilit kalkinca acar", eng.decide("ofis")["on"])

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
