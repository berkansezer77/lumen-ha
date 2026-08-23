# Changelog

## 1.0.6 — the room that would never go dark again

When a room empties, LUMEN puts it out **once** and then leaves it alone: if
something switches the light back on, wrestling with it is how a house ends up
flickering all night. That "once" was meant to last for one empty spell.

It lasted forever. The flag was only cleared in one code path — the one that
runs when a *holder* sensor comes on while the room is already being watched.
In a room whose presence sensor is both the waker and the holder (the ordinary
case for a small room) that path never runs. So the first time LUMEN switched
such a room off was the last: from then on it only warned, ten minutes later,
that the room was empty and the lights were still on.

It hid well. A room lit by a *trigger* recovers on the way in, so most rooms
looked fine; the ones that went wrong were the rooms lit by the darkness rule
in a slot whose "switch on" is off — where the trigger is blocked and never
gets the chance to clear the flag.

Somebody being in the room now clears it, in both places where we learn it:
the sensor firing, and the half-minute sweep.

## 1.0.5 — a restart forgot who was in the room

A room is only switched off after somebody was **seen** in it and then left —
that is what stops a light coming on for a passing sensor blip from being put
out by a countdown nobody started. But "somebody was seen here" lived only in
memory, and a Home Assistant restart wipes it.

So: restart Home Assistant while you are sitting in a room, walk out, and the
light stays on until morning. LUMEN treats it as a light somebody switched on
from outside and keeps its hands off — it warns ten minutes later instead
("the room is empty and 8 lights have been on for 10 minutes"), which is
exactly what the diary showed.

The sensors already know. If they say a room is occupied, somebody is in it:
that is now taken as *seen*, both when the integration starts and every half
minute afterwards (the entities are not always loaded yet at start-up). The
rule itself is unchanged — a room nobody has been in is still left alone.

## 1.0.4 — rooms with light groups

A regression from 1.0.3: the permission check listed a room's switchable
things by adding `groups` to `lights` — but a group is not an entity id, it is
`{key, name, lights}`. In a room with any group, the household-facing
`lumen_ha.room` service raised `unhashable type: dict` instead of switching
anything. The panel, administrators and sensor automations were unaffected,
which is exactly why the tests missed it: every one of them used a room
without groups.

Group lights are now flattened, and the service test runs against a room that
has groups — for an authorised and an unauthorised user both.

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
