import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# Kapanma uyarısı: kutudan kapalı, kısamayan cihaza hiç gönderilmez.
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
DIMMER = {"supported_color_modes": ["color_temp"], "brightness": 200}
ONOFF = {"supported_color_modes": ["onoff"]}


class St:
    def __init__(self, eid, state, ago=0.0, attrs=None):
        self.entity_id = eid; self.state = state; self.attributes = dict(attrs or {})
        self.last_changed = dt.datetime.now(UTC) - dt.timedelta(seconds=ago)


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, st, ago=0.0, attrs=None): self.d[e] = St(e, st, ago, attrs)


class Services:
    def __init__(self): self.calls = []
    def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append((svc, tuple(data.get("entity_id") or []), data.get("brightness_pct")))
        for e in (data.get("entity_id") or []):
            old = HASS.states.d.get(e)
            attrs = dict(old.attributes if old else {})
            HASS.states.d[e] = St(e, "on" if svc == "turn_on" else "off", attrs=attrs)


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


def build(lights):
    TIMERS.clear()
    HASS.services.calls = []
    eng = LumenEngine(HASS, Store())
    eng.config["rooms"] = {"oda": {
        "trigger": [SENS], "hold": [SENS], "lights": list(lights), "lux": "",
        "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                      "off_after": 30, "mode": "set", "bri": 60, "kelvin": 3000,
                      "dim_warn": 10, "delay_on": 0}
                  for k in ("morning", "day", "evening", "night")},
    }}
    eng._boot_at = time.time() - BOOT_GRACE - 5
    HASS.states.set(SENS, "off")
    for e, attrs in lights.items():
        HASS.states.set(e, "on", attrs=attrs)
    st = eng._state("oda")
    st["on_by_us"] = True
    st["seen"] = True
    return eng


def fire(kind=None):
    now = time.time()
    for box in list(TIMERS):
        if not box[2] and box[0] <= now + 40:
            box[2] = True
            box[1](None)


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


print("1) paket varsayilani: kapanma uyarisi KAPALI")
src = io.open(Z + "/lumen_ha/const.py", encoding="utf-8").read()
check("const'ta 20 kalmadi", '"dim_warn": 20' not in src)
check("hepsi 0", src.count('"dim_warn": 0') == 5, str(src.count('"dim_warn": 0')))

print("2) yalniz anahtar olan oda: kisma komutu YOK, sure ayni")
eng = build({"switch.a": ONOFF, "switch.b": ONOFF})
eng._maybe_clear("oda")                      # bos oda, geri sayim kurulur
fire()                                       # dim ani
kismalar = [c for c in HASS.services.calls if c[0] == "turn_on"]
check("kisma komutu gitmedi", not kismalar, str(HASS.services.calls))
fire()                                       # sonme ani
check("yine de sondu", HASS.states.get("switch.a").state == "off",
      str(HASS.services.calls))

print("3) kisilabilen ampul: uyari calisir")
eng = build({"light.a": DIMMER})
eng._maybe_clear("oda")
fire()
kisma = [c for c in HASS.services.calls if c[0] == "turn_on" and c[2]]
check("kisildi", bool(kisma), str(HASS.services.calls))
check("gunluge yazildi", any(e.get("action") == "dim" for e in eng.events))
fire()
check("sonra sondu", HASS.states.get("light.a").state == "off")

print("4) karisik oda: ampul kisilir, anahtar beklerken dokunulmaz")
eng = build({"light.a": DIMMER, "switch.b": ONOFF})
eng._maybe_clear("oda")
fire()
hedefler = [c[1] for c in HASS.services.calls if c[0] == "turn_on"]
duz = [t for t in hedefler if "switch.b" in t]
check("kisma yalniz ampule", hedefler and all("light.a" in t for t in hedefler), str(hedefler))
check("anahtara kisma gitmedi", not duz, str(duz))
fire()
check("ikisi de sondu", HASS.states.get("switch.b").state == "off"
      and HASS.states.get("light.a").state == "off")

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
