# hifiPiikki

hifiPiikki on verkkosovellus tuotteiden myyntiin kerhoille ja yhdistyksille. Myynnit kirjataan aina tietyn käyttäjän piikkiin ja hallintanäkymä mahdollistaa myyntien tarkastelun ja raportoinnin. Sovellus tukee kahta hintaa tuotteille, jäsenhinta ja normaalihinta. Lisäksi sovellus sisältää helppokäyttöisen kerhotilan käytön seurannan. Sovellus on toteutettu Django-webkehystä ja SQLite-tietokantaa käyttäen.

## Asennusohjeet

    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    python manage.py migrate
    python manage.py createsuperuser
    python manage.py runserver
