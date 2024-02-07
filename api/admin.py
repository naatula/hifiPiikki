from django.contrib import admin
from django_paranoid.admin import ParanoidAdmin
from .models import Tab, ProductGroup, Product, Purchase, Setting, Hosting

class MyModelAdmin(ParanoidAdmin):
    pass

class TabAdmin(MyModelAdmin):
    list_display = ('name', 'balance', 'active',)

class ProductGroupAdmin(MyModelAdmin):
    list_display = ('name', 'order',)
    search_fields = ('name',)
    ordering = ('order',)

class ProductAdmin(MyModelAdmin):
    list_display = ('name', 'price_in', 'price_out', 'group', 'in_stock',)
    list_filter = ('group', 'in_stock', 'group__name',)
    search_fields = ('name',)

class PurchaseAdmin(MyModelAdmin):
    list_display = ('tab', 'product', 'quantity', 'total', 'created_at',)
    list_filter = ('tab', 'product', 'created_at',)
    search_fields = ('tab__name', 'product__name',)
    date_hierarchy = 'created_at'

class SettingAdmin(MyModelAdmin):
    list_display = ('key', 'value',)
    search_fields = ('key',)

class HostingAdmin(MyModelAdmin):
    list_display = ('tab', 'started_at', 'ended_at', 'people', 'comment',)
    list_filter = ('tab', 'ended_at',)
    search_fields = ('tab__name',)
    date_hierarchy = 'ended_at'

# Register your models here.
admin.site.register(Tab, TabAdmin)
admin.site.register(ProductGroup, ProductGroupAdmin)
admin.site.register(Product, ProductAdmin)
admin.site.register(Purchase, PurchaseAdmin)
admin.site.register(Setting, SettingAdmin)
admin.site.register(Hosting, HostingAdmin)