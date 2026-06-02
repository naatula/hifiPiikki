"""Aggregation for the admin insights dashboard.

Two entry points share the same helpers:

* :func:`home_kpis` -- a handful of cheap "quick numbers" for the admin home
  page (a fixed recent window plus point-in-time balances).
* :func:`dashboard_context` -- the full period-driven payload (KPIs, charts,
  session stats, period selector) for the dedicated ``/admin/insights/`` page.

Queries use the default model managers, which (via django-paranoid) already
exclude soft-deleted rows. Aggregates are ``Decimal`` for display and converted
to ``float``/``int`` for the JSON passed to Chart.js.
"""

from datetime import timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.db.models import (
    Count,
    DecimalField,
    DurationField,
    ExpressionWrapper,
    F,
    OuterRef,
    Q,
    Subquery,
    Sum,
    Value,
)
from django.db.models.functions import (
    Coalesce,
    ExtractHour,
    ExtractWeekDay,
    TruncDate,
    TruncMonth,
)
from django.utils import timezone

from api.models import Session, Product, Purchase, TabAdjustment, Tab

DEFAULT_PERIOD = "90d"
HOME_KPI_DAYS = 30
# Spans up to this many days are bucketed by day; longer spans by month.
DAY_BUCKET_MAX_DAYS = 92

# The club is in Finland; activity-pattern charts are most useful in local time
# even though the app stores/displays UTC elsewhere.
LOCAL_TZ = ZoneInfo("Europe/Helsinki")

# ExtractWeekDay: 1=Sunday .. 7=Saturday. Present Monday-first, Finnish labels.
_DOW_ORDER = [2, 3, 4, 5, 6, 7, 1]
_DOW_LABELS = ["Ma", "Ti", "Ke", "To", "Pe", "La", "Su"]


def _f(value):
    """Decimal/None -> float for JSON serialization."""
    return float(value or 0)


def _balances():
    """Point-in-time (credit, debt, net) across all tabs."""
    b = Tab.objects.aggregate(
        credit=Sum("balance", filter=Q(balance__gt=0)),
        debt=Sum("balance", filter=Q(balance__lt=0)),
        net=Sum("balance"),
    )
    return (
        b["credit"] or Decimal("0"),
        b["debt"] or Decimal("0"),
        b["net"] or Decimal("0"),
    )


def home_kpis():
    """Cheap quick numbers for the admin home page (no charts)."""
    now = timezone.now()
    since = now - timedelta(days=HOME_KPI_DAYS)
    qs = Purchase.objects.filter(created_at__gte=since)
    revenue = qs.aggregate(s=Sum("total"))["s"] or Decimal("0")
    count = qs.count()
    tab_adjustments = (
        TabAdjustment.objects.filter(created_at__gte=since).aggregate(s=Sum("sum"))["s"]
        or Decimal("0")
    )
    credit, debt, net = _balances()
    return {
        "period_days": HOME_KPI_DAYS,
        "period_label": f"Last {HOME_KPI_DAYS} days",
        "revenue": revenue,
        "count": count,
        "avg_purchase": (revenue / count) if count else Decimal("0"),
        "tab_adjustments": tab_adjustments,
        "active_tabs": Tab.objects.filter(active=True).count(),
        "in_stock": Product.objects.filter(in_stock=True).count(),
        "credit": credit,
        "debt": debt,
        "net": net,
    }


def _resolve_period(request, now):
    """Return (code, label, start, end) for the requested window.

    ``end`` is None for windows that run up to "now"; a bounded datetime for a
    calendar year.
    """
    code = (request.GET.get("period") if request else None) or DEFAULT_PERIOD

    if code == "30d":
        return code, "Last 30 days", now - timedelta(days=30), None
    if code == "90d":
        return code, "Last 90 days", now - timedelta(days=90), None
    if code == "12m":
        return code, "Last 12 months", now - timedelta(days=365), None
    if code == "all":
        first = (
            Purchase.objects.order_by("created_at")
            .values_list("created_at", flat=True)
            .first()
        )
        return code, "All time", first or now, None
    if code.isdigit() and len(code) == 4:
        year = int(code)
        start = now.replace(
            year=year, month=1, day=1, hour=0, minute=0, second=0, microsecond=0
        )
        return code, str(year), start, start.replace(year=year + 1)

    # Unknown code -> fall back to the default window.
    return DEFAULT_PERIOD, "Last 90 days", now - timedelta(days=90), None


def _period_options(now, current):
    """Selector entries: fixed windows + each calendar year with data + all."""
    entries = [("30d", "30 days"), ("90d", "90 days"), ("12m", "12 months")]
    for d in Purchase.objects.dates("created_at", "year", order="DESC"):
        entries.append((str(d.year), str(d.year)))
    entries.append(("all", "All time"))
    return [
        {"code": code, "label": label, "active": code == current}
        for code, label in entries
    ]


def _bucket_keys(start, end, bucket):
    """Ordered (keys, labels) covering [start, end] at the given granularity.

    ``keys`` match the Trunc output used for indexing: ``date`` for day buckets,
    ``(year, month)`` tuples for month buckets.
    """
    if bucket == "day":
        keys = []
        d, last = start.date(), end.date()
        while d <= last:
            keys.append(d)
            d += timedelta(days=1)
        return keys, [k.isoformat() for k in keys]

    keys = []
    y, m = start.year, start.month
    ly, lm = end.year, end.month
    while (y, m) <= (ly, lm):
        keys.append((y, m))
        m += 1
        if m == 13:
            m, y = 1, y + 1
    return keys, [f"{y}-{m:02d}" for (y, m) in keys]


def _bucketed(rows, bucket, field):
    """Index Trunc rows by bucket key -> float(field)."""
    if bucket == "day":
        return {r["b"]: _f(r[field]) for r in rows}
    return {(r["b"].year, r["b"].month): _f(r[field]) for r in rows}


def dashboard_context(request):
    """Full period-driven payload for the dedicated Insights page."""
    now = timezone.now()
    code, label, start, end = _resolve_period(request, now)
    # ``end`` is an exclusive upper bound; the last instant actually included is
    # just before it (or "now" for open-ended windows).
    last_instant = (end - timedelta(microseconds=1)) if end else now
    bucket = "day" if (last_instant - start).days <= DAY_BUCKET_MAX_DAYS else "month"
    trunc = TruncDate if bucket == "day" else TruncMonth

    period_filter = {"created_at__gte": start}
    if end:
        period_filter["created_at__lt"] = end
    period_qs = Purchase.objects.filter(**period_filter)

    # ---- KPI cards ------------------------------------------------------
    revenue = period_qs.aggregate(s=Sum("total"))["s"] or Decimal("0")
    count = period_qs.count()
    credit, debt, net = _balances()  # point-in-time, period-independent
    adjustment_filter = {"created_at__gte": start}
    if end:
        adjustment_filter["created_at__lt"] = end
    adjustment_qs = TabAdjustment.objects.filter(**adjustment_filter)
    tab_adjustments = adjustment_qs.aggregate(s=Sum("sum"))["s"] or Decimal("0")

    kpis = {
        "period_label": label,
        "revenue": revenue,
        "count": count,
        "avg_purchase": (revenue / count) if count else Decimal("0"),
        "tab_adjustments": tab_adjustments,
        "active_tabs": Tab.objects.filter(active=True).count(),
        "in_stock": Product.objects.filter(in_stock=True).count(),
        "credit": credit,
        "debt": debt,
        "net": net,
    }

    # ---- Bucket keys shared by trend & cashflow -------------------------
    keys, bucket_labels = _bucket_keys(start, last_instant, bucket)

    trend_rows = list(
        period_qs.annotate(b=trunc("created_at"))
        .values("b")
        .annotate(revenue=Sum("total"), n=Count("id"))
    )
    trend = _bucketed(trend_rows, bucket, "revenue")
    trend_counts = _bucketed(trend_rows, bucket, "n")

    # ---- Previous year (only for calendar-year views) -------------------
    if code.isdigit() and len(code) == 4:
        prev_year_start = start.replace(year=int(code) - 1)
        prev_year_end = start
        prev_trend_rows = list(
            Purchase.objects.filter(created_at__gte=prev_year_start, created_at__lt=prev_year_end)
            .annotate(b=trunc("created_at"))
            .values("b")
            .annotate(revenue=Sum("total"))
        )
        prev_trend = _bucketed(prev_trend_rows, bucket, "revenue")
        prev_keys, _ = _bucket_keys(prev_year_start, prev_year_start.replace(year=int(code)) - timedelta(microseconds=1), bucket)
        prev_revenue_values = [prev_trend.get(k, 0.0) for k in prev_keys]
        n = len(keys)
        if len(prev_revenue_values) < n:
            prev_revenue_values += [0.0] * (n - len(prev_revenue_values))
        else:
            prev_revenue_values = prev_revenue_values[:n]
        prev_label = str(int(code) - 1)
    else:
        prev_revenue_values = None
        prev_label = None

    # ---- Top products & groups ------------------------------------------
    products_qs = period_qs.filter(product__isnull=False)
    top_qty = list(
        products_qs.values("product__name").annotate(v=Sum("quantity")).order_by("-v")[:20]
    )
    top_rev = list(
        products_qs.values("product__name").annotate(v=Sum("total")).order_by("-v")[:20]
    )
    group_rev = list(
        period_qs.values("product__group__name").annotate(v=Sum("total")).order_by("-v")
    )

    # ---- Top spenders & cashflow (in vs out over the period) ------------
    top_spenders = list(
        period_qs.values("tab__name").annotate(v=Sum("total")).order_by("-v")[:10]
    )
    out_by_bucket = _bucketed(
        period_qs.annotate(b=trunc("created_at")).values("b").annotate(v=Sum("total")),
        bucket,
        "v",
    )
    in_by_bucket = _bucketed(
        reimb_qs
        .annotate(b=trunc("created_at"))
        .values("b")
        .annotate(v=Sum("sum")),
        bucket,
        "v",
    )

    # ---- Session stats (sessions ended within the period) ---------------
    session_filter = {"ended_at__isnull": False, "ended_at__gte": start}
    if end:
        session_filter["ended_at__lt"] = end
    # Per-session revenue via a correlated subquery (sum of the host tab's
    # purchases during the session) so the whole panel is a single query
    # instead of one query per session.
    session_revenue = Coalesce(
        Subquery(
            Purchase.objects.filter(
                tab=OuterRef("tab"),
                created_at__gte=OuterRef("started_at"),
                created_at__lte=OuterRef("ended_at"),
            )
            .values("tab")
            .annotate(s=Sum("total"))
            .values("s")[:1],
            output_field=DecimalField(max_digits=12, decimal_places=2),
        ),
        Value(Decimal("0")),
        output_field=DecimalField(max_digits=12, decimal_places=2),
    )
    sessions = list(
        Session.objects.filter(**session_filter).annotate(
            rev=session_revenue,
            dur=ExpressionWrapper(
                F("ended_at") - F("started_at"), output_field=DurationField()
            ),
        )
    )
    h_count = len(sessions)
    total_people = sum(h.people or 0 for h in sessions)
    total_rev = sum((h.rev for h in sessions), Decimal("0"))
    total_seconds = sum(h.dur.total_seconds() for h in sessions if h.dur)

    session_stats = {
        "count": h_count,
        "people": total_people,
        "revenue": total_rev,
        "avg_per_session": (total_rev / h_count) if h_count else Decimal("0"),
        "avg_per_person": (total_rev / total_people) if total_people else Decimal("0"),
        "avg_hours": (total_seconds / 3600 / h_count) if h_count else 0,
    }

    # ---- Activity patterns (over the period, local time) ----------------
    by_hour = {
        r["h"]: r["n"]
        for r in period_qs.annotate(h=ExtractHour("created_at", tzinfo=LOCAL_TZ))
        .values("h")
        .annotate(n=Count("id"))
    }
    by_dow = {
        r["w"]: r["n"]
        for r in period_qs.annotate(w=ExtractWeekDay("created_at", tzinfo=LOCAL_TZ))
        .values("w")
        .annotate(n=Count("id"))
    }

    # ---- Chart payloads (JSON-safe) -------------------------------------
    charts = {
        "daily": {
            "labels": bucket_labels,
            "revenue": [trend.get(k, 0.0) for k in keys],
            "prev_revenue": prev_revenue_values,
            "prev_label": prev_label,
        },
        "top_qty": {
            "labels": [r["product__name"] for r in top_qty],
            "values": [_f(r["v"]) for r in top_qty],
        },
        "top_rev": {
            "labels": [r["product__name"] for r in top_rev],
            "values": [_f(r["v"]) for r in top_rev],
        },
        "groups": {
            "labels": [r["product__group__name"] or "Oma summa / muu" for r in group_rev],
            "values": [_f(r["v"]) for r in group_rev],
        },
        "spenders": {
            "labels": [r["tab__name"] for r in top_spenders],
            "values": [_f(r["v"]) for r in top_spenders],
        },
        "cashflow": {
            "labels": bucket_labels,
            "out": [out_by_bucket.get(k, 0.0) for k in keys],
            "in": [in_by_bucket.get(k, 0.0) for k in keys],
        },
        "balances": {"credit": _f(kpis["credit"]), "debt": _f(abs(kpis["debt"]))},
        "hours": {
            "labels": [f"{h:02d}" for h in range(24)],
            "values": [by_hour.get(h, 0) for h in range(24)],
        },
        "dow": {
            "labels": _DOW_LABELS,
            "values": [by_dow.get(d, 0) for d in _DOW_ORDER],
        },
    }

    return {
        "kpis": kpis,
        "session": session_stats,
        "charts": charts,
        "periods": _period_options(now, code),
    }
