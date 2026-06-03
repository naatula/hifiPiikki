from decimal import Decimal

from django.db import migrations, models

CENT = Decimal('0.01')


def backfill_price_type(apps, schema_editor):
    """Infer in/out for existing purchases from their unit price.

    Only products with two distinct prices can be classified. For each such
    purchase we compare the stored total against quantity * price_in and
    quantity * price_out (rounded to cents). It is set to 'in' or 'out' only
    when exactly one matches; if neither matches (e.g. the product price has
    since been changed) or the data is otherwise ambiguous, the field is left
    empty. Single-price products and custom amounts are skipped entirely.
    """
    Purchase = apps.get_model('api', 'Purchase')
    purchases = (
        Purchase.objects
        .filter(product__isnull=False)
        .select_related('product')
        .iterator()
    )
    for purchase in purchases:
        product = purchase.product
        price_in = product.price_in
        price_out = product.price_out
        # Single price (no separate out price, or both equal): nothing to tell.
        if price_out is None or price_out == price_in:
            continue
        if not purchase.quantity:
            continue
        expected_in = (purchase.quantity * price_in).quantize(CENT)
        expected_out = (purchase.quantity * price_out).quantize(CENT)
        if purchase.total == expected_in and purchase.total != expected_out:
            purchase.price_type = 'in'
            purchase.save(update_fields=['price_type'])
        elif purchase.total == expected_out and purchase.total != expected_in:
            purchase.price_type = 'out'
            purchase.save(update_fields=['price_type'])
        # else: ambiguous / no match -> leave empty


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0007_alter_product_price_out'),
    ]

    operations = [
        migrations.AddField(
            model_name='purchase',
            name='price_type',
            field=models.CharField(
                blank=True,
                choices=[('in', 'Sisään'), ('out', 'Ulos')],
                max_length=3,
                null=True,
            ),
        ),
        migrations.RunPython(backfill_price_type, migrations.RunPython.noop),
    ]
