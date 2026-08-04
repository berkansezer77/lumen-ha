# -*- coding: utf-8 -*-
"""Suzgec, calisan bir kurulumun ayarina DOKUNMAMALI.

Bu testin bir numarali isi: gercek bir yapilandirmayi suzgecten gecirip
cikanin girenle BIREBIR ayni oldugunu gostermek. Geri kalani, bozuk ve sisirilmis
dosyalarin geri cevrildigini.
"""
import importlib.util
import io
import json
import sys
import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

Z = Z + "/lumen_ha/guard.py"
spec = importlib.util.spec_from_file_location("guard", Z)
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

sorun = []
CANLI = json.load(io.open(_FIX, encoding="utf-8"))["config_res"]["config"]

print("1) GERCEK AYAR: suzgecten birebir ayni cikmali")
temiz, notlar = g.clean(json.loads(json.dumps(CANLI)))
ayni = json.dumps(temiz, sort_keys=True) == json.dumps(CANLI, sort_keys=True)
print("   ayni mi:", ayni, "| duzeltme notu:", notlar or "yok")
if not ayni:
    sorun.append("gercek ayar degisti")
    a = json.dumps(CANLI, sort_keys=True, indent=1).splitlines()
    b = json.dumps(temiz, sort_keys=True, indent=1).splitlines()
    for x, y in zip(a, b):
        if x != y:
            print("   ONCE:", x.strip()[:90]); print("   SONRA:", y.strip()[:90]); break
if notlar:
    sorun.append("gercek ayarda kirpma oldu: %s" % notlar[:3])

print("2) Sacma sayilar kirpilir, kurulum yasar")
cfg = json.loads(json.dumps(CANLI))
oda = list(cfg["rooms"])[0]
dilim = list(cfg["rooms"][oda]["slots"])[0]
cfg["rooms"][oda]["slots"][dilim]["bri"] = 900
cfg["rooms"][oda]["slots"][dilim]["off_after"] = -5
cfg["rooms"][oda]["slots"][dilim]["kelvin"] = 99999
temiz, notlar = g.clean(cfg)
d = temiz["rooms"][oda]["slots"][dilim]
print("   bri:", d["bri"], "| off_after:", d["off_after"], "| kelvin:", d["kelvin"])
print("   notlar:", notlar)
if d["bri"] != 100 or d["off_after"] != 0 or d["kelvin"] != 10000:
    sorun.append("sayilar kirpilmadi")
if len(notlar) != 3:
    sorun.append("kirpmalar bildirilmedi")
# odalar ve isiklar yerinde mi
if len(temiz["rooms"]) != len(CANLI["rooms"]):
    sorun.append("kirpma odalari dusurdu")

print("3) Bozuk yapi geri cevrilir (sessizce duzeltilmez)")
for ad, bozuk in [
    ("nesne degil", ["a"]),
    ("rooms liste", {"rooms": ["a"]}),
    ("oda nesne degil", {"rooms": {"a": "salon"}}),
    ("tetik liste degil", {"rooms": {"a": {"trigger": "x"}}}),
    ("cok fazla oda", {"rooms": {str(i): {} for i in range(g.MAX_ROOMS + 1)}}),
    ("cok uzun liste", {"rooms": {"a": {"lights": ["l"] * (g.MAX_LIST + 1)}}}),
    ("cok fazla dilim", {"rooms": {"a": {"slots": {str(i): {} for i in range(g.MAX_SLOTS + 1)}}}}),
    ("bos oda kimligi", {"rooms": {"": {}}}),
]:
    try:
        g.clean(bozuk)
        print("   x", ad, "GECTI (gecmemeliydi)")
        sorun.append("bozuk yapi kabul edildi: " + ad)
    except g.ConfigRejected as err:
        print("   ", ad, "-> reddedildi:", str(err)[:60])

print("4) Devasa dosya iceri alinmaz")
try:
    g.clean({"rooms": {}}, raw_len=g.MAX_BYTES + 1)
    sorun.append("devasa dosya kabul edildi")
except g.ConfigRejected as err:
    print("   reddedildi:", str(err)[:60])

print("5) Uzun metin kirpilir, dosya yasar")
cfg = {"rooms": {"a": {"icon": "x" * (g.MAX_TEXT + 50)}}}
temiz, notlar = g.clean(cfg)
print("   uzunluk:", len(temiz["rooms"]["a"]["icon"]), "| not:", bool(notlar))
if len(temiz["rooms"]["a"]["icon"]) != g.MAX_TEXT:
    sorun.append("uzun metin kirpilmadi")

print("5b) DENETIMDE OLMAYAN ALANLAR (ikinci denetimin bulgusu)")
# NaN, sonsuz, milyarlik izgara ve sayi yerine metin: hepsi suzgecten
# gecerdi. Panelin cizim dongusu cols'a bakiyor; milyar = kilitli tarayici.
import json as _json
for ad, cfg, beklenen in [
    ("NaN", _json.loads('{"rooms":{},"energy":{"watt":NaN}}'), "watt"),
    ("sonsuz", _json.loads('{"rooms":{},"energy":{"price":Infinity}}'), "price"),
    ("izgara", {"rooms": {}, "layout": {"floors": [{"cols": 10**9, "rows_n": 10**9}]}}, "cols"),
    ("oda olcusu", {"rooms": {"a": {"x": 10**9, "y": -5, "w": 99999, "h": 0}}}, "x"),
    ("sayi yerine metin", {"rooms": {}, "mode_until": "bozuk"}, "mode_until"),
]:
    t, n = g.clean(_json.loads(_json.dumps(cfg)) if ad not in ("NaN", "sonsuz") else cfg)
    print("   %-18s -> %s" % (ad, n or "NOT YOK"))
    if not n:
        sorun.append(ad + " suzgecten notsuz gecti")
    elif not any(beklenen in x for x in n):
        sorun.append(ad + " yanlis alan bildirildi: %s" % n)

print("5c) Kat listesi bozuksa reddedilir")
for ad, cfg in [("layout nesne degil", {"rooms": {}, "layout": []}),
                ("floors liste degil", {"rooms": {}, "layout": {"floors": {}}}),
                ("kat nesne degil", {"rooms": {}, "layout": {"floors": ["x"]}}),
                ("cok fazla kat", {"rooms": {}, "layout": {"floors": [{}] * 50}})]:
    try:
        g.clean(cfg)
        sorun.append("bozuk layout kabul edildi: " + ad)
        print("   x", ad, "GECTI")
    except g.ConfigRejected as err:
        print("   ", ad, "-> reddedildi:", str(err)[:50])

print("6) Bilmedigi alanlara dokunmaz (ileride eklenecek her sey)")
cfg = {"rooms": {"a": {"yepyeni_alan": {"ic": [1, 2, 3]}}}, "gelecek": True}
temiz, _ = g.clean(cfg)
if temiz != cfg:
    sorun.append("bilinmeyen alan degistirildi")
print("   korundu:", temiz == cfg)

print()
if sorun:
    print("SORUN:")
    for x in sorun:
        print("   x", x)
    sys.exit(1)
print("TEMIZ")
