# Changelog

## 1.0.0 — first release

The first public version. Everything below is what it does on day one; there is
no earlier release to compare it against.

### The engine

- One panel, one engine. No generated automations, no `input_boolean` helpers,
  nothing written to your YAML.
- Per room: triggers (what wakes it) and holders (what keeps it awake), an
  optional lux sensor, and up to a day's worth of time slots with their own
  brightness, colour temperature, scene and rules.
- Turns a room off **only** after somebody was actually seen in it and then
  left — a light that came on for a passing sensor blip does not get switched
  off by a timer that nobody triggered.
- Every decision is written down in plain words ("Kitchen ON — lux 13 ≤ 15 ·
  Night · last setting"), with the sensors that said so and how long ago.
- Watches for lights left burning in an empty room and says so once, rather
  than wrestling with whatever turned them on.
- Notices devices that have gone quiet, and tells you — once.

### The panel

- The Night House: your rooms drawn as an isometric plan, lit as they really
  are, with their photos, sensors and countdowns. Drag to turn, pinch to zoom.
- Light memory: two days replayed on a timeline you can scrub.
- Room photos, health checks, statistics, a diary, version history of your own
  settings, and import/export.
- Turkish and English throughout.

### The card

- `custom:lumen-house-card` — the same house on a dashboard. It registers
  itself as a Lovelace resource and keeps that registration up to date across
  updates; there is nothing to add by hand.
- Options: `height`, `interactive`, `toolbar`, `header`, `modes`, `refresh`,
  `isometric`, `align`, `walk`, `tilt`, `turn`, `zoom`.

### Safety and privacy

- The panel, its endpoints and the configuration services require a Home
  Assistant administrator; `lumen_ha.room` carries the caller's identity so
  Home Assistant enforces that user's own entity permissions.
- The engine only ever calls `light` and `switch`; scenes must be `scene.`,
  notifications must be `notify.`.
- Incoming configuration is checked before it is stored: malformed structure is
  refused, out-of-range numbers are clamped, and the file has a size ceiling.
- Uploaded images are checked by content, not by extension, with a size, a
  dimension and a folder-quota limit.
- Image addresses are restricted to your own installation — a shared
  configuration cannot make your browser call a stranger's server.
- Nothing leaves your home: no telemetry, no external requests, no Python
  dependencies beyond Home Assistant itself.

### Tests

66 of them, and they run in CI: 28 for the engine's decisions, 38 for the
panel, against a demo house whose every name is invented.
