from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from .kinopoli import push_state_async
from .models import Session


@receiver(post_save, sender=Session)
def push_session_to_kinopoli(sender, instance, **kwargs):
    """Every saved change to a session -- started, ended, edited or soft
    deleted in the admin -- tells Kinopoli the current state, once the
    change is committed."""
    transaction.on_commit(push_state_async)
