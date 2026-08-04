# -*- coding: utf-8 -*-
"""Entegrasyon kaldirilinca motor gercekten susmali.

Susmazsa: kaldirilmis bir kurulum isiklari yonetmeye devam eder ve yeniden
kurunca iki motor ayni lambaya komut verir. Bir de kimlik: servis cagrisinda
komutu veren kullanici tasinmali, ama motorun "bu komutu ben verdim"
tanimasi bozulmamali.
"""
import io
import sys
import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
import types
import datetime as dt

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_sweep.py'), encoding='utf-8').read()
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

SENS = "binary_sensor.p"
LIGHT = "light.a"


class St:
    def __init__(self, eid, state, ago=0.0, attrs=None):
        self.entity_id = eid; self.state = state; self.attributes = attrs or {}
        self.last_changed = dt.datetime.now(UTC) - dt.timedelta(seconds=ago)


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, st, ago=0.0): self.d[e] = St(e, st, ago)


class Services:
    def __init__(self): self.calls = []
    def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append((svc, tuple(data.get("entity_id") or []), context))
        for e in data.get("entity_id") or []:
            HASS.states.d[e] = St(e, "on" if svc == "turn_on" else "off")


class Hass:
    def __init__(self):
        self.states = States(); self.services = Services(); self.data = {}
    def async_create_task(self, c):
        try: c.close()
        except Exception: pass


HASS = Hass()

# Kurulan her dinleyici ve zamanlayici sayilir; iptal edilince dusmeli.
canli = {"dinleyici": 0, "zamanlayici": 0, "sayac": 0}


def _bir_dinleyici(hass, ents, cb):
    canli["dinleyici"] += 1
    def iptal():
        canli["dinleyici"] -= 1
    return iptal


def _bir_zamanlayici(hass, cb, aralik):
    canli["zamanlayici"] += 1
    def iptal():
        canli["zamanlayici"] -= 1
    return iptal


def _bir_sayac(hass, gecikme, cb):
    canli["sayac"] += 1
    def iptal():
        canli["sayac"] -= 1
    return iptal


_m.async_track_state_change_event = _bir_dinleyici
_m.async_track_time_interval = _bir_zamanlayici
_m.async_call_later = _bir_sayac


class Store:
    def __init__(self, data): self.data = data
    async def async_load(self): return self.data
    async def async_save(self, d): self.data = d


CFG = {
    "enabled": True, "mode": "normal",
    "rooms": {"oda": {"on": True, "trigger": [SENS], "hold": [], "lights": [LIGHT],
                      "slots": {}}},
}

HASS.states.set(SENS, "off", 600)
HASS.states.set(LIGHT, "off", 600)

eng = LumenEngine(HASS, Store({"config": CFG}))
eng.config = CFG
eng.setup()

print("1) Kurulunca dinleyici ve dongu ayakta")
print("   dinleyici:", canli["dinleyici"], "· zamanlayici:", canli["zamanlayici"])
if canli["dinleyici"] < 1: sorun.append("dinleyici kurulmadi")
if canli["zamanlayici"] < 2: sorun.append("dongu ya da karanlik kontrolu kurulmadi")

print("2) Bekleyen bir sayac birakalim")
eng._later("oda", "off", 300, lambda: None)
print("   sayac:", canli["sayac"])
if canli["sayac"] != 1: sorun.append("sayac kurulmadi")

print("3) shutdown() hepsini birakmali")
if not hasattr(eng, "shutdown"):
    sorun.append("shutdown yok — kaldirilan entegrasyon calismaya devam eder")
else:
    eng.shutdown()
    print("   dinleyici:", canli["dinleyici"], "· zamanlayici:", canli["zamanlayici"],
          "· sayac:", canli["sayac"])
    if canli["dinleyici"] or canli["zamanlayici"] or canli["sayac"]:
        sorun.append("shutdown sonrasi hala canli is var")

print("4) shutdown iki kez cagrilirsa comez")
try:
    eng.shutdown()
except Exception as err:
    sorun.append("ikinci shutdown patladi: %s" % err)

print("5) Yeniden setup() calisabilmeli (yeniden yukleme)")
eng.setup()
print("   dinleyici:", canli["dinleyici"], "· zamanlayici:", canli["zamanlayici"])
if canli["dinleyici"] < 1 or canli["zamanlayici"] < 2:
    sorun.append("shutdown sonrasi setup toparlamadi")
eng.shutdown()

print("6) KIMLIK: servis cagrisi kullaniciyi tasir, eko tanimasi bozulmaz")
eng.setup()
HASS.services.calls.clear()
eng._as_user = "kullanici-123"
eng._call("turn_on", [LIGHT], {})
eng._as_user = None
if not HASS.services.calls:
    sorun.append("komut hic gitmedi")
else:
    svc, ents, ctx = HASS.services.calls[-1]
    print("   komut:", svc, ents, "· user_id:", getattr(ctx, "user_id", None))
    if getattr(ctx, "user_id", None) != "kullanici-123":
        sorun.append("kullanici kimligi tasinmadi")
    # motorun kendi isareti: ctx.id bizim listemizde olmali
    if getattr(ctx, "id", None) not in eng._ctx:
        sorun.append("motor kendi komutunu taniyamaz (eko bozuldu)")

print("7) Kimliksiz (sensorden gelen) komut da calisir")
HASS.services.calls.clear()
eng._call("turn_off", [LIGHT], {})
svc, ents, ctx = HASS.services.calls[-1]
print("   komut:", svc, ents, "· user_id:", getattr(ctx, "user_id", None))
if getattr(ctx, "user_id", None) is not None:
    sorun.append("sensor komutuna kullanici yapisti")
if getattr(ctx, "id", None) not in eng._ctx:
    sorun.append("kimliksiz komutta eko bozuldu")
eng.shutdown()

print()
if sorun:
    print("SORUN:")
    for x in sorun:
        print("   x", x)
    sys.exit(1)
print("TEMIZ")
