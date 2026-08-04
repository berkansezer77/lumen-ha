# Tests

Two suites, no test framework: every file is a program you can run on its own
and read the output of.

```bash
# engine — the decisions, on a stand-in Home Assistant
for f in tests/engine/test_*.py; do python "$f"; done

# panel — the interface, opened in jsdom
npm install
node tests/run-panel.js
```

Both run in CI on every push (`.github/workflows/validate.yml`).

## What is where

| | |
|---|---|
| `engine/` | What LUMEN decides and when: the empty-room sweep, the departure gate, the stuck-light watch, dimming, migrations, the config guard, unload. |
| `panel/` | What the panel and the card draw: layout, photos, the memory view, touch behaviour on a tablet, the isometric camera. |
| `fixtures/house.json` | A demo house — eight rooms, 143 entities, invented names throughout. |

## The fixture

The suites need a house to work on. This one has the shape of a real one
(rooms with triggers, holders, lux sensors, time slots, a live state payload
and lux history) but **every name in it is made up** — it was derived from a
real installation and then stripped: entity ids renamed, device names replaced,
diary lines rewritten, the unrelated 1500 entities of that home dropped.

If you change the fixture, keep the tests reading their expectations *from it*
rather than hard-coding values. A test that says `expect(bri).toBe(42)` is a
test that belongs to one house; `expect(bri).toBe(cfg.rooms.x.slots.night.bri)`
belongs to everybody.
