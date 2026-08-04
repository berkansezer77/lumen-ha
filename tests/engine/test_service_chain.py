# -*- coding: utf-8 -*-
"""Servislerin gonderdigi ile motorun anladigi ayni sey olmali.

`lock_room` servisi motorun tanimadigi bir eylem gonderiyordu ("lock", oysa
motor "room_lock" bekliyor): servis basarili gorunuyor, oda kilitlenmiyordu.
Testler yalnizca motoru cagirdigi icin bu bir surum boyunca fark edilmedi.

Ikinci is: komutu veren kullanicinin kimligi, YEDI SANIYE SONRAKI tekrarda
da tasinmali. Tasinmazsa, ilk komutu yetkisizlikten reddedilen biri ikinci
komutla gecer.
"""
import os as _os
import io
import re
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

# ── 1) sozlesme: gonderilen her eylemi motor tanimali ──────────────────
init_src = io.open(Z + "/lumen_ha/__init__.py", encoding="utf-8").read()
eng_src = io.open(Z + "/lumen_ha/engine.py", encoding="utf-8").read()

bas = init_src.index("def _register_services")
son = init_src.index("async def async_unload_entry", bas)
gonderilen = set(re.findall(r'"action":\s*"(\w+)"', init_src[bas:son]))
# Motor eylemleri iki bicimde taniyor: `action == "x"` ve `action in ("x","y")`.
taninan = set(re.findall(r'action == "(\w+)"', eng_src))
for grup in re.findall(r'action in \(([^)]*)\)', eng_src):
    taninan.update(re.findall(r'"(\w+)"', grup))

print("1) SERVISLERIN GONDERDIGI EYLEMLER MOTORDA VAR MI")
print("   gonderilen:", sorted(gonderilen))
eksik = sorted(gonderilen - taninan)
print("   motorda olmayan:", eksik or "yok")
if eksik:
    sorun.append("servis motorun tanimadigi eylem gonderiyor: " + ", ".join(eksik))

print("2) SERVIS MOTORUN CEVABINI DENETLIYOR MU")
# Cevaba bakilmazsa "yaptim" der, hicbir sey yapmaz.
denetim = init_src[bas:son].count("_sonucu_denetle")
print("   denetim cagrisi:", denetim)
if denetim < 2:
    sorun.append("servisler motorun cevabini denetlemiyor (%d)" % denetim)

# ── 2) davranis: room_lock gercekten kilitliyor mu ─────────────────────
SENS, LIGHT = "binary_sensor.p", "light.a"


class St:
    def __init__(self, eid, state, ago=0.0):
        self.entity_id = eid; self.state = state; self.attributes = {}
        self.last_changed = dt.datetime.now(UTC) - dt.timedelta(seconds=ago)


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, s, ago=0.0): self.d[e] = St(e, s, ago)


class Services:
    """Isik komuta UYMAZ: dogrulama tekrari boylece devreye girer."""
    def __init__(self): self.calls = []
    def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append((svc, tuple(data.get("entity_id") or []), context))


class Hass:
    def __init__(self): self.states = States(); self.services = Services(); self.data = {}
    def async_create_task(self, c):
        try: c.close()
        except Exception: pass


HASS = Hass()
gecikmeli = []


def _sonra(hass, gecikme, cb):
    gecikmeli.append((gecikme, cb))
    return lambda: None


_m.async_call_later = _sonra
_m.async_track_state_change_event = lambda *a, **k: (lambda: None)
_m.async_track_time_interval = lambda *a, **k: (lambda: None)


class Store:
    def __init__(self, d): self.data = d
    async def async_load(self): return self.data
    async def async_save(self, d): self.data = d


CFG = {"enabled": True, "mode": "normal",
       "rooms": {"oda": {"on": True, "trigger": [SENS], "hold": [],
                         "lights": [LIGHT], "slots": {}}}}
HASS.states.set(SENS, "off", 600)
HASS.states.set(LIGHT, "off", 600)
eng = LumenEngine(HASS, Store({"config": CFG}))
eng.config = CFG


def calistir(coro):
    try:
        coro.send(None)
    except StopIteration as bitti:
        return bitti.value
    raise AssertionError("beklenmedik askiya alma")


print("3) SURELI KILIT KALKTI MI")
# 1.0.2'de kaldirildi: "su kadar dakika kapali kalsin" hatirlamayi
# gerektiriyordu, yerini "su cihaz su durumdayken acma" aldi.
for iz, nerede, kaynak in (("room_lock", "motor", eng_src),
                           ("locked_until", "motor", eng_src),
                           ("lock_room", "servisler", init_src)):
    if iz in kaynak:
        sorun.append("kilitten kalinti: %s (%s)" % (iz, nerede))
print("   kalinti:", "yok" if not sorun else sorun)

print("4) Tanimadigi eylem 'ok' DEMEMELI")
sonuc = calistir(eng.async_action({"action": "lock", "room": "oda", "hours": 3}))
print("   cevap:", sonuc)
if (sonuc or {}).get("ok"):
    sorun.append("motor bilinmeyen eylemi kabul etti")

# ── yetki: komuttan ONCE sorulmali ─────────────────────────────────────
print("5) YETKISIZ KULLANICI MOTORUN IC DURUMUNU DEGISTIREMEMELI")


class Izin:
    def __init__(self, izinli): self.izinli = izinli
    def check_entity(self, eid, policy): return self.izinli


class Kullanici:
    def __init__(self, izinli, admin=False):
        self.is_admin = admin
        self.permissions = Izin(izinli)


class Auth:
    def __init__(self): self.user = None
    async def async_get_user(self, uid): return self.user


HASS.auth = Auth()
HASS.auth.user = Kullanici(izinli=False)
HASS.services.calls.clear()
rts = eng._state("oda")
rts["on_by_us"] = False
rts["paused_until"] = 12345.0

sonuc = calistir(eng.async_action(
    {"action": "room_on", "room": "oda"}, user_id="yabanci"))
print("   cevap:", sonuc)
print("   komut gitti mi:", bool(HASS.services.calls))
print("   on_by_us:", rts.get("on_by_us"), "| paused_until:", rts.get("paused_until"))
if (sonuc or {}).get("ok"):
    sorun.append("yetkisiz istek kabul edildi")
if HASS.services.calls:
    sorun.append("yetkisiz istekte isik komutu gonderildi")
if rts.get("on_by_us"):
    sorun.append("yetkisiz istek on_by_us'u degistirdi")
if rts.get("paused_until") != 12345.0:
    sorun.append("yetkisiz istek paused_until'i sifirladi")

print("6) YETKILI KULLANICI GECER")
HASS.auth.user = Kullanici(izinli=True)
HASS.services.calls.clear()
sonuc = calistir(eng.async_action(
    {"action": "room_on", "room": "oda"}, user_id="komsu"))
print("   cevap:", sonuc, "| komut:", len(HASS.services.calls))
if not (sonuc or {}).get("ok"):
    sorun.append("yetkili kullanici geri cevrildi: %s" % sonuc)
if not HASS.services.calls:
    sorun.append("yetkili kullanicida komut gitmedi")

print("7) YONETICI HER ZAMAN GECER")
HASS.auth.user = Kullanici(izinli=False, admin=True)
HASS.services.calls.clear()
sonuc = calistir(eng.async_action(
    {"action": "room_on", "room": "oda"}, user_id="yonetici"))
print("   cevap:", sonuc)
if not (sonuc or {}).get("ok"):
    sorun.append("yonetici geri cevrildi")

print("8) KULLANICI YOKSA (sensor/otomasyon) SORULMAZ")
HASS.auth.user = None
HASS.services.calls.clear()
sonuc = calistir(eng.async_action({"action": "room_on", "room": "oda"}))
print("   cevap:", sonuc, "| komut:", len(HASS.services.calls))
if not (sonuc or {}).get("ok"):
    sorun.append("kimliksiz cagri engellendi (otomasyonlar kirilir)")

# ── yedi saniyelik tekrar kimligi tasiyor mu ───────────────────────────
print("5) YEDI SANIYELIK TEKRAR KOMUTU VEREN KULLANICIYI TASIYOR MU")
eng._state("oda")["locked_until"] = 0.0
HASS.services.calls.clear()
gecikmeli.clear()
eng._as_user = "kullanici-123"
eng._switch_on("oda", {"how": "last", "lights": [LIGHT]})
eng._as_user = None
ilk = HASS.services.calls[-1] if HASS.services.calls else None
print("   ilk komut user_id:", getattr(ilk[2], "user_id", None) if ilk else "YOK")
if not ilk or getattr(ilk[2], "user_id", None) != "kullanici-123":
    sorun.append("ilk komutta kimlik yok")

dogrula = [cb for gec, cb in gecikmeli if gec == 7.0]
print("   dogrulama zamanlayicisi:", "var" if dogrula else "YOK")
if not dogrula:
    sorun.append("dogrulama tekrari kurulmadi")
else:
    HASS.services.calls.clear()
    dogrula[-1](None) if dogrula[-1].__code__.co_argcount else dogrula[-1]()
    tekrar = HASS.services.calls[-1] if HASS.services.calls else None
    kim = getattr(tekrar[2], "user_id", None) if tekrar else "KOMUT YOK"
    print("   tekrar komutu user_id:", kim)
    if kim != "kullanici-123":
        sorun.append("tekrar komutu kimligi kaybetti: %r "
                     "(yetkisiz kullanici ikinci komutla gecer)" % kim)
    if eng._as_user is not None:
        sorun.append("tekrar sonrasi kimlik temizlenmedi")

print()
if sorun:
    print("SORUN:")
    for x in sorun:
        print("   x", x)
    sys.exit(1)
print("TEMIZ")
