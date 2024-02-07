from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework.authtoken import views

from . import views

router = DefaultRouter()

router.register(r'purchases', views.PurchaseViewSet)
router.register(r'tabs', views.TabViewSet)
router.register(r'products', views.ProductViewSet)
router.register(r'hostings', views.HostingViewSet)


urlpatterns = [
    path('', include(router.urls)),
    path('auth/', include('rest_framework.urls', namespace='rest_framework')),
    path('csrf/', views.csrf),
]