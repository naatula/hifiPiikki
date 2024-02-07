from django.http import HttpResponse
from .models import Purchase, Tab, Product, ProductGroup, Hosting
from rest_framework import permissions, viewsets, serializers
from .serializers import PurchaseSerializer, TabSerializer, ProductSerializer, ProductGroupSerializer, HostingSerializer
from rest_framework.decorators import action
from rest_framework.response import Response
from datetime import datetime, timedelta
from django.db import models
from django.shortcuts import render


class PurchaseViewSet(viewsets.GenericViewSet):
    queryset = Purchase.objects.all()
    serializer_class = PurchaseSerializer
    permission_classes = [permissions.IsAuthenticated]
    def create(self, request):
        serializer = PurchaseSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            # Update the tab balance
            tab = serializer.validated_data['tab']
            tab.balance -= serializer.validated_data['total']
            tab.save()
            return Response(serializer.data)
        return Response(serializer.errors)
    # List should return the purchases from the last 24 hours
    def list(self, request):
        return Response(PurchaseSerializer(
            Purchase.objects.filter(
                created_at__gte=datetime.now()-timedelta(days=1)), many=True).data)
    
class TabViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Tab.objects.filter(active=True).order_by('name')
    serializer_class = TabSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    @action(detail=False, methods=['get'])
    def export(self, request):
        # Only for admins, 403 otherwise
        if not request.user.is_staff:
            return HttpResponse(status=403)
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="tabs.csv"'
        tabs = Tab.objects.all()
        response.write('id,name,balance\n')
        for tab in tabs:
            response.write(f'{tab.id},{tab.name},{tab.balance}\n')
        return response
    
class ProductViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ProductGroup.objects.all().order_by('order')
    serializer_class = ProductGroupSerializer
    permission_classes = [permissions.IsAuthenticated]
    
    # Change the value of in_stock for a product
    @action(detail=True, methods=['post'])
    def in_stock(self, request, pk=None):
        product = Product.objects.get(pk=pk)
        product.in_stock = request.data['in_stock']
        product.save()
        return Response(ProductSerializer(product).data)
    

class HostingViewSet(viewsets.GenericViewSet):
    queryset = Hosting.objects.all()
    serializer_class = HostingSerializer
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        queryset = Hosting.objects.all()
        serializer = HostingSerializer(queryset, many=True)
        return Response(serializer.data)

    # Create should create a new hosting with the tab from the request
    def create(self, request):
        # Fail if there is already an active hosting
        if Hosting.objects.filter(ended_at=None).exists():
            return Response({'error': 'An active hosting already exists'}, status=400)
        # Create new hosting object with tab from request
        serializer = HostingSerializer(data = {
            'tab': request.data['tab'],
            'people': None,
            'comment': '',
            'started_at': datetime.now(),
            'ended_at': None
        })
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors)
        
    
    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        hosting = self.get_object()
        # Add people and comment to the hosting
        hosting = self.get_object()
        hosting.people = request.data.get('people')
        hosting.comment = request.data.get('comment')
        # Fail if the hosting has already ended
        if hosting.ended_at is not None:
            return Response({'error': 'Hosting has already ended'}, status=400)
        if hosting.people == None or hosting.people == 0:
            return Response({'error': 'Number of people is required'}, status=400)
        if hosting.comment == None or hosting.comment == '':
            return Response({'error': 'Comment is required'}, status=400)
        hosting.ended_at = datetime.now()
        hosting.save()
        # Create a 1 minute timer

        return Response(HostingSerializer(hosting).data)
    
    @action(detail=False, methods=['get'])
    def active(self, request):
        queryset = Hosting.objects.filter(ended_at=None).first()
        if queryset is None:
            return Response({'id': None})
        serializer = HostingSerializer(queryset, many=False)
        # Add total purchases after the hosting started
        data = serializer.data
        data['total_host'] = Purchase.objects.filter(tab=queryset.tab, created_at__gte=queryset.started_at).aggregate(models.Sum('total'))['total__sum'] or 0
        data['total_all'] = Purchase.objects.filter(created_at__gte=queryset.started_at).aggregate(models.Sum('total'))['total__sum'] or 0
        return Response(data)
    

@action(detail=False, methods=['get'])
def csrf(request):
    # Render the CSRF token in a template
    return render(request, 'csrf.html')