import os as _os
# LUMEN puts an empty room out once. After that it watches, and says so.
import io, sys, time, asyncio
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_insight.py'), encoding='utf-8').read().split('print("1)')[0],
             'stub', 'exec'), globals())


def empty(eng):
    """Nobody in the salon, but its light is on."""
    HASS.states.set("binary_sensor.s", "off")
    HASS.states.set("light.a", "on")
    return eng._state("salon")


print("1) suren bir geri sayim varken sikayet edilmez")
eng = build()
HASS.states.set("binary_sensor.s", "off")
HASS.states.set("light.a", "on")
eng._state("salon")["timers"]["off"] = lambda: None   # sayim planli
eng._watch_stuck()
check("sayim varken susuyor", not eng._watch_stuck())
eng._state("salon")["timers"].pop("off", None)

print("2) bos odada yanan isik, secilen dakika sonra bildirilir")
eng = build()
eng.config["notify"] = {"service": "notify.telefon", "enabled": True,
                        "stuck": True, "stuck_min": 6}
rts = empty(eng)
eng._watch_stuck()
check("ilk goruste beklemeye alindi", rts["stuck_since"] > 0)
check("hemen soylemedi", not eng._watch_stuck())
rts["stuck_since"] = time.time() - 6 * 60 - 5
news = eng._watch_stuck()
check("sure dolunca soyledi", len(news) == 1, str(news))
check("mesajda dakika var", "dakika" in news[0], news[0] if news else "")

print("3) bir kez soyler, her yarim dakikada bir degil")
check("tekrarlamadi", not eng._watch_stuck())

print("4) bildirim gercekten gonderiliyor")
eng = build()
eng.config["notify"] = {"service": "notify.telefon", "enabled": True,
                        "stuck": True, "stuck_min": 3}
rts = empty(eng)
eng._watch_stuck()
rts["stuck_since"] = time.time() - 4 * 60
HASS.services.calls = []
asyncio.run(eng.async_stuck_notify())
check("bildirim gitti", len(HASS.services.calls) == 1, str(HASS.services.calls))
if HASS.services.calls:
    print("   mesaj:", HASS.services.calls[0][2].get("message", ""))

print("5) kapatma yok — isik yanik kalir")
check("isige dokunulmadi", HASS.states.get("light.a").state == "on")
check("kapatma cagrisi yok",
      not [c for c in HASS.services.calls if c[1] == "turn_off"])

print("6) kapali tutulabilir")
eng = build()
eng.config["notify"] = {"service": "notify.telefon", "enabled": True,
                        "stuck": False, "stuck_min": 1}
rts = empty(eng)
eng._watch_stuck()
rts["stuck_since"] = time.time() - 300
HASS.services.calls = []
asyncio.run(eng.async_stuck_notify())
check("kapaliyken susuyor", not HASS.services.calls)

print("7) odaya biri girince mesele kapanir")
eng = build()
rts = empty(eng)
eng._watch_stuck()
HASS.states.set("binary_sensor.s", "on")
eng._watch_stuck()
check("bekleme sifirlandi", not rts["stuck_since"])
check("yeniden soz hakki", not rts["stuck_told"])

print("8) sonme listesi ayri secilebilir")
eng = build()
eng.config["rooms"]["salon"]["lights"] = ["light.a", "light.b"]
HASS.states.set("light.b", "off")
rule = dict(eng.slot_rule("salon"))
check("bos birakinca oda tamami",
      set(eng.rule_lights("salon", rule, "off")) == {"light.a", "light.b"})
rule["off_picks"] = ["light.b"]
check("secince sadece o", eng.rule_lights("salon", rule, "off") == ["light.b"])
check("acilis listesi etkilenmedi",
      set(eng.rule_lights("salon", rule, "on")) == {"light.a", "light.b"})

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
