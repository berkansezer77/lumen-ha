# -*- coding: utf-8 -*-
"""Bir oda BIR KEZ degil, HER BOSALDIGINDA sonmeli.

"Bir kez teklif" kurali su demekti: oda bosaldiginda LUMEN isigi bir kez
sondurur; baska bir sey geri acarsa gureş etmez, bildirir. Bayrak o BOS
KALMAYA aitti — ama bir daha hic temizlenmiyordu.

Tek sensorlu odalarda (tetik ve tutucu ayni entity) sonuc: LUMEN o odayi
omru boyunca yalnizca BIR kez sonduruyor, sonra her seferinde "oda bos ama
isik yaniyor" diye uyariyor. Berkan'in ofisinde gece boyunca olan buydu.
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
LumenEngine, BOOT_GRACE = _m.LumenEngine, _m.BOOT_GRACE
UTC = dt.timezone.utc
sorun = []

SENS, LIGHT = "binary_sensor.ofis_presence", "light.ofis"


class St:
    def __init__(self, eid, state, ago=0.0):
        self.entity_id = eid; self.state = state
        self.attributes = {"friendly_name": eid.split(".")[1].title()}
        self.last_changed = dt.datetime.now(UTC) - dt.timedelta(seconds=ago)


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, s, ago=0.0): self.d[e] = St(e, s, ago)


class Services:
    def __init__(self): self.calls = []
    def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append(svc)
        for e in data.get("entity_id") or []:
            HASS.states.d[e] = St(e, "on" if svc == "turn_on" else "off")


class Hass:
    def __init__(self): self.states = States(); self.services = Services(); self.data = {}
    def async_create_task(self, c):
        try: c.close()
        except Exception: pass


HASS = Hass()
bekleyen = []


def _sonra(hass, gecikme, cb):
    bekleyen.append(cb)
    return lambda: None


_m.async_call_later = _sonra
_m.async_track_state_change_event = lambda *a, **k: (lambda: None)
_m.async_track_time_interval = lambda *a, **k: (lambda: None)


class Store:
    def __init__(self, d): self.data = d
    async def async_load(self): return self.data
    async def async_save(self, d): self.data = d


# Berkan'in ofisi: tetik ve tutucu AYNI entity, sonme gecikmesi 0.
CFG = {"enabled": True, "mode": "normal",
       "rooms": {"ofis": {"on": True, "trigger": [SENS], "hold": [SENS],
                          "lights": [LIGHT], "slots": {}}}}
HASS.states.set(SENS, "off", 600)
HASS.states.set(LIGHT, "off", 600)
eng = LumenEngine(HASS, Store({"config": CFG}))
eng.config = CFG
eng._boot_at = 0.0                      # acilis toleransini gec
dilim = eng.slot_now()
CFG["rooms"]["ofis"].setdefault("slots", {})[dilim] = {
    "on": True, "lux_max": 100000, "off_enabled": True, "off_after": 0,
    "dim_warn": 0, "mode": "last"}


def bekleyenleri_calistir():
    while bekleyen:
        cb = bekleyen.pop(0)
        try:
            cb(None)
        except TypeError:
            cb()


def gir():
    HASS.states.set(SENS, "on", 0)
    eng.trigger("ofis", "sensor")
    bekleyenleri_calistir()


def cik():
    HASS.states.set(SENS, "off", 0)
    eng._maybe_clear("ofis")
    bekleyenleri_calistir()


print("1) Odaya girildi, isik yandi")
gir()
print("   isik:", HASS.states.get(LIGHT).state, "| komutlar:", HASS.services.calls)
if HASS.states.get(LIGHT).state != "on":
    sorun.append("ilk girişte isik yanmadi")

print("2) Cikildi — sonmeli")
HASS.services.calls.clear()
cik()
print("   isik:", HASS.states.get(LIGHT).state, "| komutlar:", HASS.services.calls)
if HASS.states.get(LIGHT).state != "off":
    sorun.append("ilk cikista isik sonmedi")

print("3) TEKRAR girildi — isik yine yanmali")
HASS.services.calls.clear()
gir()
print("   isik:", HASS.states.get(LIGHT).state)
if HASS.states.get(LIGHT).state != "on":
    sorun.append("ikinci giriste isik yanmadi")

print("4) TEKRAR cikildi — ISIK YINE SONMELI  (asil sinav)")
HASS.services.calls.clear()
cik()
print("   isik:", HASS.states.get(LIGHT).state, "| komutlar:", HASS.services.calls)
if HASS.states.get(LIGHT).state != "off":
    sorun.append("IKINCI cikista isik sonmedi — 'bir kez teklif' bayragi "
                 "bir sonraki bos kalmaya tasindi")

print("5) Ucuncu tur da calismali")
HASS.services.calls.clear()
gir(); cik()
print("   isik:", HASS.states.get(LIGHT).state)
if HASS.states.get(LIGHT).state != "off":
    sorun.append("ucuncu turda sonmedi")

print("6) Kural korunuyor mu: LUMEN sondurdukten SONRA baskasi acarsa "
      "gures etmemeli")
HASS.services.calls.clear()
HASS.states.d[LIGHT] = St(LIGHT, "on", 1)     # disaridan acildi (bizim komut degil)
eng._maybe_clear("ofis")                       # oda hala bos
bekleyenleri_calistir()
print("   isik:", HASS.states.get(LIGHT).state, "| komutlar:", HASS.services.calls or "yok")
if HASS.services.calls:
    sorun.append("bos odada geri acilan isikla gures edildi (bir kez teklif bozuldu)")

print("7) YENIDEN BASLATMA: odada biri varken HA yeniden baslarsa,")
print("   cikista isik YINE sonmeli")
# Motorun calisma zamani hafizasi restart'ta sifirlaniyor: "burada biri
# goruldu" bilgisi de gidiyor. Oda o sirada doluysa, cikista LUMEN
# "bunu disaridan biri yakmis" deyip elini cekiyordu ve isik sabaha kadar
# yaniyordu. Berkan'in ofisinde gece boyunca olan buydu.
gir()                                   # odada biri var, isik yaniyor
yeni = LumenEngine(HASS, Store({"config": CFG}))   # <-- yeniden baslatma
yeni.config = CFG
yeni._boot_at = 0.0
yeni.setup()
print("   restart sonrasi seen:", yeni._state("ofis").get("seen"))
HASS.services.calls.clear()
HASS.states.set(SENS, "off", 0)
yeni._maybe_clear("ofis")
while bekleyen:
    cb = bekleyen.pop(0)
    try: cb(None)
    except TypeError: cb()
print("   isik:", HASS.states.get(LIGHT).state, "| komutlar:", HASS.services.calls or "yok")
if HASS.states.get(LIGHT).state != "off":
    sorun.append("YENIDEN BASLATMADAN sonra cikista isik sonmedi "
                 "(oda doluyken restart -> 'goruldu' kaybi)")

print()
if sorun:
    print("SORUN:")
    for x in sorun:
        print("   x", x)
    sys.exit(1)
print("TEMIZ")
