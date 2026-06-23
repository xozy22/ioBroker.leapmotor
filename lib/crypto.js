'use strict';

/**
 * Kryptografische Helfer für die Leapmotor-API.
 * Portiert aus custom_components/leapmotor/leap_api/crypto.py des HA-Projekts.
 */

const crypto = require('crypto');
const { DEFAULT_DEVICE_ID, DEFAULT_OPERPWD_AES_KEY, DEFAULT_OPERPWD_AES_IV } = require('./constants');

/**
 * Leitet AES-Schlüssel und IV für das operatePassword aus dem Session-Token ab.
 * Entspricht MD5Util.getEncryptPassword der App.
 *
 * @param {string|null} token
 * @returns {[string, string]} [keyText, ivText] (je 16 ASCII-Zeichen)
 */
function deriveOperpwdKeyIv(token) {
    if (!token) {
        return [DEFAULT_OPERPWD_AES_KEY, DEFAULT_OPERPWD_AES_IV];
    }
    if (token.length < 64) {
        throw new Error('Access token is too short for operatePassword derivation.');
    }
    const keySource = token.slice(0, 32);
    const ivSource = token.slice(32, 64);
    const keyText = crypto.createHash('md5').update(keySource, 'utf-8').digest('hex').slice(8, 24);
    const ivText = crypto.createHash('md5').update(ivSource, 'utf-8').digest('hex').slice(8, 24);
    return [keyText, ivText];
}

/**
 * Leitet das operatePassword aus der Fahrzeug-PIN und dem aktuellen Token ab.
 *
 * @param {string} pin
 * @param {string|null} token
 * @returns {string} Base64-codierter AES-CBC-Geheimtext
 */
function deriveOperatePassword(pin, token) {
    const [keyText, ivText] = deriveOperpwdKeyIv(token);
    const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(keyText, 'utf-8'), Buffer.from(ivText, 'utf-8'));
    // PKCS7-Padding ist Standard (autoPadding = true)
    const ciphertext = Buffer.concat([cipher.update(pin, 'utf-8'), cipher.final()]);
    return ciphertext.toString('base64');
}

/**
 * Extrahiert die Session-deviceId aus dem JWT-Payload.
 *
 * @param {string|null} token
 * @param {string} fallback
 * @returns {string}
 */
function deriveSessionDeviceId(token, fallback = DEFAULT_DEVICE_ID) {
    if (!token) {
        return fallback;
    }
    try {
        const payloadB64 = token.split('.')[1];
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
        const userName = String(payload.user_name || '');
        const parts = userName.split(',');
        if (parts.length >= 4 && parts[2]) {
            return parts[2];
        }
    } catch {
        // Fällt auf den Standardwert zurück
    }
    return fallback;
}

/**
 * Berechnet den HMAC-Signaturschlüssel über HKDF-SHA256 aus dem Login-Sign-Material.
 *
 * @param {string} ikm - signIkm
 * @param {string} salt - signSalt
 * @param {string} info - signInfo
 * @returns {Buffer} 32-Byte-Schlüssel
 */
function deriveSignKey(ikm, salt, info) {
    if (ikm == null || salt == null || info == null) {
        throw new Error('No account sign material loaded.');
    }
    const derived = crypto.hkdfSync(
        'sha256',
        Buffer.from(ikm, 'utf-8'),
        Buffer.from(salt, 'utf-8'),
        Buffer.from(info, 'utf-8'),
        32,
    );
    return Buffer.from(derived);
}

module.exports = {
    deriveOperpwdKeyIv,
    deriveOperatePassword,
    deriveSessionDeviceId,
    deriveSignKey,
};
