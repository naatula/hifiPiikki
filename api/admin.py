import json
from django import forms
from django.contrib import admin, messages
from django.db import transaction
from django.db.models import Sum
from django.urls import path
from decimal import Decimal
from django_paranoid.admin import ParanoidAdmin
from .models import Tab, ProductGroup, Product, Purchase, Setting, Session, TabAdjustment
from .admin_views import insights_view

class MyModelAdmin(ParanoidAdmin):
    pass

class TabAdmin(MyModelAdmin):
    list_display = ('name', 'balance', 'active', 'pin_required', 'pin_attempts',)
    list_filter = ('pin_required',)
    ordering = ('name',)
    actions = ['validate_tabs', 'activate_tabs', 'deactivate_tabs', 'reset_pin_attempts']
    fields = ('name', 'balance', 'active', 'pin', 'pin_required', 'pin_attempts',)

    def get_readonly_fields(self, request, obj=None):
        return super().get_readonly_fields(request, obj) + ('balance', 'pin_attempts',)

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path('<path:object_id>/reset_pin/', self.admin_site.admin_view(self.reset_pin_view), name='api_tab_reset_pin'),
        ]
        return custom_urls + urls

    def reset_pin_view(self, request, object_id):
        from django.http import HttpResponseRedirect
        from django.urls import reverse
        tab = self.get_object(request, object_id)
        if tab:
            tab.pin_attempts = 0
            tab.save()
            messages.success(request, f'Reset PIN attempts for {tab.name}.')
        return HttpResponseRedirect(reverse('admin:api_tab_change', args=[object_id]))

    @admin.action(description='Activate selected tabs')
    def activate_tabs(self, request, queryset):
        updated = queryset.update(active=True)
        messages.success(request, f'Successfully activated {updated} tab(s).')

    @admin.action(description='Deactivate selected tabs')
    def deactivate_tabs(self, request, queryset):
        updated = queryset.update(active=False)
        messages.success(request, f'Successfully deactivated {updated} tab(s).')

    @admin.action(description='Reset PIN attempts (unlock)')
    def reset_pin_attempts(self, request, queryset):
        updated = queryset.update(pin_attempts=0)
        messages.success(request, f'Reset PIN attempts for {updated} tab(s).')

    @admin.action(description='Validate tab balances')
    def validate_tabs(self, request, queryset):
        violations = []
        total_tabs_checked = 0

        # Use selected tabs if any, otherwise check all tabs
        tabs_to_check = queryset if queryset.exists() else Tab.objects.all()

        for tab in tabs_to_check:
            total_tabs_checked += 1

            # Calculate total purchases (subtract from balance)
            purchases_total = Purchase.objects.filter(tab=tab).aggregate(
                total=Sum('total')
            )['total'] or Decimal('0.00')

            # Calculate total tab adjustments (add to balance)
            tab_adjustments_total = TabAdjustment.objects.filter(tab=tab).aggregate(
                total=Sum('sum')
            )['total'] or Decimal('0.00')

            # Expected balance: starting balance (0) + tab adjustments - purchases
            expected_balance = tab_adjustments_total - purchases_total

            # Check if current balance matches expected balance
            if abs(tab.balance - expected_balance) > Decimal('0.01'):  # Allow for small rounding differences
                violations.append({
                    'tab': tab.name,
                    'current_balance': tab.balance,
                    'expected_balance': expected_balance,
                    'difference': tab.balance - expected_balance,
                    'purchases_total': purchases_total,
                    'tab_adjustments_total': tab_adjustments_total
                })

        if violations:
            violation_details = []
            for v in violations:
                violation_details.append(
                    f"Tab '{v['tab']}': Current={v['current_balance']:.2f}, Expected={v['expected_balance']:.2f}, "
                    f"Difference={v['difference']:.2f}, Purchases={v['purchases_total']:.2f}, TabAdjustments={v['tab_adjustments_total']:.2f}"
                )

            messages.error(
                request,
                f"Found {len(violations)} tab(s) with balance violations out of {total_tabs_checked} checked:\n" +
                "\n".join(violation_details)
            )
        else:
            messages.success(
                request,
                f"All {total_tabs_checked} tabs have correct balances. No violations found."
            )

class ProductGroupAdmin(MyModelAdmin):
    list_display = ('name', 'order',)
    search_fields = ('name',)
    ordering = ('order',)

class ProductAdmin(MyModelAdmin):
    list_display = ('name', 'price_in', 'price_out', 'group', 'in_stock',)
    list_filter = ('group', 'in_stock', 'group__name',)
    search_fields = ('name',)
    ordering = ('name',)
    actions = ['set_in_stock', 'set_out_of_stock']
    @admin.action(description='Set in stock', permissions=['change'],)
    def set_in_stock(self, request, queryset):
        queryset.update(in_stock=True)
    @admin.action(description='Set out of stock', permissions=['change'],)
    def set_out_of_stock(self, request, queryset):
        queryset.update(in_stock=False)

class PurchaseAdmin(MyModelAdmin):
    list_display = ('tab', 'product', 'quantity', 'total', 'created_at',)
    list_filter = ('tab', 'product', 'created_at',)
    search_fields = ('tab__name', 'product__name',)
    date_hierarchy = 'created_at'

    def get_readonly_fields(self, request, obj=None):
        return super().get_readonly_fields(request, obj) + ('deletion_note',)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def deletion_note(self, obj):
        return "Note: deleting a purchase automatically adjusts the tab balance by adding back the purchase total."
    deletion_note.short_description = "Balance adjustment"

    def delete_model(self, request, obj):
        with transaction.atomic():
            obj.tab.balance += obj.total
            obj.tab.save()
            super().delete_model(request, obj)

    def delete_queryset(self, request, queryset):
        with transaction.atomic():
            for obj in queryset:
                obj.tab.balance += obj.total
                obj.tab.save()
            super().delete_queryset(request, queryset)

class SettingAdmin(MyModelAdmin):
    list_display = ('key', 'value',)
    search_fields = ('key',)

class SessionAdmin(MyModelAdmin):
    list_display = ('tab', 'started_at', 'ended_at', 'people', 'comment',)
    list_filter = ('tab', 'ended_at',)
    search_fields = ('tab__name',)
    date_hierarchy = 'ended_at'

    def has_add_permission(self, request):
        return False

class TabAdjustmentAdminForm(forms.ModelForm):
    activate_tab = forms.BooleanField(
        required=False,
        label='Activate tab',
        help_text='This tab is inactive. Check to activate it when saving.',
        initial=False,
    )

    class Meta:
        model = TabAdjustment
        fields = '__all__'


class TabAdjustmentAdmin(MyModelAdmin):
    form = TabAdjustmentAdminForm
    list_display = ('tab', 'sum', 'description', 'created_at',)
    list_filter = ('tab',)
    search_fields = ('tab__name', 'description',)
    date_hierarchy = 'created_at'

    def get_fields(self, request, obj=None):
        fields = list(super().get_fields(request, obj))
        if obj is None and 'activate_tab' not in fields:
            fields.append('activate_tab')
        elif obj is not None and 'activate_tab' in fields:
            fields.remove('activate_tab')
        return fields

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        form.base_fields['sum'].help_text = (
            "The system automatically updates the tab balance when you create, edit, or delete a tab adjustment. The sum is credited to the tab balance on creation. Negative sums can be used to deduct from the balance."
        )
        return form

    def changeform_view(self, request, object_id=None, form_url='', extra_context=None):
        extra_context = extra_context or {}
        tab_balances = {t.id: float(t.balance) for t in Tab.objects.all()}
        extra_context['tab_balances_json'] = json.dumps(tab_balances)
        if object_id is None:
            inactive_tab_ids = list(Tab.objects.filter(active=False).values_list('id', flat=True))
            extra_context['inactive_tab_ids_json'] = json.dumps(inactive_tab_ids)
            extra_context['existing_sum_json'] = 'null'
        else:
            obj = TabAdjustment.objects.get(pk=object_id)
            extra_context['existing_sum_json'] = str(float(obj.sum))
        return super().changeform_view(request, object_id, form_url, extra_context)

    def save_model(self, request, obj, form, change):
        with transaction.atomic():
            is_new = obj.pk is None
            if is_new:
                super().save_model(request, obj, form, change)
                obj.tab.balance += obj.sum
                if form.cleaned_data.get('activate_tab') and not obj.tab.active:
                    obj.tab.active = True
                    messages.info(request, f"Tab '{obj.tab.name}' has been activated.")
                obj.tab.save()
            else:
                # Editing existing tab adjustment - adjust the difference
                old_obj = TabAdjustment.objects.get(pk=obj.pk)
                old_sum = old_obj.sum
                super().save_model(request, obj, form, change)
                difference = obj.sum - old_sum
                obj.tab.balance += difference
                obj.tab.save()

    def delete_model(self, request, obj):
        with transaction.atomic():
            obj.tab.balance -= obj.sum
            obj.tab.save()
            super().delete_model(request, obj)

    def delete_queryset(self, request, queryset):
        with transaction.atomic():
            for obj in queryset:
                obj.tab.balance -= obj.sum
                obj.tab.save()
            super().delete_queryset(request, queryset)

# Register your models here.
admin.site.register(Tab, TabAdmin)
admin.site.register(ProductGroup, ProductGroupAdmin)
admin.site.register(Product, ProductAdmin)
admin.site.register(Purchase, PurchaseAdmin)
admin.site.register(Setting, SettingAdmin)
admin.site.register(Session, SessionAdmin)
admin.site.register(TabAdjustment, TabAdjustmentAdmin)

# Customize admin site titles
admin.site.site_header = "hifiPiikki administration"
admin.site.site_title = "hifiPiikki administration"

# Show the quick KPI numbers above the model list on the admin home.
admin.site.index_template = "admin/insights_index.html"

# Register the dedicated /admin/insights/ page (full charts) on the default site.
_original_get_urls = admin.site.get_urls


def get_urls():
    return [
        path("insights/", admin.site.admin_view(insights_view), name="insights"),
    ] + _original_get_urls()


admin.site.get_urls = get_urls