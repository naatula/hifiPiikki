from django.db import migrations, models


def backfill_status(apps, schema_editor):
    Tab = apps.get_model('api', 'Tab')
    Tab.objects.filter(active=True).update(status='enabled')
    Tab.objects.filter(active=False).update(status='disabled')


def backfill_active(apps, schema_editor):
    Tab = apps.get_model('api', 'Tab')
    Tab.objects.exclude(status='disabled').update(active=True)
    Tab.objects.filter(status='disabled').update(active=False)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0014_add_tab_last_purchase_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='tab',
            name='status',
            field=models.CharField(
                choices=[
                    ('disabled', 'Disabled'),
                    ('host_only', 'Host only, no purchases'),
                    ('enabled', 'Enabled'),
                ],
                default='enabled',
                max_length=10,
            ),
        ),
        migrations.RunPython(backfill_status, backfill_active),
        migrations.RemoveField(
            model_name='tab',
            name='active',
        ),
    ]
