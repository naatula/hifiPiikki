import json
from django import forms
from django.contrib import admin, messages
from django.db import transaction
from django.db.models import F, Q, Sum
from django.http import HttpResponseRedirect
from django.template.response import TemplateResponse
from collections import defaultdict
from django.urls import path
from decimal import Decimal, InvalidOperation
from django_paranoid.admin import ParanoidAdmin
from . import analytics
from .models import Tab, ProductGroup, Product, Purchase, Setting, Session, TabAdjustment
from .admin_views import insights_view

class MyModelAdmin(ParanoidAdmin):
    pass

class TabAdmin(MyModelAdmin):
    list_display = ('name', 'balance', 'active', 'pin_required', 'pin_attempts',)
    list_filter = ('active', 'pin_required',)
    ordering = ('name',)
    actions = ['validate_tabs', 'recalculate_balances', 'activate_tabs', 'deactivate_tabs', 'reset_pin_attempts']
    change_list_template = 'admin/api/tab/change_list.html'
    fields = ('name', 'balance', 'active', 'pin', 'pin_required', 'pin_attempts', 'ignore_balance_limit',)

    def get_readonly_fields(self, request, obj=None):
        return super().get_readonly_fields(request, obj) + ('balance', 'pin_attempts',)

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path('<path:object_id>/reset_pin/', self.admin_site.admin_view(self.reset_pin_view), name='api_tab_reset_pin'),
            path('<path:object_id>/insights/', self.admin_site.admin_view(self.insights_view), name='api_tab_insights'),
            path('<path:object_id>/recalculate_balance/', self.admin_site.admin_view(self.recalculate_balance_view), name='api_tab_recalculate_balance'),
            path('negative-balances/', self.admin_site.admin_view(self.negative_balances_view), name='api_tab_negative_balances'),
        ]
        return custom_urls + urls

    def insights_view(self, request, object_id):
        from django.http import Http404
        from django.shortcuts import render
        tab = self.get_object(request, object_id)
        if tab is None:
            raise Http404('Tab not found.')
        context = {
            **self.admin_site.each_context(request),
            'title': f'Insights: {tab.name}',
            'tab': tab,
            **analytics.tab_dashboard_context(request, tab),
        }
        return render(request, 'admin/api/tab/insights.html', context)

    def recalculate_balance_view(self, request, object_id):
        from django.http import HttpResponseRedirect
        from django.urls import reverse
        tab = self.get_object(request, object_id)
        if tab:
            with transaction.atomic():
                purchases_total = Purchase.objects.filter(tab=tab).aggregate(
                    total=Sum('total')
                )['total'] or Decimal('0.00')
                adjustments_total = TabAdjustment.objects.filter(tab=tab).aggregate(
                    total=Sum('sum')
                )['total'] or Decimal('0.00')
                old_balance = tab.balance
                tab.balance = adjustments_total - purchases_total
                tab.save()
            messages.success(
                request,
                f"Recalculated balance for {tab.name}: {old_balance:.2f} → {tab.balance:.2f} €"
            )
        return HttpResponseRedirect(reverse('admin:api_tab_change', args=[object_id]))

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

    @admin.action(description='Recalculate balances from transaction history')
    def recalculate_balances(self, request, queryset):
        updated = 0
        with transaction.atomic():
            for tab in queryset:
                purchases_total = Purchase.objects.filter(tab=tab).aggregate(
                    total=Sum('total')
                )['total'] or Decimal('0.00')
                adjustments_total = TabAdjustment.objects.filter(tab=tab).aggregate(
                    total=Sum('sum')
                )['total'] or Decimal('0.00')
                correct_balance = adjustments_total - purchases_total
                if tab.balance != correct_balance:
                    tab.balance = correct_balance
                    tab.save()
                    updated += 1
        messages.success(request, f'Recalculated balances for {queryset.count()} tab(s); {updated} updated.')

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

    def negative_balances_view(self, request):
        from django.shortcuts import render
        negative_tabs = Tab.objects.filter(balance__lt=0).order_by('name')
        text = '\n'.join(f"{tab.name}: {tab.balance:.2f} €" for tab in negative_tabs)
        context = {
            **self.admin_site.each_context(request),
            'title': 'Negative balances',
            'negative_tabs': negative_tabs,
            'text': text,
        }
        return render(request, 'admin/api/tab/negative_balances.html', context)

class ProductGroupAdmin(MyModelAdmin):
    list_display = ('name', 'order',)
    search_fields = ('name',)
    ordering = ('order',)

class ProductAdmin(MyModelAdmin):
    list_display = ('name', 'price_in', 'price_out', 'group', 'in_stock', 'stock_quantity', 'low_stock_threshold',)
    list_filter = ('group', 'in_stock', 'group__name',)
    search_fields = ('name',)
    ordering = ('name',)
    actions = ['set_in_stock', 'set_out_of_stock']
    change_list_template = 'admin/api/product/change_list.html'

    @admin.action(description='Set in stock', permissions=['change'],)
    def set_in_stock(self, request, queryset):
        queryset.update(in_stock=True)
    @admin.action(description='Set out of stock', permissions=['change'],)
    def set_out_of_stock(self, request, queryset):
        queryset.update(in_stock=False)

    def get_urls(self):
        urls = super().get_urls()
        custom_urls = [
            path('manage-quantities/', self.admin_site.admin_view(self.manage_quantities_view),
                 name='api_product_manage_quantities'),
        ]
        return custom_urls + urls

    def manage_quantities_view(self, request):
        """Bulk-edit stock_quantity / low_stock_threshold, grouped by category.

        Categories and products are sorted alphabetically (note: not the SPA's
        ProductGroup.order). By default only products that already track stock
        (either field populated) are shown; ?all=1 shows every in-stock product."""
        from django.http import HttpResponseRedirect
        from django.shortcuts import render

        show_all = request.GET.get('all') == '1'

        if request.method == 'POST':
            def parse(raw):
                raw = (raw or '').strip().replace(',', '.')
                if raw == '':
                    return None
                try:
                    return Decimal(raw)
                except (InvalidOperation, ValueError):
                    return None
            updated = 0
            for product in Product.objects.all():
                stock_key = f'stock_{product.id}'
                threshold_key = f'threshold_{product.id}'
                if stock_key not in request.POST and threshold_key not in request.POST:
                    continue
                new_stock = parse(request.POST.get(stock_key))
                new_threshold = parse(request.POST.get(threshold_key))
                if product.stock_quantity != new_stock or product.low_stock_threshold != new_threshold:
                    product.stock_quantity = new_stock
                    product.low_stock_threshold = new_threshold
                    product.save()
                    updated += 1
            messages.success(request, f'Saved quantities for {updated} product(s).')
            redirect_url = request.path + ('?all=1' if show_all else '')
            return HttpResponseRedirect(redirect_url)

        if show_all:
            products = Product.objects.filter(in_stock=True)
        else:
            products = Product.objects.filter(
                Q(stock_quantity__isnull=False) | Q(low_stock_threshold__isnull=False)
            )
        products = products.select_related('group')

        # Group by category, both categories and products sorted alphabetically.
        grouped = defaultdict(list)
        for product in products:
            grouped[product.group.name if product.group else None].append(product)
        groups = []
        for name in sorted([n for n in grouped if n is not None], key=str.lower):
            groups.append({'name': name, 'products': sorted(grouped[name], key=lambda p: p.name.lower())})
        if None in grouped:
            groups.append({'name': 'Uncategorized', 'products': sorted(grouped[None], key=lambda p: p.name.lower())})

        context = {
            **self.admin_site.each_context(request),
            'title': 'Manage quantities',
            'groups': groups,
            'show_all': show_all,
        }
        return render(request, 'admin/api/product/manage_quantities.html', context)

class PurchaseAdmin(MyModelAdmin):
    list_display = ('tab', 'product', 'quantity', 'total', 'price_type', 'created_at',)
    list_filter = ('tab', 'product', 'price_type', 'created_at',)
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
            # Restore stock for tracked products (mirrors the decrement on purchase).
            if obj.product_id is not None:
                Product.objects.filter(
                    pk=obj.product_id, stock_quantity__isnull=False
                ).update(stock_quantity=F('stock_quantity') + obj.quantity)
            super().delete_model(request, obj)

    def delete_queryset(self, request, queryset):
        with transaction.atomic():
            tab_totals = defaultdict(Decimal)
            product_qtys = defaultdict(Decimal)
            for obj in queryset:
                tab_totals[obj.tab_id] += obj.total
                if obj.product_id is not None:
                    product_qtys[obj.product_id] += obj.quantity
            for tab_id, total in tab_totals.items():
                Tab.objects.filter(pk=tab_id).update(balance=F('balance') + total)
            for product_id, qty in product_qtys.items():
                Product.objects.filter(
                    pk=product_id, stock_quantity__isnull=False
                ).update(stock_quantity=F('stock_quantity') + qty)
            super().delete_queryset(request, queryset)

class SettingsForm(forms.Form):
    KNOWN_KEYS = [
        'cash_enabled', 'custom_amount_enabled', 'pin_lockout_threshold',
        'negative_balance_limit',
        'shelly_cloud_server', 'shelly_cloud_key', 'shelly_cloud_device',
    ]
    TRUTHY = ('1', 'true', 'yes', 'on')

    cash_enabled = forms.BooleanField(
        required=False,
        label='Käteismaksu käytössä',
        help_text='Näyttää kassanäkymässä käteismaksuvaihtoehdon. Käteisostot kirjataan 0 € hintaan mutta vähentävät varastosaldoa.',
    )
    custom_amount_enabled = forms.BooleanField(
        required=False,
        label='Oma summa käytössä',
        help_text='Näyttää kassanäkymässä "Oma summa" -painikkeen vapaalle rahasummalle. Poista käytöstä piilottaaksesi sen.',
    )
    pin_lockout_threshold = forms.IntegerField(
        required=False,
        min_value=1,
        label='PIN-lukitusraja',
        help_text='Suurin sallittu epäonnistuneiden PIN-yritysten määrä ennen tilin lukitusta. Jätä tyhjäksi poistaaksesi lukituksen käytöstä.',
    )
    negative_balance_limit = forms.DecimalField(
        required=False,
        max_digits=10,
        decimal_places=2,
        label='Saldon alaraja (€)',
        help_text='Pienin sallittu saldo euroina (esim. −100 = saldo ei voi laskea alle −100,00 €, 0 = ei saa mennä miinukselle). Jätä tyhjäksi poistaaksesi rajan. Yksittäisen piikin voi vapauttaa rajasta piikin asetuksissa.',
    )
    shelly_cloud_server = forms.URLField(
        required=False,
        label='Shelly Cloud -palvelin',
        help_text='Shelly Cloud API -palvelimen osoite (esim. https://shelly-103-eu.shelly.cloud).',
    )
    shelly_cloud_key = forms.CharField(
        required=False,
        label='Shelly Cloud -avain',
        help_text='Shelly Cloud -tunnistautumisavain (auth key).',
    )
    shelly_cloud_device = forms.CharField(
        required=False,
        label='Shelly-laitetunnus',
        help_text='Ohjattavan Shelly-laitteen tunniste (device ID).',
    )


class SettingAdmin(MyModelAdmin):

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def changelist_view(self, request, extra_context=None):
        if request.method == 'POST':
            form = SettingsForm(request.POST)
            if form.is_valid():
                self._save_settings(form.cleaned_data)
                messages.success(request, 'Asetukset tallennettu.')
                return HttpResponseRedirect(request.path)
        else:
            settings_dict = {
                s.key: s.value
                for s in Setting.objects.filter(key__in=SettingsForm.KNOWN_KEYS)
            }
            initial = {
                'cash_enabled': str(settings_dict.get('cash_enabled', '')).strip().lower() in SettingsForm.TRUTHY,
                # Defaults to on when unset, mirroring get_custom_amount_enabled().
                'custom_amount_enabled': str(settings_dict.get('custom_amount_enabled', 'true')).strip().lower() in SettingsForm.TRUTHY,
                'pin_lockout_threshold': self._parse_optional_int(settings_dict.get('pin_lockout_threshold', '')),
                'negative_balance_limit': self._parse_optional_decimal(settings_dict.get('negative_balance_limit', '')),
                'shelly_cloud_server': settings_dict.get('shelly_cloud_server', ''),
                'shelly_cloud_key': settings_dict.get('shelly_cloud_key', ''),
                'shelly_cloud_device': settings_dict.get('shelly_cloud_device', ''),
            }
            form = SettingsForm(initial=initial)

        context = {
            **self.admin_site.each_context(request),
            'title': 'Asetukset',
            'form': form,
            'opts': self.model._meta,
        }
        return TemplateResponse(request, 'admin/api/setting/settings_form.html', context)

    def _save_settings(self, cleaned_data):
        mapping = {
            'cash_enabled': 'true' if cleaned_data['cash_enabled'] else 'false',
            'custom_amount_enabled': 'true' if cleaned_data['custom_amount_enabled'] else 'false',
            'pin_lockout_threshold': str(cleaned_data['pin_lockout_threshold']) if cleaned_data['pin_lockout_threshold'] is not None else '',
            'negative_balance_limit': str(cleaned_data['negative_balance_limit']) if cleaned_data['negative_balance_limit'] is not None else '',
            'shelly_cloud_server': cleaned_data.get('shelly_cloud_server') or '',
            'shelly_cloud_key': cleaned_data.get('shelly_cloud_key') or '',
            'shelly_cloud_device': cleaned_data.get('shelly_cloud_device') or '',
        }
        for key, value in mapping.items():
            try:
                obj = Setting.objects_with_deleted.get(key=key)
                obj.value = value
                obj.deleted_at = None
                obj.save()
            except Setting.DoesNotExist:
                Setting.objects.create(key=key, value=value)

    @staticmethod
    def _parse_optional_int(raw):
        if raw is None or str(raw).strip() == '':
            return None
        try:
            return int(str(raw).strip())
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _parse_optional_decimal(raw):
        if raw is None or str(raw).strip() == '':
            return None
        try:
            return Decimal(str(raw).strip())
        except (InvalidOperation, ValueError):
            return None

class SessionAdmin(MyModelAdmin):
    list_display = ('tab', 'started_at', 'ended_at', 'people', 'comment',)
    list_filter = ('tab', 'ended_at',)
    search_fields = ('tab__name',)
    readonly_fields = ('client_uuid',)
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
    ordering = ('-created_at',)

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
            tab_totals = defaultdict(Decimal)
            for obj in queryset:
                tab_totals[obj.tab_id] += obj.sum
            for tab_id, total in tab_totals.items():
                Tab.objects.filter(pk=tab_id).update(balance=F('balance') - total)
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
