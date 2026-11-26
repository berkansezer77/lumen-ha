# -*- coding: utf-8 -*-
"""Kart yüklemesi ve fotoğraf adresleri (1.0.7).

1) Kart, kullanıcının Lovelace kaynak listesine hiç dokunmadan, panelin dosyası
   ek frontend modülü olarak yüklenerek gelir.
2) 1.0.6'nın herkese açık /local/lumen/ adresleri korumalı uca çevrilir.

Gerçek gönderilen kodu okur (HA kurulu olmadan).
"""
import io
import re
import sys
import os as _os

_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

text = io.open(Z + "/lumen_ha/__init__.py", encoding="utf-8").read()
sorun = []

# 1) kaynak listesine yazan hiçbir şey kalmadı
for yasak in ('hass.data.get("lovelace")', 'data["lovelace"]', "async_create_item",
              "async_update_item", "async_delete_item", "resources.loaded"):
    if yasak in text:
        sorun.append("kaynak listesine dokunan kod kaldı: " + yasak)
if not re.search(r'add_extra_js_url\(hass, f"\{FRONTEND_URL_BASE\}/lumen-panel-\{FRONTEND_VERSION\}\.js"\)', text):
    sorun.append("kart ek modül olarak yüklenmiyor")
print("  GECTI  kart kaynak listesine dokunmadan yükleniyor" if not sorun else "  KALDI  kart yüklemesi")

# 2) _relink: eski adresleri korumalı uca çevirir, başka adreslere dokunmaz
m = re.search(r"_LEGACY_URL = re\.compile.*?\n\ndef _relink.*?\n(?=\n\ndef |\n\nasync def |\n\nclass )", text, re.S)
assert m, "fonksiyon bulunamadı"
ns = {"re": re, "IMAGE_URL": "/api/lumen_ha/image", "LEGACY_IMAGE_DIR": "lumen"}
exec(m.group(0), ns)
relink = ns["_relink"]
cfg = {"rooms": {"a": {"image": "/local/lumen/salon.jpg"},
                 "b": {"image": "/local/baska/x.jpg"},
                 "c": {"image": "/local/lumen/alt/klasor.jpg"}},
       "art": ["/local/lumen/kat.png", 5, None],
       "not": "/local/lumen/salon.jpg yazısı"}
yeni = relink(cfg, {"kat.png": "kat_2.png"})
bekle = {"rooms": {"a": {"image": "/api/lumen_ha/image/salon.jpg"},
                   "b": {"image": "/local/baska/x.jpg"},
                   "c": {"image": "/local/lumen/alt/klasor.jpg"}},
         "art": ["/api/lumen_ha/image/kat_2.png", 5, None],
         "not": "/local/lumen/salon.jpg yazısı"}
if yeni != bekle:
    sorun.append("relink yanlış: %r" % yeni)
if cfg["rooms"]["a"]["image"] != "/local/lumen/salon.jpg":
    sorun.append("relink girdiyi değiştirdi")
print("  GECTI  eski /local/lumen/ adresleri korumalı uca çevriliyor" if not sorun else "  KALDI  relink")

# 3) yükleme klasörü www/ dışında
if 'IMAGE_STORE' not in text or 'config.path("www", IMAGE' in text:
    sorun.append("yüklemeler hâlâ www altında olabilir")

if sorun:
    print("SORUN: " + " | ".join(sorun))
    sys.exit(1)
print("HEPSI GECTI")
