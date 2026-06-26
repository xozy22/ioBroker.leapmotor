'use strict';

/**
 * ioBroker-Adapter für Leapmotor-Elektrofahrzeuge.
 * Portiert von der Home-Assistant-Integration https://github.com/kerniger/leapmotor-ha
 */

const utils = require('@iobroker/adapter-core');
const fs = require('fs');
const path = require('path');
const { LeapmotorApiClient } = require('./lib/api');
const { normalizeVehicle } = require('./lib/normalize');
const { CHANNEL_NAMES, STATE_META, CONTROLS } = require('./lib/states');
const { LeapmotorMissingAppCertError } = require('./lib/errors');
const { downloadCerts, DEFAULT_CERT_URL_CRT, DEFAULT_CERT_URL_KEY } = require('./lib/certloader');
const { buildAbrpTelemetry, sendAbrpTelemetry, DEFAULT_ABRP_API_KEY } = require('./lib/abrp');

// VIN des Demo-Fahrzeugs (Objektstruktur ohne echte Daten zum Testen)
const DEMO_VIN = 'DEMO';

class LeapmotorAdapter extends utils.Adapter {
    constructor(options) {
        super({ ...options, name: 'leapmotor' });
        this.client = null;
        this.pollTimer = null;
        this.polling = false;
        this.stopping = false;
        this.knownObjects = new Set();
        this.controlMap = new Map(); // controlId -> control-Definition
        this.lastCommandTime = new Map(); // vin -> Zeitstempel des letzten Steuerbefehls
        this.commandCooldownMs = 0;

        for (const control of CONTROLS) {
            this.controlMap.set(control.id, control);
        }

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        this.setState('info.connection', false, true);

        // Demo-Objekte beim Start anlegen (auch ohne Zugangsdaten), wenn aktiviert
        if (this.config.demoMode) {
            try {
                const count = await this._createDemoObjects();
                this.log.info(`Demo-Modus aktiv: ${count} Demo-Objekte unter "${DEMO_VIN}" angelegt (Null-Werte).`);
            } catch (err) {
                this.log.error(`Demo-Objekte konnten nicht angelegt werden: ${err.message}`);
            }
        }

        const config = this.config;
        if (!config.email || !config.password) {
            this.log.error('E-Mail und Passwort müssen in der Adapter-Konfiguration hinterlegt werden.');
            return;
        }

        let staticCert;
        try {
            staticCert = await this._resolveStaticCert();
        } catch (err) {
            this.log.error(`App-Zertifikat konnte nicht geladen werden: ${err.message}`);
            return;
        }

        // Sensible Felder werden von ioBroker automatisch entschlüsselt geliefert.
        this.client = new LeapmotorApiClient({
            username: config.email,
            password: config.password,
            operationPassword: config.vehiclePin || null,
            accountP12Password: config.accountP12Password || null,
            staticCert,
            baseUrl: config.baseUrl || undefined,
            language: config.language || undefined,
            appVersion: config.appVersion || undefined,
            deviceId: config.deviceId || null,
            logger: {
                debug: m => this.log.debug(m),
                info: m => this.log.info(m),
                warn: m => this.log.warn(m),
                error: m => this.log.error(m),
            },
        });

        this.normalIntervalMs = Math.max(1, parseInt(config.pollInterval, 10) || 5) * 60 * 1000;
        this.ecoIntervalMs = Math.max(1, parseInt(config.ecoPollInterval, 10) || 15) * 60 * 1000;
        this.ecoPollingEnabled = Boolean(config.ecoPollingEnabled);

        this.abrpEnabled = Boolean(config.abrpEnabled);
        this.abrpToken = config.abrpToken || '';
        this.abrpApiKey = (config.abrpApiKey && config.abrpApiKey.trim()) || DEFAULT_ABRP_API_KEY;

        // Mindestabstand zwischen Steuerbefehlen je Fahrzeug (0 = aus)
        this.commandCooldownMs = Math.max(0, parseInt(config.commandCooldown, 10) || 0) * 1000;

        await this.subscribeStatesAsync('*.control.*');

        // Erster Abruf
        await this.poll();
    }

    /**
     * Lädt manuell konfiguriertes Zertifikatsmaterial (PEM-Text oder Dateipfad).
     * Gibt null zurück, wenn nichts vollständig konfiguriert ist.
     *
     * @returns {{cert: string, key: string} | null}
     */
    _loadManualCert() {
        const config = this.config;
        let cert = config.appCertPem && config.appCertPem.trim() ? config.appCertPem : null;
        let key = config.appKeyPem && config.appKeyPem.trim() ? config.appKeyPem : null;

        if (!cert && config.appCertPath) {
            cert = fs.readFileSync(config.appCertPath, 'utf-8');
        }
        if (!key && config.appKeyPath) {
            key = fs.readFileSync(config.appKeyPath, 'utf-8');
        }
        if (!cert || !key) {
            return null;
        }
        return { cert, key };
    }

    /**
     * Ermittelt das App-Zertifikatsmaterial je nach gewählter Quelle.
     * Bei "auto" wird von der konfigurierten URL geladen und lokal zwischengespeichert;
     * schlägt der Download fehl, wird auf den Cache (und dann manuell) zurückgegriffen.
     *
     * @returns {Promise<{cert: string, key: string}>}
     */
    async _resolveStaticCert() {
        const config = this.config;
        const source = config.certSource || 'auto';

        if (source === 'manual') {
            const manual = this._loadManualCert();
            if (!manual) {
                throw new LeapmotorMissingAppCertError(
                    'Manuelle Zertifikatsquelle gewählt, aber app_cert.pem / app_key.pem fehlen ' +
                        '(PEM-Text oder Dateipfad in der Konfiguration hinterlegen).',
                );
            }
            return manual;
        }

        // source === 'auto': von URL laden, mit Cache- und Manuell-Fallback
        const certUrl = config.certUrlCrt || DEFAULT_CERT_URL_CRT;
        const keyUrl = config.certUrlKey || DEFAULT_CERT_URL_KEY;
        try {
            const certs = await downloadCerts({ certUrl, keyUrl });
            await this._cacheCerts(certs);
            this.log.info('App-Zertifikate erfolgreich von der URL geladen.');
            return certs;
        } catch (err) {
            this.log.warn(`Zertifikat-Download fehlgeschlagen: ${err.message}`);
            const cached = await this._loadCachedCerts();
            if (cached) {
                this.log.info('Zwischengespeicherte App-Zertifikate werden verwendet.');
                return cached;
            }
            const manual = this._loadManualCert();
            if (manual) {
                this.log.info('Manuell hinterlegte App-Zertifikate werden als Fallback verwendet.');
                return manual;
            }
            throw new LeapmotorMissingAppCertError(
                'Keine App-Zertifikate verfügbar: Download fehlgeschlagen, kein Cache und keine manuelle Hinterlegung.',
            );
        }
    }

    /** Verzeichnis für zwischengespeicherte Zertifikate. */
    _certCacheDir() {
        return utils.getAbsoluteInstanceDataDir(this);
    }

    /**
     * Speichert heruntergeladene Zertifikate im Instanz-Datenverzeichnis.
     *
     * @param {{cert: string, key: string}} certs
     */
    async _cacheCerts(certs) {
        try {
            const dir = this._certCacheDir();
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(path.join(dir, 'app_cert.pem'), certs.cert, 'utf-8');
            await fs.promises.writeFile(path.join(dir, 'app_key.pem'), certs.key, 'utf-8');
        } catch (err) {
            this.log.debug(`Zertifikate konnten nicht zwischengespeichert werden: ${err.message}`);
        }
    }

    /**
     * Lädt zuvor zwischengespeicherte Zertifikate, falls vorhanden.
     *
     * @returns {Promise<{cert: string, key: string} | null>}
     */
    async _loadCachedCerts() {
        try {
            const dir = this._certCacheDir();
            const cert = await fs.promises.readFile(path.join(dir, 'app_cert.pem'), 'utf-8');
            const key = await fs.promises.readFile(path.join(dir, 'app_key.pem'), 'utf-8');
            if (cert && key) {
                return { cert, key };
            }
        } catch {
            // kein Cache vorhanden
        }
        return null;
    }

    /**
     * Behandelt Nachrichten aus der Admin-Oberfläche (Lade-Button).
     *
     * @param {object} obj
     */
    async onMessage(obj) {
        if (!obj || typeof obj !== 'object' || !obj.command) {
            return;
        }
        if (obj.command === 'loadCerts') {
            const msg = obj.message || {};
            const certUrl = (msg.certUrlCrt && msg.certUrlCrt.trim()) || this.config.certUrlCrt || DEFAULT_CERT_URL_CRT;
            const keyUrl = (msg.certUrlKey && msg.certUrlKey.trim()) || this.config.certUrlKey || DEFAULT_CERT_URL_KEY;
            let result;
            try {
                const certs = await downloadCerts({ certUrl, keyUrl });
                await this._cacheCerts(certs);
                result = {
                    result: `Zertifikate erfolgreich geladen und validiert (app.crt ${certs.cert.length} Bytes, app.key ${certs.key.length} Bytes).`,
                };
            } catch (err) {
                result = { error: `Laden fehlgeschlagen: ${err.message}` };
            }
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, result, obj.callback);
            }
        } else if (obj.command === 'createDemoObjects') {
            let result;
            try {
                const count = await this._createDemoObjects();
                result = {
                    result: `${count} Demo-Objekte unter "${DEMO_VIN}" angelegt (Null-Werte, ohne Fahrzeugverbindung).`,
                };
            } catch (err) {
                result = { error: `Anlegen fehlgeschlagen: ${err.message}` };
            }
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, result, obj.callback);
            }
        } else if (obj.command === 'deleteDemoObjects') {
            let result;
            try {
                await this._deleteDemoObjects();
                result = { result: `Demo-Objekte unter "${DEMO_VIN}" gelöscht.` };
            } catch (err) {
                result = { error: `Löschen fehlgeschlagen: ${err.message}` };
            }
            if (obj.callback) {
                this.sendTo(obj.from, obj.command, result, obj.callback);
            }
        }
    }

    /**
     * Legt die komplette Objektstruktur eines Demo-Fahrzeugs mit Null-Werten an,
     * ohne dass eine Fahrzeugverbindung nötig ist. Nutzt dieselbe Normalisierungs-
     * und Objektlogik wie der echte Abruf, damit die Adressen identisch sind.
     *
     * @returns {Promise<number>} Anzahl angelegter States
     */
    async _createDemoObjects() {
        // Alten Demo-Baum entfernen, damit aktualisierte Objektdefinitionen (z. B.
        // korrigierte Default-Werte) nach einem Update tatsächlich greifen.
        await this._deleteDemoObjects();

        const bundle = {
            vehicle: {
                vin: DEMO_VIN,
                car_id: '0',
                car_type: 'C10',
                nickname: 'Demo-Fahrzeug',
                is_shared: false,
                year: 2024,
                abilities: [],
            },
            status: { data: { signal: {} } },
            mileage: null,
            consumptionRank: null,
            consumptionBreakdown: null,
            picture: null,
            chargingDaily: null,
            notifications: { unread_count: null, last_message_title: null, last_message_time: null },
        };
        const normalized = normalizeVehicle(bundle, 'demo');
        await this._ensureVehicleObjects(DEMO_VIN, normalized);
        await this._writeVehicleStates(DEMO_VIN, normalized);

        let count = 0;
        for (const [channel, fields] of Object.entries(normalized)) {
            if (channel !== 'raw_updated_at' && fields && typeof fields === 'object') {
                count += Object.keys(fields).length;
            }
        }
        return count;
    }

    /** Entfernt das Demo-Fahrzeug samt aller Unterobjekte. */
    async _deleteDemoObjects() {
        const base = this._vinId(DEMO_VIN);
        try {
            await this.delObjectAsync(base, { recursive: true });
        } catch {
            // Baum existiert (noch) nicht – kein Fehler
        }
        // Cache der bekannten Objekte bereinigen, damit ein erneutes Anlegen funktioniert
        for (const id of [...this.knownObjects]) {
            if (id === base || id.startsWith(`${base}.`)) {
                this.knownObjects.delete(id);
            }
        }
    }

    /**
     * Plant den nächsten Poll mit dynamischem Intervall.
     *
     * @param intervalMs
     */
    _scheduleNextPoll(intervalMs) {
        if (this.stopping) {
            return;
        }
        if (this.pollTimer) {
            this.clearTimeout(this.pollTimer);
        }
        this.pollTimer = this.setTimeout(() => {
            this.pollTimer = null;
            this.poll();
        }, intervalMs);
    }

    /** Führt einen Abruf durch und schreibt die Daten in die States. */
    async poll() {
        if (this.polling || this.stopping) {
            return;
        }
        this.polling = true;
        let anyActive = false;
        try {
            const data = await this.client.fetchData();
            this.setState('info.connection', true, true);

            const vins = Object.keys(data.vehicles);
            this.log.debug(`Leapmotor: ${vins.length} Fahrzeug(e) abgerufen`);

            for (const vin of vins) {
                const normalized = normalizeVehicle(data.vehicles[vin], data.user_id);
                if (this.abrpEnabled && this.abrpToken) {
                    normalized.abrp = await this._pushAbrp(vin, normalized);
                }
                await this._ensureVehicleObjects(vin, normalized);
                await this._writeVehicleStates(vin, normalized);
                if (normalized.status.is_driving || normalized.charging.is_charging) {
                    anyActive = true;
                }
            }
        } catch (err) {
            this.setState('info.connection', false, true);
            this.log.error(`Leapmotor-Abruf fehlgeschlagen: ${err.message}`);
        } finally {
            this.polling = false;
            const interval = this.ecoPollingEnabled && !anyActive ? this.ecoIntervalMs : this.normalIntervalMs;
            this._scheduleNextPoll(interval);
        }
    }

    /**
     * Sendet die Fahrzeug-Telemetrie an ABRP und liefert das Ergebnis als State-Block.
     *
     * @param {string} vin
     * @param {object} normalized
     * @returns {Promise<object>}
     */
    async _pushAbrp(vin, normalized) {
        const telemetry = buildAbrpTelemetry(normalized);
        const telemetryKeys = Object.keys(telemetry).sort().join(',');
        const lastPush = Date.now();
        try {
            const result = await sendAbrpTelemetry({
                apiKey: this.abrpApiKey,
                token: this.abrpToken,
                telemetry,
            });
            return {
                enabled: true,
                status: result.status || 'ok',
                success: true,
                last_push: lastPush,
                error: null,
                telemetry_keys: telemetryKeys,
            };
        } catch (err) {
            this.log.debug(`ABRP-Push für VIN ${vin} fehlgeschlagen: ${err.message}`);
            return {
                enabled: true,
                status: 'error',
                success: false,
                last_push: lastPush,
                error: err.message,
                telemetry_keys: telemetryKeys,
            };
        }
    }

    // ---- Objektbaum ----

    _vinId(vin) {
        return String(vin).replace(this.FORBIDDEN_CHARS, '_').replace(/[.\s]/g, '_');
    }

    async _ensureObject(id, obj) {
        if (this.knownObjects.has(id)) {
            return;
        }
        await this.setObjectNotExistsAsync(id, obj);
        this.knownObjects.add(id);
    }

    async _ensureVehicleObjects(vin, normalized) {
        const base = this._vinId(vin);
        if (this.knownObjects.has(base)) {
            return; // Struktur bereits angelegt
        }

        const nickname = normalized.vehicle.nickname || vin;
        await this._ensureObject(base, {
            type: 'device',
            common: { name: `${nickname} (${vin})` },
            native: { vin },
        });

        // Lese-Kanäle und States
        for (const [channel, fields] of Object.entries(normalized)) {
            if (channel === 'raw_updated_at') {
                continue;
            }
            await this._ensureObject(`${base}.${channel}`, {
                type: 'channel',
                common: { name: CHANNEL_NAMES[channel] || channel },
                native: {},
            });
            for (const [field, value] of Object.entries(fields)) {
                await this._ensureObject(`${base}.${channel}.${field}`, this._readStateObject(channel, field, value));
            }
        }

        // Steuer-Kanal
        await this._ensureObject(`${base}.control`, {
            type: 'channel',
            common: { name: 'Steuerung' },
            native: {},
        });
        for (const control of CONTROLS) {
            let def;
            if (control.type === 'boolean') {
                def = false;
            } else if (control.type === 'string') {
                def = '';
            } else {
                // number: gültigen Standard innerhalb der Grenzen wählen
                def = control.min !== undefined ? control.min : 0;
            }
            const common = {
                name: control.name,
                type: control.type,
                role: control.role,
                read: true,
                write: true,
                def,
            };
            if (control.unit) {
                common.unit = control.unit;
            }
            if (control.min !== undefined) {
                common.min = control.min;
            }
            if (control.max !== undefined) {
                common.max = control.max;
            }
            await this._ensureObject(`${base}.control.${control.id}`, {
                type: 'state',
                common,
                native: { vin },
            });
        }
    }

    _readStateObject(channel, field, value) {
        const metaKey = `${channel}.${field}`;
        const meta = STATE_META[metaKey] || {};
        let type = meta.type;
        if (!type) {
            if (typeof value === 'boolean') {
                type = 'boolean';
            } else if (typeof value === 'number') {
                type = 'number';
            } else {
                type = 'string';
            }
        }
        const common = {
            name: field,
            type,
            role: meta.role || 'state',
            read: true,
            write: false,
        };
        if (meta.unit) {
            common.unit = meta.unit;
        }
        return { type: 'state', common, native: {} };
    }

    async _writeVehicleStates(vin, normalized) {
        const base = this._vinId(vin);
        for (const [channel, fields] of Object.entries(normalized)) {
            if (channel === 'raw_updated_at') {
                continue;
            }
            for (const [field, value] of Object.entries(fields)) {
                await this.setStateAsync(`${base}.${channel}.${field}`, {
                    val: this._toStateValue(value),
                    ack: true,
                });
            }
        }
    }

    _toStateValue(value) {
        if (value === undefined) {
            return null;
        }
        if (value === null) {
            return null;
        }
        if (Array.isArray(value) || typeof value === 'object') {
            return JSON.stringify(value);
        }
        return value;
    }

    // ---- Steuerung ----

    async onStateChange(id, state) {
        if (!state || state.ack || this.stopping || !this.client) {
            return;
        }

        const parts = id.split('.');
        const controlIdx = parts.indexOf('control');
        if (controlIdx < 0 || controlIdx + 1 >= parts.length) {
            return;
        }

        const vinId = parts[controlIdx - 1];
        const controlId = parts.slice(controlIdx + 1).join('.');

        // Zugehörige VIN aus dem Objekt-native lesen (robuster als ID-Rückübersetzung)
        let vin = vinId;
        try {
            const obj = await this.getObjectAsync(id);
            if (obj && obj.native && obj.native.vin) {
                vin = obj.native.vin;
            }
        } catch {
            // Fallback auf vinId
        }

        if (controlId === 'refresh') {
            this.log.info('Manuelle Aktualisierung ausgelöst');
            await this.setStateAsync(id, { val: false, ack: true });
            if (this.pollTimer) {
                this.clearTimeout(this.pollTimer);
            }
            this.pollTimer = null;
            await this.poll();
            return;
        }

        const control = this.controlMap.get(controlId);
        if (!control || !control.handler) {
            this.log.warn(`Unbekannter Steuerbefehl: ${controlId}`);
            return;
        }

        // Cooldown: schützt die 12V-Batterie, da Steuerbefehle (anders als das Lesen)
        // tatsächlich das Fahrzeug kontaktieren. Zu schnelle Befehle werden abgelehnt.
        const cooldown = this._commandAllowed(vin);
        if (!cooldown.allowed) {
            this.log.warn(
                `Steuerbefehl '${controlId}' abgelehnt: Cooldown aktiv (noch ${cooldown.remaining}s, schützt die 12V-Batterie).`,
            );
            await this.setStateAsync(id, { val: state.val, ack: true });
            return;
        }
        if (this.commandCooldownMs > 0) {
            this.lastCommandTime.set(vin, Date.now());
        }

        try {
            this.log.info(`Steuerbefehl '${controlId}' für VIN ${vin} (Wert: ${state.val})`);
            await control.handler(this.client, vin, state.val);
            await this.setStateAsync(id, { val: state.val, ack: true });
            // Nach einer Aktion zeitnah aktualisieren
            this._scheduleQuickRefresh();
        } catch (err) {
            this.log.error(`Steuerbefehl '${controlId}' fehlgeschlagen: ${err.message}`);
        }
    }

    /**
     * Prüft, ob für die VIN aktuell ein Steuerbefehl erlaubt ist (Cooldown abgelaufen).
     *
     * @param {string} vin
     * @param {number} [nowMs]
     * @returns {{allowed: boolean, remaining: number}}
     */
    _commandAllowed(vin, nowMs = Date.now()) {
        if (this.commandCooldownMs <= 0) {
            return { allowed: true, remaining: 0 };
        }
        const last = this.lastCommandTime.get(vin);
        if (!last) {
            // noch kein Steuerbefehl für dieses Fahrzeug -> immer erlaubt
            return { allowed: true, remaining: 0 };
        }
        const elapsed = nowMs - last;
        if (elapsed < this.commandCooldownMs) {
            return { allowed: false, remaining: Math.ceil((this.commandCooldownMs - elapsed) / 1000) };
        }
        return { allowed: true, remaining: 0 };
    }

    _scheduleQuickRefresh() {
        if (this.stopping) {
            return;
        }
        if (this.quickRefreshTimer) {
            this.clearTimeout(this.quickRefreshTimer);
        }
        this.quickRefreshTimer = this.setTimeout(() => {
            this.quickRefreshTimer = null;
            this.poll();
        }, 8000);
    }

    async onUnload(callback) {
        this.stopping = true;
        try {
            if (this.pollTimer) {
                this.clearTimeout(this.pollTimer);
                this.pollTimer = null;
            }
            if (this.quickRefreshTimer) {
                this.clearTimeout(this.quickRefreshTimer);
                this.quickRefreshTimer = null;
            }
            this.setState('info.connection', false, true);
        } catch {
            // ignorieren
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new LeapmotorAdapter(options);
    module.exports.LeapmotorAdapter = LeapmotorAdapter;
} else {
    new LeapmotorAdapter();
}
