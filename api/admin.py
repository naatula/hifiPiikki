from django.contrib import admin, messages
from django.db import transaction
from django.db.models import Sum
from decimal import Decimal
from django_paranoid.admin import ParanoidAdmin
from .models import Tab, ProductGroup, Product, Purchase, Setting, Hosting, Reimbursement

class MyModelAdmin(ParanoidAdmin):
    pass

class TabAdmin(MyModelAdmin):
    list_display = ('name', 'balance', 'active',)
    actions = ['validate_tabs', 'activate_tabs', 'deactivate_tabs']

    @admin.action(description='Activate selected tabs')
    def activate_tabs(self, request, queryset):
        updated = queryset.update(active=True)
        messages.success(request, f'Successfully activated {updated} tab(s).')

    @admin.action(description='Deactivate selected tabs')
    def deactivate_tabs(self, request, queryset):
        updated = queryset.update(active=False)
        messages.success(request, f'Successfully deactivated {updated} tab(s).')

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

            # Calculate total reimbursements (add to balance)
            reimbursements_total = Reimbursement.objects.filter(tab=tab).aggregate(
                total=Sum('sum')
            )['total'] or Decimal('0.00')

            # Expected balance: starting balance (0) + reimbursements - purchases
            expected_balance = reimbursements_total - purchases_total

            # Check if current balance matches expected balance
            if abs(tab.balance - expected_balance) > Decimal('0.01'):  # Allow for small rounding differences
                violations.append({
                    'tab': tab.name,
                    'current_balance': tab.balance,
                    'expected_balance': expected_balance,
                    'difference': tab.balance - expected_balance,
                    'purchases_total': purchases_total,
                    'reimbursements_total': reimbursements_total
                })

        if violations:
            violation_details = []
            for v in violations:
                violation_details.append(
                    f"Tab '{v['tab']}': Current={v['current_balance']:.2f}, Expected={v['expected_balance']:.2f}, "
                    f"Difference={v['difference']:.2f}, Purchases={v['purchases_total']:.2f}, Reimbursements={v['reimbursements_total']:.2f}"
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

class SettingAdmin(MyModelAdmin):
    list_display = ('key', 'value',)
    search_fields = ('key',)

class HostingAdmin(MyModelAdmin):
    list_display = ('tab', 'started_at', 'ended_at', 'people', 'comment',)
    list_filter = ('tab', 'ended_at',)
    search_fields = ('tab__name',)
    date_hierarchy = 'ended_at'

class ReimbursementAdmin(MyModelAdmin):
    list_display = ('tab', 'sum', 'description', 'created_at',)
    list_filter = ('tab',)
    search_fields = ('tab__name', 'description',)
    date_hierarchy = 'created_at'

    def get_form(self, request, obj=None, **kwargs):
        form = super().get_form(request, obj, **kwargs)
        form.base_fields['sum'].help_text = (
            "The system automatically updates the tab balance when you create a reimbursement or edit reimbursement sums. The sum is debited to the tab balance. Negative sums can be used to deduct from the balance. Note that deletions of reimbursements do not automatically adjust balances, beware of data inconsistencies!"
        )
        return form

    def save_model(self, request, obj, form, change):
        with transaction.atomic():
            is_new = obj.pk is None
            if is_new:
                # New reimbursement - add sum to tab balance
                super().save_model(request, obj, form, change)
                obj.tab.balance += obj.sum
                obj.tab.save()
            else:
                # Editing existing reimbursement - adjust the difference
                old_obj = Reimbursement.objects.get(pk=obj.pk)
                old_sum = old_obj.sum
                super().save_model(request, obj, form, change)
                difference = obj.sum - old_sum
                obj.tab.balance += difference
                obj.tab.save()

# Register your models here.
admin.site.register(Tab, TabAdmin)
admin.site.register(ProductGroup, ProductGroupAdmin)
admin.site.register(Product, ProductAdmin)
admin.site.register(Purchase, PurchaseAdmin)
admin.site.register(Setting, SettingAdmin)
admin.site.register(Hosting, HostingAdmin)
admin.site.register(Reimbursement, ReimbursementAdmin)

# Customize admin site titles
admin.site.site_header = "hifiPiikki administration"
admin.site.site_title = "hifiPiikki administration"