# ioBroker.leapmotor

Inoffizieller ioBroker-Adapter für **Leapmotor-Elektrofahrzeuge** (Leapmotor International, z. B. T03, C10, B10).

Dieser Adapter ist eine Portierung der Home-Assistant-Integration
[kerniger/leapmotor-ha](https://github.com/kerniger/leapmotor-ha) nach Node.js/ioBroker.
Die gesamte API-Logik (Authentifizierung, Krypto, Datennormalisierung, Fernsteuerung)
wurde aus dem Python-Projekt übernommen.

## Funktionen

- **Status**: Batterie, Reichweite (CLTC/WLTP), Kilometerstand, Geschwindigkeit, Gang, Fahrzeugzustand, Verriegelung
- **Standort**: GPS-Position
- **Laden**: Ladestatus, Ladeleistung/-strom/-spannung, Stecker-Status, Ladelimit, Ladeplan, Restladezeit
- **Verlauf**: Gesamtkilometer/-energie, 7-Tage- und Wochenverbrauch, Verbrauchsaufteilung
- **Diagnose**: Türen, Fenster, Kofferraum, Reifendruck, Klimadetails, Sitzheizung/-belüftung, Spiegel-/Lenkradheizung u. v. m.
- **Rohsignale**: alle numerischen Fahrzeugsignale unter `raw.*`
- **Fernsteuerung** (PIN erforderlich): Ver-/Entriegeln, Klima ein/aus, Kofferraum, Fenster, Sonnenrollo, Ladelimit, Ladeplan, Sitz-/Lenkrad-/Spiegelheizung, Batterievorheizung, Schnellkühlung/-heizung, Frontscheibenenteisung, Fahrzeug suchen, Ladestecker entriegeln
- **Mehrere Fahrzeuge** (eigene und geteilte)
- Optionales **Eco-Polling** (seltener abrufen, wenn das Fahrzeug ruht)
- Optionaler **ABRP-Telemetrie-Push** (A Better Routeplanner) für Live-Routenplanung
- **EVCC-Status** (`charging.evcc_status` als A/B/C) für die Einbindung in [evcc](https://evcc.io)

## Voraussetzungen

### App-Zertifikate (zwingend)

Der Login benötigt App-Client-Zertifikatsmaterial (`app.crt` / `app.key`) für die
mTLS-Verbindung. Es handelt sich um App-/Client-Material, **nicht** um deine
persönlichen Kontodaten. Es ist bewusst **nicht** im Adapter enthalten. Drei Wege:

1. **Automatisch laden (Standard, empfohlen):** Im Tab *Zertifikate* die Quelle
   „Automatisch von URL laden" wählen. Der Adapter lädt `app.crt`/`app.key` beim
   Start von einem Community-Repository (Standard:
   [markoceri/leapmotor-certs](https://github.com/markoceri/leapmotor-certs)),
   validiert sie und speichert sie lokal zwischen. Mit dem Button
   *„Zertifikate jetzt laden & testen"* kannst du das sofort prüfen.
   > ⚠️ Dabei wird ein Client-Zertifikat samt privatem Schlüssel von einer
   > **fremden Quelle** geladen. Vertraue nur Quellen, die du kennst – die URL
   > ist konfigurierbar (z. B. ein eigener Fork).
2. **Manuell – PEM-Inhalt:** Quelle „Manuell" wählen und den Inhalt von `app.crt`
   und `app.key` einfügen.
3. **Manuell – Dateipfad:** Pfade zu den Dateien auf dem ioBroker-Host angeben.
   Wenn du bereits die Home-Assistant-Integration nutzt, liegen sie dort unter
   `/config/leapmotor/`.

Dein normaler Leapmotor-Benutzername und das Passwort werden zusätzlich benötigt.
Eine **Fahrzeug-PIN** ist optional und nur für Fernsteuerungsbefehle erforderlich.

### Konto-Empfehlung

Lege am besten ein **zweites Leapmotor-Konto** an, teile dein Fahrzeug in der offiziellen
App dorthin und verwende dieses geteilte Konto im Adapter. Wird dasselbe Konto gleichzeitig
in der App und im Adapter genutzt, kann die App dich ausloggen.

## Installation

Da der Adapter (noch) nicht im offiziellen ioBroker-Repo ist, per GitHub/lokal installieren:

1. Im ioBroker-Admin unter **Adapter** auf **Aus eigener URL / npm installieren** (Katze/Expertenmodus).
2. Das GitHub-Repository angeben:
   ```
   https://github.com/xozy22/ioBroker.leapmotor
   ```
   Bei einem **privaten** Repository wird ein Personal Access Token in die URL eingefügt:
   ```
   https://<TOKEN>@github.com/xozy22/ioBroker.leapmotor/tarball/main
   ```
   oder lokal aus diesem Verzeichnis:
   ```
   cd /opt/iobroker
   npm install /pfad/zu/iobroker.leapmotor
   iobroker add leapmotor
   ```
3. Eine Adapter-Instanz anlegen.

## Konfiguration

| Tab | Feld | Beschreibung |
|-----|------|--------------|
| Anmeldung | E-Mail / Passwort | Leapmotor-Kontodaten |
| Anmeldung | Fahrzeug-PIN | Optional, nur für Steuerbefehle |
| Zertifikate | Zertifikatsquelle | „Automatisch von URL laden" (Standard) **oder** „Manuell" |
| Zertifikate | URL zu app.crt / app.key | Bei Auto-Quelle; Standard: markoceri/leapmotor-certs |
| Zertifikate | Zertifikate jetzt laden & testen | Button: lädt und validiert sofort |
| Zertifikate | app.crt / app.key (PEM oder Pfad) | Nur bei manueller Quelle |
| Zertifikate | Account-Zertifikatspasswort | Optional, wird sonst automatisch abgeleitet |
| Abruf | Abrufintervall | Standard 5 Minuten |
| Abruf | Eco-Polling | Seltener abrufen, wenn das Fahrzeug ruht |
| Erweitert | Basis-URL / Sprache / App-Version / Device-ID | Normalerweise unverändert lassen |

Die Felder Passwort, PIN und Zertifikatsinhalte werden in der ioBroker-Datenbank verschlüsselt abgelegt.

## Vorab testen (empfohlen)

Bevor du den Adapter in ioBroker einrichtest, kannst du die komplette API-Kette
gegen die echte Leapmotor-Cloud testen:

```bash
cd iobroker.leapmotor
npm install
cp test/credentials.example.json test/credentials.json
# test/credentials.json mit deinen Daten + Zertifikatspfaden füllen
node test/smoke.js
```

Das Skript meldet sich an, ruft alle Fahrzeuge ab und gibt die wichtigsten Werte aus.
`test/credentials.json` ist per `.gitignore` ausgeschlossen.

## Objektstruktur

Pro Fahrzeug wird ein Gerät `leapmotor.<instanz>.<VIN>` mit folgenden Kanälen angelegt:

```
<VIN>.vehicle.*          Stammdaten (Modell, Spitzname, ...)
<VIN>.status.*           Batterie, Reichweite, Kilometerstand, Verriegelung, ...
<VIN>.location.*         GPS
<VIN>.charging.*         Ladestatus und -plan
<VIN>.history.*          Verbrauchs-/Kilometerverlauf
<VIN>.charging_history.* Letzte Ladevorgänge
<VIN>.media.*            Fahrzeugbild-Metadaten
<VIN>.diagnostics.*      Türen, Fenster, Reifendruck, Klima, Sitze, ...
<VIN>.raw.*              Alle numerischen Rohsignale
<VIN>.notifications.*    Konto-Benachrichtigungen
<VIN>.abrp.*             Ergebnis des ABRP-Telemetrie-Push (falls aktiviert)
<VIN>.control.*          Schreibbare Steuerbefehle
```

Hinweise:
- `charging.evcc_status` liefert den Ladezustand als EVCC-Buchstabe (A = getrennt,
  B = verbunden, C = lädt) – direkt in evcc als `charge status` nutzbar.
- ABRP wird im Tab *ABRP / EVCC* aktiviert (ABRP-Token erforderlich, im ABRP-Konto
  ein Fahrzeug vom Typ „Generic" anlegen).

### Steuerbefehle

> 📋 Vollständige Referenz inkl. cmd-IDs und JSON-Formaten: **[docs/commands.md](docs/commands.md)**

Schreibe auf die States unter `<VIN>.control.*`:

**Verifiziert (aus der Original-HA-Integration):**
- `lock` (bool): `true` = verriegeln, `false` = entriegeln
- `climate` (bool): Klima ein/aus
- `charge_limit` (Zahl 50–100): Ladelimit in %
- `charging_plan_enabled` (bool): Ladeplan aktivieren
- `trunk_open` / `trunk_close`, `windows_open` / `windows_close`, `sunshade_open` / `sunshade_close` (Buttons)
- `find_car`, `unlock_charger`, `quick_cool`, `quick_heat`, `windshield_defrost` (Buttons)
- `steering_wheel_heat`, `mirror_heat`, `battery_preheat` (bool)
- `seat_heat_driver` / `seat_heat_passenger`, `seat_ventilation_driver` / `seat_ventilation_passenger` (0–3)
- `send_destination`, `prepare_car`, `climate_schedule` (JSON-String, siehe State-Beschreibung)
- `refresh` (Button): sofortige Aktualisierung

**Zusätzlich (portiert aus [markoceri/leapmotor-api](https://github.com/markoceri/leapmotor-api), ⚠️ noch nicht am Fahrzeug verifiziert):**
- `charging` (bool): Laden starten/stoppen
- `sentry_mode` (bool): Wächtermodus
- `healthy_charging` (bool): schonendes Laden
- `on3` (bool), `fuel_heating` (bool, EREV)
- `sunroof_open` / `sunroof_close` (echtes Schiebedach, Buttons)
- `hotspot`, `autopark`, `ble_key_restart` (Buttons)
- `speed_limit` (km/h), `music` / `video` (`play`/`pause`/`next`/`previous`)

> Steuerbefehle benötigen eine konfigurierte Fahrzeug-PIN.
> Die zusätzlichen Befehle stammen aus einem zweiten Community-Projekt und sind noch
> nicht gegen ein echtes Fahrzeug getestet – mit Vorsicht verwenden und Rückmeldung willkommen.

## Wichtige Hinweise

- Inoffizielles Projekt, **nicht** von Leapmotor unterstützt oder freigegeben.
- Nutzung auf eigene Gefahr. Keine Haftung für Kontosperren, API-Änderungen, fehlgeschlagene
  Befehle oder Fahrzeug-Nebenwirkungen.
- Fernsteuerungsbefehle nur bewusst und bei sicherem Fahrzeugzustand verwenden.
- Leapmotor kann die API jederzeit ändern.

## Credits

- Ursprüngliche Home-Assistant-Integration und gesamte API-Recherche:
  [kerniger/leapmotor-ha](https://github.com/kerniger/leapmotor-ha)

## Lizenz

MIT – siehe [LICENSE](LICENSE).
