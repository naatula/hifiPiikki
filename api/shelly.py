import requests
import logging
from typing import Optional, Dict, Any
from .models import Setting

logger = logging.getLogger(__name__)


class ShellyCloudError(Exception):
    """Custom exception for Shelly Cloud API errors"""
    pass


class ShellyCloudClient:
    """Client for interacting with Shelly Cloud API v2

    Handles device control including turning on/off and scheduling operations.
    Automatically disables functionality if required settings are missing.
    """

    def __init__(self):
        """Initialize client with settings from database"""
        self.enabled = True
        try:
            self.server_url = Setting.objects.get(key='shelly_cloud_server').value
            self.api_key = Setting.objects.get(key='shelly_cloud_key').value
            self.device_id = Setting.objects.get(key='shelly_cloud_device').value
        except Setting.DoesNotExist:
            self.enabled = False
            return

        self.headers = {
            'Content-Type': 'application/json'
        }

    def _make_request(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Make HTTP request to Shelly Cloud API v2"""
        url = f"{self.server_url.rstrip('/')}/v2/devices/api/set/switch"
        params = {'auth_key': self.api_key}

        try:
            response = requests.post(url, headers=self.headers, json=data, params=params, timeout=10)
            response.raise_for_status()

        except requests.exceptions.Timeout:
            raise ShellyCloudError("Request timeout when communicating with Shelly Cloud")
        except requests.exceptions.ConnectionError:
            raise ShellyCloudError("Connection error when communicating with Shelly Cloud")
        except requests.exceptions.HTTPError as e:
            raise ShellyCloudError(f"HTTP error from Shelly Cloud: {e}")
        except requests.exceptions.RequestException as e:
            raise ShellyCloudError(f"Request error: {e}")

        # The command succeeded once we get a 2xx; the body is unused. Tolerate
        # an empty/non-JSON body — in requests >= 2.27 a json() failure raises a
        # RequestException subclass, which would otherwise read as a failure and
        # report shelly_ok=False even though the device already toggled.
        try:
            return response.json()
        except ValueError:
            return {}

    def turn_on(self) -> Optional[bool]:
        """Turn on the Shelly device immediately

        This automatically cancels any existing scheduled turn-off operations.
        Used when starting a session session.

        Returns:
            None if not configured, True if successful, False on error
        """
        if not self.enabled:
            return None

        try:
            data = {
                'id': self.device_id,
                'channel': 0,
                'on': True
            }

            result = self._make_request(data)
            logger.info(f"Shelly device {self.device_id} turned ON successfully")
            return True

        except ShellyCloudError as e:
            logger.error(f"Failed to turn ON Shelly device {self.device_id}: {e}")
            return False

    def schedule_turn_off(self, delay_seconds: int = 60) -> Optional[bool]:
        """Schedule the device to turn off after a specified delay

        The device is first turned on, then scheduled to turn off after the delay.
        This is useful for ensuring the device is active during session and then
        automatically turns off when the session ends.

        Args:
            delay_seconds: Seconds to wait before turning off (default: 60)

        Returns:
            None if not configured, True if successful, False on error
        """
        if not self.enabled:
            return None

        try:
            data = {
                'id': self.device_id,
                'channel': 0,
                'on': True,  # Ensure device is on first
                'toggle_after': delay_seconds  # Then schedule turn off
            }

            result = self._make_request(data)
            logger.info(f"Shelly device {self.device_id} scheduled to turn OFF in {delay_seconds} seconds")
            return True

        except ShellyCloudError as e:
            logger.error(f"Failed to schedule turn OFF for Shelly device {self.device_id}: {e}")
            return False


# Convenience functions for use in views
def turn_on_shelly() -> Optional[bool]:
    """Turn on the Shelly device immediately and cancel any timers

    Returns:
        None if not configured, True if successful, False on error
    """
    try:
        client = ShellyCloudClient()
        return client.turn_on()
    except Exception as e:
        logger.error(f"Failed to turn on Shelly device: {e}")
        return None


def schedule_turn_off_shelly(delay_seconds: int = 60) -> Optional[bool]:
    """Schedule the Shelly device to turn off after specified delay

    Returns:
        None if not configured, True if successful, False on error
    """
    try:
        client = ShellyCloudClient()
        return client.schedule_turn_off(delay_seconds)
    except Exception as e:
        logger.error(f"Failed to schedule Shelly device turn off: {e}")
        return None