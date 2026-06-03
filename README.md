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

### Settings

Lista käytettävissä olevista Settings-avaimista:

- `shelly_cloud_server`: Shelly Cloud -palvelimen URL
- `shelly_cloud_key`: Shelly Cloud API-avain
- `shelly_cloud_device`: Shelly-laitteen ID
- `pin_lockout_threshold`: Kokonaisluku, joka määrittää, kuinka monen peräkkäisen väärän PIN-koodin syöttämisen jälkeen piikki lukitaan. Jos avain on asettamatta, lukitus on pois käytöstä.

## Shelly

Shellyn pistorasian saa kytkemään virrat automaattisesti kytkeytymään päälle ja pois täyttämällä Settings-avaimet `shelly_cloud_server`, `shelly_cloud_key` ja `shelly_cloud_device`.

## PIN-koodit

Yksittäisen piikin (Tab) voi suojata 6-numeroisella PIN-koodilla. Ylläpitäjä asettaa hallintanäkymästä piikille kentät `pin` (6 numeroa) ja `pin_required`. Kun `pin_required` on päällä, käyttäjänäkymä näyttää oston vahvistuspainikkeen sijaan numeronäppäimistön: oikean PIN-koodin syöttäminen kirjaa oston (äänellä ja kuittauksella kuten painikkeella), väärä koodi tyhjentää syötteen.

PIN-koodi tarkistetaan aina palvelimella oston yhteydessä, eikä sitä lähetetä selaimeen. Väärät yritykset lasketaan piikin kenttään `pin_attempts`, joka näytetään käyttäjälle ja nollautuu oikean koodin syöttämisestä.

Liian monen väärän yrityksen jälkeen piikki voidaan lukita. Lukituksen raja määritellään Settings-avaimella `pin_lockout_threshold` (kokonaisluku). Kun `pin_attempts` saavuttaa rajan, piikki lukittuu eikä ostoja voi kirjata ennen kuin ylläpitäjä nollaa `pin_attempts`-kentän (esim. hallintanäkymän "Reset PIN attempts (unlock)" -toiminnolla). Jos avain on asettamatta, tyhjä tai ei-numeerinen, lukitus on pois käytöstä.
