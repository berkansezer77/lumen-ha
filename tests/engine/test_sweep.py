# Proves the periodic sweep: a room that empties while LUMEN is not listening
# must still go dark. Home Assistant is stubbed — only LUMEN's own logic runs.
import sys, types, time, json, io
import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")

sys.path.insert(0, Z)


def mod(name, **attrs):
    m = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(m, k, v)
    sys.modules[name] = m
    return m


class _Reg:
    def __init__(self): self.areas = {}; self.entities = {}; self.devices = {}
    def async_get(self, *a, **k): return None
    def async_get_area(self, *a, **k): return None
    def async_list_areas(self): return []


def _passthrough(*a, **k): return _Reg()


mod("homeassistant")
mod("homeassistant.const", SUN_EVENT_SUNRISE="sunrise", SUN_EVENT_SUNSET="sunset")


_SAYAC = [0]


def id_sayaci():
    _SAYAC[0] += 1
    return _SAYAC[0]


class Context:
    """HA'nin Context'i gibi: kimlik alanlarini gercekten saklar.

    Eskiden hepsini yutuyordu; o yuzden "komutu veren kullanici tasiniyor mu"
    sorusunu soran bir test yanlislikla gecerdi."""
    def __init__(self, user_id=None, parent_id=None, id=None):
        self.user_id = user_id
        self.parent_id = parent_id
        self.id = id or "ctx%d" % id_sayaci()


def callback(f): return f


mod("homeassistant.core", Context=Context, HomeAssistant=object, callback=callback)
mod("homeassistant.helpers")
mod("homeassistant.helpers.area_registry", async_get=_passthrough)
mod("homeassistant.helpers.device_registry", async_get=_passthrough,
    DeviceEntryType=types.SimpleNamespace(SERVICE="service"))
mod("homeassistant.helpers.entity_registry", async_get=_passthrough)
mod("homeassistant.helpers.dispatcher", async_dispatcher_send=lambda *a, **k: None)

TIMERS = []            # (fire_at, func, cancelled_flag)


def async_call_later(hass, delay, func):
    box = [time.time() + float(delay), func, False]
    TIMERS.append(box)

    def cancel():
        box[2] = True
    return cancel


def async_track_state_change_event(*a, **k): return lambda: None
def async_track_time_interval(*a, **k): return lambda: None


mod("homeassistant.helpers.event",
    async_call_later=async_call_later,
    async_track_state_change_event=async_track_state_change_event,
    async_track_time_interval=async_track_time_interval)


class Store:
    def __init__(self, *a, **k): pass
    async def async_load(self): return None
    async def async_save(self, *a): return None
    def async_delay_save(self, *a, **k): return None


mod("homeassistant.helpers.storage", Store=Store)
mod("homeassistant.helpers.sun", get_astral_event_date=lambda *a, **k: None)
import datetime as _dt
mod("homeassistant.util")
mod("homeassistant.util.dt", now=lambda: _dt.datetime.now(),
    as_local=lambda d: d, utcnow=lambda: _dt.datetime.now(_dt.timezone.utc),
    DEFAULT_TIME_ZONE=None)

import importlib.util                                     # noqa: E402

# hand-build the package so lumen/__init__.py (voluptuous, HA config flow) never
# runs: we only want the engine.
_pkg = types.ModuleType("lumen_ha")
_pkg.__path__ = [Z + "/lumen_ha"]
sys.modules["lumen_ha"] = _pkg
_spec = importlib.util.spec_from_file_location("lumen_ha.engine", Z + "/lumen_ha/engine.py")
_eng_mod = importlib.util.module_from_spec(_spec)
sys.modules["lumen_ha.engine"] = _eng_mod
_spec.loader.exec_module(_eng_mod)
LumenEngine, BOOT_GRACE = _eng_mod.LumenEngine, _eng_mod.BOOT_GRACE


class St:
    def __init__(self, eid, state, attrs=None):
        self.entity_id = eid; self.state = state; self.attributes = attrs or {}


class States:
    def __init__(self): self.d = {}
    def get(self, eid): return self.d.get(eid)
    def set(self, eid, state, attrs=None): self.d[eid] = St(eid, state, attrs)


class Services:
    def __init__(self): self.calls = []
    def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append((dom, svc, data))
        for eid in (data.get("entity_id") or []):
            HASS.states.set(eid, "on" if svc == "turn_on" else "off")
        return None


class Hass:
    def __init__(self):
        self.states = States(); self.services = Services(); self.data = {}
    def async_create_task(self, coro):
        coro.close() if hasattr(coro, "close") else None


HASS = Hass()


def build(off_after=0, sensors=("binary_sensor.p",), lights=("light.a",)):
    global TIMERS
    TIMERS = []
    HASS.services.calls = []
    eng = LumenEngine(HASS, Store())
    eng.config["rooms"] = {"ofis": {
        "trigger": list(sensors), "hold": list(sensors), "lights": list(lights),
        "lux": "", "dim_warn": 0,
        # every slot, not just "night" — which slot is current depends on the
        # clock, and a test must not pass only in the small hours
        "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                      "off_after": off_after, "mode": "last", "dim_warn": 0}
                  for k in ("morning", "day", "evening", "night")},
    }}
    eng._boot_at = time.time() - BOOT_GRACE - 5
    eng._slot_now = eng.slot_now()
    for e in sensors:
        HASS.states.set(e, "on")
    for e in lights:
        HASS.states.set(e, "on", {"brightness": 200})
    st = eng._state("ofis")
    st["on_by_us"] = True
    # the fixture is "LUMEN lit this room while somebody was in it"; switching
    # off only answers a departure, so the visit has to have happened
    st["seen"] = True
    return eng


def fire_due():
    now = time.time()
    for box in list(TIMERS):
        if not box[2] and box[0] <= now + 1.0:
            box[2] = True
            box[1](None)


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond:
        ok = False


print("1) sensor 'off' olayi kacirildi -> supurge yakalamali (off_after=0)")
eng = build(off_after=0)
HASS.states.set("binary_sensor.p", "off")        # nobody told the engine
eng._tick(None)
fire_due()
check("isik sonduruldu", HASS.states.get("light.a").state == "off",
      str(HASS.services.calls))

print("2) oda dolu -> supurge dokunmamali")
eng = build(off_after=0)
eng._tick(None)
fire_due()
check("isik yaniyor", HASS.states.get("light.a").state == "on")

print("3) sensor cevrimdisi -> supurge dokunmamali")
eng = build(off_after=0)
HASS.states.set("binary_sensor.p", "unavailable")
eng._tick(None)
fire_due()
check("isik yaniyor", HASS.states.get("light.a").state == "on")

print("4) sensoru olmayan oda -> supurge dokunmamali")
eng = build(off_after=0, sensors=())
eng._tick(None)
fire_due()
check("isik yaniyor", HASS.states.get("light.a").state == "on")

print("5) geri sayim varken supurge sayaci sifirlamamali (off_after=600)")
eng = build(off_after=600)
eng._state("ofis")["seen"] = True     # biri girdi; ayrilis supurgeyle yakalanacak
HASS.states.set("binary_sensor.p", "off")
eng._tick(None)
first = eng._state("ofis")["off_at"]
time.sleep(1.1)
eng._tick(None)          # a second sweep, one second later
second = eng._state("ofis")["off_at"]
check("sonme ani ayni kaldi", abs(second - first) < 0.01,
      "%.2f -> %.2f" % (first, second))
check("tek sayac var", sum(1 for b in TIMERS if not b[2]) == 1)

print("6) acilis payi icinde supurge susmali")
eng = build(off_after=0)
eng._boot_at = time.time()
HASS.states.set("binary_sensor.p", "off")
eng._tick(None)
fire_due()
check("isik yaniyor (acilis payi)", HASS.states.get("light.a").state == "on")

print("7) sondurme kapaliysa supurge dokunmamali")
eng = build(off_after=0)
for _rule in eng.config["rooms"]["ofis"]["slots"].values():
    _rule["off_enabled"] = False
HASS.states.set("binary_sensor.p", "off")
eng._tick(None)
fire_due()
check("isik yaniyor", HASS.states.get("light.a").state == "on")

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
