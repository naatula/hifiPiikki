from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0010_backfill_occurred_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='product',
            name='stock_quantity',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name='product',
            name='low_stock_threshold',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AlterField(
            model_name='purchase',
            name='price_type',
            field=models.CharField(
                blank=True,
                choices=[('in', 'Sisään'), ('out', 'Ulos'), ('cash', 'Käteinen')],
                max_length=3,
                null=True,
            ),
        ),
    ]
