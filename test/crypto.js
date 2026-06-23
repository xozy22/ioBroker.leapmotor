'use strict';

const { expect } = require('chai');
const { deriveAccountP12Password } = require('../lib/sm4');
const { deriveOperpwdKeyIv, deriveSessionDeviceId, deriveSignKey } = require('../lib/crypto');
const { normalizeVehicle, isCharging, isLocked } = require('../lib/normalize');

// Referenzwerte wurden 1:1 gegen die Python-Implementierung des HA-Projekts
// (p12.py / crypto.py) verifiziert.
const TOKEN =
    'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX25hbWUiOiAiYWNjLHJvbGUsREVWMUNFNzg5MGFiY2RlZix4In0.' +
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('Krypto (verifiziert gegen Python-Referenz)', () => {
    it('deriveAccountP12Password (SM4) erzeugt identische Passwörter', () => {
        expect(deriveAccountP12Password('1234567', '0a1b2c3d4e5f60718293')).to.equal('/Qaey62qYGF0+6z');
        expect(deriveAccountP12Password(987654321, 'ZZZZ1111aaaa2222bbbb')).to.equal('RbSjimc0mJdEcMa');
    });

    it('deriveOperpwdKeyIv leitet Schlüssel/IV aus dem Token ab', () => {
        expect(deriveOperpwdKeyIv(TOKEN)).to.deep.equal(['45c4984e17859a3d', '1e391e6664fe989c']);
        expect(deriveOperpwdKeyIv(null)).to.deep.equal(['f1cf0c025baec0e2', '6b6a1fe94e133fd7']);
    });

    it('deriveSignKey (HKDF-SHA256) erzeugt den erwarteten Schlüssel', () => {
        expect(deriveSignKey('my-ikm-value', 'my-salt-value', 'my-info-value').toString('hex')).to.equal(
            'ec08df7b0239c32fe21d3705c4048e40e0dfe256fa683efdaf448730ec58f8e6',
        );
    });

    it('deriveSessionDeviceId liest die deviceId aus dem JWT', () => {
        expect(deriveSessionDeviceId(TOKEN)).to.equal('DEV1CE7890abcdef');
        expect(deriveSessionDeviceId(null, 'fallback')).to.equal('fallback');
    });
});

describe('Normalisierung', () => {
    const bundle = {
        vehicle: { vin: 'LSA1234567890', car_id: '42', car_type: 'C10', nickname: 'Auto', is_shared: false, year: 2024, abilities: [] },
        status: { data: { signal: { 1204: 82, 3260: 310, 1318: 12345, 1298: 1, 1010: 0, 1178: -16.5, 1177: 230, 1200: 45, 2646: 245 } } },
        notifications: { unread_count: 0 },
    };

    it('interpretiert Batterie, Verriegelung und Laden korrekt', () => {
        const n = normalizeVehicle(bundle, 'u');
        expect(n.status.battery_percent).to.equal(82);
        expect(n.status.is_locked).to.equal(true);
        expect(n.status.vehicle_state).to.equal('parked');
        expect(n.charging.is_charging).to.equal(true);
        expect(n.charging.charging_power_kw).to.equal(3.8);
        expect(n.diagnostics.tire_pressure_front_left_bar).to.equal(2.45);
    });

    it('isCharging/isLocked reagieren auf Signalwerte', () => {
        expect(isLocked({ 1298: 0 })).to.equal(false);
        expect(isCharging({ 1178: -0.2 })).to.equal(false);
    });
});
