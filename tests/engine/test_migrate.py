import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# The trigger delay and the dim warning used to live on the room. Nobody's value
# may be silently reset to zero when they move into the slots.
import io, sys, runpy
src = io.open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'test_sweep.py'), encoding='utf-8').read()
head = src.split('from lumen.engine import')[0] if 'from lumen.engine import' in src else src.split('import importlib.util')[0]
exec(compile(head, 'stub', 'exec'), globals())
import importlib.util, types
_pkg = types.ModuleType("lumen_ha"); _pkg.__path__ = [Z + "/lumen_ha"]; sys.modules["lumen_ha"] = _pkg
_spec = importlib.util.spec_from_file_location("lumen_ha.engine", Z + "/lumen_ha/engine.py")
_m = importlib.util.module_from_spec(_spec); sys.modules["lumen_ha.engine"] = _m
_spec.loader.exec_module(_m)

ok = True
def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond: ok = False

old = {"rooms": {"ofis": {"delay_on": 7, "dim_warn": 5,
                          "slots": {"night": {"bri": 42, "dim_warn": 30}}}}}
cfg = _m._deep_default(old)
rules = cfg["rooms"]["ofis"]["slots"]
print("dilimler:", ", ".join(sorted(rules)))
check("gece kendi dim_warn'unu korudu", rules["night"]["dim_warn"] == 30,
      str(rules["night"]["dim_warn"]))
check("gece oda gecikmesini devraldi", rules["night"]["delay_on"] == 7,
      str(rules["night"]["delay_on"]))
for k in rules:
    if k == "night": continue
    check(k + " oda degerlerini devraldi",
          rules[k]["delay_on"] == 7 and rules[k]["dim_warn"] == 5,
          "%s / %s" % (rules[k]["delay_on"], rules[k]["dim_warn"]))
check("oda seviyesindeki kopyalar silindi",
      "delay_on" not in cfg["rooms"]["ofis"] and "dim_warn" not in cfg["rooms"]["ofis"])

fresh = _m._deep_default({"rooms": {"salon": {}}})["rooms"]["salon"]["slots"]
# Kutudan cikan varsayilan: kapanma uyarisi KAPALI. Taninmayan bir evde,
# taninmayan ampullerde kisma yapmak dogru degil (bkz. test_dim).
check("yeni odada kapanma uyarisi kapali",
      all(r["delay_on"] == 0 and r["dim_warn"] == 0 for r in fresh.values()))

# migrating twice must not change anything
again = _m._deep_default(cfg)["rooms"]["ofis"]["slots"]
check("ikinci gecis bir sey bozmuyor", again == rules)

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
