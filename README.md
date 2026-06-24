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

Kun selainpuolen tiedostot (esim. `app.js`, `offline.js`, `styles.css` tai `index.html`) muuttuvat, kasvata service workerin `CACHE_VERSION`-vakiota tiedostossa `api/static/sw.js`. Muuten käyttäjien laitteet jatkavat vanhojen, välimuistissa olevien tiedostojen käyttöä. Versionumeron muuttuessa sovellus näyttää "Uusi versio saatavilla" -ilmoituksen.

## Käyttö

Sovellusta käytetään käyttäjänäkymän kautta yhteisellä laitteella, kuten tabletilla. Yhteislaitteella on oma käyttäjätunnus (User), jonka kautta voidaan kirjata myynnit ja kerhotilan käyttökirjaukset mille tahansa käyttäjälle (Tab). Tarkoituksena on, että yhteislaitteella ei kirjauduta ulos käyttökertojen välissä, vaan kirjautuminen säilyy evästeessä nopean käytön mahdollistamiseksi.

Ylläpitäjä voi omalla tunnuksellaan hallintanäkymästä tarkastella myyntejä, kerhotilan käyttöä ja hallinnoida tuotteita, käyttäjiä ja tilitietoja. Tab adjustments -sivulta voidaan nostaa tai laskea halutun käyttäjän piikin saldoa.

Järjestelmä on suunniteltu siten, että kaikki tilisaldon muutokset ovat jäljitettävissä tapahtumaan, jolloin pystytään seuraamaan käyttäjien piikkien saldojen historiallisia muutoksia jälkikäteen.

## Offline-tila

Käyttäjänäkymä on progressiivinen web-sovellus (PWA), joka toimii myös ilman jatkuvaa verkkoyhteyttä.

- **Puskurointi:** Offline-tilassa ostot sekä hostauksen aloitus ja lopetus tallentuvat selaimen `localStorage`-jonoon ja synkronoidaan palvelimelle, kun yhteys palaa. Tuote- ja piikkilistat sekä aktiivinen hostaus näytetään välimuistista.
- **Offline-painike:** Yhteyden katketessa tilastopainike korvautuu punaisella offline-painikkeella. Painike avaa paneelin, jossa näkyvät jonossa olevat toiminnot, viimeisin palvelinyhteys ja "Synkronoi"-painike.
- **Pysyvyys:** Offline-tila pysyy päällä, kunnes kaikki jonossa olevat toiminnot on synkronoitu — myös sivun uudelleenlatauksen yli. Yhteys tarkistetaan taustalla ja synkronointi käynnistyy automaattisesti yhteyden palatessa; lisäksi sen voi käynnistää käsin.
- **Idempotenssi:** Jokainen puskuroitu toiminto saa oman `client_uuid`-tunnisteen, joten palvelin ei kirjaa samaa ostoa tai hostausta kahdesti, vaikka synkronointi yritettäisiin uudelleen.
- **Aikaleimat:** Ostot kirjataan todelliseen tapahtuma-aikaan (`occurred_at`), ei synkronointihetkeen, jotta tilastot ja suositukset pysyvät oikein. `created_at` säilyy palvelimen kirjaushetkenä.
- **Rajoitukset offline-tilassa:** PIN-suojattuja piikkejä ei voi käyttää (PIN tarkistetaan vain palvelimella) eikä tilastonäkymää voi avata. Shelly-laitetta ei ohjata jälkikäteen synkronoiduista hostauksista.
- **Epäonnistuneet synkronoinnit:** Palvelimen hylkäämät (4xx) toiminnot merkitään virheellisiksi ja ne voi poistaa jonosta yksitellen; tilapäiset verkkovirheet yritetään automaattisesti uudelleen.
- **Service worker:** `api/static/sw.js` tarjoilee sovelluksen myös offline-tilassa ja huolehtii automaattisista päivityksistä (ks. `CACHE_VERSION` yllä).

### Settings

Lista käytettävissä olevista Settings-avaimista:

- `shelly_cloud_server`: Shelly Cloud -palvelimen URL
- `shelly_cloud_key`: Shelly Cloud API-avain
- `shelly_cloud_device`: Shelly-laitteen ID
- `pin_lockout_threshold`: Kokonaisluku, joka määrittää, kuinka monen peräkkäisen väärän PIN-koodin syöttämisen jälkeen piikki lukitaan. Jos avain on asettamatta, lukitus on pois käytöstä.
- `cash_enabled`: Kun arvo on tosi (`true`/`1`/`yes`/`on`), kassanäkymään tulee tuotteille kolmas määräkenttä "Käteinen". Ks. [Käteinen](#käteinen).

## Varastonseuranta

Tuotteille voi asettaa hallintanäkymästä valinnaiset kentät `stock_quantity` (varastosaldo) ja `low_stock_threshold` (hälytysraja). Kun kumpikin on asetettu ja saldo on raja-arvossa tai sen alle, tuote näkyy hallinnan etusivun "Low stock" -listalla. Jokainen osto vähentää `stock_quantity`-saldoa ostetulla määrällä (myös käteismyynnit) ja oston poistaminen hallintanäkymästä palauttaa määrän saldoon. Saldo voi mennä negatiiviseksi eikä se koskaan estä ostoa. Boolean-kenttä `in_stock` on edelleen erillinen, käsin asetettava lippu eikä varastonseuranta vaikuta siihen.

Tuotteiden saldoja ja rajoja voi muokata joukkona hallinnan sivulla Products → "Manage quantities", jossa tuotteet on ryhmitelty kategorioittain aakkosjärjestyksessä.

## Käteinen

Kun Settings-avain `cash_enabled` on päällä, kassanäkymässä näkyy tuotteille kolmas määräkenttä "Käteinen" ilman hintaa (myyjä hinnoittelee käteismyynnin sisään-/uloshintojen perusteella). Käteismyynnit kirjataan järjestelmään aina hintaan 0,00 €, koska raha liikkuu sovelluksen ulkopuolella — ne eivät siis muuta piikin saldoa, mutta vähentävät varastosaldoa ja näkyvät myydyissä määrissä.

## Shelly

Shellyn pistorasian saa kytkemään virrat automaattisesti kytkeytymään päälle ja pois täyttämällä Settings-avaimet `shelly_cloud_server`, `shelly_cloud_key` ja `shelly_cloud_device`.

## PIN-koodit

Yksittäisen piikin (Tab) voi suojata 6-numeroisella PIN-koodilla. Ylläpitäjä asettaa hallintanäkymästä piikille kentät `pin` (6 numeroa) ja `pin_required`. Kun `pin_required` on päällä, käyttäjänäkymä näyttää oston vahvistuspainikkeen painamisen jälkeen numeronäppäimistön: oikean PIN-koodin syöttäminen kirjaa oston (äänellä ja kuittauksella kuten painikkeella), väärä koodi tyhjentää syötteen.

PIN-koodi tarkistetaan aina palvelimella oston yhteydessä, eikä sitä lähetetä selaimeen. Väärät yritykset lasketaan piikin kenttään `pin_attempts`, joka näytetään käyttäjälle ja nollautuu oikean koodin syöttämisestä.

Käyttäjä voi kytkeä piikin PIN-koodin päälle ja pois, mutta vain ylläpitäjä voi asettaa tai muuttaa PIN-koodeja.

Liian monen väärän yrityksen jälkeen piikki voidaan lukita. Lukituksen raja määritellään Settings-avaimella `pin_lockout_threshold` (kokonaisluku). Kun `pin_attempts` saavuttaa rajan, piikki lukittuu eikä ostoja voi kirjata ennen kuin ylläpitäjä nollaa `pin_attempts`-kentän (esim. hallintanäkymän "Reset PIN attempts (unlock)" -toiminnolla). Jos avain on asettamatta, tyhjä tai ei-numeerinen, lukitus on pois käytöstä.
