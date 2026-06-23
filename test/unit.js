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
