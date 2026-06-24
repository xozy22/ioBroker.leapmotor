# Steuerbefehle & Action-Specs

Vollständige Referenz der Steuerbefehle des Adapters. Schreibe auf die States unter
`leapmotor.<instanz>.<VIN>.control.*`, um einen Befehl auszulösen.

> **Voraussetzung:** Alle Steuerbefehle benötigen eine konfigurierte **Fahrzeug-PIN**.
>
> ⚠️ Befehle, die mit **(markoceri)** markiert sind, stammen aus
> [markoceri/leapmotor-api](https://github.com/markoceri/leapmotor-api) und sind **noch
> nicht gegen ein echtes Fahrzeug verifiziert**. Mit Vorsicht verwenden.

---

## 1. Steuerbefehle (`<VIN>.control.*`)

### Verifiziert (aus der HA-Integration kerniger/leapmotor-ha)

| State-ID | Typ | Werte | Funktion |
|----------|-----|-------|----------|
| `lock` | boolean | `true`/`false` | Verriegeln / Entriegeln |
| `climate` | boolean | `true`/`false` | Klimatisierung ein/aus |
| `charge_limit` | number | 50–100 (%) | Ladelimit setzen |
| `charging_plan_enabled` | boolean | `true`/`false` | Ladeplan aktivieren/deaktivieren |
| `trunk_open` | button | — | Kofferraum öffnen |
| `trunk_close` | button | — | Kofferraum schließen |
| `find_car` | button | — | Fahrzeug suchen (Hupe/Licht) |
| `windows_open` | button | — | Fenster öffnen |
| `windows_close` | button | — | Fenster schließen |
| `sunshade_open` | button | — | Sonnenrollo öffnen |
| `sunshade_close` | button | — | Sonnenrollo schließen |
| `unlock_charger` | button | — | Ladestecker entriegeln |
| `steering_wheel_heat` | boolean | `true`/`false` | Lenkradheizung ein/aus |
| `mirror_heat` | boolean | `true`/`false` | Spiegelheizung ein/aus |
| `battery_preheat` | boolean | `true`/`false` | Batterievorheizung ein/aus |
| `seat_heat_driver` | number | 0–3 | Sitzheizung Fahrer |
| `seat_heat_passenger` | number | 0–3 | Sitzheizung Beifahrer |
| `seat_ventilation_driver` | number | 0–3 | Sitzbelüftung Fahrer |
| `seat_ventilation_passenger` | number | 0–3 | Sitzbelüftung Beifahrer |
| `quick_cool` | button | — | Schnellkühlung |
| `quick_heat` | button | — | Schnellheizung |
| `windshield_defrost` | button | — | Frontscheibe enteisen |
| `send_destination` | string (JSON) | siehe unten | Navigationsziel ans Auto senden |
| `prepare_car` | string (JSON) | siehe unten | Fahrzeug vorbereiten (Klima/Sitze/Navi) |
| `climate_schedule` | string (JSON) | siehe unten | Klima-Zeitplan setzen |
| `refresh` | button | — | Daten sofort aktualisieren |

### Neu, portiert aus markoceri (⚠️ noch nicht verifiziert)

| State-ID | Typ | Werte | Funktion |
|----------|-----|-------|----------|
| `charging` | boolean | `true`/`false` | Laden starten / stoppen |
| `sentry_mode` | boolean | `true`/`false` | Wächtermodus ein/aus |
| `healthy_charging` | boolean | `true`/`false` | Schonendes Laden ein/aus |
| `on3` | boolean | `true`/`false` | ON3-Modus ein/aus |
| `fuel_heating` | boolean | `true`/`false` | Standheizung ein/aus (EREV) |
| `sunroof_open` | button | — | Schiebedach öffnen |
| `sunroof_close` | button | — | Schiebedach schließen |
| `hotspot` | button | — | WLAN-Hotspot aktivieren |
| `autopark` | button | — | Einparkassistent / Summon |
| `ble_key_restart` | button | — | Bluetooth-Schlüssel neu starten |
| `speed_limit` | number | 0–200 (km/h) | Tempolimit setzen |
| `music` | string | `play`/`pause`/`next`/`previous` | Musik-Steuerung |
| `video` | string | `play`/`pause`/`next`/`previous` | Video-Steuerung |

---

## 2. JSON-Formate der parametrischen Befehle

### `send_destination`

```json
{ "address": "Alexanderplatz 1, Berlin", "addressName": "Alexanderplatz", "latitude": 52.5219, "longitude": 13.4132 }
```

`addressName` ist optional (Standard = `address`).

### `prepare_car`

Leerer String oder `{}` → Standard-Klimavorbereitung. Mit Optionen (alle optional):

```json
{
  "climateEnabled": true,
  "mode": "cold",
  "operate": "manual",
  "temperature": 18,
  "fanSpeed": 7,
  "recirculate": true,
  "windshieldDefrost": false,
  "driverSeat": "heat",
  "driverSeatLevel": 2,
  "passengerSeat": "off",
  "passengerSeatLevel": 3,
  "steeringWheelHeat": false,
  "mirrorHeat": false,
  "destinationName": "Zuhause",
  "destinationAddress": "...",
  "destinationLatitude": 52.5,
  "destinationLongitude": 13.4
}
```

- `mode`: `cold` | `hot` | `nohotcold`
- `temperature`: 18–32, `fanSpeed`: 1–7
- `driverSeat` / `passengerSeat`: `off` | `heat` | `ventilation`, Level 1–3

### `climate_schedule`

```json
{
  "startTime": "2026-06-25T07:30:00",
  "mode": "hot",
  "temperature": 24,
  "fanSpeed": 4,
  "recirculate": false,
  "windshieldDefrost": false,
  "days": [1, 2, 3, 4, 5],
  "enabled": true
}
```

- `days`: Wochentage `0`=Sonntag … `6`=Samstag (leer = einmalig)
- `mode`: `cold` | `hot` | `nohotcold`, `temperature`: 18–32, `fanSpeed`: 1–7

---

## 3. Action-Specs (interne cmd-Zuordnung)

Diese `cmd_id` + `cmd_content` werden tatsächlich ans Fahrzeug gesendet. Für Debugging
und zum Abgleich mit anderen Projekten.

### Verifiziert

| Aktion | cmd_id | cmd_content |
|--------|--------|-------------|
| `unlock` | 110 | `{"value":"unlock"}` |
| `lock` | 110 | `{"value":"lock"}` |
| `unlock_charger` | 192 | `{"operation":"unlock"}` |
| `trunk` / `trunk_open` | 130 | `{"value":"true"}` |
| `trunk_close` | 130 | `{"value":"false"}` |
| `find_car` | 120 | `{"value":"true"}` |
| `sunshade` / `sunshade_open` | 240 | `{"value":"10"}` |
| `sunshade_close` | 240 | `{"value":"0"}` |
| `battery_preheat` | 160 | `{"value":"ptcon"}` |
| `battery_preheat_off` | 160 | `{"value":"ptcoff"}` |
| `steering_wheel_heat_on` | 320 | `{"level":"2"}` |
| `steering_wheel_heat_off` | 320 | `{"level":"1"}` |
| `rearview_mirror_heat_on` | 440 | `{"value":"2"}` |
| `rearview_mirror_heat_off` | 440 | `{"value":"1"}` |
| `seat_heat` | 301 | `{"position":"driver","level":"3"}` |
| `seat_ventilation` | 370 | `{"position":"driver","level":"3"}` |
| `windows` / `windows_open` | 230 | `{"value":"2"}` |
| `windows_close` | 230 | `{"value":"0"}` |
| `ac_switch` / `ac_off` | 170 | `{"operate":"off"}` |
| `ac_on` | 170 | `{"circle":"out","mode":"nohotcold","operate":"manual","position":"all","temperature":"24","windlevel":"4","wshld":"1"}` |
| `quick_cool` | 170 | `{"circle":"in","mode":"cold","operate":"manual","position":"all","temperature":"18","windlevel":"7","wshld":"1"}` |
| `quick_heat` | 170 | `{"circle":"in","mode":"hot","operate":"manual","position":"all","temperature":"32","windlevel":"7","wshld":"1"}` |
| `windshield_defrost` | 170 | `{"circle":"in","mode":"hot","operate":"manual","position":"all","temperature":"32","windlevel":"7","wshld":"2"}` |

> Die parametrischen Befehle `send_destination` (cmd 180), `prepare_car` (cmd 360),
> `climate_schedule` (cmd 171) und `charge_limit` / `charging_plan_enabled` (cmd 190)
> bauen ihren `cmd_content` dynamisch und sind hier nicht als feste Specs gelistet.

### Neu aus markoceri (⚠️ unverifiziert)

| Aktion | cmd_id | cmd_content |
|--------|--------|-------------|
| `charge_start` | 193 | `{"value":"start"}` |
| `charge_stop` | 193 | `{"value":"stop"}` |
| `sentry_mode_on` | 220 | `{"value":"1"}` |
| `sentry_mode_off` | 220 | `{"value":"0"}` |
| `healthy_charging_on` | 480 | `{"value":"1"}` |
| `healthy_charging_off` | 480 | `{"value":"0"}` |
| `on3_on` | 410 | `{"on3":"on"}` |
| `on3_off` | 410 | `{"on3":"off"}` |
| `fuel_heating_on` | 380 | `{"value":"1"}` |
| `fuel_heating_off` | 380 | `{"value":"0"}` |
| `sunroof_open` | 300 | `{"value":"open"}` |
| `sunroof_close` | 300 | `{"value":"close"}` |
| `hotspot` | 140 | `{"value":"findCar"}` |
| `autopark` | 150 | `{"value":"findCar"}` |
| `ble_key_restart` | 430 | `{"value":"restart"}` |
| `speed_limit` | 510 | `{"value":"<km/h>"}` |
| `music` | 270 | `{"operation":"<play\|pause\|next\|previous>"}` |
| `video` | 290 | `{"operation":"<play\|pause\|next\|previous>"}` |

### Bewusst nicht implementiert

Aus Sicherheits-/Komplexitätsgründen ausgelassen: FOTA-Updates (cmd 390/391/392,
benötigen Task-Abfrage), Fernparken `piloted_parking` (cmd 350), Sitzverstellung
`seat_adjust` (cmd 280), C16-Rücksitze `rear_seats` (cmd 470).
