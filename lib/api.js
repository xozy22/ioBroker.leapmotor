'use strict';

/**
 * Leapmotor-API-Client.
 * Portiert aus custom_components/leapmotor/api.py (Klasse LeapmotorApiClient).
 *
 * Alle Methoden sind asynchron (Promise-basiert), da der ioBroker-Adapter im
 * Node.js-Event-Loop läuft. Das Ergebnis-Polling nutzt `await sleep()` statt
 * blockierendem time.sleep().
 */

const crypto = require('crypto');
const C = require('./constants');
const { HttpsTransport } = require('./transport');
const { loadAccountCertFromP12 } = require('./certs');
const { LeapmotorApiError, LeapmotorAuthError, LeapmotorMissingAppCertError, isTokenError } = require('./errors');
const { deriveOperatePassword, deriveSessionDeviceId, deriveSignKey } = require('./crypto');
const { deriveAccountP12Password } = require('./sm4');
const {
    REMOTE_ACTION_SPECS,
    compactJson,
    buildSeatComfortPayload,
    buildClimatePayload,
    buildClimateScheduleEntry,
    buildPrepareCarDatacontent,
    buildPrepareCarScheduleEntry,
    normalizeChargePlan,
    chargePlanIsComplete,
    mergeChargePlans,
} = require('./remote');
const { lastSevenDayWindowMs, previousWeekWindowSeconds } = require('./timeutil');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * URL-Encoding entsprechend Python requests.utils.quote(value, safe='').
 *
 * @param value
 */
function quote(value) {
    return encodeURIComponent(String(value)).replace(/[!*'()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Zufalls-Nonce wie Python random.randint(100000, 9999999). */
function makeNonce() {
    return String(Math.floor(Math.random() * (9999999 - 100000 + 1)) + 100000);
}

/** Aktueller Timestamp in Millisekunden als String. */
function makeTimestamp() {
    return String(Date.now());
}

/**
 * SHA256-Hex über die UTF-8-Bytes des Strings.
 *
 * @param text
 */
function sha256Hex(text) {
    return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * Maskiert die VIN für Logausgaben.
 *
 * @param vin
 */
function redactVin(vin) {
    if (!vin || vin.length < 6) {
        return '***';
    }
    return `${vin.slice(0, 3)}***${vin.slice(-3)}`;
}

function safeInt(raw) {
    if (raw == null) {
        return null;
    }
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
}

const NOOP_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };

class LeapmotorApiClient {
    /**
     * @param {object} opts
     * @param {string} opts.username
     * @param {string} opts.password
     * @param {string|null} [opts.operationPassword] - Fahrzeug-PIN
     * @param {string|null} [opts.accountP12Password]
     * @param {{cert:string,key:string}} opts.staticCert - App-Zertifikat (PEM)
     * @param {string} [opts.baseUrl]
     * @param {string|null} [opts.deviceId]
     * @param {string} [opts.language]
     * @param {string} [opts.appVersion]
     * @param {object} [opts.logger] - { debug, info, warn, error }
     */
    constructor(opts) {
        this.username = opts.username;
        this.password = opts.password;
        this.operationPassword = opts.operationPassword ? String(opts.operationPassword).trim() : null;
        this.accountP12Password = opts.accountP12Password || null;
        this.staticCert = opts.staticCert || null;
        this.baseUrl = (opts.baseUrl || C.DEFAULT_BASE_URL).replace(/\/+$/, '');
        this.language = opts.language || C.DEFAULT_LANGUAGE;
        this.appVersion = opts.appVersion || C.DEFAULT_APP_VERSION;
        this.log = opts.logger || NOOP_LOGGER;

        this.transport = new HttpsTransport(this.baseUrl);
        this.loginDeviceId = opts.deviceId || crypto.randomUUID().replace(/-/g, '');
        this.deviceId = this.loginDeviceId;

        this.userId = null;
        this.token = null;
        this.refreshToken = null;
        this.signIkm = null;
        this.signSalt = null;
        this.signInfo = null;
        this._signKey = null;
        this.accountCert = null; // {cert, key}
        this.accountP12PasswordUsed = null;
        this.accountP12PasswordSource = null;
        this.remoteCertSynced = false;
        this.lastApiResults = {};
    }

    // ---- Authentifizierung ----

    get signKey() {
        if (this._signKey) {
            return this._signKey;
        }
        this._signKey = deriveSignKey(this.signIkm, this.signSalt, this.signInfo);
        return this._signKey;
    }

    _clearAuth() {
        this.token = null;
        this.refreshToken = null;
        this.deviceId = this.loginDeviceId;
        this.userId = null;
        this.signIkm = null;
        this.signSalt = null;
        this.signInfo = null;
        this._signKey = null;
        this.accountCert = null;
        this.accountP12PasswordUsed = null;
        this.accountP12PasswordSource = null;
        this.remoteCertSynced = false;
    }

    _ensureStaticCert() {
        if (!this.staticCert || !this.staticCert.cert || !this.staticCert.key) {
            throw new LeapmotorMissingAppCertError(
                'App-Zertifikatsmaterial fehlt (app_cert.pem / app_key.pem). ' +
                    'Dieses Material ist nicht im öffentlichen Repository enthalten und muss in der Adapter-Konfiguration hinterlegt werden.',
            );
        }
    }

    async _ensureAccountCert() {
        if (this.accountCert && this.accountCert.cert && this.accountCert.key) {
            return;
        }
        if (this.token) {
            this._clearAuth();
        }
        await this.login();
    }

    async login() {
        this._ensureStaticCert();
        const headers = this._buildLoginHeaders();
        const body = this._buildLoginFormBody();
        const response = await this._post({
            path: '/carownerservice/oversea/acct/v1/login',
            headers,
            data: body,
            cert: this.staticCert,
        });
        const data = this._parseApiBody(response.statusCode, response.body, 'login');
        const loginData = data.data || {};
        this.userId = String(loginData.id);
        this.token = String(loginData.token);
        this.deviceId = deriveSessionDeviceId(this.token, this.loginDeviceId);
        this.signIkm = String(loginData.signIkm);
        this.signSalt = String(loginData.signSalt);
        this.signInfo = String(loginData.signInfo);
        this._signKey = null;
        this.refreshToken = loginData.refreshToken ? String(loginData.refreshToken) : null;
        this._loadAccountCert(loginData);
        this.remoteCertSynced = false;
    }

    async tokenRefresh() {
        if (!this.refreshToken) {
            throw new LeapmotorAuthError('No refresh token available; a full login is required.');
        }
        const currentRefreshToken = this.refreshToken;
        const headers = this._buildSignedHeaders({
            bodyParams: { refreshToken: currentRefreshToken },
        });
        Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
        const response = await this._post({
            path: '/carownerservice/oversea/acct/v1/token/refresh',
            headers,
            data: `refreshToken=${quote(currentRefreshToken)}`,
            cert: this.accountCert,
        });
        const result = this._parseApiBody(response.statusCode, response.body, 'token refresh');
        const refreshData = result.data || {};
        const refreshedToken = refreshData.token;
        if (!refreshedToken) {
            throw new LeapmotorAuthError('Leapmotor token refresh returned no access token.');
        }
        this.token = String(refreshedToken);
        this.refreshToken = refreshData.refreshToken ? String(refreshData.refreshToken) : currentRefreshToken;
        this.log.debug('Leapmotor access token refreshed successfully');
    }

    async _recoverSession(err) {
        if (isTokenError(err) && this.refreshToken) {
            try {
                await this.tokenRefresh();
                return;
            } catch (refreshErr) {
                this.log.debug(`Leapmotor token refresh failed, using full login: ${refreshErr.message}`);
            }
        }
        this._clearAuth();
        this._ensureStaticCert();
        await this.login();
    }

    _loadAccountCert(loginData) {
        const base64Cert = String(loginData.base64Cert || '');
        const p12Bytes = Buffer.from(base64Cert, 'base64');
        const candidates = [];
        if (this.accountP12Password) {
            candidates.push({
                source: 'provided',
                password: this.accountP12Password,
            });
        }
        let derivedPassword = null;
        try {
            derivedPassword = deriveAccountP12Password(loginData.id, String(loginData.uid));
        } catch {
            derivedPassword = null;
        }
        if (derivedPassword && candidates.every(c => c.password !== derivedPassword)) {
            candidates.push({ source: 'derived', password: derivedPassword });
        }
        const result = loadAccountCertFromP12(p12Bytes, candidates);
        this.accountCert = { cert: result.cert, key: result.key };
        this.accountP12PasswordUsed = result.passwordUsed;
        this.accountP12PasswordSource = result.passwordSource;
    }

    // ---- Hauptabruf ----

    async fetchData() {
        if (!this.token) {
            this._ensureStaticCert();
            await this.login();
        }
        try {
            return await this._fetchAuthenticatedData();
        } catch (err) {
            if (!(err instanceof LeapmotorApiError)) {
                throw err;
            }
            await this._recoverSession(err);
            return await this._fetchAuthenticatedData();
        }
    }

    async _fetchAuthenticatedData() {
        const vehicles = await this.getVehicleList();
        const result = {
            user_id: this.userId,
            vehicles: {},
            account_p12_password_source: this.accountP12PasswordSource,
        };
        const notifications = await this._fetchAccountNotifications();
        for (const vehicle of vehicles) {
            const status = await this.getVehicleStatus(vehicle);
            const mileage = await this._fetchOptionalRead(
                'mileage energy detail',
                v => this.getMileageEnergyDetail(v),
                vehicle,
            );
            const consumptionRank = await this._fetchOptionalRead(
                'consumption weekly rank',
                v => this.getConsumptionWeeklyRank(v),
                vehicle,
            );
            const consumptionBreakdown = await this._fetchOptionalRead(
                'consumption last week breakdown',
                v => this.getConsumptionLastWeekBreakdown(v),
                vehicle,
            );
            const picture = await this._fetchOptionalRead('car picture', v => this.getCarPicture(v), vehicle);
            const chargingDaily = await this._fetchOptionalRead(
                'charging daily detail',
                v => this.getChargingDailyDetail(v),
                vehicle,
            );
            result.vehicles[vehicle.vin] = {
                vehicle,
                status,
                mileage,
                consumptionRank,
                consumptionBreakdown,
                picture,
                chargingDaily,
                notifications,
            };
        }
        return result;
    }

    async _fetchOptionalRead(label, fetcher, vehicle) {
        try {
            return await fetcher(vehicle);
        } catch (err) {
            this.log.debug(`Leapmotor optional read failed for ${label}: ${err.message}`);
            return null;
        }
    }

    async _fetchAccountNotifications() {
        const empty = {
            unread_count: null,
            last_message_title: null,
            last_message_time: null,
        };
        try {
            let headers = this._buildSignedHeaders();
            Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
            let resp = await this._post({
                path: '/carownerservice/oversea/message/v1/unread/count',
                headers,
                data: '',
                cert: this.accountCert,
            });
            let bodyData = this._parseApiBody(resp.statusCode, resp.body, 'unread count');
            const unread = LeapmotorApiClient._extractUnreadCount(bodyData.data);

            const listHeaders = this._buildMessageListHeaders({
                pageNo: 1,
                pageSize: 1,
            });
            Object.assign(listHeaders, this._authHeaders('application/x-www-form-urlencoded'));
            resp = await this._post({
                path: '/carownerservice/oversea/message/v1/list',
                headers: listHeaders,
                data: 'pageNo=1&pageSize=1',
                cert: this.accountCert,
            });
            bodyData = this._parseApiBody(resp.statusCode, resp.body, 'message list');
            const messages = LeapmotorApiClient._extractMessageList(bodyData.data);
            const latest = messages[0] || {};
            return {
                unread_count: unread,
                last_message_title: latest.title || null,
                last_message_time: latest.sendTime || null,
            };
        } catch (err) {
            this.log.debug(`Leapmotor notification fetch failed: ${err.message}`);
            return empty;
        }
    }

    static _extractUnreadCount(data) {
        if (typeof data === 'number') {
            return data;
        }
        if (typeof data === 'string') {
            const n = parseInt(data, 10);
            return Number.isNaN(n) ? null : n;
        }
        if (data && typeof data === 'object') {
            for (const key of ['unread', 'unreadCount', 'count']) {
                if (key in data) {
                    const n = parseInt(data[key], 10);
                    return Number.isNaN(n) ? null : n;
                }
            }
        }
        return null;
    }

    static _extractMessageList(data) {
        if (Array.isArray(data)) {
            return data.filter(i => i && typeof i === 'object');
        }
        if (data && typeof data === 'object') {
            const messages = data.list || data.records || data.rows;
            if (Array.isArray(messages)) {
                return messages.filter(i => i && typeof i === 'object');
            }
        }
        return [];
    }

    // ---- Lese-Endpunkte ----

    async getVehicleList() {
        const headers = this._buildSignedHeaders();
        Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
        const response = await this._post({
            path: '/carownerservice/oversea/vehicle/v1/list',
            headers,
            data: '',
            cert: this.accountCert,
        });
        const body = this._parseApiBody(response.statusCode, response.body, 'vehicle list');
        const listData = body.data || {};
        const vehicles = [];
        for (const [bucket, isShared] of [
            ['bindcars', false],
            ['sharedcars', true],
        ]) {
            for (const item of listData[bucket] || []) {
                if (!item.vin) {
                    continue;
                }
                vehicles.push({
                    vin: String(item.vin),
                    car_id: item.carId != null ? String(item.carId) : null,
                    car_type: String(item.carType || 'C10'),
                    nickname: item.nickName || null,
                    is_shared: isShared,
                    year: safeInt(item.year),
                    rights: item.rightList,
                    abilities: (item.abilities || []).map(v => String(v)),
                    module_rights: item.moduleRights,
                });
            }
        }
        return vehicles;
    }

    async getVehicleStatus(vehicle) {
        const carTypePath = LeapmotorApiClient._vehicleStatusCarTypePath(vehicle.car_type);
        const body = `vin=${quote(vehicle.vin)}`;
        const status = await this._getVehicleStatusRaw(vehicle, carTypePath, body, 'vehicle status');
        if (vehicle.is_shared && vehicle.car_id && !LeapmotorApiClient._statusSignalCount(status)) {
            const sharedBody = `vin=${quote(vehicle.vin)}&carId=${quote(vehicle.car_id)}`;
            let sharedStatus = null;
            try {
                sharedStatus = await this._getVehicleStatusRaw(
                    vehicle,
                    carTypePath,
                    sharedBody,
                    'vehicle status shared carId',
                );
            } catch {
                sharedStatus = null;
            }
            if (sharedStatus && LeapmotorApiClient._statusSignalCount(sharedStatus)) {
                return sharedStatus;
            }
        }
        return status;
    }

    async _getVehicleStatusRaw(vehicle, carTypePath, body, label) {
        const headers = this._buildSignedHeaders({ vin: vehicle.vin });
        Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
        const response = await this._post({
            path: `/carownerservice/oversea/vehicle/v1/status/get/${carTypePath}`,
            headers,
            data: body,
            cert: this.accountCert,
        });
        return this._parseApiBody(response.statusCode, response.body, label);
    }

    async getMileageEnergyDetail(vehicle) {
        const [begintime, endtime] = lastSevenDayWindowMs();
        const headers = this._buildMileageEnergyDetailHeaders({
            vin: vehicle.vin,
            begintime: String(begintime),
            endtime: String(endtime),
        });
        Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
        const body = `endtime=${endtime}&begintime=${begintime}&vin=${quote(vehicle.vin)}`;
        const response = await this._post({
            path: '/carownerservice/oversea/drivingRecord/v1/mileage/energy/detail',
            headers,
            data: body,
            cert: this.accountCert,
        });
        return this._parseApiBody(response.statusCode, response.body, 'mileage energy detail');
    }

    async getConsumptionWeeklyRank(vehicle) {
        const headers = this._buildConsumptionWeeklyRankHeaders({
            carvin: vehicle.vin,
        });
        Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
        const response = await this._post({
            path: '/carownerservice/oversea/drivingRecord/v1/getLastNweeks100kmECAndRank',
            headers,
            data: `carvin=${quote(vehicle.vin)}`,
            cert: this.accountCert,
        });
        return this._parseApiBody(response.statusCode, response.body, 'consumption weekly rank');
    }

    async getConsumptionLastWeekBreakdown(vehicle) {
        const [begintime, endtime] = previousWeekWindowSeconds();
        const headers = this._buildConsumptionLastWeekHeaders({
            carvin: vehicle.vin,
            begintime: String(begintime),
            endtime: String(endtime),
        });
        Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
        const body = `endtime=${endtime}&begintime=${begintime}&carvin=${quote(vehicle.vin)}`;
        const response = await this._post({
            path: '/carownerservice/oversea/drivingRecord/v1/getLastweekEC',
            headers,
            data: body,
            cert: this.accountCert,
        });
        return this._parseApiBody(response.statusCode, response.body, 'consumption last week breakdown');
    }

    /**
     *
     * @param vehicle
     */
    async getChargingDailyDetail(vehicle) {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        const iso = d => d.toISOString().slice(0, 10);
        const timezone = 'GMT+00:00';
        const pageNum = 1;
        const pageSize = 10;
        const bodyParams = {
            vin: vehicle.vin,
            timeZone: timezone,
            startTime: iso(startDate),
            endTime: iso(endDate),
            pageNum: String(pageNum),
            pageSize: String(pageSize),
        };
        const headers = this._buildChargingDailyDetailHeaders({ bodyParams });
        Object.assign(headers, this._authHeaders('application/json'));
        const body = compactJson({
            vin: vehicle.vin,
            timeZone: timezone,
            startTime: iso(startDate),
            endTime: iso(endDate),
            pageNum,
            pageSize,
        });
        const response = await this._post({
            path: '/carownerservice/charge/daily/detail/page',
            headers,
            data: body,
            cert: this.accountCert,
        });
        return this._parseApiBody(response.statusCode, response.body, 'charging daily detail');
    }

    async getCarPicture(vehicle) {
        const headers = this._buildCarPictureHeaders({ vin: vehicle.vin });
        Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
        const body = `deviceID=${quote(this.deviceId)}&vin=${quote(vehicle.vin)}`;
        const response = await this._post({
            path: '/carownerservice/oversea/vehicle/v1/carpicture/key',
            headers,
            data: body,
            cert: this.accountCert,
        });
        return this._parseApiBody(response.statusCode, response.body, 'car picture');
    }

    // ---- Fahrzeugauflösung ----

    async findVehicleByVin(vin) {
        let vehicles;
        try {
            vehicles = await this.getVehicleList();
        } catch (err) {
            if (!isTokenError(err)) {
                throw err;
            }
            await this._recoverSession(err);
            vehicles = await this.getVehicleList();
        }
        for (const vehicle of vehicles) {
            if (vehicle.vin === vin) {
                return vehicle;
            }
        }
        throw new LeapmotorApiError(`Vehicle not found for VIN ${vin}`);
    }

    // ---- Header-Builder ----

    _buildLoginFormBody() {
        return (
            'isRecoverAcct=0' +
            `&password=${quote(this.password)}` +
            `&policyId=${C.DEFAULT_POLICY_ID}` +
            '&loginMethod=1' +
            `&email=${quote(this.username)}`
        );
    }

    _buildLoginHeaders() {
        const nonce = makeNonce();
        const timestamp = makeTimestamp();
        const signInput = [
            this.language,
            C.DEFAULT_DEVICE_TYPE,
            this.deviceId,
            '1',
            this.username,
            '0',
            '1',
            nonce,
            this.password,
            C.DEFAULT_POLICY_ID,
            C.DEFAULT_SOURCE,
            timestamp,
            this.appVersion,
        ].join('');
        return {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            acceptLanguage: this.language,
            channel: C.DEFAULT_CHANNEL,
            deviceType: C.DEFAULT_DEVICE_TYPE,
            'X-P12_ENC_ALG': C.DEFAULT_P12_ENC_ALG,
            source: C.DEFAULT_SOURCE,
            version: this.appVersion,
            nonce,
            deviceId: this.deviceId,
            timestamp,
            sign: sha256Hex(signInput),
        };
    }

    _buildSignedHeaders({ vin = null, bodyParams = null } = {}) {
        const nonce = makeNonce();
        const timestamp = makeTimestamp();
        const signFields = {
            acceptLanguage: this.language,
            channel: C.DEFAULT_CHANNEL,
            deviceId: this.deviceId,
            deviceType: C.DEFAULT_DEVICE_TYPE,
            nonce,
            source: C.DEFAULT_SOURCE,
            timestamp,
            version: this.appVersion,
            ...(bodyParams || {}),
        };
        if (vin) {
            signFields.vin = vin;
        }
        const signInput = Object.keys(signFields)
            .sort()
            .map(k => signFields[k])
            .join('');
        return {
            acceptLanguage: this.language,
            channel: C.DEFAULT_CHANNEL,
            deviceType: C.DEFAULT_DEVICE_TYPE,
            'X-P12_ENC_ALG': C.DEFAULT_P12_ENC_ALG,
            source: C.DEFAULT_SOURCE,
            version: this.appVersion,
            nonce,
            deviceId: this.deviceId,
            timestamp,
            sign: this._hmac(signInput),
        };
    }

    _buildMessageListHeaders({ pageNo = 1, pageSize = 1 } = {}) {
        const nonce = makeNonce();
        const timestamp = makeTimestamp();
        const signInput = [
            this.language,
            C.DEFAULT_CHANNEL,
            this.deviceId,
            C.DEFAULT_DEVICE_TYPE,
            nonce,
            String(pageNo),
            String(pageSize),
            C.DEFAULT_SOURCE,
            timestamp,
            this.appVersion,
        ].join('');
        return this._signedHeaderDict(nonce, timestamp, signInput);
    }

    _buildConsumptionWeeklyRankHeaders({ carvin }) {
        const nonce = makeNonce();
        const timestamp = makeTimestamp();
        const signInput = [
            this.language,
            carvin,
            C.DEFAULT_CHANNEL,
            this.deviceId,
            C.DEFAULT_DEVICE_TYPE,
            nonce,
            C.DEFAULT_SOURCE,
            timestamp,
            this.appVersion,
        ].join('');
        return this._signedHeaderDict(nonce, timestamp, signInput);
    }

    _buildMileageEnergyDetailHeaders({ vin, begintime, endtime }) {
        const nonce = makeNonce();
        const timestamp = makeTimestamp();
        const signInput = [
            this.language,
            begintime,
            C.DEFAULT_CHANNEL,
            this.deviceId,
            C.DEFAULT_DEVICE_TYPE,
            endtime,
            nonce,
            C.DEFAULT_SOURCE,
            timestamp,
            this.appVersion,
            vin,
        ].join('');
        return this._signedHeaderDict(nonce, timestamp, signInput);
    }

    _buildConsumptionLastWeekHeaders({ carvin, begintime, endtime }) {
        const nonce = makeNonce();
        const timestamp = makeTimestamp();
        const signInput = [
            this.language,
            begintime,
            carvin,
            C.DEFAULT_CHANNEL,
            this.deviceId,
            C.DEFAULT_DEVICE_TYPE,
            endtime,
            nonce,
            C.DEFAULT_SOURCE,
            timestamp,
            this.appVersion,
        ].join('');
        return this._signedHeaderDict(nonce, timestamp, signInput);
    }

    _buildChargingDailyDetailHeaders({ bodyParams }) {
        const nonce = makeNonce();
        const timestamp = makeTimestamp();
        const signFields = {
            acceptLanguage: this.language,
            channel: C.DEFAULT_CHANNEL,
            deviceId: this.deviceId,
            deviceType: C.DEFAULT_DEVICE_TYPE,
            nonce,
            source: C.DEFAULT_SOURCE,
            timestamp,
            version: this.appVersion,
            ...bodyParams,
        };
        const signInput = Object.keys(signFields)
            .sort()
            .map(k => signFields[k])
            .join('');
        return this._signedHeaderDict(nonce, timestamp, signInput);
    }

    _signedHeaderDict(nonce, timestamp, signInput) {
        return {
            acceptLanguage: this.language,
            channel: C.DEFAULT_CHANNEL,
            deviceType: C.DEFAULT_DEVICE_TYPE,
            'X-P12_ENC_ALG': C.DEFAULT_P12_ENC_ALG,
            source: C.DEFAULT_SOURCE,
            version: this.appVersion,
            nonce,
            deviceId: this.deviceId,
            timestamp,
            sign: this._hmac(signInput),
        };
    }

    _buildCarPictureHeaders({ vin }) {
        const nonce = makeNonce();
        const timestamp = makeTimestamp();
        const signInput =
            `${this.language}${C.DEFAULT_CHANNEL}${this.deviceId}${this.deviceId}${C.DEFAULT_DEVICE_TYPE}` +
            `${nonce}${C.DEFAULT_SOURCE}${timestamp}${this.appVersion}${vin}`;
        return {
            acceptLanguage: this.language,
            channel: C.DEFAULT_CHANNEL,
            deviceType: C.DEFAULT_DEVICE_TYPE,
            'X-P12_ENC_ALG': C.DEFAULT_P12_ENC_ALG,
            source: C.DEFAULT_SOURCE,
            version: this.appVersion,
            nonce,
            deviceId: this.deviceId,
            timestamp,
            sign: this._hmac(signInput),
        };
    }

    _buildOperpwdVerifyHeaders({ vin, operationPassword }) {
        const nonce = makeNonce();
        const timestamp = makeTimestamp();
        const signInput =
            `${this.language}${C.DEFAULT_CHANNEL}${this.deviceId}${C.DEFAULT_DEVICE_TYPE}` +
            `${nonce}${operationPassword}${C.DEFAULT_SOURCE}${timestamp}${this.appVersion}${vin}`;
        return {
            acceptLanguage: this.language,
            channel: C.DEFAULT_CHANNEL,
            deviceType: C.DEFAULT_DEVICE_TYPE,
            'X-P12_ENC_ALG': C.DEFAULT_P12_ENC_ALG,
            source: C.DEFAULT_SOURCE,
            version: this.appVersion,
            nonce,
            deviceId: this.deviceId,
            timestamp,
            sign: this._hmac(signInput),
        };
    }

    _buildRemoteCtlWriteHeaders({ vin, cmdContent, cmdId, operationPassword }) {
        const nonce = makeNonce();
        const timestamp = makeTimestamp();
        const signInput =
            `${this.language}${C.DEFAULT_CHANNEL}${cmdContent}${cmdId}${this.deviceId}${C.DEFAULT_DEVICE_TYPE}` +
            `${nonce}${operationPassword}${C.DEFAULT_SOURCE}${timestamp}${this.appVersion}${vin}`;
        return {
            acceptLanguage: this.language,
            channel: C.DEFAULT_CHANNEL,
            deviceType: C.DEFAULT_DEVICE_TYPE,
            'X-P12_ENC_ALG': C.DEFAULT_P12_ENC_ALG,
            source: C.DEFAULT_SOURCE,
            version: this.appVersion,
            nonce,
            deviceId: this.deviceId,
            timestamp,
            sign: this._hmac(signInput),
        };
    }

    _buildRemoteCtlWriteHeadersWithoutPin({ vin, cmdContent, cmdId }) {
        const nonce = makeNonce();
        const timestamp = makeTimestamp();
        const signInput =
            `${this.language}${C.DEFAULT_CHANNEL}${cmdContent}${cmdId}${this.deviceId}${C.DEFAULT_DEVICE_TYPE}` +
            `${nonce}${C.DEFAULT_SOURCE}${timestamp}${this.appVersion}${vin}`;
        return {
            acceptLanguage: this.language,
            channel: C.DEFAULT_CHANNEL,
            deviceType: C.DEFAULT_DEVICE_TYPE,
            'X-P12_ENC_ALG': C.DEFAULT_P12_ENC_ALG,
            source: C.DEFAULT_SOURCE,
            version: this.appVersion,
            nonce,
            deviceId: this.deviceId,
            timestamp,
            sign: this._hmac(signInput),
        };
    }

    _buildRemoteCtlResultHeaders({ remoteCtlId }) {
        const nonce = makeNonce();
        const timestamp = makeTimestamp();
        const signInput =
            `${this.language}${C.DEFAULT_CHANNEL}${this.deviceId}${C.DEFAULT_DEVICE_TYPE}` +
            `${nonce}${remoteCtlId}${C.DEFAULT_SOURCE}${timestamp}${this.appVersion}`;
        return {
            acceptLanguage: this.language,
            channel: C.DEFAULT_CHANNEL,
            deviceType: C.DEFAULT_DEVICE_TYPE,
            'X-P12_ENC_ALG': C.DEFAULT_P12_ENC_ALG,
            source: C.DEFAULT_SOURCE,
            version: this.appVersion,
            nonce,
            deviceId: this.deviceId,
            timestamp,
            sign: this._hmac(signInput),
        };
    }

    _hmac(signInput) {
        return crypto.createHmac('sha256', this.signKey).update(signInput, 'utf-8').digest('hex');
    }

    _authHeaders(contentType) {
        if (!this.userId || !this.token) {
            throw new LeapmotorAuthError('Not authenticated.');
        }
        return {
            'Content-Type': contentType,
            userId: this.userId,
            token: this.token,
        };
    }

    // ---- HTTP/Parsing ----

    async _post({ path, headers, data, cert }) {
        try {
            return await this.transport.post({ path, headers, data, cert });
        } catch (err) {
            this._recordApiResult(`transport ${path}`, 0, 'transport_error', err.message);
            throw err;
        }
    }

    _parseApiBody(statusCode, body, label) {
        let data;
        try {
            data = JSON.parse(body);
        } catch {
            this._recordApiResult(label, statusCode, null, 'non_json');
            throw new LeapmotorApiError(`${label} returned non-JSON response: ${body.slice(0, 200)}`);
        }
        this._recordApiResult(label, statusCode, data.code, data.message);
        if (statusCode !== 200 || data.code !== 0) {
            const message = data.message || body.slice(0, 200);
            if (label === 'login') {
                throw new LeapmotorAuthError(`Leapmotor login failed: ${message}`);
            }
            if (label === 'remote verify') {
                throw new LeapmotorAuthError(
                    `Leapmotor remote verify failed: ${message}. The backend rejected the verification request before any vehicle action was sent.`,
                );
            }
            throw new LeapmotorApiError(`Leapmotor ${label} failed: ${message}`);
        }
        return data;
    }

    _recordApiResult(label, statusCode, code, message) {
        this.lastApiResults[label] = {
            http_status: statusCode,
            code,
            message,
            updated_at: Date.now() / 1000,
        };
        this.log.debug(`Leapmotor API result for ${label}: HTTP ${statusCode} code=${code} message=${message}`);
    }

    // ---- Statische Helfer ----

    static _vehicleStatusCarTypePath(carType) {
        const normalized = String(carType || 'C10')
            .trim()
            .toLowerCase();
        if (normalized === 'b10' || normalized === 'b11') {
            return 'c10';
        }
        return normalized || 'c10';
    }

    static _statusSignalCount(statusJson) {
        const statusData = (statusJson && statusJson.data) || {};
        const signal = statusData.signal;
        return signal && typeof signal === 'object' ? Object.keys(signal).length : 0;
    }
}

// Befehle werden in commands.js an den Prototyp angehängt, um die Datei
// überschaubar zu halten.
require('./commands')(LeapmotorApiClient, {
    quote,
    sleep,
    makeNonce,
    makeTimestamp,
    redactVin,
    safeInt,
    compactJson,
    REMOTE_ACTION_SPECS,
    buildSeatComfortPayload,
    buildClimatePayload,
    buildClimateScheduleEntry,
    buildPrepareCarDatacontent,
    buildPrepareCarScheduleEntry,
    normalizeChargePlan,
    chargePlanIsComplete,
    mergeChargePlans,
    deriveOperatePassword,
    errors: { LeapmotorApiError, LeapmotorAuthError, isTokenError },
});

module.exports = { LeapmotorApiClient };
