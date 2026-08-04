import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# Taking an area out of the house, and autofill leaving it out.
import io, sys, types, time, asyncio
exec(compile(io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_sweep.py'), encoding='utf-8').read()
             .split('import importlib.util')[0], 'stub', 'exec'), globals())
import importlib.util
_pkg = types.ModuleType("lumen_ha"); _pkg.__path__ = [Z + "/lumen_ha"]; sys.modules["lumen_ha"] = _pkg
_spec = importlib.util.spec_from_file_location("lumen_ha.engine", Z + "/lumen_ha/engine.py")
_m = importlib.util.module_from_spec(_spec); sys.modules["lumen_ha.engine"] = _m
_spec.loader.exec_module(_m)

ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False


print("1) cikarilan alan yapilandirmadan dusuyor")
cfg = _m._deep_default({
    "skip_areas": ["sokak"],
    "rooms": {"sokak": {"lights": ["light.x"]}, "salon": {"lights": ["light.a"]}},
    "layout": {"floors": [{"id": "f1", "cols": 3, "rows_n": 2, "rooms": [
        {"id": "sokak", "x": 0, "y": 0, "w": 1, "h": 1},
        {"id": "salon", "x": 1, "y": 0, "w": 1, "h": 1}]}]},
})
check("oda silindi", "sokak" not in cfg["rooms"], str(sorted(cfg["rooms"])))
check("salon duruyor", "salon" in cfg["rooms"])
check("liste normallesti", cfg["skip_areas"] == ["sokak"])

print("2) tekrar tekrar gecirmek bir sey bozmuyor")
again = _m._deep_default(cfg)
check("hala yok", "sokak" not in again["rooms"] and again["skip_areas"] == ["sokak"])

print("3) autofill cikarilan alani geri koymuyor")


class Area:
    def __init__(self, aid, name): self.id = aid; self.name = name


class AreaReg:
    def async_list_areas(self):
        return [Area("sokak", "Sokak"), Area("salon", "Salon")]
    def async_get_area(self, aid): return None


_m.ar.async_get = lambda hass: AreaReg()


class Hass:
    class S:
        def get(self, e): return None
    class Sv:
        async def async_call(self, *a, **k): pass
        def async_services(self): return {}
    def __init__(self): self.states = Hass.S(); self.services = Hass.Sv(); self.data = {}
    def async_create_task(self, c):
        try: c.close()
        except Exception: pass


class Store:
    def __init__(self, *a, **k): pass
    async def async_load(self): return None
    async def async_save(self, *a): return None
    def async_delay_save(self, *a, **k): return None


eng = _m.LumenEngine(Hass(), Store())
eng.config = cfg
eng._area_entities = lambda: {"sokak": ["light.x"], "salon": ["light.a"]}
eng.setup = lambda: None
asyncio.run(eng.async_autofill(build_layout=False))
check("sokak geri gelmedi", "sokak" not in eng.config["rooms"], str(sorted(eng.config["rooms"])))
check("salon dokunulmadi", "salon" in eng.config["rooms"])

print("4) geri alinca autofill onu tekrar kurabiliyor")
asyncio.run(eng.async_action({"action": "restore_room", "room": "sokak"}))
check("listeden dustu", "sokak" not in (eng.config.get("skip_areas") or []))
check("oda geri geldi", "sokak" in eng.config["rooms"], str(sorted(eng.config["rooms"])))

print("5) cikarma islemi odayi ve cizimden yerini siliyor")
asyncio.run(eng.async_action({"action": "remove_room", "room": "sokak"}))
check("odadan silindi", "sokak" not in eng.config["rooms"])
check("listeye girdi", "sokak" in eng.config["skip_areas"])
plan = [r["id"] for f in eng.config["layout"]["floors"] for r in f["rooms"]]
check("cizimden de silindi", "sokak" not in plan, str(plan))
check("gunluge yazildi", any(e["action"] == "room" for e in eng.events),
      "; ".join(e["text"] for e in eng.events[:1]))

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
