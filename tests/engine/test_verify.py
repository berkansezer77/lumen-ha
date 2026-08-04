import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# Soz verilen isik gelmediyse komut BIR kez daha gider; gelen isik rahat birakilir.
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
SENS = "binary_sensor.p"


class St:
    def __init__(self, eid, state, ago=0.0, attrs=None):
        self.entity_id = eid; self.state = state; self.attributes = attrs or {}
        self.last_changed = dt.datetime.now(UTC) - dt.timedelta(seconds=ago)


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, st, ago=0.0): self.d[e] = St(e, st, ago)


class Services:
    """switch.b huysuz: ilk turn_on'u yutar, ikincisine uyar."""
    def __init__(self): self.calls = []; self.dropped = 0
    def async_call(self, dom, svc, data, blocking=False, context=None):
        ents = list(data.get("entity_id") or [])
        self.calls.append((svc, tuple(ents)))
        for e in ents:
            if svc == "turn_on" and e == "switch.b" and self.dropped == 0:
                self.dropped += 1
                continue                       # cihaz komutu yuttu
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


def build():
    TIMERS.clear()
    HASS.services.calls = []
    HASS.services.dropped = 0
    eng = LumenEngine(HASS, Store())
    eng.config["rooms"] = {"banyo": {
        "trigger": [SENS], "hold": [SENS], "lights": ["switch.a", "switch.b"],
        "lux": "", "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                                 "off_after": 0, "mode": "set", "bri": 60,
                                 "kelvin": 3000, "dim_warn": 0, "delay_on": 0}
                             for k in ("morning", "day", "evening", "night")},
    }}
    eng._boot_at = time.time() - BOOT_GRACE - 5
    HASS.states.set(SENS, "off")
    HASS.states.set("switch.a", "off")
    HASS.states.set("switch.b", "off")
    return eng


def fire():
    now = time.time()
    for box in list(TIMERS):
        if not box[2] and box[0] <= now + 8.0:
            box[2] = True
            box[1](None)


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


print("1) huysuz anahtar ilk komutu yutti -> bir kez daha soruldu")
eng = build()
HASS.states.set(SENS, "on")
eng._sensor_event(Ev(SENS, St(SENS, "off"), St(SENS, "on")))
check("a hemen yandi", HASS.states.get("switch.a").state == "on")
check("b ilk komutu yuttu", HASS.states.get("switch.b").state == "off")
fire()          # 7 sn'lik kontrol
check("b ikinci komutla geldi", HASS.states.get("switch.b").state == "on",
      str(HASS.services.calls))
check("gunluge yazildi", any("komuta uymadı" in (e.get("text") or "") for e in eng.events),
      str([e.get("text") for e in eng.events][:3]))
sadece_b = [c for c in HASS.services.calls if c == ("turn_on", ("switch.b",))]
check("yalniz eksik olana gitti", len(sadece_b) >= 1)

print("2) herkes uyduysa kontrol sessiz gecer")
eng = build()
olay_once = None
HASS.states.set(SENS, "on")
HASS.services.dropped = 9          # artik yutmuyor
eng._sensor_event(Ev(SENS, St(SENS, "off"), St(SENS, "on")))
n = len(HASS.services.calls)
fire()
check("fazladan komut yok", len(HASS.services.calls) == n, str(HASS.services.calls))
check("gunluk temiz", not any("komuta uymadı" in (e.get("text") or "") for e in eng.events))

print("3) ikinci de yutulursa israr YOK (gures yasak)")
class Inat(Services):
    def async_call(self, dom, svc, data, blocking=False, context=None):
        ents = list(data.get("entity_id") or [])
        self.calls.append((svc, tuple(ents)))
        for e in ents:
            if svc == "turn_on" and e == "switch.b":
                continue                       # hep yutar
            HASS.states.d[e] = St(e, "on" if svc == "turn_on" else "off")
eng = build()
HASS.services = Inat()
HASS.states.set(SENS, "on")
eng._sensor_event(Ev(SENS, St(SENS, "off"), St(SENS, "on")))
fire()          # kontrol + yineleme
fire()          # baska kontrol kalmamali
tekrar = [c for c in HASS.services.calls if c == ("turn_on", ("switch.b",))]
check("en fazla bir yineleme", len(tekrar) == 1, str(len(tekrar)))

print("4) son-ayar modunda iki anahtar TEK komutta gider (otomasyon gibi)")
eng = build()
for k in ("morning", "day", "evening", "night"):
    eng.config["rooms"]["banyo"]["slots"][k]["mode"] = "last"
HASS.services.dropped = 9      # yutma yok; sayilan sey komut bicimi
HASS.states.set(SENS, "on")
eng._sensor_event(Ev(SENS, St(SENS, "off"), St(SENS, "on")))
grup = [c for c in HASS.services.calls if c == ("turn_on", ("switch.a", "switch.b"))]
tekli = [c for c in HASS.services.calls
         if c in (("turn_on", ("switch.a",)), ("turn_on", ("switch.b",)))]
check("tek grup komut", len(grup) == 1, str(HASS.services.calls))
check("tekli komut yok", not tekli)

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
