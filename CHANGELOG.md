# Changelog

## 1.0.3 — permission asked before anything moves

**A refused command no longer leaves a trace.** Home Assistant already enforces
entity permissions on a call that carries the caller's identity — but it does
so *after* the call is on its way, and it does not tell us. LUMEN had already
noted "this room is mine" by then, and a later automatic sweep could act on
that note. The permission is now asked **before** the engine touches anything:
a user without control of a room's lights gets `unauthorized`, no command is
sent, and no internal state changes. Administrators and calls with no user
behind them (sensors, automations, scripts) are unaffected.

**A malformed configuration answers 400, not 500.** The guard walked
`rooms[].slots` before checking it was an object, and accepted a `scene_art`
that was a list or an `ignored` that was a number — which the engine then
choked on. Every top-level structure the engine assumes is now checked, and the
answer is a clear message rather than "the server got itself in trouble".

## 1.0.2 — a condition instead of a timer

**The timed room lock is gone.** "Leave this room alone for three hours" asked
you to remember something; a house should not need to be remembered.

**In its place: conditions, per slot.** A slot can now name entities and the
state they must be in for the room to be left alone:

| While | Room | Condition |
|---|---|---|
| The television is playing | living room | `media_player.tv` = `playing` |
| Somebody is asleep | bedroom | `binary_sensor.bed_occupied` = `on` |
| The projector is on | cinema | `switch.projector` = `on` |

It only withholds the decision to **switch on** — a light already burning is
not put out, and the countdown is unaffected. The reason appears on the room
the same way every other decision does ("Tv = playing").

Entity and state are typed in by hand rather than picked from a list: a
television that reports `playing` and one that reports `on` are both
televisions, and a list would have excluded whichever we did not think of.

**Also removed:** two dead settings left over from the old "did you touch this
switch yourself" inference — `manual_off` on rooms and `keep_manual_off` on
slots. Nothing read them; they sat in exported configurations inviting the
question "what does this do?". The `lumen_ha.lock_room` service is gone with
the feature.

## 1.0.1 — the second audit

A security review of 1.0.0 found four real defects. All are fixed.

- **`lock_room` did nothing.** The service sent an action name the engine did
  not recognise, and reported success anyway. It now sends the right one — and
  every service checks what the engine answered instead of assuming.
- **The seven-second retry lost the caller.** When a light did not answer, the
  retry went out as a system call. A user whose first command was refused for
  lack of permission would have been let through by the second. The identity is
  now carried into the deferred work.
- **The configuration guard had holes.** `NaN`, infinity, a billion-column
  floor grid, room geometry and non-numeric values in numeric fields all passed
  through. A billion columns is a browser that stops responding.
- **A video could pass as an image.** "Has an `ftyp` box" is true of MP4 and
  QuickTime as well as AVIF; the brand is now checked.

Also: diagnostics use Home Assistant's own `async_redact_data` rather than a
hand-rolled mask, and the test harness no longer swallows "coroutine was never
awaited" warnings — those would have hidden a real one.

Three new tests, aimed at the class of bug rather than the instance: the
services' action names must be ones the engine handles, the retry must carry
the caller, and the guard must object to the fields it previously ignored.

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
