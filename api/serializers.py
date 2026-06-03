from .models import Tab, ProductGroup, Product, Purchase, Setting, Session, TabAdjustment, is_tab_locked
from rest_framework import serializers

class TabSerializer(serializers.ModelSerializer):
    pin_locked = serializers.SerializerMethodField()
    has_pin = serializers.SerializerMethodField()

    class Meta:
        model = Tab
        fields = ['id', 'name', 'balance', 'active', 'updated_at', 'pin_required', 'pin_attempts', 'pin_locked', 'has_pin']
        read_only_fields = ['pin_required', 'pin_attempts']

    def get_pin_locked(self, obj):
        return is_tab_locked(obj)

    # Whether a PIN is set, without ever exposing the PIN itself.
    def get_has_pin(self, obj):
        return bool(obj.pin)

class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = ['id', 'name', 'price_in', 'price_out', 'note', 'description', 'in_stock']

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # price_out is optional; when unset it behaves identically to price_in.
        if data.get('price_out') is None:
            data['price_out'] = data['price_in']
        return data

class ProductGroupSerializer(serializers.ModelSerializer):
    products = ProductSerializer(many=True)

    class Meta:
        model = ProductGroup
        fields = ['id', 'name', 'products']

class PurchaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Purchase
        fields = ['id', 'tab', 'product', 'quantity', 'total', 'price_type', 'created_at']

class SettingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Setting
        fields = ['key', 'value']

class SessionSerializer(serializers.ModelSerializer):
    tab_name = serializers.CharField(source='tab.name', read_only=True)
    class Meta:
        model = Session
        fields = ['id', 'tab', 'tab_name', 'people', 'comment', 'started_at', 'ended_at']

class TabAdjustmentSerializer(serializers.ModelSerializer):
    tab_name = serializers.CharField(source='tab.name', read_only=True)
    class Meta:
        model = TabAdjustment
        fields = ['id', 'tab', 'tab_name', 'sum', 'description', 'created_at']
