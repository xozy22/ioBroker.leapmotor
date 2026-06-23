'use strict';

/**
 * HTTP-Transport für den Leapmotor-API-Client.
 *
 * Ersetzt den curl-basierten Transport des Python-Projekts durch das native
 * https-Modul von Node.js. mTLS (Client-Zertifikat) wird direkt über die
 * cert/key-Optionen abgebildet; `rejectUnauthorized: false` entspricht dem
 * `--insecure` des Originals (der Gateway nutzt eine eigene Zertifikatskette).
 */

const https = require('https');
const { URL } = require('url');
const { LeapmotorApiError } = require('./errors');

class HttpsTransport {
    /**
     * @param {string} baseUrl
     * @param {number} [timeoutMs]
     */
    constructor(baseUrl, timeoutMs = 30000) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.timeoutMs = timeoutMs;
    }

    /**
     * Sendet einen POST-Request und liefert Statuscode, Text-Body und Header.
     *
     * @param {object} opts
     * @param {string} opts.path
     * @param {Object<string,string>} opts.headers
     * @param {string} opts.data
     * @param {{cert:string,key:string}} opts.cert - PEM-Zertifikat und -Schlüssel
     * @returns {Promise<{statusCode:number, body:string, bodyBuffer:Buffer, headers:object}>}
     */
    async post({ path, headers, data, cert }) {
        const res = await this._post({ path, headers, data, cert });
        return {
            statusCode: res.statusCode,
            body: res.bodyBuffer.toString('utf-8'),
            bodyBuffer: res.bodyBuffer,
            headers: res.headers,
        };
    }

    _post({ path, headers, data, cert }) {
        const url = new URL(`${this.baseUrl}/${String(path).replace(/^\/+/, '')}`);
        const body = Buffer.from(data != null ? data : '', 'utf-8');

        const options = {
            method: 'POST',
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            headers: {
                ...headers,
                'Content-Length': body.length,
            },
            cert: cert.cert,
            key: cert.key,
            rejectUnauthorized: false,
            timeout: this.timeoutMs,
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, res => {
                const chunks = [];
                res.on('data', chunk => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode || 0,
                        bodyBuffer: Buffer.concat(chunks),
                        headers: res.headers,
                    });
                });
            });

            req.on('error', err => {
                reject(new LeapmotorApiError(`https request failed: ${err.message}`));
            });
            req.on('timeout', () => {
                req.destroy(new LeapmotorApiError(`https request timed out after ${this.timeoutMs} ms`));
            });

            req.write(body);
            req.end();
        });
    }
}

module.exports = { HttpsTransport };
