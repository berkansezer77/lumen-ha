import os as _os
# A tap on a room's card is a person asking for light; the rules that decide
# on somebody's behalf must not overrule somebody who has already decided.
import io, sys, asyncio
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_empty.py'), encoding='utf-8').read().split('print("1)')[0],
             'stub', 'exec'), globals())

_bare = build


def build(*a, **k):
    """A room that goes dark the instant it is empty would take the light back
    in the same second it was asked for. Every real room has a countdown, so
    the tests use one too."""
    eng = _bare(60, *a, **k)
    return eng


def lit():
    return HASS.states.get(LIGHT).state


print("1) dilim 'acma kapali' derken bile elle acilir")
eng = build()
for key in ("morning", "day", "evening", "night"):
    eng.config["rooms"]["bedroom"]["slots"][key]["on"] = False
    eng.config["rooms"]["bedroom"]["slots"][key]["lux_max"] = None
check("motor kendiliginden acmaz", not eng.decide("bedroom")["on"],
      eng.decide("bedroom")["reason"])
asyncio.run(eng.async_action({"action": "room_on", "room": "bedroom"}))
fire()
check("elle istenince acildi", lit() == "on", str(HASS.services.calls))
check("gunluge 'panelden' diye yazildi",
      any("panelden" in (e.get("text") or "") for e in eng.events),
      str([e.get("text") for e in eng.events][:3]))

print("2) oda 'lux yeterince aydinlik' dese de acilir")
eng = build()
for key in ("morning", "day", "evening", "night"):
    eng.config["rooms"]["bedroom"]["slots"][key]["lux_max"] = 5
eng.config["rooms"]["bedroom"]["lux"] = "sensor.lux"
HASS.states.set("sensor.lux", "400")
check("aydinlikta motor acmaz", not eng.decide("bedroom")["on"],
      eng.decide("bedroom")["reason"])
asyncio.run(eng.async_action({"action": "room_on", "room": "bedroom"}))
fire()
check("elle istenince yine acildi", lit() == "on")

print("3) sigorta atmis olsa da elle acilir")
eng = build()
eng._state("bedroom")["paused_until"] = time.time() + 300
asyncio.run(eng.async_action({"action": "room_on", "room": "bedroom"}))
fire()
check("sigortaya ragmen acildi", lit() == "on")

print("4) odada isik yoksa durum durust anlatilir")
eng = build()
eng.config["rooms"]["bedroom"]["lights"] = []
asyncio.run(eng.async_action({"action": "room_on", "room": "bedroom"}))
fire()
check("isik atanmamis diye yazildi",
      any("ışık atanmamış" in (e.get("text") or "") for e in eng.events),
      str([e.get("text") for e in eng.events][:3]))

print("5) sensor tetigi hala kurallara tabi")
eng = build()
for key in ("morning", "day", "evening", "night"):
    eng.config["rooms"]["bedroom"]["slots"][key]["on"] = False
    eng.config["rooms"]["bedroom"]["slots"][key]["lux_max"] = None
HASS.states.set(SENS, "on")
eng._sensor_event(Ev(SENS, St(SENS, "off"), St(SENS, "on")))
fire()
check("kural 'acma' diyorsa sensor acmaz", lit() == "off", str(HASS.services.calls))

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
