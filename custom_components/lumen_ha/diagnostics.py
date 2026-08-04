"""What Home Assistant hands over when somebody says "it did not work".

A user reporting a light that stayed off cannot describe the thing we need:
which sensors said what, in which slot, and what the engine made of it. This
file answers that in one download — the panel's whole configuration, every
room's live verdict with its reason in plain words, the state of every device
those rooms depend on, and the last hundred lines of the diary.

It lands in a public issue, so anything that is nobody else's business is
taken out on the way: the notify service somebody chose, the paths of photos
they uploaded, the names they gave their house.
"""
from __future__ import annotations

import copy
import time
from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.loader import async_get_integration

from .const import DOMAIN
from .engine import LumenEngine

# Kept out of the file: not secrets exactly, but nobody else's business.
# `async_redact_data` walks the whole document, so one list covers the
# notification target, uploaded photo paths and anything that looks like a
# credential or a location wherever it turns up.
REDACT_ALL = {
    "notify", "image", "images", "photo",
    "latitude", "longitude", "elevation",
    "api_key", "token", "password", "webhook_id",
}
KEEP_EVENTS = 100


def _clean_config(cfg: dict) -> dict:
    """The configuration with the personal bits taken out.

    Home Assistant's own `async_redact_data` does the masking, rather than a
    hand-rolled loop: one fewer place to get it wrong, and it recurses.

    What deliberately stays: entity ids, room names, and the diary. A
    diagnostics file without them cannot answer the only question it is for —
    which sensor said what, and what the engine made of it. The panel says so
    in plain words before you download it, so nobody sends one unawares.
    """
    out = async_redact_data(copy.deepcopy(cfg), REDACT_ALL)
    art = out.get("scene_art")
    if isinstance(art, dict):
        out["scene_art"] = {k: bool(v) for k, v in art.items()}
    return out


def _devices(hass: HomeAssistant, engine: LumenEngine) -> dict[str, Any]:
    """Every entity the rooms lean on, exactly as Home Assistant sees it.

    This is usually where the answer is: a sensor that has said "off" for two
    days, a light that is not in Home Assistant at all any more, a switch that
    reports unavailable.
    """
    out: dict[str, Any] = {}
    for rid in engine.rooms():
        for eid in engine.room_entities(rid):
            if eid in out:
                continue
            st = hass.states.get(eid)
            if st is None:
                out[eid] = {"state": "YOK — Home Assistant'ta bulunamadı"}
                continue
            attrs = st.attributes
            out[eid] = {
                "state": st.state,
                "changed": st.last_changed.isoformat(timespec="seconds"),
                "brightness": attrs.get("brightness"),
                "color_modes": attrs.get("supported_color_modes"),
                "device_class": attrs.get("device_class"),
            }
    return out


def _rooms(engine: LumenEngine) -> dict[str, Any]:
    """Each room's verdict this second, and the reasoning behind it."""
    out: dict[str, Any] = {}
    for rid in engine.rooms():
        decision = engine.decide(rid)
        rts = engine._state(rid)          # noqa: SLF001 — this is the report
        out[rid] = {
            "slot": engine.slot_now(),
            "occupied": engine.occupied(rid),
            "motion": engine.motion_active(rid),
            "hold": engine.hold_active(rid),
            "trigger_ready": engine.trigger_ready(rid),
            "lights_on": engine.lights_on(rid),
            "lux": engine.lux_value(rid),
            "would_switch_on": decision["on"],
            "why": decision["reason"],
            "which_lights": decision.get("lights"),
            "seen_since_lit": rts.get("seen"),
            "by_us": rts.get("on_by_us"),
            "paused_for": max(0, int(rts.get("paused_until", 0) - time.time())),
            "locked_for": max(0, int(rts.get("locked_until", 0) - time.time())),
        }
    return out


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    """The file a user attaches to an issue."""
    engine: LumenEngine | None = (hass.data.get(DOMAIN) or {}).get("engine")
    if engine is None:
        return {"error": "LUMEN motoru yüklü değil"}

    integration = await async_get_integration(hass, DOMAIN)
    surum = str(integration.version)

    return {
        "lumen": {
            # Entegrasyonun sürümü — config-flow şemasının sürümü değil.
            # Orası hep 1 yazıyordu ve hata bildiriminde en çok işe yarayan
            # bilgi kayıptı.
            "version": surum,
            "entry_version": entry.version,
            "mode": engine.config.get("mode"),
            "engine_enabled": engine.config.get("enabled", True),
            "slot_now": engine.slot_now(),
            "room_count": len(engine.rooms()),
            # "Kart görünmüyor" bildiriminde ilk bakılacak yer: kart dosyası
            # panoya nasıl tanıtıldı, hangi adresle.
            "card_resource": (hass.data.get(DOMAIN) or {}).get("card_resource"),
        },
        "home_assistant": {
            "version": getattr(hass.config, "version", None),
            "time_zone": str(hass.config.time_zone),
        },
        "rooms_now": _rooms(engine),
        "devices": _devices(hass, engine),
        "health": engine.health(),
        "diary": engine.events[:KEEP_EVENTS],
        "config": _clean_config(engine.config),
    }
