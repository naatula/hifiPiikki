"""Custom admin pages wired into the default admin site (see api/admin.py)."""

from django.contrib import admin
from django.template.response import TemplateResponse

from api import analytics


def insights_view(request):
    """Full insights dashboard with the period selector and all charts."""
    context = {
        **admin.site.each_context(request),
        "title": "Insights",
        **analytics.dashboard_context(request),
    }
    return TemplateResponse(request, "admin/insights/page.html", context)
