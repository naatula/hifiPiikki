# hifiPiikki

hifiPiikki on verkkosovellus tuotteiden myyntiin kerhoille ja yhdistyksille. Myynnit kirjataan aina tietyn käyttäjän piikkiin ja hallintanäkymä mahdollistaa myyntien tarkastelun ja raportoinnin. Sovellus tukee kahta hintaa tuotteille, jäsenhinta ja normaalihinta. Lisäksi sovellus sisältää helppokäyttöisen kerhotilan käytön seurannan. Sovellus on toteutettu Django-webkehystä ja SQLite-tietokantaa käyttäen.

## Asennusohjeet

    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    python manage.py migrate
    python manage.py createsuperuser

## Kehitysympäristö

Kopioi `.env.example` tiedostoksi `.env` ja käynnistä Djangon kehityspalvelin:

    cp .env.example .env
    source venv/bin/activate
    python manage.py runserver

[Käyttäjänäkymä](http://localhost:8000/static/index.html)

[Hallinta](http://localhost:8000/admin/)



## Tuotantokäyttö

    source venv/bin/activate
    python manage.py migrate
    python manage.py collectstatic --noinput
    gunicorn --bind 127.0.0.1:9000 hifiPiikki.wsgi

Vaihda IP (127.0.0.1:9000) tarpeen mukaan

## Käyttö

Sovellusta käytetään käyttäjänäkymän kautta yhteisellä laitteella, kuten tabletilla. Yhteislaitteella on oma käyttäjätunnus (User), jonka kautta voidaan kirjata myynnit ja kerhotilan käyttökirjaukset mille tahansa käyttäjälle (Tab). Tarkoituksena on, että yhteislaitteella ei kirjauduta ulos käyttökertojen välissä, vaan kirjautuminen säilyy evästeessä nopean käytön mahdollistamiseksi.

Ylläpitäjä voi omalla tunnuksellaan hallintanäkymästä tarkastella myyntejä, kerhotilan käyttöä ja hallinnoida tuotteita, käyttäjiä ja tilitietoja. Tab adjustments -sivulta voidaan nostaa tai laskea halutun käyttäjän piikin saldoa.

Järjestelmä on suunniteltu siten, että kaikki tilisaldon muutokset ovat jäljitettävissä tapahtumaan, jolloin pystytään seuraamaan käyttäjien piikkien saldojen historiallisia muutoksia jälkikäteen.


## Shelly

Shellyn pistorasian saa kytkemään virrat automaattisesti kytkeytymään päälle ja pois täyttämällä Settings-avaimet `shelly_cloud_server`, `shelly_cloud_key` ja `shelly_cloud_device`.
