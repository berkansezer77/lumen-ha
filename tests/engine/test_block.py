# -*- coding: utf-8 -*-
"""Sunlar varken acma: kosullu engel.

Sureli kilidin ("su kadar dakika kapali kalsin") yerini aldi. Fark: kilit
hatirlamayi gerektiriyordu, bu ise evin kendi haline bakiyor.

Kural: yalnizca ACMAYI engeller. Yanan bir isigi sondurmez, geri sayimi
durdurmaz.
"""
import os as _os
import io
import sys
import types
import datetime as dt

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),
                                   'test_sweep.py'), encoding='utf-8').read()
             .split('import importlib.util')[0], 'stub', 'exec'), globals())
import importlib.util

_pkg = types.ModuleType("lumen_ha"); _pkg.__path__ = [Z + "/lumen_ha"]
sys.modules["lumen_ha"] = _pkg
_spec = importlib.util.spec_from_file_location("lumen_ha.engine", Z + "/lumen_ha/engine.py")
_m = importlib.util.module_from_spec(_spec); sys.modules["lumen_ha.engine"] = _m
_spec.loader.exec_module(_m)
LumenEngine = _m.LumenEngine
UTC = dt.timezone.utc
sorun = []

SENS, LIGHT, TV = "binary_sensor.p", "light.a", "media_player.tv"


class St:
    def __init__(self, eid, state, ago=0.0, attrs=None):
        self.entity_id = eid; self.state = state
        self.attributes = attrs or {"friendly_name": eid.split(".")[1].title()}
        self.last_changed = dt.datetime.now(UTC) - dt.timedelta(seconds=ago)


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, s, ago=0.0): self.d[e] = St(e, s, ago)


class Services:
    def __init__(self): self.calls = []
    def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append((svc, tuple(data.get("entity_id") or [])))
        for e in data.get("entity_id") or []:
            HASS.states.d[e] = St(e, "on" if svc == "turn_on" else "off")


class Hass:
    def __init__(self): self.states = States(); self.services = Services(); self.data = {}
    def async_create_task(self, c):
        try: c.close()
        except Exception: pass


HASS = Hass()
_m.async_call_later = lambda h, g, cb: (lambda: None)
_m.async_track_state_change_event = lambda *a, **k: (lambda: None)
_m.async_track_time_interval = lambda *a, **k: (lambda: None)


class Store:
    def __init__(self, d): self.data = d
    async def async_load(self): return self.data
    async def async_save(self, d): self.data = d


CFG = {"enabled": True, "mode": "normal",
       "rooms": {"salon": {"on": True, "trigger": [SENS], "hold": [],
                           "lights": [LIGHT], "slots": {}}}}
HASS.states.set(SENS, "on", 0)
HASS.states.set(LIGHT, "off", 600)
HASS.states.set(TV, "off", 600)
eng = LumenEngine(HASS, Store({"config": CFG}))
eng.config = CFG


def kural():
    """Motorun OKUDUGU kural.

    `slot_rule` birlestirilmis bir KOPYA donduruyor; ona yazmak motora
    ulasmiyordu. Ayari yapilandirmanin kendisine koymak gerekiyor.
    """
    dilim = eng.slot_now()
    oda = CFG["rooms"]["salon"]
    return oda.setdefault("slots", {}).setdefault(dilim, {})


print("1) Kosul yokken oda acilabilir")
kural()["block"] = []
karar = eng.decide("salon")
print("   acilir mi:", karar["on"], "|", karar["reason"][:60])
if not karar["on"]:
    sorun.append("kosulsuz oda acilmadi: " + karar["reason"])

print("2) TV acikken oda ACILMAZ ve sebebi yazilir")
kural()["block"] = [{"entity": TV, "state": "playing"}]
HASS.states.set(TV, "playing", 0)
karar = eng.decide("salon")
print("   acilir mi:", karar["on"], "| sebep:", karar["reason"])
if karar["on"]:
    sorun.append("TV acikken oda acildi")
if "Tv" not in karar["reason"] and TV not in karar["reason"]:
    sorun.append("sebep hangi cihaz oldugunu soylemiyor: " + karar["reason"])

print("3) TV kapaninca oda yine acilir")
HASS.states.set(TV, "off", 0)
karar = eng.decide("salon")
print("   acilir mi:", karar["on"])
if not karar["on"]:
    sorun.append("kosul gecince oda hala kapali: " + karar["reason"])

print("4) Durum buyuk/kucuk harf farki takilmasin")
HASS.states.set(TV, "PLAYING", 0)
if eng.decide("salon")["on"]:
    sorun.append("buyuk harfli durum eslesmedi")
print("   PLAYING de engelliyor: evet")

print("5) Olmayan entity ya da bos alan sessizce yok sayilir")
HASS.states.set(TV, "off", 0)
kural()["block"] = [{"entity": "light.hic_yok", "state": "on"},
                    {"entity": "", "state": "on"},
                    {"entity": TV, "state": ""}]
karar = eng.decide("salon")
print("   acilir mi:", karar["on"])
if not karar["on"]:
    sorun.append("gecersiz kosul odayi kilitledi: " + karar["reason"])

print("6) Engel YANAN isigi sondurmez (yalniz acmayi engeller)")
kural()["block"] = [{"entity": TV, "state": "playing"}]
HASS.states.set(TV, "playing", 0)
HASS.states.set(LIGHT, "on", 5)
HASS.services.calls.clear()
eng._state("salon")["seen"] = True
eng._maybe_clear("salon")
sonduren = [c for c in HASS.services.calls if c[0] == "turn_off"]
print("   sondurme komutu:", sonduren or "yok")
# Oda hala dolu (sensor on), yani sonmemeli; engel bunu degistirmemeli.
if sonduren:
    sorun.append("engel yanan isigi sondurdu")

print("7) Sureli kilit gercekten kalkti mi")
kalinti = []
kaynak = io.open(Z + "/lumen_ha/engine.py", encoding="utf-8").read()
for iz in ("locked_until", "room_lock"):
    if iz in kaynak:
        kalinti.append(iz)
kaynak_init = io.open(Z + "/lumen_ha/__init__.py", encoding="utf-8").read()
if "lock_room" in kaynak_init:
    kalinti.append("lock_room servisi")
print("   kalinti:", kalinti or "yok")
if kalinti:
    sorun.append("kilitten kalinti var: " + ", ".join(kalinti))

print()
if sorun:
    print("SORUN:")
    for x in sorun:
        print("   x", x)
    sys.exit(1)
print("TEMIZ")
