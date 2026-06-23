'use strict';

/**
 * Hilfsfunktionen für Zertifikatsmaterial.
 *
 * Das Account-Zertifikat liefert die Login-Antwort als base64-codiertes PKCS#12.
 * Node.js kann ein PKCS#12 zwar direkt als `pfx` an TLS übergeben, aber das
 * Parsen über node-forge ist robuster gegenüber den Algorithmen der Leapmotor-App
 * und erlaubt das Durchprobieren mehrerer Passwortkandidaten (analog zum
 * Python-Original).
 */

const forge = require('node-forge');
const { LeapmotorAccountCertError } = require('./errors');

/**
 * Parst ein PKCS#12 zu PEM-Zertifikat und -Schlüssel.
 *
 * @param {Buffer} p12Buffer
 * @param {string} password
 * @returns {{cert:string, key:string}}
 */
function parseP12ToPem(p12Buffer, password) {
    const p12Der = forge.util.createBuffer(p12Buffer.toString('binary'));
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, password);

    let certPem = null;
    let keyPem = null;

    for (const safeContents of p12.safeContents) {
        for (const safeBag of safeContents.safeBags) {
            if (safeBag.cert && !certPem) {
                certPem = forge.pki.certificateToPem(safeBag.cert);
            } else if (safeBag.key && !keyPem) {
                // gilt sowohl für keyBag als auch für pkcs8ShroudedKeyBag
                keyPem = forge.pki.privateKeyToPem(safeBag.key);
            }
        }
    }

    if (!certPem || !keyPem) {
        throw new Error('PKCS#12 enthält kein vollständiges Zertifikat/Schlüssel-Paar.');
    }
    return { cert: certPem, key: keyPem };
}

/**
 * Probiert mehrere Passwortkandidaten, bis das PKCS#12 erfolgreich geöffnet wird.
 *
 * @param {Buffer} p12Buffer
 * @param {Array<{source:string, password:string}>} candidates
 * @returns {{cert:string, key:string, passwordUsed:string, passwordSource:string}}
 */
function loadAccountCertFromP12(p12Buffer, candidates) {
    let lastError = null;
    for (const { source, password } of candidates) {
        try {
            const { cert, key } = parseP12ToPem(p12Buffer, password);
            return { cert, key, passwordUsed: password, passwordSource: source };
        } catch (err) {
            lastError = err;
        }
    }
    throw new LeapmotorAccountCertError(
        `Could not open account certificate: ${lastError ? lastError.message : 'unknown error'}`,
    );
}

module.exports = { parseP12ToPem, loadAccountCertFromP12 };
