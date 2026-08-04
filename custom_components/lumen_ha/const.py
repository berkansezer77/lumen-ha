"""Constants for LUMEN — automatic room lighting."""

DOMAIN = "lumen_ha"

# Static path the frontend files are served from.
FRONTEND_URL_BASE = "/lumen_ha_frontend"

# Bump on every frontend change — the version lives in the FILE NAME (not ?v=)
# so service workers / browser caches are forced to fetch the fresh file.
FRONTEND_VERSION = "1.0.0"

STORE_VERSION = 1
STORE_KEY = "lumen_config"

# Panel config changed -> engine reloads its listeners.
SIGNAL_CONFIG = f"{DOMAIN}_config_updated"
# A decision was logged -> panel refreshes.
SIGNAL_EVENT = f"{DOMAIN}_event"

PLATFORMS = ["select", "switch"]

# How many decisions we keep in the log.
MAX_EVENTS = 300

# Where uploaded room artwork lands (under config/www).
IMAGE_DIR = "lumen"
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")
MAX_UPLOAD = 12 * 1024 * 1024

# Device classes we accept for each sensor role.
TRIGGER_CLASSES = ["motion", "occupancy", "presence", "door", "window", "opening"]
HOLD_CLASSES = ["occupancy", "presence", "motion"]
LUX_CLASSES = ["illuminance"]
LIGHT_DOMAINS = ["light", "switch"]

# ---------------------------------------------------------------- room catalog
# A public app cannot assume anyone's room names. Areas still come from Home
# Assistant; this catalogue only gives each room a *type* — which decides the
# icon and (later) the artwork that ships with the integration.
ROOM_TYPES = [
    # key, tr, en, icon, group
    ("living_room", "Salon", "Living Room", "mdi:sofa", "main"),
    ("kitchen", "Mutfak", "Kitchen", "mdi:countertop", "main"),
    ("bedroom", "Yatak Odası", "Bedroom", "mdi:bed", "main"),
    ("bathroom", "Banyo", "Bathroom", "mdi:shower", "main"),
    ("hallway", "Koridor", "Hallway", "mdi:door-sliding", "main"),
    ("entryway", "Antre", "Entryway", "mdi:door-open", "main"),
    ("wc", "Tuvalet", "Toilet", "mdi:toilet", "main"),
    ("kids_room", "Çocuk Odası", "Kids Room", "mdi:teddy-bear", "main"),
    ("office", "Ofis", "Home Office", "mdi:desktop-tower-monitor", "main"),
    ("dining_room", "Yemek Odası", "Dining Room", "mdi:silverware-fork-knife", "extra"),
    ("guest_room", "Misafir Odası", "Guest Room", "mdi:bed-king-outline", "extra"),
    ("dressing_room", "Giyinme Odası", "Dressing Room", "mdi:hanger", "extra"),
    ("laundry_room", "Çamaşır Odası", "Laundry Room", "mdi:washing-machine", "extra"),
    ("pantry", "Kiler", "Pantry", "mdi:cupboard-outline", "extra"),
    ("balcony", "Balkon", "Balcony", "mdi:balcony", "extra"),
    ("nursery", "Bebek Odası", "Nursery", "mdi:baby-carriage", "extra"),
    ("gaming_room", "Oyun Odası", "Game Room", "mdi:gamepad-variant-outline", "extra"),
    ("library", "Kitaplık", "Library", "mdi:bookshelf", "extra"),
    ("gym", "Spor Odası", "Home Gym", "mdi:dumbbell", "extra"),
    ("cinema_room", "Sinema Odası", "Home Theater", "mdi:movie-open-outline", "extra"),
    ("music_room", "Müzik Odası", "Music Room", "mdi:piano", "extra"),
    ("storage", "Depo", "Storage Room", "mdi:package-variant-closed", "extra"),
    ("attic", "Çatı Katı", "Attic", "mdi:home-roof", "extra"),
    ("basement", "Bodrum", "Basement", "mdi:stairs-down", "extra"),
    ("garage", "Garaj", "Garage", "mdi:garage-variant", "extra"),
    ("stairway", "Merdiven", "Stairway", "mdi:stairs", "extra"),
    ("sunroom", "Kış Bahçesi", "Sunroom", "mdi:flower-tulip-outline", "extra"),
    ("prayer_room", "İbadet Odası", "Prayer Room", "mdi:hands-pray", "extra"),
    ("workshop", "Atölye", "Workshop", "mdi:tools", "extra"),
    ("utility_room", "Teknik Oda", "Utility Room", "mdi:water-boiler", "extra"),
    ("sauna", "Sauna", "Sauna", "mdi:hot-tub", "extra"),
    ("pet_room", "Evcil Hayvan Odası", "Pet Room", "mdi:paw", "extra"),
    ("garden", "Bahçe", "Garden", "mdi:flower", "out"),
    ("terrace", "Teras", "Terrace", "mdi:table-chair", "out"),
    ("pool", "Havuz", "Pool Area", "mdi:pool", "out"),
    ("driveway", "Araç Yolu", "Driveway", "mdi:road-variant", "out"),
    ("front_door", "Kapı Önü", "Front Door", "mdi:door", "out"),
    ("barbecue", "Barbekü", "BBQ Area", "mdi:grill", "out"),
    ("other", "Diğer", "Other", "mdi:shape-outline", "out"),
]

# Words that map a free-text area name onto a room type. First hit wins, so the
# more specific spellings come first.
TYPE_HINTS = [
    ("kids_room", ["çocuk", "cocuk", "kids", "kinder", "child"]),
    ("nursery", ["bebek", "nursery", "baby"]),
    ("guest_room", ["misafir", "guest"]),
    ("bedroom", ["yatak", "bedroom", "yatakodası", "schlaf", "master"]),
    ("living_room", ["salon", "oturma", "living", "lounge", "wohn"]),
    ("kitchen", ["mutfak", "kitchen", "küche", "kuche"]),
    ("bathroom", ["banyo", "bath", "duş", "dus", "shower"]),
    ("wc", ["tuvalet", "wc", "toilet", "lavabo"]),
    ("hallway", ["koridor", "hol", "hall", "corridor", "geçit", "gecit"]),
    ("entryway", ["antre", "giriş", "giris", "entry", "foyer", "eingang"]),
    ("office", ["ofis", "office", "çalışma", "calisma", "büro", "buro", "study"]),
    ("dining_room", ["yemek", "dining", "esszimmer"]),
    ("dressing_room", ["giysi", "giyinme", "gardırop", "gardirop", "dressing", "closet", "walk-in"]),
    ("laundry_room", ["çamaşır", "camasir", "laundry", "wasch"]),
    ("pantry", ["kiler", "pantry"]),
    ("balcony", ["balkon", "balcony"]),
    ("gaming_room", ["oyun", "gaming", "game"]),
    ("library", ["kitap", "library", "okuma"]),
    ("gym", ["spor", "gym", "fitness"]),
    ("cinema_room", ["sinema", "cinema", "theater", "theatre"]),
    ("music_room", ["müzik", "muzik", "music"]),
    ("storage", ["depo", "storage", "ambar"]),
    ("attic", ["çatı", "cati", "attic", "tavan"]),
    ("basement", ["bodrum", "basement", "kellar", "keller"]),
    ("garage", ["garaj", "garage"]),
    ("stairway", ["merdiven", "stair", "treppe"]),
    ("sunroom", ["kış bahçe", "kis bahce", "sunroom", "veranda", "conservatory"]),
    ("prayer_room", ["ibadet", "namaz", "prayer", "mescit"]),
    ("workshop", ["atölye", "atolye", "workshop", "hobi"]),
    ("utility_room", ["kazan", "teknik", "utility", "boiler"]),
    ("sauna", ["sauna"]),
    ("pet_room", ["evcil", "kedi", "köpek", "kopek", "pet", "cat", "dog"]),
    ("garden", ["bahçe", "bahce", "garden", "yard", "çim", "cim"]),
    ("terrace", ["teras", "terrace", "patio"]),
    ("pool", ["havuz", "pool"]),
    ("driveway", ["araç yol", "arac yol", "driveway", "otopark", "park"]),
    ("front_door", ["kapı ön", "kapi on", "sokak", "front door", "porch", "street"]),
    ("barbecue", ["barbekü", "barbeku", "mangal", "bbq", "grill"]),
]

# ------------------------------------------------------------------- defaults
DEFAULT_SLOTS = [
    {"key": "morning", "name": {"tr": "Sabah", "en": "Morning"},
     "from": "06:00", "to": "sunrise+60"},
    {"key": "day", "name": {"tr": "Gündüz", "en": "Day"},
     "from": "sunrise+60", "to": "sunset-60"},
    {"key": "evening", "name": {"tr": "Akşam", "en": "Evening"},
     "from": "sunset-60", "to": "00:30"},
    {"key": "night", "name": {"tr": "Gece", "en": "Night"},
     "from": "00:30", "to": "06:00"},
]

# Per-slot starting point for a freshly added room. `lux_max: None` means
# "ignore the light sensor in this slot"; `groups: []` means "all lights".
# `mode` decides *how* the light comes on:
#   set   — brightness / colour temperature / colour set here
#   last  — leave whatever the lamp was last set to
#   scene — activate a scene and touch nothing else
DEFAULT_SLOT_RULES = {
    "morning": {"on": True, "lux_max": 40, "groups": [], "picks": [], "mode": "set",
                "bri": 60, "kelvin": 3000, "color": None, "scene": "",
                "off_enabled": True, "off_groups": [], "off_picks": [], "off_after": 180, "delay_on": 0, "dim_warn": 0, "off_on_enter": False,
                "trigger_pick": [], "hold_pick": [],
                "trigger_mode": "any", "hold_mode": "any", "and_window": 30,
                     "watch_dark": False, "check_every": 30},
    "day": {"on": True, "lux_max": 20, "groups": [], "picks": [], "mode": "set",
            "bri": 80, "kelvin": 4000, "color": None, "scene": "",
            "off_enabled": True, "off_groups": [], "off_picks": [], "off_after": 300, "delay_on": 0, "dim_warn": 0, "off_on_enter": False,
                "trigger_pick": [], "hold_pick": [],
                "trigger_mode": "any", "hold_mode": "any", "and_window": 30,
                     "watch_dark": False, "check_every": 30},
    "evening": {"on": True, "lux_max": 200, "groups": [], "picks": [], "mode": "set",
                "bri": 70, "kelvin": 2700, "color": None, "scene": "",
                "off_enabled": True, "off_groups": [], "off_picks": [], "off_after": 600, "delay_on": 0, "dim_warn": 0, "off_on_enter": False,
                "trigger_pick": [], "hold_pick": [],
                "trigger_mode": "any", "hold_mode": "any", "and_window": 30,
                     "watch_dark": False, "check_every": 30},
    "night": {"on": True, "lux_max": 15, "groups": [], "picks": [], "mode": "set",
              "bri": 10, "kelvin": 2200, "color": None, "scene": "",
              "off_enabled": True, "off_groups": [], "off_picks": [], "off_after": 120, "delay_on": 0, "dim_warn": 0, "off_on_enter": False,
                "trigger_pick": [], "hold_pick": [],
                "trigger_mode": "any", "hold_mode": "any", "and_window": 30,
                     "watch_dark": False, "check_every": 30},
}

DEFAULT_SLOT_RULE = {"on": True, "lux_max": 40, "groups": [], "picks": [], "mode": "set",
                     "bri": 70, "kelvin": 2700, "color": None, "scene": "",
                     "off_enabled": True, "off_groups": [], "off_picks": [], "off_after": 300, "delay_on": 0, "dim_warn": 0,
                     "off_on_enter": False,
                     "trigger_pick": [], "hold_pick": [],
                     "trigger_mode": "any", "hold_mode": "any",
                     "and_window": 30,
                     "watch_dark": False, "check_every": 30}

DEFAULT_ROOM = {
    "on": True,
    "type": "other",
    # Empty means "whatever the type suggests"; a name like mdi:sofa overrides
    # it, because no list of forty room types covers everybody's home.
    "icon": "",
    "image": "",            # /local/lumen/… uploaded artwork
    "trigger": [],          # fires the light
    "hold": [],             # keeps the light on while occupied
    # "any" = one sensor is enough (the default), "all" = they must agree.
    "trigger_mode": "any",  # how the wakers are read when switching on
    "hold_mode": "any",     # how the holders are read when deciding "occupied"
    # Two sensors rarely fire in the same second: a PIR resets in half a minute
    # while an mmWave holds for several, so a strict "both on right now" can
    # never come true. "all" means both saw something within this window.
    "and_window": 30,
    "lux": "",              # illuminance sensor
    "temp": [],             # temperature sensors, averaged on the card
    "lights": [],           # every controllable light in the room
    "groups": [],           # [{key, name, lights: []}]
    "manual_off": False,    # dropped from the panel: we only tidy our own doing
    # Seconds of fade. Zero means the plain turn_on/turn_off Home
    # Assistant itself sends — and some bulbs answer a fade-to-off by
    # coming back on a minute later, so zero is the honest default.
    "transition": 0,
    "fade_set": False,      # true once somebody has chosen it
    "neighbors": [],        # these rooms' triggers also switch this room on
    "slot_follow": True,    # follow the slot change while already on
    "mode_off": [],         # modes in which this room is left alone
    "slots": {},            # slot key -> rule
}

DEFAULT_MODES = [
    # A mode bends how the light comes on. It does not decide *whether* — the
    # rooms and their slots already answer that, and saying it twice is how a
    # panel ends up arguing with itself.
    {"key": "normal", "name": {"tr": "Normal", "en": "Normal"},
     "icon": "mdi:home-outline",
     "bri": None, "kelvin": None, "expire_h": 0},
    # The follow-me mode. Which sensors count as "I am here now" is chosen per
    # room, and rooms can be left out of the sweep entirely.
    {"key": "alone", "name": {"tr": "Tek Oda", "en": "One Room"},
     "icon": "mdi:map-marker-radius-outline",
     "bri": None, "kelvin": None, "expire_h": 0,
     "enter": {},        # room -> [entity_id]; empty = that room's own wakers
     "keep": []},        # rooms this mode never switches off
]

DEFAULT_CONFIG = {
    "lang": "tr",
    "enabled": True,
    "mode": "normal",
    "mode_until": 0,        # epoch seconds; 0 = no expiry
    "slots": DEFAULT_SLOTS,
    "modes": DEFAULT_MODES,
    "rooms": {},            # area_id -> DEFAULT_ROOM
    # The Night House drawing. One floor with several rows = a flat; add floors
    # for a house. Rooms live in rows so any home shape can be laid out.
    "layout": {"floors": []},
    # How a room's own photograph is shown on its card. A dark house wants a
    # dark picture, but how dark — and whether an unlit room drains the colour
    # out of it — is a matter of taste, so it is asked rather than decided.
    # off_style: dark | gray | both
    "photo": {"off_style": "dark", "off": 62, "on": 14},
    # entity_id -> area_id, when the Home Assistant area is wrong for lighting
    # purposes. We never write to the HA registry.
    "overrides": {},
    # Entities the user has taken out of a room. Autofill and the "new device"
    # notice both leave these alone: removing something and being offered it
    # again the next minute is the panel arguing with you.
    "ignored": [],
    # Areas that are not rooms: a street, a garage, a virtual area somebody made
    # for grouping. Autofill leaves them alone instead of putting them back.
    "skip_areas": [],
    # Where to send the health report, and how often to bother.
    # after_min: a device has to stay away this long before it counts as
    # gone. Anything shorter is a blink, and a blink is not news.
    "notify": {"service": "", "enabled": False, "every_h": 24,
               "after_min": 5, "stuck_min": 10, "stuck": True,
               "quiet": []},
    # The Night House backdrop. Two of each, because a house at noon and a
    # house at midnight are not the same picture.
    "scene_art": {"floor_day": "", "floor_night": "",
                  "back_day": "", "back_night": ""},
    # Rough running cost. Nobody knows a bulb's wattage offhand, so one average
    # stands for the house and the panel is honest about it being an estimate.
    "energy": {"price": 3.5, "watt": 9},
}

# How long a sensor may stay silent before we call it asleep rather than calm.
STALE_DAYS = 3
# A device is only 'gone' once it has stayed gone this long.
OUTAGE_MIN = 5
# How long a light may burn in an empty room before it is worth
# mentioning. LUMEN does not switch it off — it says so.
STUCK_MIN = 10
# The darkness watch asks the lux sensor this often by default,
# and never more often than this at the fastest setting.
DARK_TICK = 5

# A room whose lights we drive more than this many times inside the window is
# treated as a runaway loop: we park it and say so, rather than flapping the
# lights all night. (Bir kez yanan sigorta, sabaha kadar çakan ışıktan iyidir.)
FUSE_CALLS = 8
FUSE_WINDOW = 20.0     # seconds
FUSE_PAUSE = 300.0     # seconds the room is parked for
