"""LUMEN — automatic room lighting, configured entirely from its own panel.

Walk into a room and the light comes on — but only if the room is actually dark,
only in the time slots you allowed, only in the house mode you are in, and never
right after you touched the switch yourself.

Panel = where you define things, Home Assistant = the engine that runs them.
There are no generated automations and no helpers: `engine.py` listens and acts.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil

from aiohttp import web

import voluptuous as vol

from homeassistant.components import panel_custom
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import HomeAssistantView, StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.service import async_register_admin_service
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.util import slugify

from .const import (
    DOMAIN,
    FRONTEND_URL_BASE,
    FRONTEND_VERSION,
    IMAGE_EXT,
    IMAGE_STORE,
    IMAGE_URL,
    LEGACY_IMAGE_DIR,
    MAX_UPLOAD,
    PLATFORMS,
    ROOM_TYPES,
    SIGNAL_CONFIG,
    STORE_KEY,
    STORE_VERSION,
)
from . import guard
from .engine import LumenEngine

_LOGGER = logging.getLogger(__name__)


def _looks_like_image(blob: bytes) -> bool:
    """True if the first bytes carry one of the allowed formats' signatures."""
    if blob.startswith((b"\xff\xd8\xff",          # jpeg
                        b"\x89PNG\r\n\x1a\n",      # png
                        b"GIF87a", b"GIF89a")):    # gif
        return True
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        return True
    # AVIF/HEIC are ISO-BMFF files, and so are MP4 and QuickTime: "has ftyp"
    # was letting a video through under an .avif name. The brand that follows
    # says which it is.
    if blob[4:8] == b"ftyp":
        return blob[8:12] in (b"avif", b"avis", b"heic", b"heix", b"heim",
                              b"heis", b"hevc", b"mif1", b"msf1")
    return False


def _folder_bytes(folder: str) -> int:
    """Yüklenen görsellerin toplam boyutu. (Yürütücüde çağrılır: disk okur.)"""
    toplam = 0
    if not os.path.isdir(folder):
        return 0
    for name in os.listdir(folder):
        try:
            toplam += os.path.getsize(os.path.join(folder, name))
        except OSError:
            continue
    return toplam


def _engine_of(hass: HomeAssistant) -> LumenEngine | None:
    """Şu anda çalışan motor.

    Uçlar motoru kurulurken ellerine tutuşturulan nesneden değil, her
    çağrıda buradan alır: entegrasyon kaldırılıp yeniden kurulduğunda
    (HA çalışan bir view'ı geri alamaz) panelin eski, ölü bir motorla
    konuşmasını başka türlü engelleyemeyiz.
    """
    return (hass.data.get(DOMAIN) or {}).get("engine")


def _is_admin(request) -> bool:
    """Only administrators.

    `requires_auth` on its own just means "somebody logged in". The panel drives
    every light in the house and can upload files, so require an admin.
    """
    user = request.get("hass_user")
    return bool(user and user.is_admin)


def _image_folder(hass: HomeAssistant) -> str:
    """Where uploaded photos are kept: outside www/, so never public."""
    return hass.config.path(*IMAGE_STORE)


_LEGACY_URL = re.compile(r"^/local/" + re.escape(LEGACY_IMAGE_DIR) + r"/([^/?#]+)$")


def _relink(obj, renamed: dict[str, str] | None = None):
    """Point every old /local/lumen/<name> address at the authenticated view.

    Used on the stored configuration and its backups after the files move, and
    on every incoming config, so an older export imported later still works.
    """
    if isinstance(obj, str):
        m = _LEGACY_URL.match(obj)
        if not m:
            return obj
        name = m.group(1)
        return f"{IMAGE_URL}/{(renamed or {}).get(name, name)}"
    if isinstance(obj, dict):
        return {k: _relink(v, renamed) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_relink(v, renamed) for v in obj]
    return obj


def _move_legacy_images(old: str, new: str) -> dict[str, str]:
    """Move photos uploaded by 1.0.6 and older out of www/lumen.

    Runs in the executor. Returns {old name: new name} for any file that had to
    be renamed because the target name was taken. The old folder is removed
    once it is empty, so nothing of ours is left under /local/.
    """
    renamed: dict[str, str] = {}
    if not os.path.isdir(old):
        return renamed
    os.makedirs(new, exist_ok=True)
    for name in os.listdir(old):
        src = os.path.join(old, name)
        if not os.path.isfile(src) or not name.lower().endswith(IMAGE_EXT):
            continue
        target = os.path.join(new, name)
        base, dot = os.path.splitext(target)
        n = 2
        while os.path.exists(target):
            target = f"{base}_{n}{dot}"
            n += 1
        shutil.move(src, target)
        if os.path.basename(target) != name:
            renamed[name] = os.path.basename(target)
    try:
        os.rmdir(old)
    except OSError:
        pass  # something else is still in there; leave it alone
    return renamed


async def _async_migrate_images(hass: HomeAssistant, engine: LumenEngine) -> None:
    """Move legacy uploads and rewrite the addresses that point at them."""
    old = hass.config.path("www", LEGACY_IMAGE_DIR)
    try:
        renamed = await hass.async_add_executor_job(
            _move_legacy_images, old, _image_folder(hass))
    except OSError as err:
        _LOGGER.error("LUMEN: could not move photos out of %s: %s", old, err)
        return
    cfg = _relink(engine.config, renamed)
    if cfg != engine.config:
        engine.config = cfg
        await engine.store.async_save(engine.config)
        _LOGGER.info("LUMEN: photos moved out of /local/; addresses updated")
    backups = _relink(engine.backups, renamed)
    if backups != engine.backups:
        engine.backups = backups
        await engine.backups_store.async_save({"backups": engine.backups})


class LumenConfigView(HomeAssistantView):
    """Read/write the panel configuration."""

    url = "/api/lumen_ha/config"
    name = "api:lumen_ha:config"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    @property
    def _engine(self) -> LumenEngine | None:
        return _engine_of(self._hass)

    async def get(self, request):
        if not _is_admin(request):
            return self.json_message("Admin required", status_code=403)
        if self._engine is None:
            return self.json_message("LUMEN unloaded", status_code=503)
        return self.json({
            "config": self._engine.config,
            "room_types": [
                {"key": k, "tr": tr, "en": en, "icon": icon, "group": grp}
                for k, tr, en, icon, grp in ROOM_TYPES
            ],
        })

    async def post(self, request):
        if not _is_admin(request):
            return self.json_message("Admin required", status_code=403)
        if self._engine is None:
            return self.json_message("LUMEN unloaded", status_code=503)
        # Gövde bir kez metin olarak alınır: boyutu ölçebilmek için. Aynı
        # dosya dışa aktarılıp paylaşılıyor ve geri içeri alınıyor; bozuk ya
        # da şişirilmiş bir dosyanın motora ulaşmaması gerekiyor.
        raw = await request.text()
        if len(raw) > guard.MAX_BYTES:
            return self.json_message("Config too large", status_code=413)
        try:
            body = json.loads(raw)
        except ValueError:
            return self.json_message("Invalid JSON", status_code=400)
        if not isinstance(body, dict):
            return self.json_message("Expected an object", status_code=400)
        try:
            body, notes = guard.clean(body, raw_len=len(raw))
        except guard.ConfigRejected as err:
            # Yapı bozuksa sessizce düzeltmek yok: kullanıcı kaydettiğini
            # sanıp başka bir şey saklanmış olur.
            _LOGGER.warning("LUMEN: yapılandırma reddedildi: %s", err)
            return self.json_message(f"Config rejected: {err}", status_code=400)
        if notes:
            _LOGGER.info("LUMEN: yapılandırmada %d değer sınıra çekildi", len(notes))
        await self._engine.async_save(_relink(body))
        # Sensors or lights may have moved between rooms — relisten.
        self._engine.setup()
        async_dispatcher_send(self._engine.hass, SIGNAL_CONFIG)
        return self.json({"ok": True, "notes": notes})


class LumenStateView(HomeAssistantView):
    """Live state the Night House and the room pages draw themselves from."""

    url = "/api/lumen_ha/state"
    name = "api:lumen_ha:state"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    @property
    def _engine(self) -> LumenEngine | None:
        return _engine_of(self._hass)

    async def get(self, request):
        if not _is_admin(request):
            return self.json_message("Admin required", status_code=403)
        if self._engine is None:
            return self.json_message("LUMEN unloaded", status_code=503)
        return self.json(self._engine.state_payload())


class LumenActionView(HomeAssistantView):
    """Mode changes, manual switching, locks, autofill."""

    url = "/api/lumen_ha/action"
    name = "api:lumen_ha:action"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    @property
    def _engine(self) -> LumenEngine | None:
        return _engine_of(self._hass)

    async def post(self, request):
        if not _is_admin(request):
            return self.json_message("Admin required", status_code=403)
        if self._engine is None:
            return self.json_message("LUMEN unloaded", status_code=503)
        try:
            body = await request.json()
        except ValueError:
            return self.json_message("Invalid JSON", status_code=400)
        if not isinstance(body, dict):
            return self.json_message("Expected an object", status_code=400)
        try:
            result = await self._engine.async_action(body)
        except Exception as err:  # noqa: BLE001 - tell the panel, don't 500
            _LOGGER.exception("LUMEN action failed")
            return self.json({"ok": False, "error": str(err)})
        return self.json(result)


class LumenInsightView(HomeAssistantView):
    """What the panel needs to look after the setup rather than just run it:
    the health report and the running total."""

    url = "/api/lumen_ha/insight"
    name = "api:lumen_ha:insight"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    @property
    def _engine(self) -> LumenEngine | None:
        return _engine_of(self._hass)

    async def get(self, request):
        if not _is_admin(request):
            return self.json_message("Admin required", status_code=403)
        if self._engine is None:
            return self.json_message("LUMEN unloaded", status_code=503)
        hass = self._engine.hass
        # Whatever this house can be told with — phones, speakers, e-mail.
        notify = sorted(hass.services.async_services().get("notify", {}))
        return self.json({
            "health": self._engine.health(),
            "usage": self._engine.usage_summary(30),
            "notify_services": ["notify." + n for n in notify],
        })

    async def post(self, request):
        if not _is_admin(request):
            return self.json_message("Admin required", status_code=403)
        if self._engine is None:
            return self.json_message("LUMEN unloaded", status_code=503)
        try:
            body = await request.json()
        except ValueError:
            return self.json_message("Invalid JSON", status_code=400)
        if (body or {}).get("action") == "test_notify":
            return self.json(await self._engine.async_health_notify(force=True))
        return self.json({"ok": False, "error": "unknown action"})


class LumenBackupView(HomeAssistantView):
    """Previous versions of the configuration, so a bad edit can be undone."""

    url = "/api/lumen_ha/backups"
    name = "api:lumen_ha:backups"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    @property
    def _engine(self) -> LumenEngine | None:
        return _engine_of(self._hass)

    async def get(self, request):
        if not _is_admin(request):
            return self.json_message("Admin required", status_code=403)
        if self._engine is None:
            return self.json_message("LUMEN unloaded", status_code=503)
        return self.json({"backups": self._engine.backup_list()})

    async def post(self, request):
        if not _is_admin(request):
            return self.json_message("Admin required", status_code=403)
        if self._engine is None:
            return self.json_message("LUMEN unloaded", status_code=503)
        try:
            body = await request.json()
        except ValueError:
            return self.json_message("Invalid JSON", status_code=400)
        try:
            index = int(body.get("index"))
        except (TypeError, ValueError):
            return self.json_message("index required", status_code=400)
        if not await self._engine.async_restore_backup(index):
            return self.json_message("No such backup", status_code=404)
        self._engine.setup()
        async_dispatcher_send(self._engine.hass, SIGNAL_CONFIG)
        return self.json({"ok": True})


class LumenImageView(HomeAssistantView):
    """Room artwork: whatever the user drops onto a room."""

    url = "/api/lumen_ha/image"
    name = "api:lumen_ha:image"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    @property
    def _engine(self) -> LumenEngine | None:
        return _engine_of(self._hass)

    def _folder(self) -> str:
        return _image_folder(self._hass)

    def _scan(self) -> list[dict]:
        folder = self._folder()
        out = []
        if not os.path.isdir(folder):
            return out
        for name in sorted(os.listdir(folder)):
            if not name.lower().endswith(IMAGE_EXT):
                continue
            try:
                size = os.path.getsize(os.path.join(folder, name))
            except OSError:
                size = 0
            out.append({"name": name, "url": f"{IMAGE_URL}/{name}", "size": size})
        return out

    async def get(self, request):
        if not _is_admin(request):
            return self.json_message("Admin required", status_code=403)
        if self._engine is None:
            return self.json_message("LUMEN unloaded", status_code=503)
        files = await self._hass.async_add_executor_job(self._scan)
        return self.json({"files": files})

    async def post(self, request):
        if not _is_admin(request):
            return self.json_message("Admin required", status_code=403)
        if self._engine is None:
            return self.json_message("LUMEN unloaded", status_code=503)
        try:
            data = await request.post()
        except Exception:  # noqa: BLE001
            return self.json_message("Bad upload", status_code=400)

        field = data.get("file")
        if field is None or not hasattr(field, "filename"):
            return self.json_message("No file", status_code=400)

        stem, ext = os.path.splitext(os.path.basename(field.filename or ""))
        if ext.lower() not in IMAGE_EXT:
            return self.json_message("Only image files are allowed", status_code=400)
        safe = f"{slugify(stem) or 'room'}{ext.lower()}"

        # Read in the executor — aiohttp has already spooled the body to a
        # temp file, and 12 MB of disk read does not belong on the event loop.
        payload = await self._hass.async_add_executor_job(
            field.file.read, MAX_UPLOAD + 1)
        if len(payload) > MAX_UPLOAD:
            return self.json_message("File too large", status_code=413)
        # The name says image; the first bytes have to agree. Whatever is
        # stored here is served back to every browser that opens the panel,
        # so "trust the extension" is not enough.
        if not _looks_like_image(payload):
            return self.json_message("Not a recognised image", status_code=400)
        # Dosya boyutu tek başına yetmiyor: küçük bir dosya açıldığında yüz
        # megapiksel olabilir ve onu çizmeye çalışan tablet diz çöker.
        neden = guard.image_reason(payload)
        if neden:
            return self.json_message(neden, status_code=400)

        folder = self._folder()
        # Yüklenip vazgeçilen dosyalar birikiyor ve kimse silmiyor. Sessizce
        # diski doldurmaktansa "yerin dolu" demek.
        dolu = await self._hass.async_add_executor_job(_folder_bytes, folder)
        if dolu + len(payload) > guard.MAX_FOLDER:
            return self.json_message(
                f"Görsel klasörü doldu ({dolu // (1024 * 1024)} MB, sınır "
                f"{guard.MAX_FOLDER // (1024 * 1024)} MB) — kullanılmayan "
                f"görselleri silin", status_code=507)

        def _save() -> str:
            os.makedirs(folder, exist_ok=True)
            target = os.path.join(folder, safe)
            base, dot = os.path.splitext(target)
            n = 2
            while os.path.exists(target):
                target = f"{base}_{n}{dot}"
                n += 1
            with open(target, "wb") as handle:
                handle.write(payload)
            return os.path.basename(target)

        try:
            stored = await self._hass.async_add_executor_job(_save)
        except OSError as err:
            return self.json_message(f"Could not save: {err}", status_code=500)

        return self.json({"ok": True, "url": f"{IMAGE_URL}/{stored}",
                          "name": stored})


class LumenImageFileView(HomeAssistantView):
    """Serve one uploaded photo, to signed-in users only.

    The panel and the card show these as CSS background images, which cannot
    carry a bearer token, so the frontend asks Home Assistant for a signed path
    (`auth/sign_path`) and loads that. Either way the request is authenticated:
    a photo is never readable by someone who merely reaches the URL.
    """

    url = IMAGE_URL + "/{name}"
    name = "api:lumen_ha:image_file"
    requires_auth = True

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    async def get(self, request, name: str):
        # A bare file name from our own folder, nothing else.
        if (name != os.path.basename(name) or name.startswith(".")
                or not name.lower().endswith(IMAGE_EXT)):
            raise web.HTTPNotFound()
        path = os.path.join(_image_folder(self._hass), name)
        if not await self._hass.async_add_executor_job(os.path.isfile, path):
            raise web.HTTPNotFound()
        return web.FileResponse(path, headers={
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        })


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up LUMEN from a config entry."""
    domain_data = hass.data.setdefault(DOMAIN, {})

    engine: LumenEngine | None = domain_data.get("engine")
    if engine is None:
        store = Store(hass, STORE_VERSION, STORE_KEY)
        engine = LumenEngine(hass, store)
        await engine.async_load()
        domain_data["engine"] = engine
        await _async_migrate_images(hass, engine)

    if not domain_data.get("frontend_registered"):
        frontend_dir = os.path.join(os.path.dirname(__file__), "frontend")
        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL_BASE, frontend_dir, False)]
        )
        hass.http.register_view(LumenConfigView(hass))
        hass.http.register_view(LumenStateView(hass))
        hass.http.register_view(LumenActionView(hass))
        hass.http.register_view(LumenInsightView(hass))
        hass.http.register_view(LumenBackupView(hass))
        hass.http.register_view(LumenImageView(hass))
        hass.http.register_view(LumenImageFileView(hass))

        try:
            await panel_custom.async_register_panel(
                hass,
                frontend_url_path="lumen-ha",
                webcomponent_name="lumen-panel",
                module_url=f"{FRONTEND_URL_BASE}/lumen-panel-{FRONTEND_VERSION}.js",
                sidebar_title="LUMEN",
                sidebar_icon="mdi:lightbulb-auto",
                # The panel controls every light and can upload files.
                require_admin=True,
            )
        except ValueError:
            pass  # already registered (entry reload)

        # The dashboard card (custom:lumen-house-card) lives in the panel's file.
        # It is loaded as an extra frontend module, the same way the panel is
        # served, so the user's Lovelace resource list is never read or written.
        add_extra_js_url(hass, f"{FRONTEND_URL_BASE}/lumen-panel-{FRONTEND_VERSION}.js")
        domain_data["card_resource"] = {
            "url": f"{FRONTEND_URL_BASE}/lumen-panel-{FRONTEND_VERSION}.js",
            "how": "extra_js",
        }

        domain_data["frontend_registered"] = True

    # Servisler her kurulumda yeniden kaydedilir — bilerek "bir kez kur"
    # bloğunun dışında. Kaldırma sırasında siliniyorlar; blok içinde kalsalardı
    # entegrasyonu kaldırıp yeniden kuran biri servissiz kalırdı. Kayıt
    # üzerine yazar, o yüzden tekrarı zararsız; ve kapanışlar her seferinde
    # o anki motora bağlanır, eskisine değil.
    _register_services(hass, engine)

    engine.setup()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


def _register_services(hass: HomeAssistant, engine: LumenEngine) -> None:
    """lumen_ha.set_mode / room / autofill

    Ev halkının kullanacağı tek servis `room`; o da çağıranın kimliğini
    taşıyor, böylece Home Assistant kullanıcının o ışığa yetkisi olup
    olmadığını kendi denetliyor. Yapılandırmaya dokunan ya da evin tamamını
    ilgilendiren üçü yönetici istiyor — otomasyon ve senaryolardan gelen
    çağrılarda kullanıcı olmadığı için onlar etkilenmez.
    """

    async def _set_mode(call: ServiceCall) -> None:
        await engine.async_set_mode(call.data["mode"])

    def _sonucu_denetle(sonuc: dict, ne: str) -> None:
        """Motor 'yapamadım' diyorsa çağıran bunu bilsin.

        Cevaba bakılmazsa servis "yaptım" der ve hiçbir şey yapmamış
        olabilir; bir sürüm boyunca öyle bir servis taşıdık.
        """
        if not (sonuc or {}).get("ok"):
            hata = (sonuc or {}).get("error") or "bilinmeyen hata"
            # Kullanicinin verdigi bir sey yanlissa (olmayan oda gibi) bu bir
            # sunucu hatasi degil: ServiceValidationError 500 yerine temiz
            # bir 400 dondurur ve mesaji kullaniciya gosterir.
            raise ServiceValidationError(f"LUMEN {ne}: {hata}")

    async def _room(call: ServiceCall) -> None:
        _sonucu_denetle(await engine.async_action({
            "action": "room_on" if call.data["state"] == "on" else "room_off",
            "room": call.data["room"],
        }, user_id=call.context.user_id), "room")

    async def _autofill(_call: ServiceCall) -> None:
        await engine.async_autofill()

    hass.services.async_register(
        DOMAIN, "room", _room,
        schema=vol.Schema({
            vol.Required("room"): cv.string,
            vol.Required("state"): vol.In(["on", "off"]),
        }),
    )
    async_register_admin_service(
        hass, DOMAIN, "set_mode", _set_mode,
        schema=vol.Schema({vol.Required("mode"): cv.string}),
    )
    async_register_admin_service(
        hass, DOMAIN, "autofill", _autofill, schema=vol.Schema({}))


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Entegrasyonu bırak — ve gerçekten bırak.

    Panel kaydı ile statik yollar kalır; HA bir view'ı ya da statik yolu geri
    alamıyor. Ama motor susar, servisler kalkar ve motor defterden silinir:
    uçlar motoru her çağrıda defterden aradığı için kaldırılmış bir kurulum
    ışıkları yönetmeye devam edemez.
    """
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    data = hass.data.get(DOMAIN) or {}
    engine = data.pop("engine", None)
    if engine is not None:
        engine.shutdown()
    for name in ("set_mode", "room", "autofill"):
        hass.services.async_remove(DOMAIN, name)
    data.pop("services_registered", None)
    return True
