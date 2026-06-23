'use strict';

/**
 * Standalone-Smoke-Test gegen die echte Leapmotor-API.
 *
 * Testet die gesamte API-Kette (Krypto, mTLS, Login, P12-Entschlüsselung,
 * Signaturen, Datenabruf, Normalisierung) OHNE eine laufende ioBroker-Instanz.
 *
 * Verwendung:
 *   1. test/credentials.json anlegen (Vorlage: test/credentials.example.json)
 *   2. node test/smoke.js
 *
 * Alternativ über Umgebungsvariablen:
 *   LEAP_EMAIL, LEAP_PASSWORD, LEAP_PIN, LEAP_APP_CERT, LEAP_APP_KEY,
 *   LEAP_P12_PASSWORD (optional)
 */

const fs = require('fs');
const path = require('path');
const { LeapmotorApiClient } = require('../lib/api');
const { normalizeVehicle } = require('../lib/normalize');

function loadConfig() {
    const file = path.join(__dirname, 'credentials.json');
    let cfg = {};
    if (fs.existsSync(file)) {
        cfg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
    const get = (key, env) => process.env[env] || cfg[key];
    const config = {
        email: get('email', 'LEAP_EMAIL'),
        password: get('password', 'LEAP_PASSWORD'),
        vehiclePin: get('vehiclePin', 'LEAP_PIN'),
        appCertPath: get('appCertPath', 'LEAP_APP_CERT'),
        appKeyPath: get('appKeyPath', 'LEAP_APP_KEY'),
        accountP12Password: get('accountP12Password', 'LEAP_P12_PASSWORD'),
        appCertPem: cfg.appCertPem,
        appKeyPem: cfg.appKeyPem,
    };
    return config;
}

function loadStaticCert(config) {
    let cert = config.appCertPem || null;
    let key = config.appKeyPem || null;
    if (!cert && config.appCertPath) cert = fs.readFileSync(config.appCertPath, 'utf-8');
    if (!key && config.appKeyPath) key = fs.readFileSync(config.appKeyPath, 'utf-8');
    if (!cert || !key) {
        throw new Error(
            'app_cert.pem / app_key.pem fehlen. Bitte in test/credentials.json (appCertPath/appKeyPath) oder per Umgebungsvariable angeben.',
        );
    }
    return { cert, key };
}

async function main() {
    const config = loadConfig();
    if (!config.email || !config.password) {
        console.error('FEHLER: E-Mail/Passwort fehlen. Siehe test/credentials.example.json.');
        process.exit(1);
    }

    let staticCert;
    try {
        staticCert = loadStaticCert(config);
    } catch (err) {
        console.error(`FEHLER: ${err.message}`);
        process.exit(1);
    }

    const client = new LeapmotorApiClient({
        username: config.email,
        password: config.password,
        operationPassword: config.vehiclePin || null,
        accountP12Password: config.accountP12Password || null,
        staticCert,
        logger: {
            debug: (m) => process.env.DEBUG && console.log('[debug]', m),
            info: (m) => console.log('[info]', m),
            warn: (m) => console.warn('[warn]', m),
            error: (m) => console.error('[error]', m),
        },
    });

    try {
        console.log('--- Login ---');
        await client.login();
        console.log('Login OK. userId =', client.userId);
        console.log('Account-P12-Passwortquelle:', client.accountP12PasswordSource);
        console.log('Session deviceId:', client.deviceId);

        console.log('\n--- Datenabruf ---');
        const data = await client.fetchData();
        const vins = Object.keys(data.vehicles);
        console.log(`Gefundene Fahrzeuge: ${vins.length}`);

        for (const vin of vins) {
            const n = normalizeVehicle(data.vehicles[vin], data.user_id);
            console.log(`\n=== ${n.vehicle.nickname || vin} (${vin}) ===`);
            console.log('  Modell:        ', n.vehicle.car_type);
            console.log('  Batterie:      ', n.status.battery_percent, '%');
            console.log('  Reichweite:    ', n.status.remaining_range_km, 'km');
            console.log('  Kilometerstand:', n.status.odometer_km, 'km');
            console.log('  Zustand:       ', n.status.vehicle_state);
            console.log('  Verriegelt:    ', n.status.is_locked);
            console.log('  Lädt:          ', n.charging.is_charging, `(${n.charging.connection_state})`);
            if (n.charging.is_charging) {
                console.log('  Ladeleistung:  ', n.charging.charging_power_kw, 'kW');
            }
            console.log('  Standort:      ', n.location.latitude, n.location.longitude);
            console.log('  Reifendruck VL:', n.diagnostics.tire_pressure_front_left_bar, 'bar');
            console.log('  Rohsignale:    ', Object.keys(n.raw).length);
        }
        console.log('\nSmoke-Test erfolgreich abgeschlossen.');
    } catch (err) {
        console.error('\nSMOKE-TEST FEHLGESCHLAGEN:', err.message);
        if (process.env.DEBUG) console.error(err.stack);
        process.exit(1);
    }
}

main();
