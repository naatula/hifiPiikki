# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

hifiPiikki is a Finnish association point-of-sale and tab management system ("piikki"). The frontend SPA is entirely in Finnish — keep all UI text in Finnish.

## Dev setup

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
cp .env.example .env
python manage.py runserver
```

- Frontend SPA in Django debug mode: `http://localhost:8000/static/index.html` (not the root `/`)
- Admin panel: `http://localhost:8000/admin/`

## Environment variables

- `DEBUG` — Django debug mode (default `False`)
- `FORCE_SCRIPT_NAME` — reverse proxy path prefix (default `/hifiPiikki`); set empty for local dev

## Architecture notes

- **Soft deletes only**: All models inherit from `ParanoidModel` (django-paranoid). Never hard-delete — calling `.delete()` soft-deletes; use `.delete(force_policy=HARD_DELETE)` only if explicitly required.
- **Shelly integration config**: Shelly Cloud credentials (`shelly_cloud_server`, `shelly_cloud_key`, `shelly_cloud_device`) are stored in the `Setting` model in the database, not in env vars.
- **No test suite**: `api/tests.py` is intentionally empty. Do not add a test framework unless explicitly asked.
