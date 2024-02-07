from .models import Tab, ProductGroup, Product, Purchase, Setting, Hosting
from rest_framework import serializers

class TabSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tab
        fields = ['id', 'name', 'balance', 'updated_at']

class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = ['id', 'name', 'price_in', 'price_out', 'note', 'description', 'in_stock']

class ProductGroupSerializer(serializers.ModelSerializer):
    products = ProductSerializer(many=True)

    class Meta:
        model = ProductGroup
        fields = ['id', 'name', 'products']

class PurchaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Purchase
        fields = ['id', 'tab', 'product', 'quantity', 'total', 'created_at']

class SettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Setting
        fields = ['key', 'value']

class HostingSerializer(serializers.ModelSerializer):
    tab_name = serializers.CharField(source='tab.name', read_only=True)
    class Meta:
        model = Hosting
        fields = ['id', 'tab', 'tab_name', 'people', 'comment', 'started_at', 'ended_at']
