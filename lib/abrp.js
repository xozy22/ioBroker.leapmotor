'use strict';

/**
 * ABRP-Telemetrie-Push (A Better Routeplanner, Generic Telemetry).
 * Portiert aus custom_components/leapmotor/abrp.py des HA-Projekts.
 *
 * Sendet bei aktivierter Konfiguration nach jedem Abruf Fahrzeug-Telemetrie
 * (Ladezustand, Position, Lade-Strom/-Spannung, ...) an ABRP, damit die
 * Routenplanung mit echten Live-Werten rechnet.
 */

const https = require('https');
const { URL } = require('url');

const ABRP_TELEMETRY_URL = 'https://api.iternio.com/1/tlm/send';
const ABRP_TIMEOUT_MS = 10000;

// API-Key der Integration (identifiziert die App gegenüber ABRP, nicht nutzerspezifisch).
const DEFAULT_ABRP_API_KEY = ['7310445a', '-0947', '-4adc', '-82f5', '-29bb882c5926'].join('');

function toFloat(value) {
    if (value == null) {
        return null;
    }
    const n = parseFloat(value);
    return Number.isNaN(n) ? null : n;
}

/**
 * Baut eine ABRP-Generic-Telemetrie aus normalisierten Fahrzeugdaten.
 *
 * @param {object} normalized - Ergebnis von normalizeVehicle
 * @param {number} nowMs - aktueller Zeitstempel in ms (für Reproduzierbarkeit injizierbar)
 * @returns {object}
 */
function buildAbrpTelemetry(normalized, nowMs = Date.now()) {
    const status = normalized.status || {};
    const location = normalized.location || {};
    const charging = normalized.charging || {};

    const telemetry = {
        utc: Math.floor(nowMs / 1000),
        soc: toFloat(status.battery_percent),
        est_battery_range: toFloat(status.remaining_range_km),
        is_charging: Boolean(charging.is_charging),
        odometer: toFloat(status.odometer_km),
        speed: 0,
    };

    const lat = toFloat(location.latitude);
    const lon = toFloat(location.longitude);
    if (lat != null && lon != null && !(lat === 0 && lon === 0) && !location.location_is_stale) {
        telemetry.lat = lat;
        telemetry.lon = lon;
    }

    const current = toFloat(charging.charging_current_a);
    const voltage = toFloat(charging.charging_voltage_v);
    if (current != null) {
        telemetry.current = current;
    }
    if (voltage != null) {
        telemetry.voltage = voltage;
    }

    // None-Werte entfernen (is_charging/speed bleiben als false/0 erhalten)
    const result = {};
    for (const [key, value] of Object.entries(telemetry)) {
        if (value != null) {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Sendet eine Telemetrie-Probe an ABRP.
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.token
 * @param {object} opts.telemetry
 * @returns {Promise<{httpStatus:number, status:string, missing:*, response:object}>}
 */
function sendAbrpTelemetry({ apiKey, token, telemetry }) {
    return new Promise((resolve, reject) => {
        if (!apiKey || !apiKey.trim() || !token || !token.trim()) {
            reject(new Error('ABRP API-Key und Token sind erforderlich.'));
            return;
        }
        if (telemetry.soc == null) {
            reject(new Error('ABRP-Telemetrie benötigt einen Ladezustand (soc).'));
            return;
        }

        const url = new URL(ABRP_TELEMETRY_URL);
        url.searchParams.set('api_key', apiKey.trim());
        url.searchParams.set('token', token.trim());
        url.searchParams.set('tlm', JSON.stringify(telemetry));

        const req = https.request(
            {
                method: 'POST',
                hostname: url.hostname,
                path: url.pathname + url.search,
                headers: { 'User-Agent': 'iobroker.leapmotor', 'Content-Length': 0 },
                timeout: ABRP_TIMEOUT_MS,
            },
            res => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf-8');
                    let payload;
                    try {
                        payload = JSON.parse(text);
                    } catch {
                        reject(new Error(`Ungültige ABRP-Antwort: HTTP ${res.statusCode} ${text.slice(0, 200)}`));
                        return;
                    }
                    if ((res.statusCode || 0) >= 400 || payload.status !== 'ok') {
                        reject(
                            new Error(
                                `ABRP hat die Telemetrie abgelehnt: HTTP ${res.statusCode} ${text.slice(0, 200)}`,
                            ),
                        );
                        return;
                    }
                    resolve({
                        httpStatus: res.statusCode || 0,
                        status: payload.status,
                        missing: payload.missing,
                        response: payload,
                    });
                });
            },
        );
        req.on('error', err => reject(new Error(`ABRP-Anfrage fehlgeschlagen: ${err.message}`)));
        req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung bei der ABRP-Anfrage')));
        req.end();
    });
}

module.exports = {
    buildAbrpTelemetry,
    sendAbrpTelemetry,
    DEFAULT_ABRP_API_KEY,
    ABRP_TELEMETRY_URL,
};
