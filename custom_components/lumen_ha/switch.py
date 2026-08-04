"""LUMEN master switch — the engine's own on/off, no helper required."""
from __future__ import annotations

# Motor zaten tek elden çalışıyor; bu varlıklar ondan okuyor,
# cihazla konuşmuyor. Sıraya sokulacak bir iş yok.
PARALLEL_UPDATES = 0


from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import DOMAIN, SIGNAL_CONFIG
from .engine import LumenEngine


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities) -> None:
    engine: LumenEngine = hass.data[DOMAIN]["engine"]
    async_add_entities([LumenEngineSwitch(engine, entry)])


class LumenEngineSwitch(SwitchEntity):
    """switch.lumen_engine — off means "leave every light alone"."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:lightbulb-auto-outline"
    _attr_should_poll = False
    _attr_translation_key = "engine"

    def __init__(self, engine: LumenEngine, entry: ConfigEntry) -> None:
        self._engine = engine
        self._attr_unique_id = f"{DOMAIN}_engine"
        self._attr_name = "Engine"
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

    @callback
    def _refresh(self) -> None:
        self.async_write_ha_state()

    @property
    def is_on(self) -> bool:
        return bool(self._engine.config.get("enabled", True))

    async def _set(self, value: bool) -> None:
        await self._engine.async_action({"action": "enable", "value": value})
        self.async_write_ha_state()

    async def async_turn_on(self, **kwargs) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._set(False)
