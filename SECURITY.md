# Security Policy

## Reporting a vulnerability

Open a [private security advisory](https://github.com/berkansezer77/lumen-ha/security/advisories/new)
— not a public issue. I answer within a few days.

## What this integration touches

- **Admin only.** The panel, its API endpoints and the services that change
  configuration (`set_mode`, `lock_room`, `autofill`) all require a Home
  Assistant administrator. `lumen_ha.room` is open to any user, but it carries
  the caller's identity, so Home Assistant enforces that user's own entity
  permissions.
- **Lights and switches only.** The engine refuses to call anything outside the
  `light` and `switch` domains, scenes must start with `scene.`, and the
  notification target must be a `notify.` service — a configuration file
  someone shares with you cannot point LUMEN at `shell_command` or
  `homeassistant.restart`.
- **Uploaded room photos** are stored in `config/www/lumen/`, which Home
  Assistant serves **without authentication**. Treat anything you upload as
  visible to whoever can reach your Home Assistant address.
- **Nothing leaves your home.** No telemetry, no external requests, no CDN, no
  Python dependencies beyond Home Assistant itself. Image URLs in the
  configuration are restricted to your own installation; an external address is
  refused rather than fetched.

## Diagnostics

The diagnostics download contains your room names, your device names, the
entity ids they use, each room's current verdict and the last 100 diary lines.
Photo paths and your notification service are masked. It is meant to be
attached to a public issue — read it first if any of that is private to you.

## Supported versions

The latest release is the supported one. Fixes go into a new release rather
than a patch of an older one.
