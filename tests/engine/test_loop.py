import os as _os
# Kaynak, testin kendi konumundan bulunur: depoda da, baska bir yerde de
# calissin. LUMEN_SRC ile disaridan gosterilebilir.
_KOK = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
Z = _os.environ.get("LUMEN_SRC") or _os.path.join(_KOK, "custom_components")
_FIX = _os.path.join(_KOK, "tests", "fixtures", "house.json")
# Which methods run on Home Assistant's event loop, and which quietly do not.
#
# A missing @callback does not break a test, does not raise on import and does
# not show up in the panel: Home Assistant simply runs the method in a worker
# thread, where the first timer it schedules dies of a thread-safety error. The
# tick then stops doing anything at all, every thirty seconds, in silence. So
# the marker itself is what gets checked here.
import io, re, sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
src = io.open(Z + "/lumen_ha/engine.py", encoding="utf-8").read()

# Everything Home Assistant calls directly, and must call on the loop.
LOOP = ["_tick", "_dark_tick", "_sensor_event", "_light_event"]

ok = True


def check(label, cond, extra=""):
    global ok
    print(("  GECTI  " if cond else "  KALDI  ") + label + ("  " + extra if extra else ""))
    if not cond:
        ok = False


print("1) HA'nin cagirdigi her sey @callback tasiyor")
for name in LOOP:
    pat = r"@callback\n    (?:async )?def " + name + r"\("
    check(name, re.search(pat, src) is not None,
          "" if re.search(pat, src) else "@callback DUSMUS")

print("2) tik gercekten is yapiyor (bos govde degil)")
body = src.split("def _tick(self, _now)")[1].split("\n    def ")[0]
for must in ("self._sweep()", "self._account("):
    check(must, must in body)

print("3) suslemeyi yanlis yere kondurmus yamalar")
# Inserting a method *before* a decorated one leaves the decorator on the new
# method. Anything that only reads state has no business carrying it.
for name in ("_watch_devices", "_watch_stuck", "room_entities"):
    pat = r"@callback\n    def " + name + r"\("
    check(name + " suslenmemis", re.search(pat, src) is None)

print()
print("HEPSI GECTI" if ok else "BASARISIZ")
sys.exit(0 if ok else 1)
