"""Test-data helper for the Playwright e2e suite.

Run from the repo root via the venv interpreter, e.g.:

    venv/bin/python e2e/seed.py baseline
    venv/bin/python e2e/seed.py reset
    venv/bin/python e2e/seed.py purchase-count

Commands:
    baseline             Ensure the e2e user + fixtures exist (idempotent).
    reset                Hard-delete all purchases/sessions, zero e2e tab balances.
    purchase-count       Print the number of (live) purchases.
    session-count        Print the number of (live) sessions.
    active-session-count Print the number of sessions with ended_at IS NULL.
    tab-balance <name>   Print a tab's balance.

Only touches the database (models), so it is independent of DEBUG /
FORCE_SCRIPT_NAME / .env routing config.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "hifiPiikki.settings")

import django  # noqa: E402

django.setup()

from django.contrib.auth.models import User  # noqa: E402
from api.models import Tab, Product, ProductGroup, Session, Purchase  # noqa: E402

try:
    from safedelete.models import HARD_DELETE
except Exception:  # pragma: no cover - depends on soft-delete backend
    HARD_DELETE = None

USERNAME = "claude"
PASSWORD = "claude"
NONPIN_TAB = "E2E Testi"
PIN_TAB = "E2E PIN"
PIN_CODE = "123456"
PRODUCT = "E2E Olut"
GROUP = "E2E Juomat"


def _all(model):
    """Manager that includes soft-deleted rows, when available."""
    return getattr(model, "all_objects", model.objects)


def _hard(qs):
    for obj in qs.all():
        if HARD_DELETE is not None:
            obj.delete(force_policy=HARD_DELETE)
        else:
            obj.delete()


def baseline():
    if not User.objects.filter(username=USERNAME).exists():
        User.objects.create_superuser(USERNAME, "", PASSWORD)
    group, _ = ProductGroup.objects.get_or_create(name=GROUP, defaults={"order": 1})
    # Equal in/out price -> a single "Määrä" quantity input (default 1) in checkout.
    Product.objects.get_or_create(
        name=PRODUCT,
        defaults={"price_in": "3.00", "price_out": "3.00", "group": group, "in_stock": True},
    )
    Tab.objects.get_or_create(
        name=NONPIN_TAB,
        defaults={"balance": "0.00", "active": True, "pin_required": False},
    )
    Tab.objects.get_or_create(
        name=PIN_TAB,
        defaults={"balance": "0.00", "active": True, "pin_required": True, "pin": PIN_CODE},
    )
    print("baseline ok")


def reset():
    _hard(_all(Purchase))
    _hard(_all(Session))
    Tab.objects.filter(name__in=[NONPIN_TAB, PIN_TAB]).update(balance="0.00", pin_attempts=0)
    print("reset ok")


def main(argv):
    cmd = argv[1] if len(argv) > 1 else "baseline"
    if cmd == "baseline":
        baseline()
    elif cmd == "reset":
        reset()
    elif cmd == "purchase-count":
        print(Purchase.objects.count())
    elif cmd == "session-count":
        print(Session.objects.count())
    elif cmd == "active-session-count":
        print(Session.objects.filter(ended_at__isnull=True).count())
    elif cmd == "tab-balance":
        tab = Tab.objects.filter(name=argv[2]).first()
        print(tab.balance if tab else "NA")
    else:
        print("unknown command: %s" % cmd, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv)
