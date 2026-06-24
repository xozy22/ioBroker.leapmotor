'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('chai');

// @iobroker/adapter-core mit einer leeren Basisklasse mocken, damit main.js
// ohne laufenden js-controller geladen werden kann. Es werden nur die reinen
// Prototyp-Hilfsmethoden getestet, keine Adapter-Instanz erzeugt.
const corePath = require.resolve('@iobroker/adapter-core');
require.cache[corePath] = {
    id: corePath,
    filename: corePath,
    loaded: true,
    exports: { Adapter: class MockAdapterBase {} },
};

const { LeapmotorAdapter } = require('../main');
const { STATE_META } = require('../lib/states');

// Minimaler Mock-Kontext mit den von den Hilfsmethoden genutzten Feldern.
function mockCtx(config = {}) {
    return {
        config,
        FORBIDDEN_CHARS: /[\][*,;'"`<>\\?]/g,
        _readStateObject: LeapmotorAdapter.prototype._readStateObject,
        _toStateValue: LeapmotorAdapter.prototype._toStateValue,
        _vinId: LeapmotorAdapter.prototype._vinId,
        _loadManualCert: LeapmotorAdapter.prototype._loadManualCert,
    };
}

describe('main.js Hilfsmethoden', () => {
    it('_toStateValue serialisiert Objekte/Arrays als JSON und reicht Primitive durch', () => {
        const ctx = mockCtx();
        expect(ctx._toStateValue(42)).to.equal(42);
        expect(ctx._toStateValue(true)).to.equal(true);
        expect(ctx._toStateValue('x')).to.equal('x');
        expect(ctx._toStateValue(undefined)).to.equal(null);
        expect(ctx._toStateValue(null)).to.equal(null);
        expect(ctx._toStateValue([1, 2])).to.equal('[1,2]');
        expect(ctx._toStateValue({ a: 1 })).to.equal('{"a":1}');
    });

    it('_readStateObject übernimmt Einheit/Rolle aus STATE_META', () => {
        const ctx = mockCtx();
        const obj = ctx._readStateObject('status', 'battery_percent', 80);
        expect(obj.common.unit).to.equal('%');
        expect(obj.common.role).to.equal('value.battery');
        expect(obj.common.type).to.equal('number');
        expect(obj.common.write).to.equal(false);
        // Sicherstellen, dass die Meta-Definition tatsächlich existiert
        expect(STATE_META['status.battery_percent']).to.be.an('object');
    });

    it('_readStateObject leitet Typ ab, wenn keine Meta vorhanden ist', () => {
        const ctx = mockCtx();
        expect(ctx._readStateObject('raw', '9999', 5).common.type).to.equal('number');
        expect(ctx._readStateObject('raw', '9999', true).common.type).to.equal('boolean');
        expect(ctx._readStateObject('raw', '9999', 'txt').common.type).to.equal('string');
    });

    it('_vinId entfernt unzulässige Zeichen', () => {
        const ctx = mockCtx();
        expect(ctx._vinId('LSA1234567890')).to.equal('LSA1234567890');
        expect(ctx._vinId('AB CD.EF')).to.equal('AB_CD_EF');
    });

    it('_loadManualCert nutzt Inline-PEM bevorzugt', () => {
        const ctx = mockCtx({ appCertPem: 'CERT', appKeyPem: 'KEY' });
        expect(ctx._loadManualCert()).to.deep.equal({ cert: 'CERT', key: 'KEY' });
    });

    it('_loadManualCert liest aus Dateipfaden', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leap-cert-'));
        const certFile = path.join(dir, 'app_cert.pem');
        const keyFile = path.join(dir, 'app_key.pem');
        fs.writeFileSync(certFile, 'FILECERT');
        fs.writeFileSync(keyFile, 'FILEKEY');
        const ctx = mockCtx({ appCertPath: certFile, appKeyPath: keyFile });
        const result = ctx._loadManualCert();
        expect(result.cert).to.equal('FILECERT');
        expect(result.key).to.equal('FILEKEY');
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('_loadManualCert gibt null bei fehlendem Material zurück', () => {
        const ctx = mockCtx({});
        expect(ctx._loadManualCert()).to.equal(null);
    });
});

describe('Cert-Loader', () => {
    const { validateCertPair, DEFAULT_CERT_URL_CRT, DEFAULT_CERT_URL_KEY } = require('../lib/certloader');

    it('validateCertPair wirft bei fehlendem PEM-Zertifikat', () => {
        expect(() => validateCertPair('kein cert', '-----BEGIN PRIVATE KEY-----')).to.throw(/app\.crt/);
    });

    it('validateCertPair wirft bei fehlendem privaten Schlüssel', () => {
        expect(() => validateCertPair('-----BEGIN CERTIFICATE-----', 'kein key')).to.throw(/app\.key/);
    });

    it('Standard-URLs zeigen auf das Community-Repository', () => {
        expect(DEFAULT_CERT_URL_CRT).to.match(/^https:\/\/.*app\.crt$/);
        expect(DEFAULT_CERT_URL_KEY).to.match(/^https:\/\/.*app\.key$/);
    });
});

describe('ABRP-Telemetrie', () => {
    const { buildAbrpTelemetry, DEFAULT_ABRP_API_KEY } = require('../lib/abrp');

    const normalized = {
        status: { battery_percent: 82, remaining_range_km: 310, odometer_km: 12345 },
        location: { latitude: 52.5, longitude: 13.4 },
        charging: { is_charging: true, charging_current_a: -16.5, charging_voltage_v: 230 },
    };

    it('baut eine vollständige Telemetrie mit fixem Zeitstempel', () => {
        const t = buildAbrpTelemetry(normalized, 1700000000000);
        expect(t).to.deep.equal({
            utc: 1700000000,
            soc: 82,
            est_battery_range: 310,
            is_charging: true,
            odometer: 12345,
            speed: 0,
            lat: 52.5,
            lon: 13.4,
            current: -16.5,
            voltage: 230,
        });
    });

    it('lässt Position bei 0/0 oder veralteten Daten weg', () => {
        const t1 = buildAbrpTelemetry({ status: { battery_percent: 50 }, location: { latitude: 0, longitude: 0 }, charging: {} });
        expect(t1).to.not.have.keys('lat', 'lon');
        const t2 = buildAbrpTelemetry({
            status: { battery_percent: 50 },
            location: { latitude: 52, longitude: 13, location_is_stale: true },
            charging: {},
        });
        expect(t2).to.not.have.property('lat');
    });

    it('Standard-API-Key hat das erwartete Format', () => {
        expect(DEFAULT_ABRP_API_KEY).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
});

describe('EVCC-Status', () => {
    const { normalizeVehicle } = require('../lib/normalize');

    function evccFor(signal) {
        return normalizeVehicle({ vehicle: { vin: 'V', car_type: 'C10', is_shared: false, abilities: [] }, status: { data: { signal } }, notifications: {} }, 'u')
            .charging.evcc_status;
    }

    it('mappt Verbindungszustand auf A/B/C', () => {
        // lädt (Strom fließt) -> C
        expect(evccFor({ 1178: -16, 1177: 230, 1200: 30 })).to.equal('C');
        // getrennt -> A
        expect(evccFor({ 1149: 0 })).to.equal('A');
        // eingesteckt, lädt nicht -> B
        expect(evccFor({ 1149: 1 })).to.equal('B');
    });
});

describe('Erweiterte Befehle (markoceri-Parität)', () => {
    const { REMOTE_ACTION_SPECS } = require('../lib/remote');

    it('enthält die neuen Aktions-Specs mit korrekten cmd-IDs', () => {
        expect(REMOTE_ACTION_SPECS.charge_start).to.deep.equal({ cmdId: '193', cmdContent: '{"value":"start"}' });
        expect(REMOTE_ACTION_SPECS.charge_stop.cmdContent).to.equal('{"value":"stop"}');
        expect(REMOTE_ACTION_SPECS.sentry_mode_on).to.deep.equal({ cmdId: '220', cmdContent: '{"value":"1"}' });
        expect(REMOTE_ACTION_SPECS.on3_on).to.deep.equal({ cmdId: '410', cmdContent: '{"on3":"on"}' });
        expect(REMOTE_ACTION_SPECS.sunroof_open).to.deep.equal({ cmdId: '300', cmdContent: '{"value":"open"}' });
        expect(REMOTE_ACTION_SPECS.healthy_charging_off.cmdId).to.equal('480');
    });
});

describe('Erweiterte Lese-Datenpunkte (markoceri-Parität)', () => {
    const { normalizeVehicle } = require('../lib/normalize');
    const n = (signal) =>
        normalizeVehicle(
            { vehicle: { vin: 'V', car_type: 'C10', is_shared: false, abilities: [] }, status: { data: { signal } }, notifications: {} },
            'u',
        );

    it('berechnet vorzeichenbehaftete Batterieleistung (Entladen positiv)', () => {
        expect(n({ 1178: 25, 1177: 380 }).charging.battery_power_kw).to.equal(9.5);
        expect(n({ 1178: -16, 1177: 400 }).charging.battery_power_kw).to.equal(-6.4);
    });

    it('liefert AC-Ladepistole und Reifen-Gesamtstatus', () => {
        expect(n({ 47: 1 }).charging.ac_gun_connected).to.equal(true);
        expect(n({ 2641: 0, 2648: 0, 2655: 0, 2662: 0 }).diagnostics.tire_pressure_all_ok).to.equal(true);
        expect(n({ 2641: 0, 2648: 1, 2655: 0, 2662: 0 }).diagnostics.tire_pressure_all_ok).to.equal(false);
    });
});

describe('Demo-Objekte', () => {
    const P = LeapmotorAdapter.prototype;

    function demoCtx() {
        return {
            objects: 0,
            states: 0,
            knownObjects: new Set(),
            FORBIDDEN_CHARS: /[\][*,;'"`<>\\?]/g,
            log: { debug() {}, info() {}, warn() {}, error() {} },
            async setObjectNotExistsAsync() {
                this.objects++;
            },
            async setStateAsync() {
                this.states++;
            },
            _createDemoObjects: P._createDemoObjects,
            _ensureVehicleObjects: P._ensureVehicleObjects,
            _writeVehicleStates: P._writeVehicleStates,
            _ensureObject: P._ensureObject,
            _readStateObject: P._readStateObject,
            _toStateValue: P._toStateValue,
            _vinId: P._vinId,
        };
    }

    it('legt die komplette Objektstruktur ohne Fahrzeugverbindung an', async () => {
        const ctx = demoCtx();
        const count = await ctx._createDemoObjects();
        expect(count).to.be.greaterThan(100); // viele benannte Datenpunkte
        expect(ctx.states).to.equal(count); // jeder Datenpunkt wird geschrieben
        expect(ctx.objects).to.be.greaterThan(count); // zusätzlich Device + Kanäle + Controls
        // Device + control-Kanal + Steuer-States wurden angelegt
        expect([...ctx.knownObjects]).to.include('DEMO');
        expect([...ctx.knownObjects]).to.include('DEMO.control.lock');
    });
});
