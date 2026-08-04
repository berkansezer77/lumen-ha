import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# Sönerken solma: bazı ampuller solmayı "aç" diye anlıyor. Varsayılan: solma yok.
import io, sys, types, time, datetime as dt
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_sweep.py'), encoding='utf-8').read()
             .split('import importlib.util')[0], 'stub', 'exec'), globals())
import importlib.util
_pkg = types.ModuleType("lumen_ha"); _pkg.__path__ = [Z + "/lumen_ha"]; sys.modules["lumen_ha"] = _pkg
_spec = importlib.util.spec_from_file_location("lumen_ha.engine", Z + "/lumen_ha/engine.py")
_m = importlib.util.module_from_spec(_spec); sys.modules["lumen_ha.engine"] = _m
_spec.loader.exec_module(_m)
LumenEngine, BOOT_GRACE = _m.LumenEngine, _m.BOOT_GRACE
UTC = dt.timezone.utc
SENS, LIGHT = "binary_sensor.p", "light.a"


class St:
    def __init__(self, eid, state, ago=0.0, attrs=None):
        self.entity_id = eid; self.state = state
        self.attributes = attrs or {"supported_color_modes": ["color_temp"],
                                    "supported_features": 32}
        self.last_changed = dt.datetime.now(UTC) - dt.timedelta(seconds=ago)


class States:
    def __init__(self): self.d = {}
    def get(self, e): return self.d.get(e)
    def set(self, e, st, ago=0.0, attrs=None): self.d[e] = St(e, st, ago, attrs)


class Services:
    def __init__(self): self.calls = []
    def async_call(self, dom, svc, data, blocking=False, context=None):
        self.calls.append((svc, dict(data)))
        for e in (data.get("entity_id") or []):
            HASS.states.d[e] = St(e, "on" if svc == "turn_on" else "off")


class Hass:
    def __init__(self): self.states = States(); self.services = Services(); self.data = {}
    def async_create_task(self, c):
        try: c.close()
        except Exception: pass


HASS = Hass()


class Store:
    def __init__(self, *a, **k): pass
    async def async_load(self): return None
    async def async_save(self, *a): return None
    def async_delay_save(self, *a, **k): return None


def build(fade=None):
    TIMERS.clear()
    HASS.services.calls = []
    eng = LumenEngine(HASS, Store())
    room = {"trigger": [SENS], "hold": [SENS], "lights": [LIGHT], "lux": "",
            "slots": {k: {"on": True, "lux_max": None, "off_enabled": True,
                          "off_after": 0, "mode": "set", "bri": 60,
                          "kelvin": 3000, "dim_warn": 0, "delay_on": 0}
                      for k in ("morning", "day", "evening", "night")}}
    if fade is not None:
        room["transition"] = fade
    eng.config["rooms"] = {"salon": room}
    eng._boot_at = time.time() - BOOT_GRACE - 5
    HASS.states.set(SENS, "off")
    HASS.states.set(LIGHT, "on", attrs={"brightness": 200,
                                        "supported_color_modes": ["color_temp"],
                                        "supported_features": 32})
    return eng


def offs():
    return [d for svc, d in HASS.services.calls if svc == "turn_off"]


ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


print("1) varsayilan: elle yazilmis bir otomasyon gibi, duz sondurme")
eng = build()
eng._do_off("salon", "empty")
check("sondurdu", offs(), str(HASS.services.calls))
check("solma yok", offs() and "transition" not in offs()[0], str(offs()[:1]))

print("2) isteyen solmayi acabilir")
eng = build(fade=2)
eng._do_off("salon", "empty")
check("solma var", offs() and offs()[0].get("transition") == 4.0, str(offs()[:1]))

print("3) sifir yazmak da solmasiz demek")
eng = build(fade=0)
eng._do_off("salon", "empty")
check("solma yok", offs() and "transition" not in offs()[0], str(offs()[:1]))

print("4) eski kurulumlar bir kereligine solmasiza cekiliyor")
cfg = _m._deep_default({"rooms": {"salon": {"transition": 1, "lights": [LIGHT],
                                            "trigger": [SENS], "hold": [SENS]}}})
room = cfg["rooms"]["salon"]
check("gecis sifirlandi", room.get("transition") == 0, str(room.get("transition")))
check("secildi isareti kondu", room.get("fade_set") is True)

print("5) bir kez secildiyse bir daha ezilmez")
cfg = _m._deep_default({"rooms": {"salon": {"transition": 3, "fade_set": True,
                                            "lights": [LIGHT], "trigger": [SENS],
                                            "hold": [SENS]}}})
check("secim korundu", cfg["rooms"]["salon"].get("transition") == 3)

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
