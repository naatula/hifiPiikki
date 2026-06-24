from django.http import HttpResponse
from django.db import IntegrityError, models
from django.db.models import F
from django.shortcuts import render
from django.utils import timezone
from rest_framework import permissions, viewsets, serializers
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from datetime import datetime, timedelta

from django.utils.dateparse import parse_datetime

from .models import Purchase, Tab, Product, ProductGroup, Session, get_pin_lockout_threshold, is_tab_locked, get_cash_enabled, get_custom_amount_enabled
from .serializers import PurchaseSerializer, TabSerializer, ProductSerializer, ProductGroupSerializer, SessionSerializer
from .shelly import turn_on_shelly, schedule_turn_off_shelly


# Window within which a session event time counts as a live action (relay
# should toggle) rather than a historical offline replay landing late (relay
# must stay untouched). A timed-out online request that gets buffered replays
# within seconds; a genuinely offline start/end may replay hours later.
LIVE_EVENT_WINDOW = timedelta(minutes=5)


def _is_live_event(event_time):
    """True if event_time is recent enough to drive the Shelly relay.

    Accepts a datetime or an ISO-8601 string (the `end` view assigns the raw
    request value before saving). A missing/unparseable time defaults to live,
    matching the pre-existing online behaviour where no timestamp meant "now".
    """
    if event_time is None:
        return True
    if isinstance(event_time, str):
        event_time = parse_datetime(event_time)
        if event_time is None:
            return True
    if timezone.is_naive(event_time):
        event_time = timezone.make_aware(event_time)
    return abs(timezone.now() - event_time) <= LIVE_EVENT_WINDOW


class PurchaseViewSet(viewsets.GenericViewSet):
    queryset = Purchase.objects.all()
    serializer_class = PurchaseSerializer
    permission_classes = [permissions.IsAuthenticated]
    def create(self, request):
        client_uuid = request.data.get('client_uuid')
        if client_uuid:
            existing = Purchase.objects.filter(client_uuid=client_uuid).first()
            if existing:
                return Response(PurchaseSerializer(existing).data)
        serializer = PurchaseSerializer(data=request.data)
        if serializer.is_valid():
            tab = serializer.validated_data['tab']
            if tab.pin_required:
                threshold = get_pin_lockout_threshold()
                if is_tab_locked(tab, threshold):
                    return Response(
                        {'error': 'locked', 'pin_attempts': tab.pin_attempts, 'pin_locked': True},
                        status=403,
                    )
                pin = request.data.get('pin')
                if pin != tab.pin:
                    tab.pin_attempts += 1
                    tab.save()
                    return Response(
                        {'error': 'wrong_pin', 'pin_attempts': tab.pin_attempts,
                         'pin_locked': is_tab_locked(tab, threshold)},
                        status=403,
                    )
                tab.pin_attempts = 0
            try:
                serializer.save()
            except IntegrityError:
                existing = Purchase.objects.filter(client_uuid=client_uuid).first()
                if existing:
                    return Response(PurchaseSerializer(existing).data)
                raise
            tab.balance -= serializer.validated_data['total']
            tab.save()
            # Decrement tracked stock by the purchased quantity. Only products
            # that track stock (stock_quantity not null) are touched; the count
            # may go negative and never blocks the sale. Reaches here only on a
            # genuine new save (replays returned early above), so idempotent.
            purchase = serializer.instance
            if purchase.product_id is not None:
                Product.objects.filter(
                    pk=purchase.product_id, stock_quantity__isnull=False
                ).update(stock_quantity=F('stock_quantity') - serializer.validated_data['quantity'])
            return Response(serializer.data)
        return Response(serializer.errors)
    def list(self, request):
        return Response(PurchaseSerializer(
            Purchase.objects.filter(
                occurred_at__gte=timezone.now()-timedelta(days=1)), many=True).data)

class TabViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Tab.objects.all().order_by('name')
    serializer_class = TabSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """Override queryset to filter by active status for list view only"""
        if self.action == 'list':
            return Tab.objects.filter(active=True).order_by('name')
        return Tab.objects.all().order_by('name')

    def retrieve(self, request, pk=None):
        """Get tab details with latest purchases"""
        tab = self.get_object()
        serializer = TabSerializer(tab)
        data = serializer.data
        purchases = Purchase.objects.filter(tab=tab, occurred_at__gte=timezone.now()-timedelta(days=7)).order_by('-occurred_at')[:50]
        purchases_data = PurchaseSerializer(purchases, many=True).data
        # Add product name to each purchase
        for i, purchase in enumerate(purchases):
            if purchase.product:
                purchases_data[i]['product_name'] = purchase.product.name
            else:
                purchases_data[i]['product_name'] = 'Oma summa'
        data['purchases'] = purchases_data

        # Add latest tab adjustment for this tab
        latest_tab_adjustment = tab.tab_adjustments.order_by('-created_at').first()
        if latest_tab_adjustment:
            data['latest_tab_adjustment'] = {
                'sum': str(latest_tab_adjustment.sum),
                'description': latest_tab_adjustment.description,
                'created_at': latest_tab_adjustment.created_at.isoformat()
            }
        else:
            data['latest_tab_adjustment'] = None

        # Expose the lockout threshold (or None) so the SPA can show a note
        # next to the PIN-required toggle.
        data['pin_lockout_threshold'] = get_pin_lockout_threshold()

        return Response(data)

    @action(detail=True, methods=['post'])
    def set_pin_required(self, request, pk=None):
        """Enable/disable the PIN requirement for a tab. Requires the correct
        PIN; applies the same wrong-attempt and lockout logic as a purchase and
        never exposes the stored PIN."""
        tab = self.get_object()
        # Only meaningful when a PIN is actually set.
        if not tab.pin:
            return Response({'error': 'no_pin'}, status=400)
        threshold = get_pin_lockout_threshold()
        if is_tab_locked(tab, threshold):
            return Response(
                {'error': 'locked', 'pin_attempts': tab.pin_attempts, 'pin_locked': True},
                status=403,
            )
        pin = request.data.get('pin')
        if pin != tab.pin:
            tab.pin_attempts += 1
            tab.save()
            return Response(
                {'error': 'wrong_pin', 'pin_attempts': tab.pin_attempts,
                 'pin_locked': is_tab_locked(tab, threshold)},
                status=403,
            )
        # Correct PIN: reset the attempt counter and apply the new setting.
        tab.pin_attempts = 0
        tab.pin_required = bool(request.data.get('pin_required'))
        tab.save()
        return Response(TabSerializer(tab).data)

    @action(detail=True, methods=['post'])
    def verify_pin(self, request, pk=None):
        """Verify the PIN for a tab without creating a purchase or changing any setting.
        Increments pin_attempts on failure (brute-force protection) and resets on success."""
        tab = self.get_object()
        if not tab.pin:
            return Response({'error': 'no_pin'}, status=400)
        threshold = get_pin_lockout_threshold()
        if is_tab_locked(tab, threshold):
            return Response(
                {'error': 'locked', 'pin_attempts': tab.pin_attempts, 'pin_locked': True},
                status=403,
            )
        pin = request.data.get('pin')
        if pin != tab.pin:
            tab.pin_attempts += 1
            tab.save()
            return Response(
                {'error': 'wrong_pin', 'pin_attempts': tab.pin_attempts,
                 'pin_locked': is_tab_locked(tab, threshold)},
                status=403,
            )
        tab.pin_attempts = 0
        tab.save()
        return Response({'ok': True})

    @action(detail=False, methods=['get'])
    def all(self, request):
        """List all tabs (including inactive ones with nonzero balance) with their balances"""
        queryset = Tab.objects.filter(models.Q(active=True) | ~models.Q(balance=0)).order_by('name')
        serializer = TabSerializer(queryset, many=True)
        return Response(serializer.data)

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

    def list(self, request):
        queryset = ProductGroup.objects.all().order_by('order')
        serializer = ProductGroupSerializer(queryset, many=True)
        recommendations = list(Purchase.objects.filter(product__isnull=False, occurred_at__gte=timezone.now()-timedelta(days=90)).values('product').annotate(total=models.Sum('quantity')).order_by('-total')[:6])
        session = Session.objects.filter(ended_at=None).first()
        if session is not None:
            recommendations = list(Purchase.objects.filter(tab=session.tab, occurred_at__gte=timezone.now()-timedelta(days=90)).values('product').annotate(total=models.Sum('quantity')).order_by('-total')[:6]) + recommendations
        # Remove duplicates
        recommendations = list({v['product']:v for v in recommendations}.values())
        # Add the recommendations to the response
        recs = []
        for rec in recommendations:
            id = rec['product']
            if id:
                product = Product.objects.get(id=id)
                recs.append(ProductSerializer(product).data)
        data = serializer.data
        if len(recs) > 0:
            data = [{'id': None, 'name': 'Suositukset', 'products': recs}] + data
        return Response(data)

    # Change the value of in_stock for a product
    @action(detail=True, methods=['post'])
    def in_stock(self, request, pk=None):
        product = Product.objects.get(pk=pk)
        product.in_stock = request.data['in_stock']
        product.save()
        return Response(ProductSerializer(product).data)


class SessionViewSet(viewsets.GenericViewSet):
    queryset = Session.objects.all()
    serializer_class = SessionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        queryset = Session.objects.all()
        serializer = SessionSerializer(queryset, many=True)
        return Response(serializer.data)

    def create(self, request):
        client_uuid = request.data.get('client_uuid')
        if client_uuid:
            existing = Session.objects.filter(client_uuid=client_uuid).first()
            if existing:
                return Response(SessionSerializer(existing).data)
        ended_at = request.data.get('ended_at')
        if not ended_at and Session.objects.filter(ended_at=None).exists():
            return Response({'error': 'An active session already exists'}, status=400)
        serializer = SessionSerializer(data={
            'tab': request.data['tab'],
            'people': request.data.get('people'),
            'comment': request.data.get('comment', ''),
            'started_at': request.data.get('started_at', timezone.now()),
            'ended_at': ended_at,
            'client_uuid': client_uuid,
        })
        if serializer.is_valid():
            try:
                serializer.save()
            except IntegrityError:
                existing = Session.objects.filter(client_uuid=client_uuid).first()
                if existing:
                    return Response(SessionSerializer(existing).data)
                raise
            # Toggle the relay only for a live start, not a historical offline
            # replay landing late (which must not flip the relay hours later).
            # Freshness of the event time — not client_uuid presence — marks a
            # replay, since online starts now also carry a client_uuid for
            # idempotency.
            data = serializer.data
            if _is_live_event(serializer.instance.started_at):
                shelly_result = turn_on_shelly()
                if shelly_result is not None:
                    data['shelly_ok'] = shelly_result
            return Response(data)
        return Response(serializer.errors)

    @action(detail=True, methods=['post'])
    def end(self, request, pk=None):
        session = self.get_object()
        if session.ended_at is not None:
            return Response(SessionSerializer(session).data)
        session.people = request.data.get('people')
        session.comment = request.data.get('comment')
        if session.people is None or session.people == 0:
            return Response({'error': 'Number of people is required'}, status=400)
        if session.comment is None or session.comment == '':
            return Response({'error': 'Comment is required'}, status=400)
        session.ended_at = request.data.get('ended_at', timezone.now())
        session.save()
        # See create(): gate the relay on event-time freshness, not client_uuid,
        # so a replayed historical end doesn't schedule a turn-off hours late.
        data = SessionSerializer(session).data
        if _is_live_event(session.ended_at):
            shelly_result = schedule_turn_off_shelly(60)
            if shelly_result is not None:
                data['shelly_ok'] = shelly_result
        return Response(data)

    @action(detail=False, methods=['get'])
    def active(self, request):
        queryset = Session.objects.filter(ended_at=None).first()
        if queryset is None:
            return Response({'id': None})
        serializer = SessionSerializer(queryset, many=False)
        # Add total purchases after the session started
        data = serializer.data
        data['total_host'] = Purchase.objects.filter(tab=queryset.tab, occurred_at__gte=queryset.started_at).aggregate(models.Sum('total'))['total__sum'] or 0
        data['total_all'] = Purchase.objects.filter(occurred_at__gte=queryset.started_at).aggregate(models.Sum('total'))['total__sum'] or 0
        return Response(data)


@action(detail=False, methods=['get'])
def csrf(request):
    # Render the CSRF token in a template
    return render(request, 'csrf.html')


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def config(request):
    """Public client config. Whitelisted keys only — never dump the whole
    Setting table, which holds Shelly cloud credentials."""
    return Response({
        'cash_enabled': get_cash_enabled(),
        'custom_amount_enabled': get_custom_amount_enabled(),
    })