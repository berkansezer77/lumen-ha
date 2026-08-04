"""Panelden gelen yapılandırmayı içeri almadan önce bir süzgeçten geçir.

Yapılandırma serbest bir JSON: paneli yazan biziz, ama aynı dosya dışa
aktarılıp paylaşılıyor ("al benim kurulumumu dene") ve geri içeri alınıyor.
Bozuk ya da şişirilmiş bir dosya, motoru her turda hata verdirmeye, depoyu
yüzlerce megabayta çıkarmaya ya da açılışta entegrasyonu düşürmeye yeter.

Süzgecin iki huyu var, ikisi de bilinçli:

* **Yapı bozuksa reddeder.** Oda listesi sözlük değilse, dosya devasa ise
  içeri hiç alınmaz — çünkü onu düzeltmeye çalışmak, kullanıcının kaydettiğini
  sanıp başka bir şey saklamak demektir.
* **Sayı saçmaysa kırpar.** Parlaklık 900 yazılmışsa 100'e çekilir; bu tek
  bir alanın düzeltilmesi, kimsenin kurulumunu kaybettirmez.

Kırpılan her şey geri bildirilir; panel bunu kullanıcıya söyleyebilir.
"""
from __future__ import annotations

from typing import Any

# Cömert sınırlar: gerçek bir evin kat kat üstü. (Sekiz odalı, 21 cihazlı bir
# kurulum ~18 KB tutuyor; buradaki tavanlar onun onlarca katı.)
MAX_BYTES = 4_000_000
MAX_ROOMS = 200
MAX_LIST = 500          # bir odanın tetik/tutucu/ışık listesi
MAX_SLOTS = 24          # oda başına zaman dilimi
MAX_MODES = 50
MAX_FLOORS = 20
MAX_BLOCK = 20          # bir dilimdeki engel koşulu
MAX_TEXT = 2000         # tek bir metin alanı
MAX_KEY = 128           # oda kimliği, mod anahtarı

# Sayı olmak ZORUNDA olan alanlar: metin gelirse varsayılana çekilir.
# ("bozuk" yazan bir mode_until, her turda hata veren bir motor demek.)
NUMBERS_ONLY = {
    "cols": 6, "rows_n": 3, "x": 0, "y": 0, "w": 1, "h": 1,
    "mode_until": 0, "expire_h": 0, "watt": 0, "price": 0, "after_min": 0,
}

# alan: (en az, en çok)
RANGES = {
    # Plan ızgarası ve oda geometrisi: paneldeki çizim döngüleri bunlara
    # bakıyor. Bir milyar sütun, tarayıcıyı kilitleyen bir döngü demek.
    "cols": (1, 64),
    "rows_n": (1, 64),
    "x": (0, 512),
    "y": (0, 512),
    "w": (1, 64),
    "h": (1, 64),
    # Mod bitişi bir zaman damgası; enerji sayfası kWh ve para hesaplıyor.
    "mode_until": (0, 4102444800),      # 2100'e kadar
    "expire_h": (0, 8760),
    "watt": (0, 100000),
    "price": (0, 1000),
    "after_min": (0, 10080),
    "bri": (0, 100),
    "kelvin": (1000, 10000),
    "lux_max": (0, 200000),
    "off_after": (0, 86400),
    "delay_on": (0, 3600),
    "dim_warn": (0, 3600),
    "and_window": (0, 3600),
    "check_every": (5, 3600),
    "transition": (0, 300),
    "every_h": (0.25, 168),
    "stuck_min": (1, 1440),
    "outage_min": (1, 10080),
}


# ── görseller ─────────────────────────────────────────────────────────
# Dosya boyutu tek başına yetmiyor: birkaç yüz kilobaytlık bir PNG, açıldığında
# yüz megapiksel olabilir ("decompression bomb"). Tarayıcı onu çizmeye
# çalışırken tablet diz çöker. Bir oda fotoğrafının 8000 pikselden geniş
# olması için de sebep yok.
MAX_DIM = 8000
MAX_PIXELS = 40_000_000
# Klasörün tamamı: yüklenen ama kullanılmayan dosyalar birikiyor ve kimse
# silmiyor. Sınıra gelince yeni yükleme reddedilir — sessizce diski doldurmak
# yerine "yerin dolu" demek.
MAX_FOLDER = 300 * 1024 * 1024


class ConfigRejected(Exception):
    """Yapı öyle bozuk ki içeri alınamaz."""


def image_size(blob: bytes) -> tuple[int, int] | None:
    """Görselin en/boyu — yalnız başlığından, dosyayı açmadan.

    Bilinmeyen bir biçimse None döner: emin olmadığımız şeyi reddetmeyiz.
    """
    try:
        if blob[:8] == b"\x89PNG\r\n\x1a\n" and blob[12:16] == b"IHDR":
            return (int.from_bytes(blob[16:20], "big"),
                    int.from_bytes(blob[20:24], "big"))
        if blob[:6] in (b"GIF87a", b"GIF89a"):
            return (int.from_bytes(blob[6:8], "little"),
                    int.from_bytes(blob[8:10], "little"))
        if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
            tur = blob[12:16]
            if tur == b"VP8X":
                return (int.from_bytes(blob[24:27], "little") + 1,
                        int.from_bytes(blob[27:30], "little") + 1)
            if tur == b"VP8 ":
                return (int.from_bytes(blob[26:28], "little") & 0x3FFF,
                        int.from_bytes(blob[28:30], "little") & 0x3FFF)
            return None
        if blob[:3] == b"\xff\xd8\xff":
            i = 2
            n = len(blob)
            # i+9'a kadar okuyacağız, yani n en az i+9 olmalı. "<" yazmak,
            # SOF tam dosyanın sonundaysa ölçüyü kaçırıyordu.
            while i + 9 <= n:
                if blob[i] != 0xFF:
                    i += 1
                    continue
                isaret = blob[i + 1]
                # SOF0..SOF15, aralarındaki DHT/DAC/RST hariç
                if isaret in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                              0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    return (int.from_bytes(blob[i + 7:i + 9], "big"),
                            int.from_bytes(blob[i + 5:i + 7], "big"))
                if isaret in (0xD8, 0x01) or 0xD0 <= isaret <= 0xD7:
                    i += 2
                    continue
                i += 2 + int.from_bytes(blob[i + 2:i + 4], "big")
            return None
    except (IndexError, ValueError):
        return None
    return None


def image_reason(blob: bytes) -> str | None:
    """Bu görsel neden kabul edilemez? Kabul edilebilirse None."""
    olcu = image_size(blob)
    if olcu is None:
        return None
    w, h = olcu
    if w <= 0 or h <= 0:
        return "görselin boyutu okunamadı"
    if w > MAX_DIM or h > MAX_DIM:
        return f"görsel çok büyük ({w}×{h}, kenar sınırı {MAX_DIM})"
    if w * h > MAX_PIXELS:
        return f"görsel çok büyük ({w}×{h} piksel, sınır {MAX_PIXELS // 1_000_000} MP)"
    return None


def _text(value: Any, notes: list[str], nerede: str) -> Any:
    if isinstance(value, str) and len(value) > MAX_TEXT:
        notes.append(f"{nerede}: metin {MAX_TEXT} karaktere kırpıldı")
        return value[:MAX_TEXT]
    return value


def _number(key: str, value: Any, notes: list[str], nerede: str) -> Any:
    """Sayı alanlarını aralığa çek. Sayı değilse dokunma — o alan sayı
    olmayabilir (renk `null`, sahne metin)."""
    if key not in RANGES or isinstance(value, bool) or value is None:
        return value
    try:
        sayi = float(value)
    except (TypeError, ValueError):
        # Sayı olması gereken bir alana metin gelmiş: varsayılana çek.
        if key in NUMBERS_ONLY:
            notes.append(f"{nerede}.{key}: {value!r} sayı değil → "
                         f"{NUMBERS_ONLY[key]}")
            return NUMBERS_ONLY[key]
        return value
    if sayi != sayi or sayi in (float("inf"), float("-inf")):
        # NaN ve sonsuz: Python'un json'u ikisini de kabul ediyor, ama
        # karşılaştırmaların hepsi False döndüğü için motoru sessizce
        # yanlış karar verdirirler.
        yedek = NUMBERS_ONLY.get(key, RANGES[key][0])
        notes.append(f"{nerede}.{key}: sayı değil (NaN/∞) → {yedek}")
        return yedek
    alt, ust = RANGES[key]
    if sayi < alt or sayi > ust:
        kirpik = min(max(sayi, alt), ust)
        notes.append(f"{nerede}.{key}: {value} → {kirpik:g}")
        return type(value)(kirpik) if isinstance(value, int) and kirpik.is_integer() \
            else kirpik
    return value


def _finite(value: Any, notes: list[str], nerede: str) -> Any:
    """NaN ve sonsuz, nerede olursa olsun, dosyada kalmasın."""
    if isinstance(value, float) and (value != value or value in (
            float("inf"), float("-inf"))):
        notes.append(f"{nerede}: NaN/∞ → 0")
        return 0
    return value


def _walk(node: Any, notes: list[str], nerede: str = "") -> Any:
    if isinstance(node, dict):
        return {k: _walk(_number(k, v, notes, nerede), notes, f"{nerede}.{k}" if nerede else str(k))
                for k, v in node.items()}
    if isinstance(node, list):
        return [_walk(v, notes, nerede) for v in node]
    return _text(_finite(node, notes, nerede), notes, nerede)


def clean(cfg: Any, raw_len: int | None = None) -> tuple[dict, list[str]]:
    """Kabul edilebilir bir yapılandırma ve nelerin düzeltildiği.

    Yapı kabul edilemezse `ConfigRejected` fırlatır.
    """
    if raw_len is not None and raw_len > MAX_BYTES:
        raise ConfigRejected(
            f"dosya çok büyük ({raw_len} bayt, sınır {MAX_BYTES})")
    if not isinstance(cfg, dict):
        raise ConfigRejected("beklenen bir nesneydi")

    rooms = cfg.get("rooms")
    if rooms is not None and not isinstance(rooms, dict):
        raise ConfigRejected("rooms bir nesne olmalı")
    if isinstance(rooms, dict):
        if len(rooms) > MAX_ROOMS:
            raise ConfigRejected(f"çok fazla oda ({len(rooms)}, sınır {MAX_ROOMS})")
        for rid, room in rooms.items():
            if not isinstance(rid, str) or not rid or len(rid) > MAX_KEY:
                raise ConfigRejected(f"geçersiz oda kimliği: {str(rid)[:40]}")
            if not isinstance(room, dict):
                raise ConfigRejected(f"{rid}: oda bir nesne olmalı")
            for alan in ("trigger", "hold", "lights", "groups", "temp",
                         "neighbors", "mode_off"):
                liste = room.get(alan)
                if liste is None:
                    continue
                if not isinstance(liste, list):
                    raise ConfigRejected(f"{rid}.{alan} bir liste olmalı")
                if len(liste) > MAX_LIST:
                    raise ConfigRejected(
                        f"{rid}.{alan} çok uzun ({len(liste)}, sınır {MAX_LIST})")
            slots = room.get("slots")
            if slots is not None and not isinstance(slots, dict):
                raise ConfigRejected(f"{rid}.slots bir nesne olmalı")
            # Engel koşulları: liste, içinde nesne, makul sayıda.
            for slot in (slots or {}).values():
                if not isinstance(slot, dict):
                    continue
                engel = slot.get("block")
                if engel is None:
                    continue
                if not isinstance(engel, list):
                    raise ConfigRejected(f"{rid}: engel listesi bir liste olmalı")
                if len(engel) > MAX_BLOCK:
                    raise ConfigRejected(
                        f"{rid}: çok fazla engel koşulu ({len(engel)}, sınır {MAX_BLOCK})")
                for kosul in engel:
                    if not isinstance(kosul, dict):
                        raise ConfigRejected(f"{rid}: engel koşulu bir nesne olmalı")

            if isinstance(slots, dict) and len(slots) > MAX_SLOTS:
                raise ConfigRejected(
                    f"{rid}: çok fazla zaman dilimi ({len(slots)}, sınır {MAX_SLOTS})")

    layout = cfg.get("layout")
    if layout is not None and not isinstance(layout, dict):
        raise ConfigRejected("layout bir nesne olmalı")
    if isinstance(layout, dict):
        floors = layout.get("floors")
        if floors is not None and not isinstance(floors, list):
            raise ConfigRejected("layout.floors bir liste olmalı")
        if isinstance(floors, list):
            if len(floors) > MAX_FLOORS:
                raise ConfigRejected(
                    f"çok fazla kat ({len(floors)}, sınır {MAX_FLOORS})")
            for kat in floors:
                if not isinstance(kat, dict):
                    raise ConfigRejected("layout.floors içinde nesne olmalı")

    # Motorun sözlük ya da liste beklediği üst alanlar: tipi yanlışsa
    # entegrasyon açılışta düşer, ve bu 400 değil 500 demektir.
    for alan, tur, ad in (("scene_art", dict, "nesne"),
                          ("ignored", list, "liste"),
                          ("skip_areas", list, "liste"),
                          ("overrides", dict, "nesne"),
                          ("photo", dict, "nesne"),
                          ("energy", dict, "nesne"),
                          ("notify", dict, "nesne")):
        deger = cfg.get(alan)
        if deger is not None and not isinstance(deger, tur):
            raise ConfigRejected(f"{alan} bir {ad} olmalı")

    modes = cfg.get("modes")
    if modes is not None:
        if not isinstance(modes, (list, dict)):
            raise ConfigRejected("modes bir liste ya da nesne olmalı")
        if len(modes) > MAX_MODES:
            raise ConfigRejected(f"çok fazla mod ({len(modes)}, sınır {MAX_MODES})")

    notes: list[str] = []
    return _walk(cfg, notes), notes
