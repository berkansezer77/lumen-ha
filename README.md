<p align="center"><img src="https://raw.githubusercontent.com/berkansezer77/lumen-ha/main/custom_components/lumen_ha/brand/icon.png" width="120" alt="Lumen HA"></p>
<h1 align="center">Lumen HA</h1>
<p align="center">Room lighting that decides for itself — and tells you why.<br>
Not a scheduler, not a blueprint: one panel, one engine, no helpers and no YAML automations.</p>

<p align="center">
  <a href="https://github.com/hacs/integration"><img src="https://img.shields.io/badge/HACS-Custom-41BDF5.svg"></a>
  <img src="https://img.shields.io/badge/license-MIT-green.svg">
  <img src="https://img.shields.io/badge/Home%20Assistant-2024.11%2B-41BDF5.svg">
</p>

<p align="center"><a href="README.tr.md">Türkçe</a></p>

---

<p align="center">
  <img src="docs/images/night-house.png" width="880" alt="The Night House — every room, lit or not, with its reason">
</p>

## What is it?

Lumen HA switches the lights in each room the way you would: it watches the
room's sensors, looks at how dark it actually is, and decides. Every decision is
written down in plain words, so when a light does something you did not expect
you can read the reason instead of guessing.

The whole configuration lives in one panel. It writes JSON; the engine reads it.
No `input_boolean` helpers appear in your entity list, no automations are
generated behind your back, and nothing is written to your YAML.

## Features

**The house, drawn** — every room is a card on an isometric plan you can turn,
zoom and rearrange. A lit room glows; an empty one does not. The card carries
the room's own light curve, its sensors and its next decision.

**Rules belong to the hour, not the room** — morning, day, evening, night and any
slot you add. Each slot has its own answer to: should it come on, which lights,
how bright, which sensors wake the room, which ones keep it awake, how long
after it empties, and how dark it has to be.

**Two kinds of sensor** — a *waker* turns the light on; a *holder* only keeps it
from going out. A fast PIR by the door and an mmWave presence sensor over the
sofa do different jobs, and telling them apart is what stops the light dying
while you sit still.

**It only decides once** — the lux value is frozen the moment a light comes on,
so the room's own lamps can never argue with its light sensor.

**An empty room goes dark — once** — whoever switched the light on. If something
turns it back on, Lumen does not wrestle with it; after a number of minutes you
choose, it tells you instead.

**Light Memory** — a time machine over the last 24 hours, 2 days or 3 days.
Scrub the bar and the house returns to that minute: which rooms were lit, how
much of each, and where somebody was.

**House modes** — Normal and One Room come with it; add your own (guest, cinema,
holiday — whatever your house needs). A mode does not replace the rules; it
bends them.

**It reports itself** — a health page for devices that went offline or stopped
reporting, an hours/kWh page, and a diary where every switch is one line of
plain language.

**Bilingual** — the whole panel is English and Turkish.

## The light memory

Two days of the house, on one timeline. Scrub it and the rooms light up as they
did, so "why was the hall on at three in the morning" is a question you answer
by looking rather than remembering.

<p align="center">
  <img src="docs/images/memory.png" width="880" alt="Light memory — the house replayed on a timeline">
</p>

## On a dashboard

The same house as a Lovelace card — `custom:lumen-house-card`. It registers
itself; there is no resource to add.

```yaml
type: custom:lumen-house-card
height: 620
turn: -20        # which way the house faces
align: true      # keep it centred, ignore the panel's saved angle
walk: true       # keep the figure walking even where the system dims animations
interactive: false   # a screensaver: look, do not touch
```

<p align="center">
  <img src="docs/images/card.png" width="820" alt="The house as a Lovelace card">
</p>

## Installation

### HACS (custom repository)

1. HACS → Integrations → ⋮ → **Custom repositories**
2. URL: `https://github.com/berkansezer77/lumen-ha`, category **Integration**
3. Install, then restart Home Assistant
4. Settings → Devices & services → **Add integration** → *Lumen HA*

### Manual

Copy `custom_components/lumen_ha` into your `config/custom_components/`,
restart, then add the integration.

## Requirements

- Home Assistant 2024.11 or newer
- Lights or switches (`light.*`, `switch.*`)
- At least one motion or presence sensor per room you want automated
- Optional: an illuminance sensor per room — without one, the room simply
  decides on movement alone

## How it works

| | |
|---|---|
| **Waker / holder** | A waker may switch the light on. A holder may only postpone the countdown. A sensor can be both. |
| **Agreement** | With two wakers you can ask for *any* of them or *all* of them within a window, so a hallway is not lit by a passing shadow. |
| **Frozen lux** | The threshold is read once, when the light comes on. |
| **Darkness watch** | While you sit still in a room that gets dark, the room can light itself; you choose how often it looks. |
| **One offer** | When a room empties, Lumen switches it off once. After that it watches and reports. |
| **Fuse** | A room that is driven too often in too short a time is parked for five minutes and the reason is written down. |

## Notes

Room artwork you upload is stored in `config/www/lumen/`. Home Assistant serves
that folder **without authentication** at `/local/…`, so treat anything you
upload as public to anyone who can reach your Home Assistant address.

## Documentation

See the [wiki](https://github.com/berkansezer77/lumen-ha/wiki).

## Contributing

Issues and pull requests are welcome. There are 66 tests under `tests/` — 28
for the engine, 38 for the panel — and they run in CI on every push. Please
keep them green; `tests/README.md` says how to run them.

## License

MIT © Berkan Sezer
