'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { expect } = require('chai');

// Validiert admin/jsonConfig.json gegen das offizielle ioBroker-Schema.
// So werden Konfigurationsfehler (z. B. falsche Attribute) erkannt, bevor sie
// im Admin die gesamte Oberfläche blockieren. Der Test überspringt sich selbst,
// wenn das Schema nicht geladen werden kann (kein Netz) oder ajv fehlt.

const SCHEMA_URL =
    'https://raw.githubusercontent.com/ioBroker/ioBroker.admin/master/packages/jsonConfig/schemas/jsonConfig.json';

function fetchJson(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, res => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
            }
            let d = '';
            res.on('data', c => (d += c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(d));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    });
}

describe('admin/jsonConfig.json Schema-Validierung', function () {
    this.timeout(25000);
    let schema;
    let Ajv;

    before(async function () {
        try {
            Ajv = require('ajv').default || require('ajv');
        } catch {
            this.skip();
        }
        try {
            schema = await fetchJson(SCHEMA_URL, 15000);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn(`      (Schema nicht ladbar – Test übersprungen: ${e.message})`);
            this.skip();
        }
    });

    it('ist gültig gegen das offizielle ioBroker-jsonConfig-Schema', () => {
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'admin', 'jsonConfig.json'), 'utf-8'));
        const ajv = new Ajv({ allErrors: true, strict: false });
        const validate = ajv.compile(schema);
        const ok = validate(config);
        if (!ok) {
            const msg = validate.errors
                .map(e => `${e.instancePath || '(root)'} ${e.keyword} ${JSON.stringify(e.params)}`)
                .join('\n  ');
            throw new Error(`jsonConfig verletzt das Schema:\n  ${msg}`);
        }
        expect(ok).to.equal(true);
    });
});
