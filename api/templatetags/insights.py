"""Template tag for the admin home "quick numbers".

The heavy charts live on the dedicated ``/admin/insights/`` page (rendered by
``api.admin_views.insights_view``); the home page only needs these cheap KPIs.
Aggregation lives in :mod:`api.analytics`.
"""

from django import template

from api import analytics

register = template.Library()


@register.inclusion_tag("admin/insights/home_kpis.html")
def home_kpis():
    return {"kpis": analytics.home_kpis()}
