"""LUMEN mode selector.

The house mode is the layer above every rule, so it must be reachable from
outside the panel too: a dashboard, a voice assistant, another automation.
The integration ships its own select — nobody should have to build a helper.
"""
from __future__ import annotations

# Motor zaten tek elden çalışıyor; bu varlıklar ondan okuyor,
# cihazla konuşmuyor. Sıraya sokulacak bir iş yok.
PARALLEL_UPDATES = 0


from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import DOMAIN, SIGNAL_CONFIG
from .engine import LumenEngine


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities) -> None:
    engine: LumenEngine = hass.data[DOMAIN]["engine"]
    async_add_entities([LumenModeSelect(engine, entry)])


class LumenModeSelect(SelectEntity):
    """select.lumen_mode — Normal / Alone / Guest / Sleep / …"""

    _attr_has_entity_name = True
    _attr_icon = "mdi:home-heart"
    _attr_should_poll = False
    _attr_translation_key = "mode"

    def __init__(self, engine: LumenEngine, entry: ConfigEntry) -> None:
        self._engine = engine
        self._attr_unique_id = f"{DOMAIN}_mode"
        self._attr_name = "Mode"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry.entry_id)},
            name="LUMEN",
            manufacturer="LUMEN",
            model="Adaptive room lighting",
            entry_type=DeviceEntryType.SERVICE,
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(async_dispatcher_connect(
            self.hass, SIGNAL_CONFIG, self._refresh))
        self.async_on_remove(async_dispatcher_connect(
            self.hass, f"{DOMAIN}_mode", self._refresh))

    @callback
    def _refresh(self) -> None:
        self.async_write_ha_state()

    def _keys(self) -> list[str]:
        return [str(m.get("key")) for m in self._engine.config.get("modes") or []]

    @property
    def options(self) -> list[str]:
        names, seen = [], set()
        for key in self._keys():
            name = self._engine.mode_name(key)
            # Two modes with the same label would make the select ambiguous.
            if name in seen:
                name = f"{name} ({key})"
            seen.add(name)
            names.append(name)
        return names

    @property
    def current_option(self) -> str | None:
        key = self._engine.config.get("mode") or "normal"
        keys = self._keys()
        if key not in keys:
            return None
        return self.options[keys.index(key)]

    @property
    def extra_state_attributes(self) -> dict:
        engine = self._engine
        return {
            "mode_key": engine.config.get("mode"),
            "slot": engine.slot_now(),
            "rooms": len(engine.rooms()),
        }

    async def async_select_option(self, option: str) -> None:
        names = self.options
        if option not in names:
            return
        await self._engine.async_set_mode(self._keys()[names.index(option)])
        self.async_write_ha_state()
