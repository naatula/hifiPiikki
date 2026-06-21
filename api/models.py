import uuid
from django.db import models
from django.core.validators import RegexValidator
from django.core.exceptions import ValidationError
from django.utils import timezone
from django_paranoid.models import ParanoidModel


def get_pin_lockout_threshold():
    """Return the integer pin_lockout_threshold from Setting, or None if
    unset/empty/non-numeric (which means lockout is disabled)."""
    setting = Setting.objects.filter(key='pin_lockout_threshold').first()
    if setting is None or setting.value is None or str(setting.value).strip() == '':
        return None
    try:
        return int(str(setting.value).strip())
    except (ValueError, TypeError):
        return None


def is_tab_locked(tab, threshold=None):
    """Return True if the tab is locked out due to too many failed PIN attempts.

    Locked == threshold is not None AND tab.pin_attempts >= threshold.
    Pass a pre-fetched threshold to avoid re-querying the Setting."""
    if threshold is None:
        threshold = get_pin_lockout_threshold()
    if threshold is None:
        return False
    return tab.pin_attempts >= threshold


# Create your models here.
class Tab(ParanoidModel):
    name = models.CharField(max_length=255)
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=0.0)
    active = models.BooleanField(default=True)
    pin = models.CharField(max_length=6, blank=True, null=True, validators=[RegexValidator(r'^\d{6}$', 'PIN must be exactly 6 digits')])
    pin_required = models.BooleanField(default=False)
    pin_attempts = models.IntegerField(default=0)
    
    def clean(self):
        super().clean()
        if self.pin_required and not self.pin:
            raise ValidationError({'pin_required': 'PIN must be set to enable PIN requirement.'})

    def __str__(self):
        return self.name

class ProductGroup(ParanoidModel):
    name = models.CharField(max_length=255)
    order = models.IntegerField(default=0)
    def __str__(self):
        return self.name

class Product(ParanoidModel):
    name = models.CharField(max_length=255)
    price_in = models.DecimalField(max_digits=10, decimal_places=2)
    price_out = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    group = models.ForeignKey(ProductGroup, on_delete=models.SET_NULL, null=True, blank=True, related_name='products')
    note = models.CharField(max_length=255, null=True, blank=True)
    description = models.TextField(null=True, blank=True)
    in_stock = models.BooleanField(default=True)
    def __str__(self):
        return self.name

class Purchase(ParanoidModel):
    PRICE_IN = 'in'
    PRICE_OUT = 'out'
    PRICE_TYPE_CHOICES = [(PRICE_IN, 'Sisään'), (PRICE_OUT, 'Ulos')]

    tab = models.ForeignKey(Tab, on_delete=models.PROTECT)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, null=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=2)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    price_type = models.CharField(
        max_length=3, choices=PRICE_TYPE_CHOICES, null=True, blank=True)
    client_uuid = models.UUIDField(null=True, blank=True, unique=True)
    occurred_at = models.DateTimeField(default=timezone.now)

class Setting(ParanoidModel):
    key = models.CharField(max_length=255, primary_key=True)
    value = models.CharField(max_length=255)

class Session(ParanoidModel):
    tab = models.ForeignKey(Tab, on_delete=models.PROTECT)
    people = models.IntegerField(blank=True, null=True)
    comment = models.TextField(blank=True, default='')
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(default=None, null=True, blank=True)
    client_uuid = models.UUIDField(null=True, blank=True, unique=True)

class TabAdjustment(ParanoidModel):
    tab = models.ForeignKey(Tab, on_delete=models.PROTECT, related_name='tab_adjustments')
    sum = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.TextField(blank=True, default='')

    def __str__(self):
        return f"{self.tab.name} - {self.sum}"