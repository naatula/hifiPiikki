"""Test-data helper for the Playwright e2e suite.

Run from the repo root via the venv interpreter, e.g.:

    venv/bin/python e2e/seed.py baseline
    venv/bin/python e2e/seed.py reset
    venv/bin/python e2e/seed.py purchase-count

Commands:
    baseline             Ensure the e2e user + fixtures exist (idempotent).
    reset                Hard-delete all purchases/sessions/adjustments, zero e2e
                         tab balances, restore config defaults.
    purchase-count       Print the number of (live) purchases.
    session-count        Print the number of (live) sessions.
    active-session-count Print the number of sessions with ended_at IS NULL.
    tab-balance <name>   Print a tab's balance.
    pin-attempts <name>  Print a tab's pin_attempts count.
    setting <key> <val>  Write a Setting row.
    product-stock <name> Print a product's stock_quantity (or NA if untracked).
    tab-adjust <name> <sum> [desc]  Create a TabAdjustment and bump the tab balance.

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
from api.models import Tab, Product, ProductGroup, Session, Purchase, Setting, TabAdjustment  # noqa: E402

try:
    from safedelete.models import HARD_DELETE
except Exception:  # pragma: no cover - depends on soft-delete backend
    HARD_DELETE = None

USERNAME = "claude"
PASSWORD = "claude"
NONPIN_TAB = "E2E Testi"
NONPIN_TAB2 = "E2E Testi 2"
PIN_TAB = "E2E PIN"
PIN_CODE = "123456"
PRODUCT = "E2E Olut"
PRODUCT_INOUT = "E2E Sisu"
PRODUCT_STOCK = "E2E Limu"
GROUP = "E2E Juomat"
INACTIVE_TAB = "E2E Suljettu"
PIN_LOCKOUT_THRESHOLD = 3


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
    Product.objects.get_or_create(
        name=PRODUCT,
        defaults={"price_in": "3.00", "price_out": "3.00", "group": group, "in_stock": True},
    )
    Product.objects.get_or_create(
        name=PRODUCT_INOUT,
        defaults={"price_in": "2.00", "price_out": "4.00", "group": group, "in_stock": True},
    )
    Product.objects.get_or_create(
        name=PRODUCT_STOCK,
        defaults={
            "price_in": "2.00", "price_out": "2.00", "group": group, "in_stock": True,
            "stock_quantity": "10", "low_stock_threshold": "2",
        },
    )
    Tab.objects.get_or_create(
        name=NONPIN_TAB,
        defaults={"balance": "0.00", "active": True, "pin_required": False},
    )
    Tab.objects.get_or_create(
        name=NONPIN_TAB2,
        defaults={"balance": "0.00", "active": True, "pin_required": False},
    )
    Tab.objects.get_or_create(
        name=PIN_TAB,
        defaults={"balance": "0.00", "active": True, "pin_required": True, "pin": PIN_CODE},
    )
    Tab.objects.get_or_create(
        name=INACTIVE_TAB,
        defaults={"balance": "-5.00", "active": False},
    )
    Setting.objects.update_or_create(
        key="pin_lockout_threshold",
        defaults={"value": str(PIN_LOCKOUT_THRESHOLD)},
    )
    print("baseline ok")


def reset():
    _hard(_all(Purchase))
    _hard(_all(Session))
    _hard(_all(TabAdjustment))
    Tab.objects.filter(name__in=[NONPIN_TAB, NONPIN_TAB2]).update(
        balance="0.00", pin_attempts=0, pin_required=False
    )
    Tab.objects.filter(name=PIN_TAB).update(
        balance="0.00", pin_attempts=0, pin_required=True
    )
    Tab.objects.filter(name=INACTIVE_TAB).update(
        balance="-5.00", active=False
    )
    Product.objects.filter(name=PRODUCT_STOCK).update(stock_quantity="10")
    # Restore config defaults so tests don't bleed.
    Setting.objects.update_or_create(key="cash_enabled", defaults={"value": "false"})
    Setting.objects.update_or_create(key="custom_amount_enabled", defaults={"value": "true"})
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
    elif cmd == "pin-attempts":
        tab = Tab.objects.filter(name=argv[2]).first()
        print(tab.pin_attempts if tab else "NA")
    elif cmd == "setting":
        Setting.objects.update_or_create(key=argv[2], defaults={"value": argv[3]})
        print("ok")
    elif cmd == "product-stock":
        prod = Product.objects.filter(name=argv[2]).first()
        print(prod.stock_quantity if prod and prod.stock_quantity is not None else "NA")
    elif cmd == "tab-adjust":
        tab = Tab.objects.filter(name=argv[2]).first()
        if not tab:
            print("NA", file=sys.stderr)
            sys.exit(1)
        adj_sum = argv[3]
        desc = argv[4] if len(argv) > 4 else ""
        from decimal import Decimal
        TabAdjustment.objects.create(tab=tab, sum=adj_sum, description=desc)
        tab.balance = Decimal(str(tab.balance)) + Decimal(adj_sum)
        tab.save()
        print("ok")
    else:
        print("unknown command: %s" % cmd, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv)
