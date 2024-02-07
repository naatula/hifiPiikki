from django.db import models
from django_paranoid.models import ParanoidModel

# Create your models here.
class Tab(ParanoidModel):
    name = models.CharField(max_length=255)
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=0.0)
    active = models.BooleanField(default=True)
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
    price_out = models.DecimalField(max_digits=10, decimal_places=2)
    group = models.ForeignKey(ProductGroup, on_delete=models.SET_NULL, null=True, blank=True, related_name='products')
    note = models.CharField(max_length=255, null=True, blank=True)
    description = models.TextField(null=True, blank=True)
    in_stock = models.BooleanField(default=True)
    def __str__(self):
        return self.name

class Purchase(ParanoidModel):
    tab = models.ForeignKey(Tab, on_delete=models.PROTECT)
    product = models.ForeignKey(Product, on_delete=models.PROTECT, null=True)
    quantity = models.DecimalField(max_digits=10, decimal_places=2)
    total = models.DecimalField(max_digits=10, decimal_places=2)

class Setting(ParanoidModel):
    key = models.CharField(max_length=255, primary_key=True)
    value = models.CharField(max_length=255)

class Hosting(ParanoidModel):
    tab = models.ForeignKey(Tab, on_delete=models.PROTECT)
    people = models.IntegerField(null=True)
    comment = models.TextField(blank=True, default='')
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(default=None, null=True)