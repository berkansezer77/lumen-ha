"""Config flow for LUMEN — single instance, everything is set in the panel."""
from __future__ import annotations

from homeassistant import config_entries

from .const import DOMAIN


class LumenConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """One-click setup: all configuration happens inside the sidebar panel."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is None:
            return self.async_show_form(step_id="user")
        return self.async_create_entry(title="LUMEN", data={})
