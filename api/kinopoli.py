"""Kinopoli integration: tell Kinopoli whenever a hosting starts or ends.

Kinopoli switches the venue's power (a different Shelly relay from the one in
shelly.py) and keeps it on while somebody is hosting here. Rather than have it
poll, every change to a Session is pushed as the *whole* current state, so a
repeated or late push is harmless: Kinopoli orders pushes by `event_at` and
ignores one older than what it already has.

When a hosting ends, this app's own relay switches itself off 60 seconds later
(see shelly.schedule_turn_off_shelly). The push says so with `power_off_at`,
and Kinopoli keeps treating the hosting as on until then unless a new one
starts first -- so nothing here has to wake up a minute later.

Configured by two environment variables; with either unset nothing is sent:

  KINOPOLI_PUSH_URL  e.g. http://127.0.0.1:8082/hifipiikki/session
  KINOPOLI_TOKEN     shared secret, Kinopoli's HIFIPIIKKI_TOKEN

Pushes run on a background thread with a few retries, so a slow or restarting
Kinopoli never delays the tablet. Kinopoli also reads the same state once when
it starts (views.integration_session_state), which covers a push it missed.
"""

import hmac
import logging
import threading
import time
from datetime import timedelta

import requests
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)

# hifiPiikki's own relay turns off this long after a session ends.
POWER_OFF_DELAY = timedelta(seconds=60)

RETRY_DELAYS = (1, 5, 30)
TIMEOUT_SECONDS = 5


def _iso(value):
    return value.isoformat() if value else None


def session_state():
    """The current hosting as Kinopoli wants it.

    The active session if there is one, else the most recently ended one (so
    Kinopoli learns when its power-off minute runs out), else nothing at all.
    """
    from .models import Session

    now = timezone.now()
    active = (
        Session.objects.filter(ended_at=None)
        .select_related('tab')
        .order_by('-started_at')
        .first()
    )

    if active is not None:
        return {
            'session_id': active.id,
            'active': True,
            'holder_name': active.tab.name,
            'started_at': _iso(active.started_at),
            'ended_at': None,
            'power_off_at': None,
            'event_at': _iso(now),
        }

    last = (
        Session.objects.exclude(ended_at=None)
        .select_related('tab')
        .order_by('-ended_at')
        .first()
    )

    if last is None:
        return {
            'session_id': None,
            'active': False,
            'holder_name': None,
            'started_at': None,
            'ended_at': None,
            'power_off_at': None,
            'event_at': _iso(now),
        }

    return {
        'session_id': last.id,
        'active': False,
        'holder_name': last.tab.name,
        'started_at': _iso(last.started_at),
        'ended_at': _iso(last.ended_at),
        'power_off_at': _iso(last.ended_at + POWER_OFF_DELAY),
        'event_at': _iso(now),
    }


def is_configured():
    return bool(settings.KINOPOLI_PUSH_URL and settings.KINOPOLI_TOKEN)


def token_matches(header):
    """Constant-time check of an `Authorization: Bearer ...` header."""
    expected = settings.KINOPOLI_TOKEN
    if not expected or not header or not header.startswith('Bearer '):
        return False
    return hmac.compare_digest(header[len('Bearer '):].encode(), expected.encode())


def _send(payload):
    headers = {'Authorization': f'Bearer {settings.KINOPOLI_TOKEN}'}

    for attempt, delay in enumerate((0,) + RETRY_DELAYS):
        if delay:
            time.sleep(delay)
        try:
            response = requests.post(
                settings.KINOPOLI_PUSH_URL,
                json=payload,
                headers=headers,
                timeout=TIMEOUT_SECONDS,
            )
            # A 4xx other than a rate limit will not get better by retrying.
            if response.ok or (400 <= response.status_code < 500 and response.status_code != 429):
                if not response.ok:
                    logger.error('Kinopoli refused session push: %s %s', response.status_code, response.text[:200])
                return
            logger.warning('Kinopoli session push answered %s (attempt %d)', response.status_code, attempt + 1)
        except requests.RequestException as error:
            logger.warning('Kinopoli session push failed (attempt %d): %s', attempt + 1, error)

    logger.error('Kinopoli session push gave up: %s', payload)


def push_state_async():
    """Builds the state now and sends it from a background thread."""
    if not is_configured():
        return

    try:
        payload = session_state()
    except Exception:  # never let the integration break a session request
        logger.exception('Could not build Kinopoli session state')
        return

    threading.Thread(target=_send, args=(payload,), daemon=True).start()
