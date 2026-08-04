# -*- coding: utf-8 -*-
"""Her ucun ihtiyaci olan sey elinde olmali.

Motor kontrolunu butun uclara eklerken, gorsel ucunda `_engine` ozelligi
olmadigini fark etmemistim: uc, ilk cagrida AttributeError ile 500 verirdi.
Testler kodu degil davranisi sinar ama bu sinif, calistirmadan gorulebilecek
bir kusurdu — nobetci birakiyoruz.
"""
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

s = io.open(Z + "/lumen_ha/__init__.py", encoding="utf-8").read()
sorun = []

print("1) self._engine kullanan her ucun ozelligi var mi")
for m in re.finditer(r"class (Lumen\w+View)\(HomeAssistantView\):(.*?)(?=\nclass |\nasync def |\ndef _)",
                     s, re.S):
    ad, govde = m.group(1), m.group(2)
    kullanim = govde.count("self._engine")
    var = "def _engine" in govde
    print("   %-22s kullanim: %d | ozellik: %s" % (ad, kullanim, "VAR" if var else "YOK"))
    if kullanim and not var:
        sorun.append(f"{ad}: _engine kullaniyor ama ozelligi yok (500 verir)")

print("2) Her uc motor yokken 503 diyor mu")
for m in re.finditer(r"    async def (get|post)\(self, request\):(.*?)(?=\n    async def |\n    def |\nclass )",
                     s, re.S):
    govde = m.group(2)
    if "_is_admin" not in govde:
        continue
    if "self._engine" in govde and "503" not in govde:
        sorun.append("bir ucta motor kontrolu var ama 503 yok")
print("   tamam")

print("3) Yapilandirma ucu suzgecten geciyor mu")
i = s.index("class LumenConfigView")
j = s.index("class LumenStateView")
govde = s[i:j]
for gerek, dert in [("guard.clean", "suzgec cagrilmiyor"),
                    ("ConfigRejected", "reddetme yakalanmiyor"),
                    ("MAX_BYTES", "boyut siniri yok")]:
    if gerek not in govde:
        sorun.append("config ucu: " + dert)
print("   suzgec bagli:", all(x in govde for x in ("guard.clean", "ConfigRejected", "MAX_BYTES")))

print("4) Unload motoru durduruyor ve servisleri kaldiriyor mu")
i = s.index("async def async_unload_entry")
govde = s[i:]
for gerek, dert in [("engine.shutdown()", "motor durdurulmuyor"),
                    ("async_remove", "servisler kaldirilmiyor"),
                    ('pop("engine"', "motor defterden silinmiyor")]:
    if gerek not in govde:
        sorun.append("unload: " + dert)
print("   tamam:", all(x in govde for x in ("engine.shutdown()", "async_remove", 'pop("engine"')))

print("5) Servis kaydi 'bir kez kur' blogunun disinda mi")
satir = [l for l in s.splitlines() if "_register_services(hass, engine)" in l]
girinti = len(satir[0]) - len(satir[0].lstrip()) if satir else -1
print("   girinti:", girinti, "(4 = blok disi)")
if girinti != 4:
    sorun.append("servis kaydi blok icinde — kaldirip yeniden kuran servissiz kalir")

print()
if sorun:
    print("SORUN:")
    for x in sorun:
        print("   x", x)
    sys.exit(1)
print("TEMIZ")
