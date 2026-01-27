# hifiPiikki

hifiPiikki on verkkosovellus tuotteiden myyntiin kerhoille ja yhdistyksille. Myynnit kirjataan aina tietyn käyttäjän piikkiin ja hallintanäkymä mahdollistaa myyntien tarkastelun ja raportoinnin. Sovellus tukee kahta hintaa tuotteille, jäsenhinta ja normaalihinta. Lisäksi sovellus sisältää helppokäyttöisen kerhotilan käytön seurannan. Sovellus on toteutettu Django-webkehystä ja SQLite-tietokantaa käyttäen.

## Asennusohjeet

    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    python manage.py migrate
    python manage.py createsuperuser
    python manage.py runserver

## Suorittaminen

    source venv/bin/activate
    gunicorn --bind 172.17.0.1:9000 hifiPiikki.wsgi
Vaihda IP (172.17.0.1:9000) tarpeen mukaan

## Shelly

Shellyn pistorasian saa kytkemään virrat automaattisesti kytkeytymään päälle ja pois täyttämällä Settings-avaimet `shelly_cloud_server`, `shelly_cloud_key` ja `shelly_cloud_device`.