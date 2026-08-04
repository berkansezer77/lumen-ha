"""LUMEN — the engine.

The panel is where the rules are *defined*; this module is what actually *runs*.
No automations, no helpers, no YAML: one listener set, one decision function.

The decision is deliberately split in two questions, because they have different
answers:

    1. Should the light come on at all?   -> slot on/off, lux gate, mode, locks
    2. How should it come on?             -> group, brightness, colour temp

Everything is local and synchronous — a light must never wait for a network hop.
"""
from __future__ import annotations

import copy
import logging
import time
from collections import deque
from datetime import timedelta

from homeassistant.const import SUN_EVENT_SUNRISE, SUN_EVENT_SUNSET
from homeassistant.auth.permissions.const import POLICY_CONTROL
from homeassistant.core import Context, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import (
    async_call_later,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.storage import Store
from homeassistant.helpers.sun import get_astral_event_date
from homeassistant.util import dt as dt_util

from .const import (
    DEFAULT_CONFIG,
    DARK_TICK,
    OUTAGE_MIN,
    STUCK_MIN,
    STALE_DAYS,
    DEFAULT_MODES,
    DEFAULT_ROOM,
    DEFAULT_SLOT_RULE,
    DEFAULT_SLOT_RULES,
    DEFAULT_SLOTS,
    DOMAIN,
    FUSE_CALLS,
    LIGHT_DOMAINS,
    FUSE_PAUSE,
    FUSE_WINDOW,
    MAX_EVENTS,
    SIGNAL_EVENT,
    STORE_VERSION,
    TYPE_HINTS,
)

_LOGGER = logging.getLogger(__name__)

EVENTS_STORE_KEY = "lumen_events"
BACKUPS_STORE_KEY = "lumen_backups"
BRI_STORE_KEY = "lumen_bri"
PRESENCE_STORE_KEY = "lumen_presence"
USAGE_STORE_KEY = "lumen_usage"
MAX_BACKUPS = 20

# Home Assistant republishes every sensor on start and `last_changed` goes with
# it. Without this grace the whole house lights up on every restart.
BOOT_GRACE = 20.0

# How long after our own command a light change still counts as ours. Scenes and
# Hue groups reach the bulbs through the bridge, so their echo arrives late and
# without our context.
ACT_ECHO = 6.0

# One "switched by hand" line per episode, not one per bulb.

# Brightness the room drops to while it warns "I am about to go dark".
DIM_WARN_PCT = 30

LIGHT_FEATURE_TRANSITION = 32


def _merge(base: dict, raw: dict) -> dict:
    """One level of dict merge, used to fill in newly added settings."""
    out = copy.deepcopy(base)
    for key, val in (raw or {}).items():
        out[key] = val
    return out


def _migrate_layout(layout: dict) -> dict:
    """Rows -> a real x/y grid.

    The first drawing stacked rooms in rows, which is why a corridor could never
    run *past* three rooms. Rooms now carry coordinates, so one plan can be read
    both as a cutaway and as a floor plan — and nobody has to lay their home out
    a second time.
    """
    floors = []
    for floor in layout.get("floors") or []:
        if not isinstance(floor, dict):
            continue
        rooms: list[dict] = []
        if isinstance(floor.get("rooms"), list) and floor.get("rows") is None:
            for item in floor["rooms"]:            # already a grid
                if not isinstance(item, dict) or not item.get("id"):
                    continue
                room = {
                    "id": str(item["id"]),
                    "x": max(0, int(item.get("x") or 0)),
                    "y": max(0, int(item.get("y") or 0)),
                    "w": max(1, int(item.get("w") or 1)),
                    "h": max(1, int(item.get("h") or 1)),
                }
                # The width the user asked for, kept apart from the width the
                # room is drawn at once a row has been closed — see _reflow.
                if item.get("cw"):
                    room["cw"] = max(1, int(item["cw"]))
                rooms.append(room)
            cols = int(floor.get("cols") or 0) or max(
                [r["x"] + r["w"] for r in rooms] or [4])
            height = int(floor.get("rows_n") or 0) or max(
                [r["y"] + r["h"] for r in rooms] or [3])
        else:
            width, y = 0, 0
            for row in floor.get("rows") or []:
                x = 0
                start = len(rooms)
                for item in (row or {}).get("rooms") or []:
                    if not isinstance(item, dict) or not item.get("id"):
                        continue
                    span = max(1, int(item.get("w") or 1))
                    rooms.append({"id": str(item["id"]), "x": x, "y": y,
                                  "w": span, "h": 1})
                    x += span
                if x:
                    y += 1
                    width = max(width, x)
                    # Stretch the last room of a short row so the plan has no
                    # hole where a wall should be.
                    if len(rooms) > start:
                        rooms[-1]["_row_end"] = True
            cols = max(1, width)
            for room in rooms:
                if room.pop("_row_end", False):
                    room["w"] = max(1, cols - room["x"])
            height = max(1, y)
        cols = max(1, min(16, cols))
        height = max(1, min(16, height))
        # A plan with no free cell cannot be rearranged at all — you would have
        # to grow it before moving anything. Leave one row of elbow room.
        used = sum(r["w"] * r["h"] for r in rooms)
        if rooms and used >= cols * height and height < 16:
            height += 1
        floors.append({
            "id": str(floor.get("id") or f"f{len(floors) + 1}"),
            "name": str(floor.get("name") or ""),
            "cols": cols,
            "rows_n": height,
            "rooms": rooms,
        })
    return {"floors": floors}


def _deep_default(raw: dict) -> dict:
    """Config from disk + every default the running version expects."""
    cfg = _merge(DEFAULT_CONFIG, raw)

    if not isinstance(cfg.get("slots"), list) or not cfg["slots"]:
        cfg["slots"] = copy.deepcopy(DEFAULT_SLOTS)
    if not isinstance(cfg.get("modes"), list) or not cfg["modes"]:
        cfg["modes"] = copy.deepcopy(DEFAULT_MODES)
    # Sleep, Cinema and Holiday were three ways of saying "dim everything" that
    # nobody set up. They are gone; anything standing on one falls back to
    # Normal rather than to a mode that no longer exists.
    dropped = {"sleep", "cinema", "holiday", "guest"}
    cfg["modes"] = [m for m in cfg["modes"]
                    if isinstance(m, dict) and m.get("key") not in dropped]
    if not any(m.get("key") == "normal" for m in cfg["modes"]):
        cfg["modes"].insert(0, copy.deepcopy(DEFAULT_MODES[0]))
    if not any(m.get("key") == "alone" for m in cfg["modes"]):
        cfg["modes"].insert(1, copy.deepcopy(DEFAULT_MODES[1]))
    for mode in cfg["modes"]:
        # Whether a room may switch on is the room's business, and how long it
        # waits to go dark is the slot's. A mode that could also answer those
        # was a second place to look — and a second place to be wrong.
        for gone in ("auto_on", "auto_off", "only_rooms", "rooms_off",
                     "kill_others", "grace"):
            mode.pop(gone, None)
        if mode.get("key") == "normal":
            mode["bri"] = mode["kelvin"] = None
            mode["expire_h"] = 0
        if mode.get("key") != "alone":
            continue
        # the follow-me mode owns exactly two settings now
        mode["bri"] = mode["kelvin"] = None

        mode["expire_h"] = 0
        name = mode.get("name")
        if isinstance(name, dict) and name.get("tr") in ("Yalnız", None):
            mode["name"] = {"tr": "Tek Oda", "en": "One Room"}
        if not isinstance(mode.get("enter"), dict):
            mode["enter"] = {}
        mode["keep"] = [str(r) for r in (mode.get("keep") or []) if isinstance(r, str)]
    if str(cfg.get("mode") or "") in dropped:
        cfg["mode"] = "normal"
        cfg["mode_until"] = 0
    if not isinstance(cfg.get("rooms"), dict):
        cfg["rooms"] = {}
    if not isinstance(cfg.get("layout"), dict):
        cfg["layout"] = {"floors": []}
    cfg["layout"] = _migrate_layout(cfg["layout"])
    if not isinstance(cfg.get("overrides"), dict):
        cfg["overrides"] = {}
    cfg["ignored"] = sorted({str(e) for e in (cfg.get("ignored") or [])
                             if isinstance(e, str) and "." in e})
    cfg["skip_areas"] = sorted({str(a) for a in (cfg.get("skip_areas") or [])
                                if isinstance(a, str) and a})
    art = cfg.get("scene_art")
    cfg["scene_art"] = {
        key: str((art or {}).get(key) or "")
        for key in ("floor_day", "floor_night", "back_day", "back_night")
    }
    # An area taken out of the house stays out, however it got in.
    for area in cfg["skip_areas"]:
        cfg["rooms"].pop(area, None)
    # The 3D floor plan experiment was dropped. Its settings are stripped on the
    # next save rather than carried around for ever; the previous configuration
    # is still in the version history if it is ever wanted back.
    cfg.pop("floorplan_3d", None)

    slot_keys = [str(s.get("key")) for s in cfg["slots"]]
    rooms = {}
    for rid, room in cfg["rooms"].items():
        room = _merge(DEFAULT_ROOM, room if isinstance(room, dict) else {})
        # Kaldırılan "bu ışığa kim dokundu" tahmininden kalanlar. Motor
        # hiçbirini okumuyordu; ayar dosyasında durup "bu ne işe yarıyor"
        # sorusunu doğuruyorlardı.
        for olu in ("manual_respect", "respect_set", "manual_off"):
            room.pop(olu, None)
        for dilim in (room.get("slots") or {}).values():
            if isinstance(dilim, dict):
                dilim.pop("keep_manual_off", None)
        if not room.get("fade_set"):
            room["transition"] = 0
            room["fade_set"] = True
        slots = room.get("slots") if isinstance(room.get("slots"), dict) else {}
        # The trigger delay and the dim warning used to be one value for the
        # whole room. They belong to the slot: a hallway wants no delay at night
        # and one at noon. The old room-wide value seeds every slot that has not
        # been given its own, so nobody's setting is quietly reset to zero.
        legacy = {k: room[k] for k in ("delay_on", "dim_warn")
                  if isinstance(room.get(k), (int, float))}
        # Every sensor setting now belongs to the slot: which sensors wake the
        # room, which keep it awake, whether one is enough or all must agree.
        # A room that was set up before this hands its lists to every slot, so
        # nothing changes for anyone who had already tuned their house.
        for key, room_key, fallback in (
            ("trigger_pick", "trigger", []),
            ("hold_pick", "hold", []),
            ("trigger_mode", "trigger_mode", "any"),
            ("hold_mode", "hold_mode", "any"),
            ("and_window", "and_window", 30),
        ):
            legacy[key] = room.get(room_key, fallback)
        room["slots"] = {}
        for k in slot_keys:
            stored = slots.get(k) or {}
            rule = _merge(DEFAULT_SLOT_RULES.get(k, DEFAULT_SLOT_RULE), stored)
            for old, val in legacy.items():
                if old not in stored:
                    rule[old] = val
            room["slots"][k] = rule
        room.pop("delay_on", None)
        room.pop("dim_warn", None)
        room.pop("trigger_mode", None)
        room.pop("hold_mode", None)
        room.pop("and_window", None)
        # The room's own lists are now derived: everything the slots between
        # them listen to. They exist so the engine knows which entities to
        # subscribe to, and are never edited directly.
        for role, pick in (("trigger", "trigger_pick"), ("hold", "hold_pick")):
            seen = []
            for rule in room["slots"].values():
                for eid in rule.get(pick) or []:
                    if isinstance(eid, str) and eid not in seen:
                        seen.append(eid)
            room[role] = sorted(seen) if seen else sorted(room.get(role) or [])
        groups = []
        for grp in room.get("groups") or []:
            if not isinstance(grp, dict) or not grp.get("key"):
                continue
            groups.append({
                "key": str(grp["key"]),
                "name": str(grp.get("name") or grp["key"]),
                "lights": [e for e in (grp.get("lights") or []) if isinstance(e, str)],
            })
        room["groups"] = groups
        wear = str(room.get("icon") or "").strip().lower()
        room["icon"] = wear if wear.startswith("mdi:") else ""
        rooms[str(rid)] = room
    cfg["rooms"] = rooms
    return cfg


class LumenEngine:
    """Holds the configuration and runs the lights."""

    def __init__(self, hass: HomeAssistant, store: Store) -> None:
        self.hass = hass
        self.store = store
        self.events_store = Store(hass, STORE_VERSION, EVENTS_STORE_KEY)
        self.bri_store = Store(hass, STORE_VERSION, BRI_STORE_KEY)
        self.presence_store = Store(hass, STORE_VERSION, PRESENCE_STORE_KEY)
        self.usage_store = Store(hass, STORE_VERSION, USAGE_STORE_KEY)
        self.backups_store = Store(hass, STORE_VERSION, BACKUPS_STORE_KEY)
        self.config: dict = copy.deepcopy(DEFAULT_CONFIG)
        self.events: list[dict] = []
        self.backups: list[dict] = []
        # room -> [{t, lux, slot}] taken when a light was switched on by hand
        # "YYYY-MM-DD" -> room -> seconds lit
        self.usage: dict[str, dict[str, int]] = {}
        self._usage_dirty = False
        self._notified_at = 0.0

        # Runtime state per room — never persisted, always rebuilt.
        self.rt: dict[str, dict] = {}
        self._unsubs: list = []
        self._tick_unsub = None
        # Context ids of the service calls we made, so a state change can be
        # told apart from a human flipping the switch.
        self._ctx: deque[str] = deque(maxlen=400)
        self._stuck_marked: list[str] = []
        # Bir servis çağrısı sırasında, komutu veren kullanıcı. Yalnız senkron
        # bir zincir boyunca doludur (araya await girmez), sonra boşaltılır.
        self._as_user: str | None = None
        self._backup_at = 0.0
        self.presence: dict[str, dict[str, int]] = {}
        # entity -> when it went away. Kept in memory: after a restart every
        # device is asked again from scratch, which is the honest answer.
        self.down: dict[str, float] = {}
        self._told: set[str] = set()
        self._boot_at = time.time()
        self._slot_now: str = ""

    # ------------------------------------------------------------------ config
    async def async_load(self) -> None:
        raw = await self.store.async_load()
        self.config = _deep_default(raw or {})
        stored = await self.events_store.async_load()
        if isinstance(stored, dict) and isinstance(stored.get("events"), list):
            self.events = stored["events"][:MAX_EVENTS]
        # How each room was last set. In memory only, this was forgotten on every
        # restart and "the last setting" started from nothing again.
        seen = await self.presence_store.async_load()
        if isinstance(seen, dict) and isinstance(seen.get("days"), dict):
            self.presence = {str(k): dict(v) for k, v in seen["days"].items()
                             if isinstance(v, dict)}
        kept_bri = await self.bri_store.async_load()
        if isinstance(kept_bri, dict) and isinstance(kept_bri.get("rooms"), dict):
            for rid, memory in kept_bri["rooms"].items():
                if isinstance(memory, dict):
                    self._state(str(rid))["last_bri"] = {
                        str(k): int(v) for k, v in memory.items()
                        if isinstance(v, (int, float)) and 1 <= int(v) <= 100}
        used = await self.usage_store.async_load()
        if isinstance(used, dict) and isinstance(used.get("days"), dict):
            self.usage = {str(k): dict(v) for k, v in used["days"].items()
                          if isinstance(v, dict)}
        kept = await self.backups_store.async_load()
        if isinstance(kept, dict) and isinstance(kept.get("backups"), list):
            self.backups = kept["backups"][:MAX_BACKUPS]

    async def async_save(self, cfg: dict) -> None:
        new = _deep_default(cfg)
        # Dragging one room across the plan is a dozen saves; each used to
        # leave its own snapshot, and ten minutes of tidying buried the state
        # worth going back to under near-identical copies. One snapshot holds
        # the sitting: the first save takes it, the rest are the same sitting.
        recent = time.time() - self._backup_at < 600
        if self.config and new != self.config and not recent:
            self.backups.insert(0, {
                "ts": dt_util.now().isoformat(timespec="seconds"),
                "config": copy.deepcopy(self.config),
            })
            self._backup_at = time.time()
            del self.backups[MAX_BACKUPS:]
            await self.backups_store.async_save({"backups": self.backups})
        self.config = new
        await self.store.async_save(self.config)

    def backup_list(self) -> list[dict]:
        out = []
        for i, item in enumerate(self.backups):
            cfg = item.get("config") or {}
            rooms = cfg.get("rooms") or {}
            out.append({
                "index": i,
                "ts": item.get("ts", ""),
                "rooms": len(rooms),
                "lights": sum(len((r or {}).get("lights") or []) for r in rooms.values()),
                "mode": cfg.get("mode", ""),
            })
        return out

    async def async_restore_backup(self, index: int) -> bool:
        if index < 0 or index >= len(self.backups):
            return False
        wanted = copy.deepcopy(self.backups[index].get("config") or {})
        await self.async_save(wanted)
        return True

    @property
    def lang(self) -> str:
        return "tr" if self.config.get("lang") == "tr" else "en"

    def tr(self, turkish: str, english: str) -> str:
        return turkish if self.lang == "tr" else english

    # -------------------------------------------------------------------- names
    def name_of(self, eid: str) -> str:
        st = self.hass.states.get(eid)
        if st and st.attributes.get("friendly_name"):
            return st.attributes["friendly_name"]
        return eid

    def room_name(self, rid: str) -> str:
        area = ar.async_get(self.hass).async_get_area(rid)
        return area.name if area else rid

    # -------------------------------------------------------------------- log
    @callback
    def log(self, room: str, action: str, text: str, extra: dict | None = None) -> None:
        """One line per decision. This is the answer to 'why did that happen?'."""
        entry = {
            "ts": dt_util.now().isoformat(timespec="seconds"),
            "room": room,
            "action": action,
            "text": text,
        }
        if extra:
            entry["d"] = extra
        self.events.insert(0, entry)
        del self.events[MAX_EVENTS:]
        self.hass.async_create_task(
            self.events_store.async_save({"events": self.events})
        )
        async_dispatcher_send(self.hass, SIGNAL_EVENT)

    # ------------------------------------------------------------------- rooms
    def rooms(self) -> dict[str, dict]:
        return self.config.get("rooms") or {}

    def room(self, rid: str) -> dict:
        return self.rooms().get(rid) or copy.deepcopy(DEFAULT_ROOM)

    def _state(self, rid: str) -> dict:
        return self.rt.setdefault(rid, {
            "on_by_us": False, "off_at": 0.0, "dim": False,
            "acted_at": 0.0,
            # Set only by the panel's "leave this room alone for N hours".
            "lux_frozen": None, "paused_until": 0.0,
            # LUMEN offers to put a room out once per empty spell. gave_off
            # remembers that the offer has been made; from then on a light that
            # is on again is watched, not fought — stuck_since is when the
            # watching started, stuck_told whether it has been mentioned.
            "gave_off": False, "stuck_since": 0.0, "stuck_told": False,
            # Somebody has actually been in this room since its light came on.
            # Switching off answers a departure; without a somebody there is
            # no departure to answer — see _maybe_clear.
            "seen": False,
            "dark_at": 0.0,         # last time the darkness watch looked
            "lit_at": 0.0,          # when this room's light last came on
            # entity -> the last brightness it was actually seen at, so that
            # "the last setting" can mean something we know rather than
            # something the bulb claims to remember
            "last_bri": {},
            "calls": deque(maxlen=FUSE_CALLS + 4), "timers": {},
            "last_slot": "",
        })

    def _cancel(self, rid: str, name: str) -> None:
        rts = self._state(rid)
        unsub = rts["timers"].pop(name, None)
        if unsub:
            unsub()

    def _later(self, rid: str, name: str, delay: float, func) -> None:
        self._cancel(rid, name)
        rts = self._state(rid)

        @callback
        def _fire(_now):
            rts["timers"].pop(name, None)
            func()

        rts["timers"][name] = async_call_later(self.hass, max(0.1, delay), _fire)

    # -------------------------------------------------------------------- modes
    def mode_cfg(self, key: str | None = None) -> dict:
        key = key or self.config.get("mode") or "normal"
        for mode in self.config.get("modes") or []:
            if mode.get("key") == key:
                return _merge(DEFAULT_MODES[0], mode)
        return _merge(DEFAULT_MODES[0], {"key": key})

    def mode_name(self, key: str | None = None) -> str:
        name = self.mode_cfg(key).get("name") or {}
        if isinstance(name, dict):
            return name.get(self.lang) or name.get("en") or str(key)
        return str(name)

    async def async_set_mode(self, key: str) -> None:
        keys = [m.get("key") for m in self.config.get("modes") or []]
        if key not in keys:
            raise ValueError(f"Unknown mode: {key}")
        mode = self.mode_cfg(key)
        self.config["mode"] = key
        hours = int(mode.get("expire_h") or 0)
        self.config["mode_until"] = time.time() + hours * 3600 if hours else 0
        await self.store.async_save(self.config)
        self.log("", "mode", self.tr(
            f"Mod: {self.mode_name(key)}", f"Mode: {self.mode_name(key)}"))
        # Rooms that this mode leaves alone should not keep a pending timer —
        # and leaving One Room mode must call off the sweep it started, or a
        # room would go dark under a mode that is no longer running.
        for rid in list(self.rooms()):
            if key != "alone":
                self._cancel(rid, "off")
                self._cancel(rid, "dim")
                self._state(rid)["off_at"] = 0.0
        async_dispatcher_send(self.hass, f"{DOMAIN}_mode")

    def _blocked_by(self, rid: str) -> str:
        """Bu dilimde odayı açmayı engelleyen bir durum var mı?

        Süreli kilidin yerini aldı. "Şu kadar dakika kapalı kalsın" hatırlamayı
        gerektiriyordu; bu ise evin kendi hâline bakıyor: televizyon açıkken
        salonun ışığı açılmasın, biri uyuyorken yatak odası açılmasın.

        Yalnız AÇMAYI engeller. Yanan bir ışığı söndürmez, geri sayımı
        durdurmaz — koşul, ışığın açılmasına dairdir.

        Durum elle yazılıyor çünkü hangi cihazın hangi durumu taşıdığı
        markadan markaya değişiyor: bir televizyon "playing" der, bir başkası
        "on".
        """
        for kosul in (self.slot_rule(rid).get("block") or []):
            if not isinstance(kosul, dict):
                continue
            eid = str(kosul.get("entity") or "").strip()
            beklenen = str(kosul.get("state") or "").strip()
            if not eid or not beklenen:
                continue
            st = self.hass.states.get(eid)
            if st is None:
                continue
            if str(st.state).strip().lower() == beklenen.lower():
                return self.tr(f"{self._name_of(eid)} = {beklenen}",
                               f"{self._name_of(eid)} = {beklenen}")
        return ""

    def _mode_allows(self, rid: str, mode: dict) -> tuple[bool, str]:
        """Can this room switch on under the current mode?"""
        room = self.room(rid)
        if mode.get("key") in (room.get("mode_off") or []):
            return False, self.tr(
                f"oda {self.mode_name()} modunda hariç tutulmuş",
                f"room is excluded in {self.mode_name()} mode")
        return True, ""

    # -------------------------------------------------------------------- slots
    def _sun(self, event: str):
        try:
            stamp = get_astral_event_date(self.hass, event, dt_util.now().date())
        except Exception:  # noqa: BLE001 - astral can refuse at the poles
            stamp = None
        return dt_util.as_local(stamp) if stamp else None

    def sun_times(self) -> dict:
        out = {}
        for name, event in (("sunrise", SUN_EVENT_SUNRISE), ("sunset", SUN_EVENT_SUNSET)):
            stamp = self._sun(event)
            out[name] = stamp.strftime("%H:%M") if stamp else ""
            out[f"{name}_min"] = stamp.hour * 60 + stamp.minute if stamp else None
        return out

    def _spec_minutes(self, spec: str) -> int | None:
        """'20:30', 'sunset-60', 'sunrise+30' -> minutes since midnight."""
        spec = str(spec or "").strip().lower()
        if not spec:
            return None
        for event, key in ((SUN_EVENT_SUNRISE, "sunrise"), (SUN_EVENT_SUNSET, "sunset")):
            if spec.startswith(key):
                stamp = self._sun(event)
                if not stamp:
                    return 420 if key == "sunrise" else 1230   # sane fallback
                base = stamp.hour * 60 + stamp.minute
                rest = spec[len(key):].replace(" ", "")
                if rest:
                    try:
                        base += int(rest)
                    except ValueError:
                        pass
                return base % 1440
        if ":" in spec:
            try:
                hour, minute = spec.split(":")[:2]
                return (int(hour) * 60 + int(minute)) % 1440
            except ValueError:
                return None
        try:
            return int(spec) % 1440
        except ValueError:
            return None

    def slot_bounds(self) -> list[dict]:
        """Every slot with its resolved start and end minute.

        Only the start is configured. Each slot runs until the next one begins,
        so the day is always a clean partition: no hour belongs to two slots, and
        no hour belongs to none. Letting both ends be set by hand produced
        exactly those two faults.
        """
        out = []
        for slot in self.config.get("slots") or []:
            name = slot.get("name") or {}
            out.append({
                "key": str(slot.get("key")),
                "name": (name.get(self.lang) or name.get("en") or slot.get("key"))
                if isinstance(name, dict) else str(name),
                "from": slot.get("from"), "to": slot.get("to"),
                "start": self._spec_minutes(slot.get("from")), "end": None,
            })
        timed = sorted([s for s in out if s["start"] is not None],
                       key=lambda s: s["start"])
        for i, slot in enumerate(timed):
            if len(timed) == 1:
                slot["end"] = slot["start"]          # one slot owns the day
            else:
                slot["end"] = timed[(i + 1) % len(timed)]["start"]
        return out

    def slot_now(self) -> str:
        now = dt_util.now()
        minutes = now.hour * 60 + now.minute
        for slot in self.slot_bounds():
            start, end = slot["start"], slot["end"]
            if start is None or end is None:
                continue
            if start == end:                      # a single slot covers the day
                return slot["key"]
            inside = (start <= minutes < end) if start <= end else (
                minutes >= start or minutes < end)
            if inside:
                return slot["key"]
        slots = self.config.get("slots") or []
        return str(slots[0].get("key")) if slots else ""

    def slot_name(self, key: str) -> str:
        return next((s["name"] for s in self.slot_bounds() if s["key"] == key), key)

    def slot_rule(self, rid: str, slot: str | None = None) -> dict:
        slot = slot or self.slot_now()
        room = self.room(rid)
        rules = room.get("slots") or {}
        return _merge(DEFAULT_SLOT_RULES.get(slot, DEFAULT_SLOT_RULE),
                      rules.get(slot) or {})

    # --------------------------------------------------------------- sensors
    def _is_on(self, eid: str) -> bool:
        st = self.hass.states.get(eid)
        return bool(st and st.state == "on")

    def motion_active(self, rid: str) -> bool:
        return any(self._is_on(e) for e in self.room(rid).get("trigger") or [])

    def _seen_recently(self, eid: str, window: float) -> bool:
        """On now, or on so recently that it counts as the same visit."""
        st = self.hass.states.get(eid)
        if st is None:
            return False
        if st.state == "on":
            return True
        if st.state != "off":
            return False
        changed = getattr(st, "last_changed", None)
        if changed is None:
            return False
        try:
            gone = (dt_util.utcnow() - changed).total_seconds()
        except TypeError:
            return False
        return 0 <= gone <= window

    def slot_sensors(self, rid: str, role: str, slot: str | None = None) -> list[str]:
        """The sensors this slot uses for a role.

        The sensor that should wake a bathroom at three in the morning is not
        the one that should wake it at noon, so the choice belongs to the slot.
        The room's own list is only the sum of them, kept for the subscriptions.
        """
        pool = list(self.room(rid).get(role) or [])
        picked = [e for e in (self.slot_rule(rid, slot).get(role + "_pick") or [])
                  if e in pool]
        return picked or pool

    def slot_triggers(self, rid: str, slot: str | None = None) -> list[str]:
        return self.slot_sensors(rid, "trigger", slot)

    def trigger_ready(self, rid: str) -> bool:
        """Are the wakers saying enough to switch the light on?

        With "all", every one of them has to have seen something — not in the
        same instant, which two different kinds of sensor almost never manage,
        but within the room's window.
        """
        rule = self.slot_rule(rid)
        eids = self.slot_triggers(rid)
        if not eids:
            return False
        if rule.get("trigger_mode") != "all":
            return any(self._is_on(e) for e in eids)
        window = float(rule.get("and_window") or 30)
        return all(self._seen_recently(e, window) for e in eids)

    def hold_active(self, rid: str) -> bool:
        eids = self.slot_sensors(rid, "hold")
        if not eids:
            return False
        if self.slot_rule(rid).get("hold_mode") == "all":
            return all(self._is_on(e) for e in eids)
        return any(self._is_on(e) for e in eids)

    def occupied(self, rid: str) -> bool:
        return self.motion_active(rid) or self.hold_active(rid)

    def lux_value(self, rid: str) -> float | None:
        eid = self.room(rid).get("lux") or ""
        if not eid:
            return None
        st = self.hass.states.get(eid)
        if not st or st.state in ("unknown", "unavailable", ""):
            return None
        try:
            return float(st.state)
        except (TypeError, ValueError):
            return None

    def _lux_for_decision(self, rid: str) -> float | None:
        """The room's darkness *before* we lit it.

        The lux sensor usually sits in the same room as the lamp, so once the
        light is on it reads its own glow. Freezing the pre-switch value is what
        keeps the room from arguing with itself.
        """
        rts = self._state(rid)
        if rts["on_by_us"] and rts["lux_frozen"] is not None:
            return rts["lux_frozen"]
        return self.lux_value(rid)

    # ---------------------------------------------------------------- lights
    def rule_lights(self, rid: str, rule: dict, going: str = "on") -> list[str]:
        """Which lights this slot switches: groups, single lamps, or both.

        Nothing chosen means the whole room — the sane default, and the reason a
        fresh room works before anyone has set anything up.

        Switching off asks the same question separately: a room that lights only
        the TV corner on the way in may still want everything put out on the way
        out. Left empty, and it does exactly that.
        """
        room = self.room(rid)
        gkey = "off_groups" if going == "off" else "groups"
        pkey = "off_picks" if going == "off" else "picks"
        keys = rule.get(gkey) or []
        picks = [e for e in (rule.get(pkey) or [])
                 if e in (room.get("lights") or [])]
        if not keys and not picks:
            return list(room.get("lights") or [])
        wanted, seen = [], set()
        for grp in room.get("groups") or []:
            if grp.get("key") not in keys:
                continue
            for eid in grp.get("lights") or []:
                if eid not in seen:
                    seen.add(eid)
                    wanted.append(eid)
        for eid in picks:
            if eid not in seen:
                seen.add(eid)
                wanted.append(eid)
        return wanted or list(room.get("lights") or [])

    def is_light_group(self, eid: str) -> bool:
        """A light that carries other lights: a Hue room/zone or a group helper."""
        if eid.split(".")[0] != "light":
            return False
        st = self.hass.states.get(eid)
        members = st.attributes.get("entity_id") if st else None
        # Hue hands this over as a *set*, the group helper as a list, and the
        # REST API turns both into an array — so accept any collection of ids
        # rather than a particular type.
        if members is None or isinstance(members, str):
            return False
        try:
            return len(members) > 1
        except TypeError:
            return False

    def lights_on(self, rid: str) -> list[str]:
        return [e for e in self.room(rid).get("lights") or [] if self._is_on(e)]

    def can_dim(self, eid: str) -> bool:
        """Can this thing hold a brightness at all?

        A wall switch cannot. Sending it the warning dim costs a command it
        can do nothing with — and one more command to a two-gang switch, a
        second before we ask it to go off, is exactly how a device ends up
        swallowing one of them.
        """
        st = self.hass.states.get(eid)
        modes = [str(m).lower() for m in
                 ((st.attributes.get("supported_color_modes") or []) if st else [])]
        return bool(modes) and modes != ["onoff"]

    def _payload(self, eid: str, bri: int | None, kelvin: int | None,
                 transition: float | None, color=None) -> dict:
        st = self.hass.states.get(eid)
        data: dict = {}
        if eid.split(".")[0] != "light":
            return data
        modes = [str(m).lower() for m in
                 ((st.attributes.get("supported_color_modes") or []) if st else [])]
        dimmable = bool(modes) and modes != ["onoff"]
        if bri is not None and dimmable:
            data["brightness_pct"] = max(1, min(100, int(bri)))
        if color and any(m in modes for m in ("hs", "rgb", "rgbw", "rgbww", "xy")):
            data["rgb_color"] = [int(c) for c in color[:3]]
        elif kelvin and "color_temp" in modes:
            data["color_temp_kelvin"] = int(kelvin)
        if transition:
            feats = int(st.attributes.get("supported_features") or 0) if st else 0
            if feats & LIGHT_FEATURE_TRANSITION:
                data["transition"] = float(transition)
        return data

    def _fuse_ok(self, rid: str) -> bool:
        """Stop a room that is flapping instead of letting it strobe all night."""
        rts = self._state(rid)
        now = time.time()
        if rts["paused_until"] > now:
            return False
        rts["calls"].append(now)
        recent = [t for t in rts["calls"] if now - t <= FUSE_WINDOW]
        if len(recent) >= FUSE_CALLS:
            rts["paused_until"] = now + FUSE_PAUSE
            rts["calls"].clear()
            self.log(rid, "fuse", self.tr(
                f"Sigorta attı — {self.room_name(rid)} {int(FUSE_PAUSE / 60)} dk "
                "duraklatıldı (ışık sürekli açılıp kapanıyordu)",
                f"Fuse tripped — {self.room_name(rid)} paused for "
                f"{int(FUSE_PAUSE / 60)} min (the light kept flapping)"))
            return False
        return True

    def _call(self, service: str, entities: list[str], data: dict) -> None:
        entities = [e for e in entities if self._is_light(e)]
        if not entities:
            return
        # Kimlik taşınır ki HA kullanıcının entity izinlerini uygulasın;
        # ctx.id yine bizim, "bu komutu ben verdim" tanıması bozulmaz.
        ctx = Context(user_id=self._as_user)
        self._ctx.append(ctx.id)
        payload = dict(data)
        payload["entity_id"] = entities
        domain = entities[0].split(".")[0]
        if domain != "light":
            payload = {"entity_id": entities}
        self.hass.async_create_task(
            self.hass.services.async_call(
                domain, service, payload, blocking=False, context=ctx)
        )

    @staticmethod
    def _is_light(eid: str) -> bool:
        """Is this something LUMEN is allowed to switch?

        A room's light list comes from the panel, which only offers lights and
        switches — but the configuration behind it is plain JSON, and anything
        that reaches the engine is acted on. So the rule lives here too.
        """
        return str(eid).split(".")[0] in LIGHT_DOMAINS

    def _apply(self, eids: list[str], on: bool, bri: int | None = None,
               kelvin: int | None = None, transition: float | None = None,
               color=None) -> None:
        """Switch a set of entities, batching identical payloads into one call."""
        buckets: dict[tuple, list[str]] = {}
        for eid in eids:
            st = self.hass.states.get(eid)
            if st is None or st.state == "unavailable":
                continue
            data = self._payload(eid, bri if on else None,
                                 kelvin if on else None, transition,
                                 color if on else None)
            if not on:
                data = {k: v for k, v in data.items() if k == "transition"}
            key = (eid.split(".")[0], tuple(sorted(data.items())))
            buckets.setdefault(key, []).append(eid)
        for (domain, items), group in buckets.items():
            self._call("turn_on" if on else "turn_off", group, dict(items))

    # ------------------------------------------------------------- decisions
    def decide(self, rid: str, slot: str | None = None) -> dict:
        """Would this room switch on right now, and how? (no side effects)

        This is the same function the panel's "what would happen now?" line
        calls, so the explanation can never drift from the behaviour.
        """
        room = self.room(rid)
        slot = slot or self.slot_now()
        rule = self.slot_rule(rid, slot)
        slot_name = next((s["name"] for s in self.slot_bounds() if s["key"] == slot), slot)
        rts = self._state(rid)
        now = time.time()

        def no(reason: str) -> dict:
            return {"on": False, "slot": slot, "slot_name": slot_name,
                    "reason": reason, "lights": [], "bri": None, "kelvin": None}

        if not self.config.get("enabled", True):
            return no(self.tr("motor kapalı", "engine is off"))
        if not room.get("on", True):
            return no(self.tr("oda kapalı", "room is off"))
        if rts["paused_until"] > now:
            left = int(rts["paused_until"] - now)
            return no(self.tr(f"sigorta attı, {left} sn", f"fuse tripped, {left} s"))
        engel = self._blocked_by(rid)
        if engel:
            return no(engel)

        mode = self.mode_cfg()
        allowed, why = self._mode_allows(rid, mode)
        if not allowed:
            return no(why)

        lights = self.rule_lights(rid, rule)
        if not lights:
            return no(self.tr("odada ışık atanmamış", "no lights assigned"))

        lux_max = rule.get("lux_max")
        lux = self._lux_for_decision(rid)
        dark = lux_max is not None and lux is not None and lux <= float(lux_max)

        # The darkness threshold outranks the slot: a slot switched off still
        # lights up when the room is genuinely dark. Turning a slot off means
        # "not for the sake of the hour", never "stay dark no matter what".
        if not rule.get("on", True):
            if not dark:
                return no(self.tr(
                    f"{slot_name} diliminde açma kapalı ve oda karanlık değil",
                    f"{slot_name} is off and the room is not dark"))

        if lux_max is not None and lux is not None and not dark:
            return no(self.tr(f"lux {lux:g} > {lux_max:g}", f"lux {lux:g} > {lux_max:g}"))

        how = str(rule.get("mode") or "set")
        bri = rule.get("bri")
        kelvin = rule.get("kelvin")
        color = rule.get("color")
        scene = str(rule.get("scene") or "")
        if how == "scene" and not scene:
            how = "set"
        if how != "set":
            bri = kelvin = color = None
        if mode.get("bri") is not None:
            bri = mode["bri"]
            how = "set" if how == "last" else how
        if mode.get("kelvin") is not None:
            kelvin = mode["kelvin"]

        bits = []
        if lux_max is None:
            bits.append(self.tr("lux'e bakılmıyor", "lux ignored"))
        elif lux is not None:
            bits.append(f"lux {lux:g} ≤ {lux_max:g}")
        bits.append(str(slot_name))
        if not rule.get("on", True):
            bits.append(self.tr("karanlık kuralı", "darkness rule"))
        if how == "scene":
            bits.append(self.name_of(scene))
        elif how == "last":
            bits.append(self.tr("son ayar", "last setting"))
        else:
            if bri is not None:
                bits.append(f"%{int(bri)}" if self.lang == "tr" else f"{int(bri)}%")
            if kelvin:
                bits.append(f"{int(kelvin)}K")
        return {"on": True, "slot": slot, "slot_name": slot_name,
                "reason": " · ".join(bits), "lights": lights, "how": how,
                "bri": bri, "kelvin": kelvin, "color": color, "scene": scene}

    # ------------------------------------------------------------- switching
    def trigger(self, rid: str, source: str = "") -> None:
        """Something moved in the room (or in a room it listens to)."""
        room = self.room(rid)
        rts = self._state(rid)
        rts["seen"] = True          # a sensor fired: somebody is here
        # Any pending "go dark" is off the table the moment we see life.
        self._cancel(rid, "off")
        if rts["dim"]:
            self._cancel(rid, "dim")
            decision = self.decide(rid)
            if decision["on"]:
                rts["dim"] = False
                self._switch_on(rid, decision)
                # whatever the mode did with it, the borrowed brightness has
                # been handed back and must not be handed back twice
                rts["predim"] = {}
                self.log(rid, "on", self.tr(
                    f"{self.room_name(rid)} geri açıldı — kapanmadan önce hareket",
                    f"{self.room_name(rid)} restored — motion before going dark"))
                return
            # Not switching on — but the lamp is still sitting at the warning
            # dim, and leaving it there is how a room ends up dim for ever.
            self._undim(rid)

        delay = int(self.slot_rule(rid).get("delay_on") or 0)
        if delay > 0 and not rts["on_by_us"]:
            self._later(rid, "delay", delay, lambda: self._do_on(rid, source))
        else:
            self._do_on(rid, source)

        # Neighbour rooms borrow this room's trigger (sensor-less hallways).
        if source != "neighbor":
            for other, cfg in self.rooms().items():
                if other != rid and rid in (cfg.get("neighbors") or []):
                    self.trigger(other, "neighbor")

    def _do_on(self, rid: str, source: str = "", asked: bool = False) -> None:
        decision = self.decide(rid)
        room = self.room(rid)
        rts = self._state(rid)
        if asked and not decision["on"]:
            # Somebody asked. Keep the slot's answer to "how" — which lights,
            # how bright, what colour — and drop its answer to "whether".
            rule = self.slot_rule(rid)
            decision = {
                "on": True, "slot": self.slot_now(),
                "slot_name": decision.get("slot_name"),
                "reason": self.tr("panelden istendi", "asked for from the panel"),
                "lights": self.rule_lights(rid, rule),
                "how": str(rule.get("mode") or "set"),
                "bri": rule.get("bri"), "kelvin": rule.get("kelvin"),
                "scene": rule.get("scene"), "color": rule.get("color"),
            }
            if not decision["lights"]:
                self.log(rid, "block", self.tr(
                    f"{self.room_name(rid)} açılamadı — odada ışık atanmamış",
                    f"{self.room_name(rid)} could not open — no lights assigned"))
                return
        if not decision["on"]:
            # Only worth a log line when a human could be waiting for the light.
            if not rts["on_by_us"] and not self.lights_on(rid):
                self.log(rid, "block", self.tr(
                    f"{self.room_name(rid)} açılmadı — {decision['reason']}",
                    f"{self.room_name(rid)} stayed off — {decision['reason']}"))
            return

        # A motion sensor fires again and again while you are in the room. Doing
        # nothing here is not laziness: re-sending the same brightness would
        # spam the bulbs and — worse — would look like a runaway loop to the
        # fuse below, parking a room that is behaving perfectly.
        if (not asked and rts["on_by_us"] and not rts["dim"]
                and rts["last_slot"] == decision["slot"] and self.lights_on(rid)):
            self._maybe_clear(rid)
            return

        if not asked and not self._fuse_ok(rid):
            return

        if rts["lux_frozen"] is None:
            rts["lux_frozen"] = self.lux_value(rid)
        was_on = rts["on_by_us"]
        rts["on_by_us"] = True
        if self.occupied(rid):
            rts["seen"] = True
        if not was_on:
            rts["lit_at"] = time.time()
        rts["dim"] = False
        rts["acted_at"] = time.time()
        rts["last_slot"] = decision["slot"]
        self._switch_on(rid, decision)
        if not was_on or asked:
            extra = self.tr(" · komşudan", " · via neighbour") if source == "neighbor" else ""
            self.log(rid, "on", self.tr(
                f"{self.room_name(rid)} AÇ — {decision['reason']}{extra}",
                f"{self.room_name(rid)} ON — {decision['reason']}{extra}"),
                extra=self._on_detail(rid, decision))


        self._maybe_clear(rid)

    def _remember_bri(self, rid: str) -> None:
        """Note the brightness each lamp is really at.

        A lamp answering "on" at zero brightness is not a setting worth keeping
        — it is a lamp that has quietly gone out, and remembering it is how a
        room ends up switching itself on into the dark.
        """
        rts = self._state(rid)
        # Two locks on the same door: the flag, and the fact that we are still
        # holding somebody's brightness. The flag has been wrong before.
        if rts.get("dim") or rts.get("predim"):
            return              # our own warning dim is not anybody's setting
        memory = rts.setdefault("last_bri", {})
        for eid in self.lights_on(rid):
            st = self.hass.states.get(eid)
            raw = st.attributes.get("brightness") if st else None
            if raw:
                memory[eid] = max(1, min(100, round(int(raw) / 2.55)))
        self.bri_store.async_delay_save(
            lambda: {"rooms": {r: (self.rt.get(r) or {}).get("last_bri") or {}
                               for r in self.rooms()}}, 60)

    def _switch_on(self, rid: str, decision: dict, retry: bool = True) -> None:
        """Put the light on the way this slot asks for."""
        room = self.room(rid)
        fade = room.get("transition")
        how = decision.get("how") or "set"
        if retry and how != "scene":
            self._verify_on(rid, decision)
        if how == "scene" and str(decision.get("scene") or "").startswith("scene."):
            ctx = Context(user_id=self._as_user)
            self._ctx.append(ctx.id)
            self.hass.async_create_task(self.hass.services.async_call(
                "scene", "turn_on", {"entity_id": decision["scene"]},
                blocking=False, context=ctx))
            return
        if how == "last":
            # Whatever the lamp was set to last — except the dim we ourselves
            # applied as a warning, which would otherwise become "last".
            #
            # Asking a bulb to come on with no brightness at all used to be the
            # way to say "as you were". It is not: a Hue lamp answers that by
            # restoring whatever it has stored, and after a fade to black that
            # is zero. The room reports six lights on and the room is dark. So
            # we carry the brightness ourselves, and if we have never seen one,
            # the slot's own level stands in. Colour is left alone either way.
            rts = self._state(rid)
            back = rts.get("predim") or {}
            memory = rts.get("last_bri") or {}
            # The decision carries no brightness in this mode — that is what
            # the mode means — so the slot's own level is the thing to fall
            # back on when a lamp has never been seen lit.
            floor = self.slot_rule(rid, decision.get("slot")).get("bri") or 70
            # A wall switch has no brightness to remember, so it gains nothing
            # from its own private command — and a two-gang switch asked twice
            # in the same instant sometimes swallows the second ask. Everything
            # that cannot dim goes out as one grouped call, exactly the way a
            # hand-written automation would send it.
            plain = [e for e in decision["lights"]
                     if str(e).split(".")[0] != "light"]
            if plain:
                self._apply(plain, True, None, None, fade)
            for eid in decision["lights"]:
                if eid in plain:
                    continue
                level = back.get(eid) or memory.get(eid) or floor
                self._apply([eid], True, level, None, fade)
            rts["predim"] = {}
            return
        self._apply(decision["lights"], True, decision.get("bri"),
                    decision.get("kelvin"), fade, decision.get("color"))

    def _verify_on(self, rid: str, decision: dict) -> None:
        """A promise checked: did every lamp we asked for actually come on?

        A flaky wall switch swallows a command now and then. Once, a few
        seconds later, the ones still dark are asked again — once, because
        anything more is a wrestling match with a lamp that said no.
        """
        lights = [e for e in (decision.get("lights") or []) if self._is_light(e)]
        if not lights:
            return
        again = dict(decision)
        # Komutu kim verdiyse, yedi saniye sonraki tekrarı da o veriyor.
        # Kimliği burada yakalamazsak tekrar sistem çağrısı gibi gider ve
        # ilk komutu reddedilmiş bir kullanıcı ikincisiyle geçer.
        isteyen = self._as_user

        def check() -> None:
            missing = [e for e in lights if not self._is_on(e)]
            if not missing:
                return
            names = ", ".join(self._name_of(e) for e in missing[:4])
            self.log(rid, "warn", self.tr(
                f"{self.room_name(rid)}: {names} komuta uymadı — bir kez daha denendi",
                f"{self.room_name(rid)}: {names} did not answer — asked once more"))
            again["lights"] = missing
            onceki = self._as_user
            self._as_user = isteyen
            try:
                self._switch_on(rid, again, retry=False)
            finally:
                self._as_user = onceki

        self._later(rid, "verify", 7.0, check)

    def alone_sensors(self, rid: str) -> list[str]:
        """Which sensors mean "I have just walked into this room".

        Chosen per room, because the sensor that should move the whole house is
        not always the same one that switches a light on: a doorway sensor is a
        good arrival, a desk-facing radar is not.
        """
        mode = self.mode_cfg("alone")
        pool = list(self.room(rid).get("trigger") or []) + \
            list(self.room(rid).get("hold") or [])
        picked = [e for e in ((mode.get("enter") or {}).get(rid) or []) if e in pool]
        return picked or list(self.room(rid).get("trigger") or [])

    def alone_enter(self, rid: str) -> None:
        """One Room mode: whoever lives here is in *this* room now."""
        mode = self.mode_cfg()
        if mode.get("key") != "alone":
            return
        # The lit half of the promise. The normal trigger covers this when the
        # sensor changes, but a room can be entered without any sensor changing
        # its mind — you never really left, only the light did.
        if not self.lights_on(rid):
            decision = self.decide(rid)
            if decision["on"]:
                self._do_on(rid, "alone")
        keep = set(mode.get("keep") or [])
        for other in list(self.rooms()):
            if other == rid or other in keep:
                continue
            if not self.rooms()[other].get("on", True):
                continue
            # Deliberately not asking whether the other room looks occupied. A
            # motion sensor holds for half a minute after you walk out, so the
            # room you just left always looks busy — which meant walking the
            # length of the house lit every room and swept none of them. You
            # are demonstrably somewhere else; that is the whole premise. The
            # exception is per room, and it is called "leave alone".
            if not self.lights_on(other):
                continue
            # No countdown. You are demonstrably in another room, so there is
            # nothing to wait and see about — waiting only means walking into
            # the kitchen with the whole house still lit behind you.
            self._cancel(other, "off")
            self._cancel(other, "dim")
            self._do_off(other, "alone")

    def _maybe_clear(self, rid: str) -> None:
        """Nobody left? Start the countdown (with a dim warning at the end)."""
        room = self.room(rid)
        rts = self._state(rid)
        if self.occupied(rid):
            rts["seen"] = True
            rts["stuck_since"] = 0.0
            rts["gave_off"] = False
            self._cancel(rid, "off")
            self._cancel(rid, "dim")
            rts["off_at"] = 0.0
            self._undim(rid)
            return

        if not self.lights_on(rid):
            rts["off_at"] = 0.0
            rts["lux_frozen"] = None
            rts["on_by_us"] = False
            rts["stuck_since"] = 0.0
            rts["seen"] = False
            return
        # An empty room goes dark, whoever switched the light on. Anything else
        # leaves lamps burning after a restart, or after you flick a switch by
        # hand — which is exactly the thing this is supposed to prevent.
        # No departure, nothing to answer: nobody has been in this room since
        # the light came on, so somebody lit it deliberately from outside.
        # LUMEN keeps its hands off — if it burns long enough, it says so
        # instead (the stuck notification).
        if not rts.get("seen"):
            rts["off_at"] = 0.0
            return

        # LUMEN has already put this room out once since it emptied, and a
        # light is on again. Scheduling a second one starts a wrestling match
        # with whatever switched it back on, and a house that flickers all
        # night is worse than a lamp left burning. From here it only says so.
        if rts.get("gave_off"):
            rts["off_at"] = 0.0
            return

        rule = self.slot_rule(rid)
        if not rule.get("off_enabled", True):
            rts["off_at"] = 0.0
            return
        wait = float(rule.get("off_after") or 0)
        warn = float(rule.get("dim_warn") or 0)
        if wait <= 0:
            rts["off_at"] = time.time()
            self._later(rid, "off", 0.2, lambda: self._do_off(rid, "empty"))
            return
        rts["off_at"] = time.time() + wait
        if warn > 0 and wait > warn:
            self._later(rid, "dim", wait - warn, lambda: self._do_dim(rid))
        else:
            self._later(rid, "off", wait, lambda: self._do_off(rid, "empty"))

    def _undim(self, rid: str) -> None:
        """Put back what the warning dim borrowed.

        The dim is a gesture, not a setting: it says "I am about to go dark".
        Every path that abandons it — you walked back in, the mode changed,
        somebody touched a switch — has to hand the brightness back, or the
        lamp stays at thirty percent and, worse, thirty percent quietly becomes
        what the room remembers itself at.
        """
        rts = self._state(rid)
        back = rts.get("predim") or {}
        rts["dim"] = False
        if not back:
            return
        rts["predim"] = {}
        room = self.room(rid)
        rts["acted_at"] = time.time()
        for eid, pct in back.items():
            if self._is_on(eid):
                self._apply([eid], True, int(pct), None, room.get("transition"))

    def _do_dim(self, rid: str) -> None:
        room = self.room(rid)
        rts = self._state(rid)
        warn = float(self.slot_rule(rid).get("dim_warn") or 20)
        if self.occupied(rid):
            self._maybe_clear(rid)
            return
        if rts.get("predim"):
            return              # already warning; do not dim the dim
        lights = [e for e in self.lights_on(rid) if self.can_dim(e)]
        if not lights:
            # Nothing here can show a warning. The room still goes dark at the
            # same second it would have — it simply does it without the wink.
            self._later(rid, "off", warn, lambda: self._do_off(rid, "empty"))
            return
        rts["acted_at"] = time.time()
        rts["dim"] = True
        # Remember where each lamp was, so "keep the last setting" never means
        # "keep the warning dim".
        back = {}
        for eid in lights:
            st = self.hass.states.get(eid)
            raw = st.attributes.get("brightness") if st else None
            if raw:
                back[eid] = max(1, min(100, round(int(raw) / 2.55)))
        rts["predim"] = back
        self._apply(lights, True, DIM_WARN_PCT, None, room.get("transition"))
        self.log(rid, "dim", self.tr(
            f"{self.room_name(rid)} kısıldı — {int(warn)} sn içinde sönecek",
            f"{self.room_name(rid)} dimmed — going dark in {int(warn)} s"))
        self._later(rid, "off", warn, lambda: self._do_off(rid, "empty"))

    def _do_off(self, rid: str, why: str) -> None:
        room = self.room(rid)
        rts = self._state(rid)
        # "manual" is you pressing it; "slot" is you having asked for the light
        # to go out at this hour. Neither waits for the room to be empty.
        if why not in ("manual", "slot", "alone") and self.occupied(rid):
            self._maybe_clear(rid)
            return
        lights = self.lights_on(rid)
        if not lights:
            rts["on_by_us"] = False
            rts["dim"] = False
            rts["off_at"] = 0.0
            rts["lux_frozen"] = None
            rts["predim"] = {}
            return
        if not self._fuse_ok(rid):
            return
        self._remember_bri(rid)     # how it looked, for the next "last setting"
        rts["acted_at"] = time.time()
        fade = float(room.get("transition") or 0)
        self._apply(self.rule_lights(rid, self.slot_rule(rid), "off"), False,
                    transition=max(2.0, fade * 2) if fade > 0 else None)
        rts["on_by_us"] = False
        rts["dim"] = False
        rts["off_at"] = 0.0
        rts["lux_frozen"] = None
        rts["off_done_at"] = time.time()
        rts["seen"] = False
        # One offer per empty spell: LUMEN puts the room out once and does not
        # wrestle with whatever turns it back on.
        rts["gave_off"] = True
        reasons = {
            "empty": self.tr("oda boşaldı", "room is empty"),
            "alone": self.tr("Tek Oda modu — başka odaya geçildi",
                             "One Room mode — moved to another room"),
            "manual": self.tr("panelden", "from the panel"),
            "mode": self.tr("mod değişti", "mode changed"),
            "slot": self.tr(f"{self.slot_name(self.slot_now())} başladı",
                            f"{self.slot_name(self.slot_now())} began"),
        }
        self.log(rid, "off", self.tr(
            f"{self.room_name(rid)} KAPAT — {reasons.get(why, why)}",
            f"{self.room_name(rid)} OFF — {reasons.get(why, why)}"))

    # ------------------------------------------------------------- listeners
    def setup(self) -> None:
        """(Re)build every listener from the current configuration."""
        for unsub in self._unsubs:
            unsub()
        self._unsubs = []
        if self._tick_unsub:
            self._tick_unsub()
            self._tick_unsub = None

        sensors, lights = set(), set()
        for rid, room in self.rooms().items():
            for eid in (room.get("trigger") or []) + (room.get("hold") or []):
                sensors.add(eid)
            for eid in room.get("lights") or []:
                lights.add(eid)

        if sensors:
            self._unsubs.append(async_track_state_change_event(
                self.hass, sorted(sensors), self._sensor_event))
        if lights:
            self._unsubs.append(async_track_state_change_event(
                self.hass, sorted(lights), self._light_event))
        self._tick_unsub = async_track_time_interval(
            self.hass, self._tick, timedelta(seconds=30))
        self._unsubs.append(async_track_time_interval(
            self.hass, self._dark_tick, timedelta(seconds=DARK_TICK)))
        self._slot_now = self.slot_now()
        _LOGGER.debug("LUMEN: watching %d sensors, %d lights in %d rooms",
                      len(sensors), len(lights), len(self.rooms()))

    def shutdown(self) -> None:
        """Her şeyi bırak: dinleyiciler, 30 saniyelik döngü, bekleyen sayaçlar.

        Entegrasyon kaldırıldığında ya da yeniden yüklendiğinde çağrılır.
        Çağrılmazsa motor aynı süreçte ışıkları yönetmeye devam eder ve
        yeniden kurulumda iki motor aynı lambaya komut verir.
        """
        for unsub in self._unsubs:
            unsub()
        self._unsubs = []
        if self._tick_unsub:
            self._tick_unsub()
            self._tick_unsub = None
        for rts in self.rt.values():
            for cancel in list((rts.get("timers") or {}).values()):
                cancel()
            rts["timers"] = {}
        _LOGGER.debug("LUMEN: motor durduruldu")

    def _rooms_for_sensor(self, eid: str) -> list[str]:
        out = []
        for rid, room in self.rooms().items():
            if eid in (room.get("trigger") or []) or eid in (room.get("hold") or []):
                out.append(rid)
        return out

    @callback
    def _sensor_event(self, event) -> None:
        if time.time() - self._boot_at < BOOT_GRACE:
            return
        old = event.data.get("old_state")
        new = event.data.get("new_state")
        if new is None or old is None:      # restored/initial state, not motion
            return
        if old.state == new.state:
            return
        eid = event.data["entity_id"]
        for rid in self._rooms_for_sensor(eid):
            if new.state == "on" and eid in self.alone_sensors(rid):
                self.alone_enter(rid)
            if new.state == "on":
                # A holder keeps a light alive; it does not start one. It was
                # falling straight through to the trigger, which meant a
                # presence sensor nobody had chosen as a waker could open the
                # room on its own — and walk straight past "all of them must
                # agree", because that test only ever ran on the wakers.
                if eid not in (self.room(rid).get("trigger") or []):
                    self._maybe_clear(rid)      # cancels any countdown, undims
                    continue
                if eid not in self.slot_triggers(rid):
                    continue        # not one of this slot's wakers
                if not self.trigger_ready(rid):
                    continue        # the room asked for its wakers to agree
                self.trigger(rid, "sensor")
            elif new.state == "off":
                self._cancel(rid, "delay")
                self._maybe_clear(rid)

    @callback
    def _light_event(self, event) -> None:
        """A light changed. Was it us, or a human?"""
        if time.time() - self._boot_at < BOOT_GRACE:
            return
        old = event.data.get("old_state")
        new = event.data.get("new_state")
        if new is None or old is None or old.state == new.state:
            return
        ctx = getattr(event, "context", None)
        if ctx is not None and ctx.id in self._ctx:
            return      # our own doing
        eid = event.data["entity_id"]
        now = time.time()
        for rid, room in self.rooms().items():
            if eid not in (room.get("lights") or []):
                continue
            rts = self._state(rid)
            # Still the wake of our own command: a scene reproduces states and a
            # Hue group tells the bridge, and neither carries our context back.
            if now - rts.get("acted_at", 0.0) < ACT_ECHO:
                continue
            # A light in this room moved and the command was not ours. Who
            # sent it cannot be known — a wall switch, the Hue app, an MQTT
            # message and the bulb reporting its own doing all arrive here
            # looking exactly alike — so nothing is read into it. The room's
            # bookkeeping is brought up to date and the ordinary rules carry
            # on from the state the room is actually in.
            if new.state == "off":
                rts["predim"] = {}      # the warning is off the table
                rts["dim"] = False
                self._cancel(rid, "off")
                self._cancel(rid, "dim")
                rts["off_at"] = 0.0
                rts["lux_frozen"] = None
            else:
                self._maybe_clear(rid)

    def check_every(self, rid: str) -> float:
        """How often this room's darkness watch asks the lux sensor."""
        try:
            every = float(self.slot_rule(rid).get("check_every") or 0)
        except (TypeError, ValueError):
            every = 0.0
        return max(float(DARK_TICK), every or 30.0)

    def _dark_check(self, rid: str) -> bool:
        """Somebody is here, the light is off — is the room dark enough now?

        Movement is not the only thing that can change the answer, and sitting
        still in a room that has gone dark is the commonest case of all.

        One Room mode comes through here for a different reason: it darkens a
        room whose sensor is still reading "on", so walking out and straight
        back in produces no edge at all and the room you are standing in stays
        dark. The mode promises one lit room; this is the half that keeps it.
        """
        rts = self._state(rid)
        alone = self.mode_cfg().get("key") == "alone"
        if not (self.slot_rule(rid).get("watch_dark") or alone):
            return False
        if not self.occupied(rid) or self.lights_on(rid):
            return False
        decision = self.decide(rid)
        if not decision["on"]:
            return False
        self._switch_on(rid, decision)
        rts["seen"] = True
        rts["last_slot"] = self.slot_now()
        why = self.tr("buradasın", "you are here") if alone \
            else self.tr("karardı", "it got dark")
        self.log(rid, "on", self.tr(
            f"{self.room_name(rid)} AÇ — {why} · {decision['reason']}",
            f"{self.room_name(rid)} ON — {why} · {decision['reason']}"),
            extra=self._on_detail(rid, decision))
        return True

    @callback
    def _dark_tick(self, _now) -> None:
        """The darkness watch, on the cadence each slot asked for.

        Separate from the half-minute round on purpose: a lux sensor that
        reports every few seconds deserves an answer in the same few seconds,
        and a room that never uses a threshold should cost nothing at all.
        """
        if time.time() - self._boot_at < BOOT_GRACE:
            return
        now = time.time()
        for rid in self.rooms():
            rule = self.slot_rule(rid)
            if not rule.get("watch_dark") or rule.get("lux_max") is None:
                continue        # the watch is the threshold's; no threshold, no watch
            rts = self._state(rid)
            if now - float(rts.get("dark_at") or 0.0) < self.check_every(rid):
                continue
            rts["dark_at"] = now
            self._dark_check(rid)

    def _sweep(self) -> None:
        """Catch the rooms that emptied while nobody was listening.

        Switching off is otherwise driven purely by sensor events, so a room
        whose "nobody here" moment lands during a restart, a reload or the boot
        grace stays lit for good: the event is gone and nothing ever asks
        again. Every half minute we ask ourselves.
        """
        if time.time() - self._boot_at < BOOT_GRACE:
            return
        for rid, room in self.rooms().items():
            sensors = list(room.get("trigger") or []) + list(room.get("hold") or [])
            if not sensors:
                continue            # nothing here can say the room is empty
            rts = self._state(rid)
            if rts["timers"].get("off") or rts["timers"].get("dim"):
                continue            # a countdown is already running; leave it
            if self.occupied(rid):
                # Nothing moved, but the room did get darker. Movement is not
                # the only thing that can change the answer, and sitting still
                # in a room that has gone dark is the commonest case of all.
                #
                # One Room mode needs the same catch for a different reason: it
                # darkens a room whose sensor is still reading "on", so walking
                # out and straight back in produces no edge at all and the room
                # you are standing in stays dark. The mode promises one lit
                # room; this is the half that keeps the promise.
                self._dark_check(rid)
                continue
            if not self.lights_on(rid):
                continue
            # A sensor that fell off the network is not an empty room. Going
            # dark on a dropout would put out the lights around someone who is
            # sitting right there.
            blind = False
            for eid in sensors:
                st = self.hass.states.get(eid)
                if st is None or st.state in ("unknown", "unavailable", ""):
                    blind = True
                    break
            if blind:
                continue
            self._maybe_clear(rid)

    # ------------------------------------------------------- what the house says
    def health(self) -> list[dict]:
        """Devices that stopped working, in plain words.

        Only faults live here — an entity that vanished from Home Assistant,
        one that went unavailable, a lamp that says it is on at zero
        brightness, a sensor that has not stirred in days. A room with no
        sensor or no lights is not a fault: it is somebody's decision, and a
        report that nags about decisions is a report people stop reading.
        """
        out = []
        now = dt_util.utcnow()

        def add(rid, kind, text, level="warn"):
            out.append({"room": rid, "kind": kind, "text": text, "level": level})

        for rid, room in self.rooms().items():
            name = self.room_name(rid)
            lights = list(room.get("lights") or [])
            sensors = list(room.get("trigger") or []) + list(room.get("hold") or [])

            for eid in lights + sensors + ([room["lux"]] if room.get("lux") else []):
                st = self.hass.states.get(eid)
                label = self._name_of(eid)
                if st is None:
                    add(rid, "missing", self.tr(
                        f"{name}: {label} Home Assistant'ta yok",
                        f"{name}: {label} is gone from Home Assistant"), "bad")
                    continue
                if st.state in ("unavailable", "unknown"):
                    since = self.down.get(eid)
                    mins = int((now.timestamp() - since) / 60) if since else 0
                    if since and (now.timestamp() - since) / 60 < self.outage_min():
                        continue        # a blink, not an outage
                    add(rid, "offline", self.tr(
                        f"{name}: {label} çevrimdışı"
                        + (f" — {mins} dakikadır" if mins else ""),
                        f"{name}: {label} is offline"
                        + (f" — for {mins} min" if mins else "")), "bad")
                    continue
                if eid in lights and st.state == "on"                         and st.attributes.get("brightness") == 0:
                    add(rid, "zero_bri", self.tr(
                        f"{name}: {label} açık görünüyor ama parlaklığı sıfır "
                        "— yanmıyor",
                        f"{name}: {label} says it is on at zero brightness "
                        "— it is not lit"))
                if eid in sensors:
                    changed = getattr(st, "last_changed", None)
                    if changed is not None:
                        try:
                            days = (now - changed).total_seconds() / 86400
                        except TypeError:
                            days = 0
                        if days >= STALE_DAYS and self._house_awake(STALE_DAYS):
                            add(rid, "stale", self.tr(
                                f"{name}: {label} {int(days)} gündür hiç "
                                "değişmedi — pili bitmiş olabilir",
                                f"{name}: {label} has not moved for "
                                f"{int(days)} days — flat battery?"))

        return out

    def _house_awake(self, days: float) -> bool:
        """Has anything at all moved in the house lately?

        Nobody home means every sensor is quiet, and a quiet sensor in an empty
        house is not a fault — it is a holiday. Only somewhere that has seen
        movement can have a sensor that should have seen some too.
        """
        now = dt_util.utcnow()
        for rid in self.rooms():
            for eid in (list(self.room(rid).get("trigger") or [])
                        + list(self.room(rid).get("hold") or [])):
                st = self.hass.states.get(eid)
                changed = getattr(st, "last_changed", None) if st else None
                if changed is None:
                    continue
                try:
                    if (now - changed).total_seconds() / 86400 < days:
                        return True
                except TypeError:
                    continue
        return False

    def _on_detail(self, rid: str, decision: dict) -> dict:
        """The moment of switching on, for the log: what each sensor was saying
        (and for how long), and which lights were told to come on. This is the
        page's answer to "who saw me, and how fast"."""
        now = dt_util.utcnow()
        sensors = []
        seen = []
        for role in ("trigger", "hold"):
            for eid in self.slot_sensors(rid, role):
                if eid in seen:
                    continue
                seen.append(eid)
                st = self.hass.states.get(eid)
                if st is None:
                    continue
                ago = None
                changed = getattr(st, "last_changed", None)
                if changed is not None:
                    try:
                        ago = max(0, int((now - changed).total_seconds()))
                    except TypeError:
                        ago = None
                sensors.append({"n": self._name_of(eid), "s": st.state,
                                "a": ago, "r": role})
        lights = [self._name_of(e) for e in (decision.get("lights") or [])[:14]]
        out = {"sensors": sensors, "lights": lights,
               "more": max(0, len(decision.get("lights") or []) - 14)}
        if decision.get("bri"):
            out["bri"] = decision["bri"]
        return out

    def _name_of(self, eid: str) -> str:
        st = self.hass.states.get(eid)
        if st is not None:
            friendly = st.attributes.get("friendly_name")
            if friendly:
                return str(friendly)
        return eid

    async def async_health_notify(self, force: bool = False) -> dict:
        """Send the report, if there is one and somebody asked to hear it."""
        cfg = self.config.get("notify") or {}
        service = str(cfg.get("service") or "")
        issues = self.health()
        if not service or "." not in service:
            return {"ok": False, "error": "no_service", "issues": len(issues)}
        if not force:
            if not cfg.get("enabled"):
                return {"ok": False, "error": "disabled", "issues": len(issues)}
            every = max(1.0, float(cfg.get("every_h") or 24)) * 3600
            if time.time() - self._notified_at < every:
                return {"ok": False, "error": "too_soon", "issues": len(issues)}
        if not issues and not force:
            # Damga YOK: rapor gönderilmedi. Damgalasaydık, beş dakika sonra
            # ortaya çıkan gerçek bir arıza bir gün boyunca susturulurdu.
            return {"ok": True, "sent": False, "issues": 0}
        domain, name = service.split(".", 1)
        # The config is admin-written, but it is also a JSON file people will
        # trade ("here, try my setup"). A pasted config must not be able to
        # point the hourly timer at shell_command or homeassistant.restart:
        # this field is a notify service and nothing else.
        if domain != "notify":
            return {"ok": False, "error": "not_notify", "issues": len(issues)}
        lines = [i["text"] for i in issues[:12]]
        if len(issues) > 12:
            lines.append(self.tr(f"… ve {len(issues) - 12} tane daha",
                                 f"… and {len(issues) - 12} more"))
        body = "\n".join(lines) or self.tr("Her şey yolunda.", "All is well.")
        try:
            await self.hass.services.async_call(domain, name, {
                "title": self.tr("LUMEN sağlık raporu", "LUMEN health report"),
                "message": body,
            }, blocking=True)
        except Exception as err:  # noqa: BLE001 - bildirim servisi yoksa/patlarsa
            _LOGGER.warning("LUMEN: sağlık raporu gönderilemedi: %s", err)
            return {"ok": False, "error": "notify_failed", "issues": len(issues)}
        # Damga ancak buraya gelirsek atılır.
        self._notified_at = time.time()
        return {"ok": True, "sent": True, "issues": len(issues)}

    async def async_outage_notify(self) -> dict:
        """Say it once, as soon as a device has been away long enough.

        Separate from the daily report on purpose: a device that has gone is
        worth interrupting somebody for, and worth interrupting them only once
        — not every half minute until it comes back.
        """
        cfg = self.config.get("notify") or {}
        service = str(cfg.get("service") or "")
        if not cfg.get("enabled") or "." not in service:
            return {"ok": False, "error": "disabled"}
        domain, name = service.split(".", 1)
        if domain != "notify":
            return {"ok": False, "error": "not_notify"}
        limit = self.outage_min() * 60
        now = time.time()
        fresh = []
        yeni_sessizler: list[str] = []
        for rid in self.rooms():
            for eid in self.room_entities(rid):
                since = self.down.get(eid)
                if not since or eid in self._told or now - since < limit:
                    continue
                yeni_sessizler.append(eid)
                fresh.append(self.tr(
                    f"{self.room_name(rid)}: {self._name_of(eid)} "
                    f"{int((now - since) / 60)} dakikadır çevrimdışı",
                    f"{self.room_name(rid)}: {self._name_of(eid)} has been "
                    f"offline for {int((now - since) / 60)} min"))
        if not fresh:
            return {"ok": True, "sent": False}
        try:
            await self.hass.services.async_call(domain, name, {
                "title": self.tr("LUMEN — cihaz çevrimdışı",
                                 "LUMEN — device offline"),
                "message": "\n".join(fresh[:8]),
            }, blocking=True)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("LUMEN: çevrimdışı bildirimi gönderilemedi: %s", err)
            return {"ok": False, "error": "notify_failed", "n": len(fresh)}
        # "Söyledik" ancak söyledikten sonra. Gönderim patlarsa cihaz bir
        # dahaki turda yeniden denenir; sessizce kaybolmaz.
        self._told.update(yeni_sessizler)
        return {"ok": True, "sent": True, "n": len(fresh)}

    # ------------------------------------------------------------------- usage
    def _account(self, seconds: float) -> None:
        """Add this tick to whatever was lit. Coarse by design: a room's month
        is measured in hours, and half a minute of resolution is plenty."""
        day = dt_util.now().strftime("%Y-%m-%d")
        today = self.usage.setdefault(day, {})
        here_day = self.presence.setdefault(day, {})
        touched = False
        for rid in self.rooms():
            if self.occupied(rid):
                here_day[rid] = int(here_day.get(rid, 0) + seconds)
                touched = True
            if self.lights_on(rid):
                today[rid] = int(today.get(rid, 0) + seconds)
                touched = True
                # Also the moment to notice how the room is set right now: a
                # lamp you turned down with the Hue app is a "last setting" too.
                self._remember_bri(rid)
        if touched:
            self._usage_dirty = True
        # Two years of daily rows is a few kilobytes; older than that is noise.
        if len(self.usage) > 800:
            for old in sorted(self.usage)[:-800]:
                self.usage.pop(old, None)
        if len(self.presence) > 800:
            for old in sorted(self.presence)[:-800]:
                self.presence.pop(old, None)

    def usage_summary(self, days: int = 30) -> dict:
        cut = (dt_util.now() - timedelta(days=days - 1)).strftime("%Y-%m-%d")
        energy = self.config.get("energy") or {}
        watt = float(energy.get("watt") or 9)
        price = float(energy.get("price") or 0)
        rooms = {}
        series = {}
        for day in sorted(self.usage):
            if day < cut:
                continue
            for rid, secs in (self.usage[day] or {}).items():
                rooms[rid] = rooms.get(rid, 0) + int(secs)
                series.setdefault(day, {})[rid] = int(secs)
        out = {}
        for rid, secs in rooms.items():
            room = self.room(rid)
            bulbs = max(1, len([e for e in (room.get("lights") or [])
                                if not self.is_light_group(e)]) or 1)
            kwh = secs / 3600 * bulbs * watt / 1000
            out[rid] = {
                "seconds": secs,
                "hours": round(secs / 3600, 1),
                "bulbs": bulbs,
                "kwh": round(kwh, 2),
                "cost": round(kwh * price, 2),
            }
        here = {}
        for day in sorted(self.presence):
            if day < cut:
                continue
            for rid, secs in (self.presence[day] or {}).items():
                here[rid] = here.get(rid, 0) + int(secs)
        stayed = {rid: {"seconds": secs, "hours": round(secs / 3600, 1)}
                  for rid, secs in here.items() if rid in self.rooms()}
        return {"days": days, "rooms": out, "series": series,
                "stayed": stayed,
                "watt": watt, "price": price,
                "first": (sorted(self.usage) or [""])[0]}

    def _watch_stuck(self) -> list[str]:
        """A light burning in a room nobody is in.

        LUMEN has already made its offer — it put the room out when it emptied.
        If something turned a light back on, wrestling with it is how a house
        ends up flickering all night. So it watches instead, and after a while
        it says so. Deciding what to do about it is yours.
        """
        cfg = self.config.get("notify") or {}
        try:
            wait = max(1.0, float(cfg.get("stuck_min") or STUCK_MIN)) * 60
        except (TypeError, ValueError):
            wait = STUCK_MIN * 60
        now = time.time()
        news = []
        # Gönderim patlarsa geri alabilmek için: bu turda kimi işaretledik.
        self._stuck_marked = []
        for rid in self.rooms():
            rts = self._state(rid)
            lit = self.lights_on(rid)
            waiting = rts["timers"].get("off") or rts["timers"].get("dim")
            if self.occupied(rid) or not lit or waiting:
                rts["stuck_since"] = 0.0
                rts["stuck_told"] = False
                continue
            if not rts.get("stuck_since"):
                rts["stuck_since"] = now
                continue
            if rts.get("stuck_told") or now - rts["stuck_since"] < wait:
                continue
            rts["stuck_told"] = True
            self._stuck_marked.append(rid)
            mins = int((now - rts["stuck_since"]) / 60)
            names = ", ".join(self._name_of(e) for e in lit[:4])
            news.append(self.tr(
                f"{self.room_name(rid)}: oda boş ama {len(lit)} ışık "
                f"{mins} dakikadır açık ({names})",
                f"{self.room_name(rid)}: nobody there, {len(lit)} light(s) on "
                f"for {mins} min ({names})"))
            self.log(rid, "warn", news[-1])
        return news

    async def async_stuck_notify(self) -> dict:
        cfg = self.config.get("notify") or {}
        news = self._watch_stuck()
        service = str(cfg.get("service") or "")
        if not news or not cfg.get("stuck", True) or not cfg.get("enabled") \
                or "." not in service:
            return {"ok": True, "sent": False, "n": len(news)}
        domain, name = service.split(".", 1)
        if domain != "notify":
            return {"ok": False, "error": "not_notify"}
        try:
            await self.hass.services.async_call(domain, name, {
                "title": self.tr("LUMEN — boş odada ışık", "LUMEN — light left on"),
                "message": "\n".join(news[:8]),
            }, blocking=True)
        except Exception as err:  # noqa: BLE001
            # Uyarı zaten "söylendi" diye işaretlendi; geri al ki kaybolmasın.
            for rid in self._stuck_marked:
                self._state(rid)["stuck_told"] = False
            _LOGGER.warning("LUMEN: boş oda uyarısı gönderilemedi: %s", err)
            return {"ok": False, "error": "notify_failed", "n": len(news)}
        return {"ok": True, "sent": True, "n": len(news)}

    def _watch_devices(self) -> None:
        """Note when a device goes away, and when it comes back."""
        now = time.time()
        alive = set()
        for rid, room in self.rooms().items():
            for eid in self.room_entities(rid):
                alive.add(eid)
                st = self.hass.states.get(eid)
                gone = st is None or st.state in ("unavailable", "unknown")
                if gone:
                    self.down.setdefault(eid, now)
                elif eid in self.down:
                    self.down.pop(eid, None)
                    self._told.discard(eid)
        for eid in [e for e in self.down if e not in alive]:
            self.down.pop(eid, None)
            self._told.discard(eid)

    async def async_user_may(self, user_id: str | None, rid: str) -> bool:
        """Bu kullanıcı bu odanın ışıklarını çevirebilir mi?

        Home Assistant, kimliği taşınan bir servis çağrısında entity iznini
        kendisi uyguluyor — ama bunu komut gönderildikten SONRA yapıyor ve
        reddi bize bildirmiyor. Biz o ana kadar "bu odayı ben açtım" diye
        not almış oluyorduk; sonraki otomatik tur da o nota bakıp ışığı
        söndürebiliyordu. Bu yüzden izni komuttan önce burada soruyoruz.
        """
        if not user_id:
            return True                       # sensörden gelen: bizim işimiz
        try:
            user = await self.hass.auth.async_get_user(user_id)
        except Exception:                     # noqa: BLE001
            return False
        if user is None:
            return False
        if getattr(user, "is_admin", False):
            return True
        izin = getattr(user, "permissions", None)
        if izin is None:
            return False
        return all(izin.check_entity(eid, POLICY_CONTROL)
                   for eid in self.room_lights(rid))

    def room_lights(self, rid: str) -> list[str]:
        """Odanın gerçekten çevrilebilen şeyleri (ışık ve anahtarlar)."""
        room = self.room(rid)
        out = list(room.get("lights") or []) + list(room.get("groups") or [])
        return [e for e in dict.fromkeys(out) if self._is_light(e)]

    def room_entities(self, rid: str) -> list[str]:
        """Everything LUMEN needs from this room, in one list."""
        room = self.room(rid)
        out = list(room.get("lights") or []) + list(room.get("trigger") or []) + \
            list(room.get("hold") or []) + list(room.get("temp") or [])
        if room.get("lux"):
            out.append(room["lux"])
        seen, uniq = set(), []
        for eid in out:
            if eid not in seen:
                seen.add(eid)
                uniq.append(eid)
        return uniq

    def outage_min(self) -> float:
        cfg = self.config.get("notify") or {}
        try:
            return max(1.0, float(cfg.get("after_min") or OUTAGE_MIN))
        except (TypeError, ValueError):
            return float(OUTAGE_MIN)

    @callback
    def _tick(self, _now) -> None:
        """Housekeeping: missed departures, slot changes and mode expiry."""
        self._watch_devices()
        self._sweep()
        self._account(30)
        if self._usage_dirty:
            self._usage_dirty = False
            self.usage_store.async_delay_save(
                lambda: {"days": self.usage}, 120)
            self.presence_store.async_delay_save(
                lambda: {"days": self.presence}, 120)
        self.hass.async_create_task(self.async_stuck_notify())
        if (self.config.get("notify") or {}).get("enabled"):
            self.hass.async_create_task(self.async_health_notify())
            self.hass.async_create_task(self.async_outage_notify())
        until = float(self.config.get("mode_until") or 0)
        if until and time.time() > until:
            self.hass.async_create_task(self.async_set_mode("normal"))
            return

        slot = self.slot_now()
        if slot == self._slot_now:
            return
        self._slot_now = slot
        name = self.slot_name(slot)
        self.log("", "slot", self.tr(f"Dilim değişti: {name}",
                                     f"Slot changed: {name}"))
        for rid, room in self.rooms().items():
            rts = self._state(rid)
            # Some hours are meant to end the light rather than shape it: at
            # sunrise the room does not need the lamp, whoever switched it on
            # and whether or not anybody is still in there.
            if self.slot_rule(rid, slot).get("off_on_enter") and self.lights_on(rid):
                self._cancel(rid, "off")
                self._cancel(rid, "dim")
                self._do_off(rid, "slot")
                continue
            if not rts["on_by_us"] or rts["dim"] or not room.get("slot_follow", True):
                continue
            decision = self.decide(rid, slot)
            if not decision["on"]:
                continue
            self._switch_on(rid, decision)
            rts["last_slot"] = slot
            self.log(rid, "slot", self.tr(
                f"{self.room_name(rid)} {name} dilimine geçti — {decision['reason']}",
                f"{self.room_name(rid)} moved to {name} — {decision['reason']}"))

    # ------------------------------------------------------------ panel state
    def state_payload(self) -> dict:
        now = time.time()
        slot = self.slot_now()
        rooms = {}
        for rid, room in self.rooms().items():
            rts = self._state(rid)
            lights = list(room.get("lights") or [])
            # A Hue zone or a light group is one entity but many bulbs. Counting
            # it as a lamp inflates the room ("16 lights" when there are 12) and
            # counts the same bulb twice when it is on.
            groups = [e for e in lights if self.is_light_group(e)]
            singles = [e for e in lights if e not in groups]
            on_now = [e for e in singles if self._is_on(e)]
            if not singles:
                on_now = [e for e in groups if self._is_on(e)]
            bri_vals = []
            for eid in on_now:
                st = self.hass.states.get(eid)
                raw = (st.attributes.get("brightness") if st else None)
                if raw:
                    bri_vals.append(round(int(raw) / 2.55))
            decision = self.decide(rid, slot)
            warn = ""
            if not lights:
                warn = "no_lights"
            elif not (room.get("trigger") or room.get("hold")):
                warn = "no_sensor" if not (room.get("neighbors") or []) else "neighbor"
            rooms[rid] = {
                "name": self.room_name(rid),
                "on": bool(room.get("on", True)),
                "lit": bool(on_now),
                "lights_on": len(on_now),
                "lights_total": len(singles),
                "groups_total": len(groups),
                "bri": max(bri_vals) if bri_vals else None,
                "lux": self.lux_value(rid),
                "lux_frozen": rts["lux_frozen"],
                # The darkness threshold for every slot of the day, so the card
                # can draw the line the readings are compared against. Worked
                # out here rather than in the panel: the defaults live in one
                # place, and a card that guessed them would sooner or later
                # draw a line the engine does not believe in.
                "gates": {
                    str(slot.get("key")): self.slot_rule(rid, slot.get("key")).get("lux_max")
                    for slot in (self.config.get("slots") or [])
                    if slot.get("key")
                },
                "motion": self.motion_active(rid),
                "hold": self.hold_active(rid),
                # how long ago we switched this room on, for the card
                "on_ago": (max(0, int(now - rts["lit_at"]))
                           if rts["lit_at"] and rts["on_by_us"] else None),
                "lights_lit": len(on_now),
                # only interesting when the room asked its wakers to agree
                "t_ready": self.trigger_ready(rid),
                "by_us": rts["on_by_us"],
                "dim": rts["dim"],
                "off_in": max(0, int(rts["off_at"] - now)) if rts["off_at"] else 0,
                "blocked": self._blocked_by(rid) or "",
                "paused_in": max(0, int(rts["paused_until"] - now)),
                "would": decision["on"],
                "why": decision["reason"],
                "warn": warn,
            }
        return {
            "enabled": bool(self.config.get("enabled", True)),
            "mode": self.config.get("mode", "normal"),
            "mode_name": self.mode_name(),
            "mode_in": max(0, int(float(self.config.get("mode_until") or 0) - now)),
            "slot": slot,
            "slot_name": next((s["name"] for s in self.slot_bounds()
                               if s["key"] == slot), slot),
            "slots": self.slot_bounds(),
            "sun": self.sun_times(),
            "now": now,
            "clock": dt_util.now().strftime("%H:%M"),
            "rooms": rooms,
            "events": self.events[:120],
        }

    # ---------------------------------------------------------------- actions
    async def async_action(self, body: dict, user_id: str | None = None) -> dict:
        action = str(body.get("action") or "")
        rid = str(body.get("room") or "")

        if action == "set_mode":
            await self.async_set_mode(str(body.get("mode") or "normal"))
            return {"ok": True}

        if action == "enable":
            self.config["enabled"] = bool(body.get("value", True))
            await self.store.async_save(self.config)
            self.log("", "engine", self.tr(
                "Motor açıldı" if self.config["enabled"] else "Motor kapatıldı",
                "Engine on" if self.config["enabled"] else "Engine off"))
            return {"ok": True}

        if action in ("room_on", "room_off"):
            if rid not in self.rooms():
                return {"ok": False, "error": "unknown room"}
            # Yetki, motorun iç durumuna dokunmadan önce sorulur.
            if not await self.async_user_may(user_id, rid):
                self.log(rid, "warn", self.tr(
                    f"{self.room_name(rid)}: yetkisiz istek geri çevrildi",
                    f"{self.room_name(rid)}: request refused, no permission"))
                return {"ok": False, "error": "unauthorized"}
            # Zincirin tamamı senkron; araya await girmediği için bu alan
            # başka bir çağrıya karışamaz.
            self._as_user = user_id
            try:
                if action == "room_off":
                    self._cancel(rid, "off")
                    self._cancel(rid, "dim")
                    self._do_off(rid, "manual")
                else:
                    rts = self._state(rid)
                    rts["paused_until"] = 0.0
                    self._do_on(rid, "panel", asked=True)
            finally:
                self._as_user = None
            return {"ok": True}

        if action == "remove_room":
            if not rid:
                return {"ok": False, "error": "unknown room"}
            name = self.room_name(rid)
            cfg = copy.deepcopy(self.config)
            cfg.setdefault("skip_areas", [])
            if rid not in cfg["skip_areas"]:
                cfg["skip_areas"].append(rid)
            cfg.get("rooms", {}).pop(rid, None)
            for floor in (cfg.get("layout") or {}).get("floors") or []:
                floor["rooms"] = [r for r in (floor.get("rooms") or [])
                                  if r.get("id") != rid]
            await self.async_save(cfg)
            self.rt.pop(rid, None)
            self.setup()
            self.log("", "room", self.tr(
                f"{name} evden çıkarıldı", f"{name} taken out of the house"))
            return {"ok": True}

        if action == "restore_room":
            cfg = copy.deepcopy(self.config)
            cfg["skip_areas"] = [a for a in (cfg.get("skip_areas") or [])
                                 if a != rid]
            await self.async_save(cfg)
            found = await self.async_autofill(build_layout=True)
            return {"ok": True, "found": found}

        if action == "reset_fuse":
            rts = self._state(rid)
            rts["paused_until"] = 0.0
            rts["calls"].clear()
            return {"ok": True}

        if action == "explain":
            return {"ok": True, "decision": self.decide(rid)}

        if action == "clear_log":
            self.events.clear()
            await self.events_store.async_save({"events": []})
            return {"ok": True}

        if action == "autofill":
            found = await self.async_autofill(bool(body.get("layout", True)))
            return {"ok": True, "found": found}

        if action == "scan_areas":
            before = set(self.rooms())
            found = await self.async_autofill(False, include_empty=True)
            after = set(self.rooms())
            new_ids = sorted(after - before)
            return {
                "ok": True,
                "found": found,
                "new": len(new_ids),
                "new_ids": new_ids,
                "total": len(self.rooms()),
            }

        return {"ok": False, "error": f"unknown action: {action}"}

    # --------------------------------------------------------------- autofill
    def _area_entities(self) -> dict[str, list[str]]:
        """area_id -> entity_ids, falling back to the *device's* area.

        Skipping that fallback is what leaves half the rooms looking empty.
        """
        ent_reg = er.async_get(self.hass)
        dev_reg = dr.async_get(self.hass)
        overrides = self.config.get("overrides") or {}
        out: dict[str, list[str]] = {}
        for entry in ent_reg.entities.values():
            if entry.disabled_by or entry.hidden_by or entry.entity_category:
                continue
            area = overrides.get(entry.entity_id) or entry.area_id
            if not area and entry.device_id:
                device = dev_reg.async_get(entry.device_id)
                area = device.area_id if device else None
            if not area:
                continue
            out.setdefault(area, []).append(entry.entity_id)
        return out

    def guess_type(self, name: str) -> str:
        low = (name or "").lower()
        for key, words in TYPE_HINTS:
            if any(word in low for word in words):
                return key
        return "other"

    async def async_autofill(
        self, build_layout: bool = True, include_empty: bool = False
    ) -> int:
        """Fill rooms from the Home Assistant areas — one click, then edit."""
        area_reg = ar.async_get(self.hass)
        by_area = self._area_entities()
        cfg = copy.deepcopy(self.config)
        rooms = cfg.setdefault("rooms", {})
        # Something taken out of a room by hand stays out: filling in the gaps
        # must not undo a decision.
        ignored = set(cfg.get("ignored") or [])
        skipped = set(cfg.get("skip_areas") or [])
        touched = 0

        for area in area_reg.async_list_areas():
            if area.id in skipped:
                continue
            eids = [e for e in (by_area.get(area.id) or []) if e not in ignored]
            lights, trigger, hold, lux = [], [], [], ""
            for eid in eids:
                domain = eid.split(".")[0]
                st = self.hass.states.get(eid)
                dev_class = (st.attributes.get("device_class") if st else None) or ""
                if domain == "light":
                    lights.append(eid)
                elif domain == "binary_sensor":
                    if dev_class == "motion":
                        trigger.append(eid)
                    elif dev_class in ("occupancy", "presence"):
                        trigger.append(eid)
                        hold.append(eid)
                elif domain == "sensor" and dev_class == "illuminance" and not lux:
                    lux = eid
            if not include_empty and not (lights or trigger or hold):
                continue

            room = _merge(DEFAULT_ROOM, rooms.get(area.id) or {})
            room["type"] = room.get("type") or "other"
            if room["type"] == "other":
                room["type"] = self.guess_type(area.name)
            # Never drop what the user already assigned by hand.
            room["lights"] = sorted(set(room.get("lights") or []) | set(lights))
            room["trigger"] = sorted(set(room.get("trigger") or []) | set(trigger))
            room["hold"] = sorted(set(room.get("hold") or []) | set(hold))
            room["lux"] = room.get("lux") or lux
            room["slots"] = {
                k: _merge(DEFAULT_SLOT_RULES.get(k, DEFAULT_SLOT_RULE),
                          (room.get("slots") or {}).get(k) or {})
                for k in [str(s.get("key")) for s in cfg.get("slots") or []]
            }
            rooms[area.id] = room
            touched += 1

        if build_layout and not (cfg.get("layout") or {}).get("floors"):
            ids = list(rooms)
            cols = 3
            placed = []
            for i, rid in enumerate(ids):
                placed.append({"id": rid, "x": i % cols, "y": i // cols,
                               "w": 1, "h": 1})
            # A trailing gap reads as a missing wall; widen the last room into it.
            if placed and len(ids) % cols:
                placed[-1]["w"] = cols - placed[-1]["x"]
            cfg["layout"] = {"floors": [{
                "id": "f1", "name": self.tr("Daire", "Flat"), "cols": cols,
                # One spare row, so the plan can be rearranged straight away.
                "rows_n": max(1, (len(ids) + cols - 1) // cols) + 1,
                "rooms": placed,
            }]}

        await self.async_save(cfg)
        self.setup()
        self.log("", "setup", self.tr(
            f"{touched} oda Home Assistant alanlarından kuruldu",
            f"{touched} rooms filled in from the Home Assistant areas"))
        return touched
