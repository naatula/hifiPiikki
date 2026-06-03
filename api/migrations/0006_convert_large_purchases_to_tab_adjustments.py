from django.db import migrations
from django.utils import timezone
from datetime import datetime

"""
Convert large Purchases before Feb 2026 to TabAdjustments, and mark the original
Purchases as deleted. This is to retroactively improve analytics, as
TabAdjustments were added later and large Purchases were used before as a
workaround for large one-off charges, such as cash withdrawals.
"""
def convert_purchases(apps, schema_editor):
    Purchase = apps.get_model('api', 'Purchase')
    TabAdjustment = apps.get_model('api', 'TabAdjustment')

    cutoff = timezone.make_aware(datetime(2026, 2, 1))

    qualifying = Purchase.objects.filter(
        total__gte=50,
        created_at__lt=cutoff,
        deleted_at__isnull=True,
    )

    for purchase in qualifying:
        adj = TabAdjustment.objects.create(
            tab=purchase.tab,
            sum=-purchase.total,
            description=f'Muunnettu ostoksesta #{purchase.pk}',
        )
        TabAdjustment.objects.filter(pk=adj.pk).update(created_at=purchase.created_at)
        purchase.deleted_at = timezone.now()
        purchase.save(update_fields=['deleted_at'])


def reverse_convert_purchases(apps, schema_editor):
    Purchase = apps.get_model('api', 'Purchase')
    TabAdjustment = apps.get_model('api', 'TabAdjustment')

    for adj in TabAdjustment.objects.filter(
        description__startswith='Muunnettu ostoksesta #',
        sum__lte=0,
    ):
        try:
            purchase_id = int(adj.description.split('#')[1])
        except (IndexError, ValueError):
            continue
        Purchase.objects.filter(pk=purchase_id).update(deleted_at=None)
        adj.delete()


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0005_tab_pin_tab_pin_attempts_tab_pin_required'),
    ]

    operations = [
        migrations.RunPython(convert_purchases, reverse_convert_purchases),
    ]
