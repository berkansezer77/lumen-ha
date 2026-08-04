import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# Health report, lux learning and the usage tally, in the engine.
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
    def __init__(self, eid, state, ago=0.0, attrs=None):
        self.entity_id = eid; self.state = state
        self.attributes = attrs or {"friendly_name": eid.split(".")[-1]}
        self.last_changed = dt.datetime.now(UTC) - dt.timedelta(seconds=ago)


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, st, ago=0.0): self.d[e] = St(e, st, ago)


class Services:
    def __init__(self): self.calls = []
    async def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append((dom, svc, data))
    def async_services(self):
        return {"notify": {"mobile_app_berkan": None, "persistent_notification": None}}


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


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


def build():
    eng = LumenEngine(HASS, Store())
    eng.config["rooms"] = {
        "salon": {"trigger": ["binary_sensor.s"], "hold": [], "lights": ["light.a"],
                  "lux": "sensor.lux", "slots": {}},
        "banyo": {"trigger": ["binary_sensor.eski"], "hold": [], "lights": [],
                  "lux": "", "slots": {}},
        "koridor": {"trigger": [], "hold": [], "lights": ["light.yok"],
                    "lux": "", "slots": {}},
    }
    eng.config = _m._deep_default(eng.config)
    eng._boot_at = time.time() - BOOT_GRACE - 5
    HASS.states.set("binary_sensor.s", "on")
    HASS.states.set("light.a", "on")
    HASS.states.set("sensor.lux", "35")
    HASS.states.set("binary_sensor.eski", "off", ago=5 * 86400)   # 5 days quiet
    return eng


print("1) saglik raporu")
eng = build()
kinds = {}
for one in eng.health():
    kinds.setdefault(one["kind"], []).append(one["room"])
print("   bulunanlar:", {k: v for k, v in kinds.items()})
# The report is a fault list, not a review of somebody's choices: a room with
# no lights or no sensor is a decision and stays out of it.
check("isiksiz oda rapor edilmez", not kinds.get("no_lights"))
check("sensorsuz oda rapor edilmez", not kinds.get("no_sensor"))
check("HA'da olmayan isik yakalandi", "koridor" in kinds.get("missing", []))
check("5 gundur susan sensor yakalandi", "banyo" in kinds.get("stale", []))
eng.config["rooms"]["salon"]["slots"]["night"]["on"] = False
eng.config["rooms"]["salon"]["slots"]["night"]["lux_max"] = None
check("kapali dilim rapor edilmez",
      not any(x["kind"] == "dead_slot" for x in eng.health()))

print("2) bildirim")
import asyncio
eng.config["notify"] = {"service": "notify.mobile_app_berkan", "enabled": True,
                        "every_h": 24}
HASS.services.calls = []
res = asyncio.run(eng.async_health_notify(force=True))
print("   sonuc:", res)
check("servis cagrildi", len(HASS.services.calls) == 1, str(HASS.services.calls[:1])[:90])
if HASS.services.calls:
    dom, svc, data = HASS.services.calls[0]
    check("dogru servis", dom == "notify" and svc == "mobile_app_berkan")
    check("mesaj dolu", len(data.get("message") or "") > 10)
HASS.services.calls = []
res2 = asyncio.run(eng.async_health_notify())
check("cok erken tekrar gondermez", not HASS.services.calls, str(res2))

print("3) lux ogrenme kaldirildi mi")
eng = build()
check("_learn_lux yok", not hasattr(eng, "_learn_lux"))
check("learn deposu yok", not hasattr(eng, "learn"))
check("learn_summary yok", not hasattr(eng, "learn_summary"))
# and switching a light on by hand must still work without it
eng._state("salon")["acted_at"] = 0.0
HASS.states.set("sensor.lux", "35")
eng._light_event(Ev("light.a", St("light.a", "off"), St("light.a", "on")))
# Nothing is written down about who moved it, because nothing can be known.
check("kim actigi kaydedilmedi", "manual_dir" not in eng._state("salon"))
check("gunluge iddia yazilmadi",
      not any(e.get("action") == "manual" for e in eng.events),
      str([e.get("text") for e in eng.events][:3]))

print("3b) saglik sadece arizayi bildirir")
eng = build()
eng.config["rooms"]["koridor"] = {"on": True, "lights": [], "trigger": [], "hold": [],
                                  "lux": "", "slots": {}}
kinds = {i["kind"] for i in eng.health()}
print("   turler:", sorted(kinds) or "(bos)")
check("sensorsuz oda hata degil", "no_sensor" not in kinds)
check("isiksiz oda hata degil", "no_lights" not in kinds)
check("olu dilim hata degil", "dead_slot" not in kinds)
HASS.states.set("light.a", "unavailable")
kinds2 = {i["kind"] for i in eng.health()}
print("   cevrimdisi lamba sonrasi:", sorted(kinds2))
check("cevrimdisi cihaz bildirilir", "offline" in kinds2)

print("4) kullanim sayaci")
eng = build()
HASS.states.set("light.a", "on")
for _ in range(4):
    eng._account(30)
check("120 saniye birikti", eng.usage_summary(30)["rooms"]["salon"]["seconds"] == 120)
# two minutes of one bulb really is 0.00 kWh; give it a believable evening
eng._account(10 * 3600)
use = eng.usage_summary(30)
print("   salon:", use["rooms"].get("salon"))
check("kWh hesaplandi", use["rooms"]["salon"]["kwh"] > 0)
check("yanmayan oda listede yok", "koridor" not in use["rooms"])
eng.config["energy"] = {"price": 10.0, "watt": 100}
use2 = eng.usage_summary(30)
print("5) odada gecirilen zaman sensorlerden sayiliyor")
eng = build()
HASS.states.set("binary_sensor.s", "on")     # somebody is in the room
for _ in range(6):
    eng._account(30)
st = eng.usage_summary(30)["stayed"]
print("   kalinan:", st)
check("oda dolu sayildi", st.get("salon", {}).get("seconds") == 180, str(st))
HASS.states.set("binary_sensor.s", "off")    # they left
for _ in range(4):
    eng._account(30)
st2 = eng.usage_summary(30)["stayed"]
check("cikinca saymayi birakti", st2["salon"]["seconds"] == 180, str(st2))
check("yanma suresinden ayri",
      eng.usage_summary(30)["rooms"].get("salon", {}).get("seconds") != 180)

check("fiyat ve watt hesaba giriyor",
      use2["rooms"]["salon"]["cost"] > use["rooms"]["salon"]["cost"],
      "%.2f -> %.2f" % (use["rooms"]["salon"]["cost"], use2["rooms"]["salon"]["cost"]))

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
