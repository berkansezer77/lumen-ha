# -*- coding: utf-8 -*-
"""Gorsel olcusu basliktan okunmali; emin olunamayan bicim reddedilmemeli.

Kucuk bir dosya acildiginda yuz megapiksel olabilir; onu cizmeye calisan
tablet diz coker. Ama tanimadigimiz bir bicimi de "buyuk olabilir" diye
geri cevirmek, calisan yuklemeleri kirmak demek.
"""
import importlib.util
import struct
import sys
import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
import zlib

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

spec = importlib.util.spec_from_file_location("guard", Z + "/lumen_ha/guard.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
sorun = []


def png(w, h):
    ihdr = struct.pack(">II", w, h) + b"\x08\x06\x00\x00\x00"
    parca = b"IHDR" + ihdr
    return (b"\x89PNG\r\n\x1a\n" + struct.pack(">I", len(ihdr)) + parca
            + struct.pack(">I", zlib.crc32(parca)))


def gif(w, h):
    return b"GIF89a" + struct.pack("<HH", w, h) + b"\x00" * 10


def jpeg(w, h):
    # SOI + APP0 + SOF0
    sof = b"\xff\xc0" + struct.pack(">H", 17) + b"\x08" + struct.pack(">HH", h, w)
    return b"\xff\xd8\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00" + b"\x00" * 9 + sof


def webp_vp8x(w, h):
    return (b"RIFF" + b"\x00" * 4 + b"WEBP" + b"VP8X" + b"\x00" * 8
            + (w - 1).to_bytes(3, "little") + (h - 1).to_bytes(3, "little"))


print("1) Olcu dogru okunuyor mu")
for ad, blob, bekle in [("PNG", png(1920, 1080), (1920, 1080)),
                        ("GIF", gif(640, 480), (640, 480)),
                        ("JPEG", jpeg(4032, 3024), (4032, 3024)),
                        ("WEBP", webp_vp8x(800, 600), (800, 600))]:
    olcu = g.image_size(blob)
    print("   %-5s -> %s (beklenen %s)" % (ad, olcu, bekle))
    if olcu != bekle:
        sorun.append(f"{ad} olcusu yanlis okundu: {olcu}")

print("2) Olagan fotograflar kabul edilir")
for ad, blob in [("telefon fotografi", jpeg(4032, 3024)),
                 ("ekran goruntusu", png(2560, 1440)),
                 ("kucuk gif", gif(320, 240))]:
    neden = g.image_reason(blob)
    print("   %-18s -> %s" % (ad, neden or "kabul"))
    if neden:
        sorun.append(f"{ad} reddedildi: {neden}")

print("3) Devasa olculer reddedilir")
for ad, blob in [("kenar 20000", png(20000, 100)),
                 ("100 megapiksel", png(10000, 10000))]:
    neden = g.image_reason(blob)
    print("   %-16s -> %s" % (ad, neden or "KABUL (olmamali)"))
    if not neden:
        sorun.append(f"{ad} kabul edildi")

print("4) Tanimadigi bicim reddedilmez (AVIF gibi)")
avif = b"\x00\x00\x00\x20ftypavif" + b"\x00" * 40
print("   avif ->", g.image_reason(avif) or "kabul (dogru)")
if g.image_reason(avif):
    sorun.append("tanimadigi bicimi reddetti")

print("5) Bozuk/kirpik dosya comez")
for ad, blob in [("bos", b""), ("yarim png", png(100, 100)[:12]),
                 ("cop", b"\xff\xd8\xff" + b"\x00" * 5)]:
    try:
        g.image_size(blob); g.image_reason(blob)
        print("   ", ad, "-> sorunsuz")
    except Exception as err:
        sorun.append(f"{ad} patladi: {err}")

print("5b) ISO-BMFF: video gorsel diye gecmemeli")
# "ftyp var" demek gorsel demek degil: MP4 ve QuickTime de ISO-BMFF.
import io as _io
_init = _io.open(Z + "/lumen_ha/__init__.py", encoding="utf-8").read()
_ns = {}
exec(_init[_init.index("def _looks_like_image"):_init.index("def _folder_bytes")], _ns)
_bak = _ns["_looks_like_image"]
_bas = bytes([0, 0, 0, 0x20]) + b"ftyp"
for ad, marka, bekle in [("mp4", b"isom", False), ("quicktime", b"qt  ", False),
                         ("avif", b"avif", True), ("heic", b"heic", True)]:
    blob = _bas + marka + bytes(20)
    var = _bak(blob)
    print("   %-10s -> %s" % (ad, "kabul" if var else "red"))
    if var != bekle:
        sorun.append(ad + (" reddedilmeliydi" if var else " kabul edilmeliydi"))

print("6) Klasor kotasi makul mu")
print("   sinir:", g.MAX_FOLDER // (1024 * 1024), "MB")
if not (50 * 1024 * 1024 <= g.MAX_FOLDER <= 2 * 1024 * 1024 * 1024):
    sorun.append("klasor kotasi sacma")

print()
if sorun:
    print("SORUN:")
    for x in sorun:
        print("   x", x)
    sys.exit(1)
print("TEMIZ")
