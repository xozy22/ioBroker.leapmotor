'use strict';

/**
 * Lädt das App-Zertifikatsmaterial (app.crt / app.key) zur Laufzeit von einer
 * URL herunter. Standardquelle ist das Community-Repository markoceri/leapmotor-certs.
 *
 * Hintergrund: Das mTLS-Zertifikatsmaterial der Leapmotor-App ist nicht öffentlich
 * Teil dieses Adapters (reverse-engineertes Material ohne Lizenz). Der Laufzeit-Download
 * hält es aktuell, ohne es im Adapter mitzuliefern.
 */

const https = require('https');
const tls = require('tls');
const { URL } = require('url');

const DEFAULT_CERT_URL_CRT = 'https://raw.githubusercontent.com/markoceri/leapmotor-certs/main/app.crt';
const DEFAULT_CERT_URL_KEY = 'https://raw.githubusercontent.com/markoceri/leapmotor-certs/main/app.key';

/**
 * Lädt eine Textressource per HTTPS und folgt dabei Weiterleitungen.
 *
 * @param {string} url
 * @param {number} [timeoutMs]
 * @param {number} [maxRedirects]
 * @returns {Promise<string>}
 */
function fetchText(url, timeoutMs = 15000, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        let u;
        try {
            u = new URL(url);
        } catch {
            reject(new Error(`Ungültige URL: ${url}`));
            return;
        }
        if (u.protocol !== 'https:') {
            reject(new Error(`Nur HTTPS-URLs sind erlaubt: ${url}`));
            return;
        }
        const req = https.get(
            {
                hostname: u.hostname,
                path: u.pathname + u.search,
                headers: { 'User-Agent': 'iobroker.leapmotor', Accept: 'text/plain' },
            },
            res => {
                const status = res.statusCode || 0;
                if (status >= 300 && status < 400 && res.headers.location) {
                    res.resume();
                    if (maxRedirects <= 0) {
                        reject(new Error(`Zu viele Weiterleitungen für ${url}`));
                        return;
                    }
                    const next = new URL(res.headers.location, u).toString();
                    fetchText(next, timeoutMs, maxRedirects - 1).then(resolve, reject);
                    return;
                }
                if (status !== 200) {
                    res.resume();
                    reject(new Error(`HTTP ${status} für ${url}`));
                    return;
                }
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            },
        );
        req.on('error', err => reject(new Error(`Download fehlgeschlagen (${url}): ${err.message}`)));
        req.setTimeout(timeoutMs, () => req.destroy(new Error(`Zeitüberschreitung beim Laden von ${url}`)));
    });
}

/**
 * Validiert ein PEM-Zertifikat/Schlüssel-Paar.
 *
 * @param {string} cert
 * @param {string} key
 */
function validateCertPair(cert, key) {
    if (!/-----BEGIN CERTIFICATE-----/.test(cert)) {
        throw new Error('Die geladene app.crt enthält kein PEM-Zertifikat.');
    }
    if (!/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(key)) {
        throw new Error('Die geladene app.key enthält keinen privaten PEM-Schlüssel.');
    }
    // Wirft, wenn Zertifikat und Schlüssel nicht zusammengehören oder ungültig sind.
    tls.createSecureContext({ cert, key });
}

/**
 * Lädt app.crt und app.key herunter und validiert das Paar.
 *
 * @param {object} [opts]
 * @param {string} [opts.certUrl]
 * @param {string} [opts.keyUrl]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{cert: string, key: string}>}
 */
async function downloadCerts({ certUrl, keyUrl, timeoutMs } = {}) {
    const cUrl = certUrl || DEFAULT_CERT_URL_CRT;
    const kUrl = keyUrl || DEFAULT_CERT_URL_KEY;
    const [cert, key] = await Promise.all([fetchText(cUrl, timeoutMs), fetchText(kUrl, timeoutMs)]);
    validateCertPair(cert, key);
    return { cert, key };
}

module.exports = {
    downloadCerts,
    validateCertPair,
    fetchText,
    DEFAULT_CERT_URL_CRT,
    DEFAULT_CERT_URL_KEY,
};
