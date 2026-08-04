import os as _os
# "Karanlık çökünce aç" is a question asked on a clock, and the clock is yours.
import io, sys, types, time, datetime as dt
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_darkmanual.py'), encoding='utf-8').read()
             .split('print("1)')[0], 'stub', 'exec'), globals())

ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond:
        ok = False


def dark_room(every=None, lux=12, watch=True, threshold=20):
    eng = build(watch=watch, lux=lux)
    for rule in eng.config["rooms"]["ofis"]["slots"].values():
        rule["lux_max"] = threshold
        if every is not None:
            rule["check_every"] = every
    return eng


print("1) 5 saniyelik aralik: bes saniyede bir sorar")
eng = dark_room(every=5)
eng._dark_tick(None)
check("hemen acti", HASS.states.get(LIGHT).state == "on", str(HASS.services.calls))

print("2) aralik dolmadan tekrar sormaz")
eng = dark_room(every=60)
eng._dark_tick(None)
HASS.states.set(LIGHT, "off")
HASS.services.calls = []
eng._dark_tick(None)
check("erken sormadi", not HASS.services.calls, str(HASS.services.calls))
eng._state("ofis")["dark_at"] = time.time() - 61
eng._dark_tick(None)
check("sure dolunca sordu", HASS.states.get(LIGHT).state == "on")

print("3) isik esigi kapaliysa bu saat hic calismaz")
eng = dark_room(every=5, threshold=None)
eng._dark_tick(None)
check("esiksiz oda yoklanmadi", HASS.states.get(LIGHT).state == "off",
      str(HASS.services.calls))

print("4) 'karanlik cokunce ac' kapaliysa yine calismaz")
eng = dark_room(every=5, watch=False)
eng._dark_tick(None)
check("gozcusuz oda yoklanmadi", HASS.states.get(LIGHT).state == "off")

print("5) oda aydinlikken dokunmaz")
eng = dark_room(every=5, lux=300)
eng._dark_tick(None)
check("aydinlikta acmadi", HASS.states.get(LIGHT).state == "off")

print("6) oda bosken dokunmaz")
eng = dark_room(every=5)
HASS.states.set(SENS, "off")
eng._dark_tick(None)
check("bos odada acmadi", HASS.states.get(LIGHT).state == "off")

print("7) aralik sinirlari: 5 sn'nin altina inilemez, bos birakilirsa 30 sn")
eng = dark_room(every=1)
check("en hizli 5 sn", eng.check_every("ofis") == 5, str(eng.check_every("ofis")))
eng = dark_room(every=0)
check("bos birakilinca 30 sn", eng.check_every("ofis") == 30)
eng = dark_room(every=45)
check("secilen deger gecerli", eng.check_every("ofis") == 45)

print("8) yarim dakikalik tur da ayni kapiyi kullanir")
eng = dark_room(every=5)
eng._sweep()
check("supurge de acti", HASS.states.get(LIGHT).state == "on")

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
