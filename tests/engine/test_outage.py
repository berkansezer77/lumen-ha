import os as _os
# A device that blinks is not news. A device that has gone is — once.
import io, sys, time, asyncio
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_insight.py'), encoding='utf-8').read().split('print("1)')[0],
             'stub', 'exec'), globals())

def kinds(eng):
    return {i["kind"] for i in eng.health()}


print("1) anlik kopma haber degil")
eng = build()
eng.config["notify"] = {"service": "notify.telefon", "enabled": True,
                        "every_h": 24, "after_min": 4}
HASS.states.set("binary_sensor.s", "unavailable")
eng._watch_devices()
check("hemen rapora girmedi", "offline" not in kinds(eng), str(kinds(eng)))
HASS.services.calls = []
asyncio.run(eng.async_outage_notify())
check("hemen bildirim de yok", not HASS.services.calls)

print("2) esigi gecince bir kez haber verir")
eng.down["binary_sensor.s"] = time.time() - 5 * 60      # bes dakikadir yok
check("rapora girdi", "offline" in kinds(eng), str(kinds(eng)))
asyncio.run(eng.async_outage_notify())
check("bildirim gitti", len(HASS.services.calls) == 1, str(HASS.services.calls))
msg = HASS.services.calls[0][2].get("message", "")
print("   mesaj:", msg)
check("suresi yaziyor", "dakika" in msg)
HASS.services.calls = []
asyncio.run(eng.async_outage_notify())
check("ikinci kez tekrarlamadi", not HASS.services.calls)

print("3) geri gelince unutulur, tekrar giderse yine haber verir")
HASS.states.set("binary_sensor.s", "off")
eng._watch_devices()
check("kayit temizlendi", "binary_sensor.s" not in eng.down)
HASS.states.set("binary_sensor.s", "unavailable")
eng._watch_devices()
eng.down["binary_sensor.s"] = time.time() - 9 * 60
asyncio.run(eng.async_outage_notify())
check("yeni kesinti icin yeniden haber verdi", len(HASS.services.calls) == 1)

print("4) tatil: ev sessizken susan sensor sikayet konusu degil")
eng = build()
import datetime as _dt
old = _dt.datetime.now(UTC) - _dt.timedelta(days=9)
for e in ("binary_sensor.s", "binary_sensor.eski"):
    HASS.states.set(e, "off")
    HASS.states.d[e].last_changed = old
check("kimse kipirdamiyorsa sessizlik sikayet degil", "stale" not in kinds(eng),
      str(kinds(eng)))
# now somebody moves in another room — then the quiet one is worth a word
HASS.states.set("binary_sensor.s", "on")
check("ev hareketliyken susan sensor bildirilir", "stale" in kinds(eng),
      str(kinds(eng)))

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
