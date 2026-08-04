# -*- coding: utf-8 -*-
"""Kart kaydı: kullanıcı hiçbir şey eklemeden çalışsın, güncellemede tazelensin.

Gerçek gönderilen kodu okuyup çalıştırır (HA kurulu olmadan): fonksiyon
yalnız hass.data ve _LOGGER kullanıyor, gerisi taklit koleksiyon.
"""
import asyncio
import io
import re
import sys
import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SRC = Z + "/lumen_ha/__init__.py"
text = io.open(SRC, encoding="utf-8").read()
m = re.search(r"async def _async_register_card_resource.*?\n(?=\n\ndef |\n\nasync def |\n\nclass )",
              text, re.S)
assert m, "fonksiyon bulunamadı"


class Log:
    def _yaz(self, tur, a):
        print("   %s:" % tur, a[0] % a[1:] if len(a) > 1 else a[0])

    def warning(self, *a): self._yaz("uyarı", a)
    def info(self, *a): self._yaz("bilgi", a)
    def debug(self, *a): pass
    def exception(self, *a): self._yaz("hata", a)


ns = {"HomeAssistant": object, "_LOGGER": Log()}
exec(compile(m.group(0), SRC, "exec"), ns)
kaydet = ns["_async_register_card_resource"]

URL = "/lumen_ha_frontend/lumen-panel-1.12.0.js"
sorun = []


class Koleksiyon:
    """Lovelace'in kaynak listesinin yaptığı kadarı."""

    def __init__(self, items=None):
        self.items = list(items or [])
        self._n = 0

    def async_items(self): return list(self.items)

    async def async_get_info(self): return {}

    async def async_create_item(self, data):
        self._n += 1
        item = dict(data); item["id"] = "yeni%d" % self._n
        item["type"] = item.pop("res_type", "module")
        self.items.append(item)
        return item

    async def async_update_item(self, iid, data):
        for it in self.items:
            if it["id"] == iid:
                it["url"] = data["url"]
                return it
        raise KeyError(iid)

    async def async_delete_item(self, iid):
        self.items = [i for i in self.items if i["id"] != iid]


class Hass:
    def __init__(self, lovelace): self.data = {"lovelace": lovelace}


class Lovelace:
    def __init__(self, resources): self.resources = resources


def urls(k): return [i["url"] for i in k.items]


async def main():
    print("1) Hiç girdi yokken kurar")
    k = Koleksiyon([{"id": "x", "url": "/hacsfiles/baska-kart.js", "type": "module"}])
    ok = await kaydet(Hass(Lovelace(k)), URL)
    print("   sonuç:", ok, "·", urls(k))
    if not ok or URL not in urls(k):
        sorun.append("kaynak oluşturulmadı")
    if "/hacsfiles/baska-kart.js" not in urls(k):
        sorun.append("başkasının kaynağına dokunuldu")

    print("2) Aynı sürüm ikinci kez: kopya çıkmaz")
    ok = await kaydet(Hass(Lovelace(k)), URL)
    print("   sonuç:", ok, "· lumen girdisi:", sum("lumen" in u for u in urls(k)))
    if sum("lumen" in u for u in urls(k)) != 1:
        sorun.append("aynı kart iki kez kaydedildi")

    print("3) GÜNCELLEME: eski sürüm yeni adrese taşınır (kimlik korunur)")
    k = Koleksiyon([{"id": "eski", "url": "/lumen_ha_frontend/lumen-panel-1.9.0.js",
                     "type": "module"}])
    ok = await kaydet(Hass(Lovelace(k)), URL)
    print("   sonuç:", ok, "·", urls(k), "· kimlik:", k.items[0]["id"])
    if urls(k) != [URL]:
        sorun.append("güncellemede adres tazelenmedi")
    if k.items[0]["id"] != "eski":
        sorun.append("girdi silinip yeniden kuruldu (pano bozulabilir)")

    print("4) Birikmiş eski girdiler tek girdiye iner")
    k = Koleksiyon([
        {"id": "a", "url": "/lumen_ha_frontend/lumen-panel-1.9.0.js", "type": "module"},
        {"id": "b", "url": "/lumen_ha_frontend/lumen-panel-1.10.0.js", "type": "module"},
        {"id": "c", "url": "/local/lumen-panel-1.8.0.js", "type": "module"},
        {"id": "d", "url": "/hacsfiles/mushroom.js", "type": "module"},
    ])
    ok = await kaydet(Hass(Lovelace(k)), URL)
    print("   sonuç:", ok, "·", urls(k))
    if sum("lumen" in u for u in urls(k)) != 1:
        sorun.append("eski girdiler temizlenmedi (dosya iki kez yüklenir)")
    if "/hacsfiles/mushroom.js" not in urls(k):
        sorun.append("başkasının kaynağı silindi")

    print("5) YAML modundaki pano: yazmaz, çağırana False der (extra-js'e düşsün)")
    class Salt:
        def async_items(self): return []
    ok = await kaydet(Hass(Lovelace(Salt())), URL)
    print("   sonuç:", ok)
    if ok is not False:
        sorun.append("YAML modunda yazmaya kalkıyor")

    print("6) Lovelace henüz yokken çökmez")
    ok = await kaydet(Hass(None), URL)
    print("   sonuç:", ok)
    if ok is not False:
        sorun.append("lovelace yokken False dönmedi")

    print("7) Koleksiyon patlarsa kurulum çökmez, uyarır")
    class Kizgin(Koleksiyon):
        async def async_create_item(self, data): raise RuntimeError("depo kilitli")
    ok = await kaydet(Hass(Lovelace(Kizgin())), URL)
    print("   sonuç:", ok)
    if ok is not False:
        sorun.append("hata yutulmadı, kurulum düşebilir")

    print("8) Kayıt 'bir kez kur' bloğunun DIŞINDA çağrılıyor mu?")
    # İçindeyken bayrak ikinci kurulumda kaydı atlıyor: sürüm atlayınca girdi
    # eski dosyada kalıyor ve o dosya artık yok — pano 404'e bakıyor. Bir kez
    # yaşandı (1.13 → 1.14), bir daha yaşanmasın.
    satir = [l for l in text.splitlines() if "async_at_start(hass, _card_at_start)" in l]
    print("   satır:", repr(satir[0]) if satir else "YOK")
    if not satir:
        sorun.append("kart kaydı açılışa bağlanmamış")
    else:
        girinti = len(satir[0]) - len(satir[0].lstrip())
        print("   girinti:", girinti, "(4 = blok dışı, 8 = blok içi)")
        if girinti != 4:
            sorun.append("kart kaydı 'bir kez kur' bloğunun içinde → "
                         "güncellemede girdi eskide kalır")

    print("\n" + ("SORUN:\n" + "\n".join(sorun) if sorun else "TEMİZ"))
    return 1 if sorun else 0


sys.exit(asyncio.run(main()))
