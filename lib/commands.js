'use strict';

/**
 * Fernsteuerungs- und Schreibbefehle des Leapmotor-API-Clients.
 * Portiert aus den Befehlsmethoden der api.py. Wird an den Prototyp von
 * LeapmotorApiClient angehängt, um api.js übersichtlich zu halten.
 */

const C = require('./constants');

module.exports = function attachCommands(Client, helpers) {
    const {
        quote,
        sleep,
        compactJson,
        safeInt,
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
        redactVin,
        errors,
    } = helpers;
    const { LeapmotorApiError, LeapmotorAuthError, isTokenError } = errors;
    const P = Client.prototype;

    // ---- Einfache verifizierte Aktionen ----

    P.lockVehicle = function (vin) {
        return this._remoteControl({ vin, action: C.REMOTE_CTL_LOCK });
    };
    P.unlockVehicle = function (vin) {
        return this._remoteControl({ vin, action: C.REMOTE_CTL_UNLOCK });
    };
    P.unlockCharger = function (vin) {
        return this._remoteControl({ vin, action: C.REMOTE_CTL_UNLOCK_CHARGER });
    };
    P.openTrunk = function (vin) {
        return this._remoteControl({ vin, action: C.REMOTE_CTL_TRUNK });
    };
    P.closeTrunk = function (vin) {
        return this._remoteControl({ vin, action: C.REMOTE_CTL_TRUNK_CLOSE });
    };
    P.findVehicle = function (vin) {
        return this._remoteControl({ vin, action: C.REMOTE_CTL_FIND_CAR });
    };
    P.controlSunshade = function (vin) {
        return this._remoteControl({ vin, action: C.REMOTE_CTL_SUNSHADE });
    };
    P.openSunshade = function (vin, value = null) {
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_SUNSHADE_OPEN,
            value,
        });
    };
    P.closeSunshade = function (vin, value = null) {
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_SUNSHADE_CLOSE,
            value,
        });
    };
    P.batteryPreheat = function (vin) {
        return this._remoteControl({ vin, action: C.REMOTE_CTL_BATTERY_PREHEAT });
    };
    P.batteryPreheatOff = function (vin) {
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_BATTERY_PREHEAT_OFF,
        });
    };
    P.steeringWheelHeatOn = function (vin) {
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_STEERING_WHEEL_HEAT_ON,
        });
    };
    P.steeringWheelHeatOff = function (vin) {
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_STEERING_WHEEL_HEAT_OFF,
        });
    };
    P.rearviewMirrorHeatOn = function (vin) {
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_REARVIEW_MIRROR_HEAT_ON,
        });
    };
    P.rearviewMirrorHeatOff = function (vin) {
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_REARVIEW_MIRROR_HEAT_OFF,
        });
    };
    P.seatHeat = function (vin, position, level) {
        const cmdContent = buildSeatComfortPayload(position, level);
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_SEAT_HEAT,
            cmdContent,
        });
    };
    P.seatVentilation = function (vin, position, level) {
        const cmdContent = buildSeatComfortPayload(position, level);
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_SEAT_VENTILATION,
            cmdContent,
        });
    };
    P.windows = function (vin) {
        return this._remoteControl({ vin, action: C.REMOTE_CTL_WINDOWS });
    };
    P.openWindows = async function (vin, value = null) {
        let v = value;
        if (v != null) {
            const vehicle = await this.findVehicleByVin(vin);
            if (['B10', 'C10'].includes(vehicle.car_type)) {
                v = Math.round(v / 10.0);
            }
        }
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_WINDOWS_OPEN,
            value: v,
        });
    };
    P.closeWindows = async function (vin, value = null) {
        let v = value;
        if (v != null) {
            const vehicle = await this.findVehicleByVin(vin);
            if (['B10', 'C10'].includes(vehicle.car_type)) {
                v = Math.round(v / 10.0);
            }
        }
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_WINDOWS_CLOSE,
            value: v,
        });
    };
    P.acSwitch = function (vin) {
        return this.acOff(vin);
    };
    P.acOn = function (vin, { temperature = null, mode = null, windlevel = null, circle = null } = {}) {
        const params = buildClimatePayload({
            temperature,
            mode,
            windlevel,
            circle,
            operate: 'manual',
        });
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_AC_ON,
            cmdContent: params,
        });
    };
    P.acOff = function (vin) {
        return this._remoteControl({ vin, action: C.REMOTE_CTL_AC_OFF });
    };
    P.quickCool = function (vin) {
        return this._remoteControl({ vin, action: C.REMOTE_CTL_QUICK_COOL });
    };
    P.quickHeat = function (vin) {
        return this._remoteControl({ vin, action: C.REMOTE_CTL_QUICK_HEAT });
    };
    P.windshieldDefrost = function (vin) {
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_WINDSHIELD_DEFROST,
        });
    };

    P.setClimate = function (
        vin,
        { mode, temperature = 26, fanSpeed = 3, recirculate = false, windshieldDefrost = false },
    ) {
        const params = buildClimatePayload({
            temperature,
            mode,
            windlevel: fanSpeed,
            circle: recirculate ? 'in' : 'out',
            operate: 'manual',
        });
        params.wshld = windshieldDefrost ? '2' : '1';
        return this._remoteControl({
            vin,
            action: C.REMOTE_CTL_AC_ON,
            cmdContent: params,
        });
    };

    // ---- Klima-Zeitplan ----

    P.setClimateSchedule = async function (vin, opts) {
        const vehicle = await this.findVehicleByVin(vin);
        let entry;
        try {
            entry = buildClimateScheduleEntry(opts);
        } catch (err) {
            throw new LeapmotorApiError(err.message);
        }
        const cmdContent = compactJson({ controls: [entry] });
        return this._remoteControlRaw({
            vin: vehicle.vin,
            cmdId: '171',
            cmdContent,
            actionLabel: 'set_climate_schedule',
            vehicle,
        });
    };

    P.cancelClimateSchedule = async function (vin) {
        const vehicle = await this.findVehicleByVin(vin);
        return this._remoteControlRaw({
            vin: vehicle.vin,
            cmdId: '171',
            cmdContent: '{"controls":[]}',
            actionLabel: 'cancel_climate_schedule',
            vehicle,
        });
    };

    // ---- One-Touch-Vorbereitung ----

    P.prepareCar = async function (vin, opts = {}) {
        const vehicle = await this.findVehicleByVin(vin);
        let datacontent;
        try {
            datacontent = buildPrepareCarDatacontent(opts);
        } catch (err) {
            throw new LeapmotorApiError(err.message);
        }
        const cmdContent = compactJson(datacontent);
        return this._remoteControlRaw({
            vin: vehicle.vin,
            cmdId: '360',
            cmdContent,
            actionLabel: 'prepare_car',
            vehicle,
        });
    };

    P.setPrepareCarSchedule = async function (vin, opts) {
        const vehicle = await this.findVehicleByVin(vin);
        let entry;
        try {
            entry = buildPrepareCarScheduleEntry(opts);
        } catch (err) {
            throw new LeapmotorApiError(err.message);
        }
        const cmdContent = compactJson({ controls: [entry] });
        return this._remoteControlRaw({
            vin: vehicle.vin,
            cmdId: '361',
            cmdContent,
            actionLabel: 'set_prepare_car_schedule',
            vehicle,
        });
    };

    P.cancelPrepareCarSchedule = async function (vin) {
        const vehicle = await this.findVehicleByVin(vin);
        return this._remoteControlRaw({
            vin: vehicle.vin,
            cmdId: '361',
            cmdContent: '{"controls":[]}',
            actionLabel: 'cancel_prepare_car_schedule',
            vehicle,
        });
    };

    // ---- Laden ----

    P.setChargeLimit = function (vin, chargeLimitPercent) {
        return this._setChargingPlan(vin, { chargeLimitPercent });
    };

    P.setChargingPlanEnabled = function (vin, enabled) {
        return this._setChargingPlan(vin, { chargePlanEnabled: enabled });
    };

    P._setChargingPlan = async function (vin, { chargeLimitPercent = null, chargePlanEnabled = null } = {}) {
        const vehicle = await this.findVehicleByVin(vin);
        let statusJson;
        try {
            statusJson = await this.getVehicleStatus(vehicle);
        } catch (err) {
            if (!isTokenError(err)) {
                throw err;
            }
            await this._recoverSession(err);
            statusJson = await this.getVehicleStatus(vehicle);
        }
        const statusChargePlan = ((statusJson.data || {}).config || {})['3'] || {};
        let chargePlan = normalizeChargePlan(statusChargePlan);
        if (!chargePlanIsComplete(chargePlan)) {
            chargePlan = mergeChargePlans(chargePlan, normalizeChargePlan(await this.getChargeSchedule(vin)));
        }

        if (chargePlanEnabled !== null && !chargePlanIsComplete(chargePlan)) {
            throw new LeapmotorApiError('Current charging plan is incomplete, cannot safely enable or disable it.');
        }

        let startTime = chargePlan.beginTime;
        let endTime = chargePlan.endTime;
        let cycles = chargePlan.cycles;
        const currentChargeLimit = safeInt(chargePlan.percent);
        if (!startTime) {
            startTime = '00:00';
        }
        if (!endTime) {
            endTime = '08:00';
        }
        if (!cycles) {
            cycles = '1,2,3,4,5,6,7';
        }
        let limit = chargeLimitPercent;
        if (limit === null || limit === undefined) {
            limit = currentChargeLimit !== null ? currentChargeLimit : 80;
        }
        const chargeEnable =
            chargePlanEnabled !== null ? (chargePlanEnabled ? 1 : 0) : safeInt(chargePlan.isEnable) ? 1 : 0;

        const cmdContent = compactJson({
            chargeEnable,
            chargesoc: parseInt(limit, 10),
            circulation: safeInt(chargePlan.circulation) || 0,
            cycles: String(cycles),
            endtime: String(endTime),
            recharge: safeInt(chargePlan.recharge) || 0,
            starttime: String(startTime),
        });
        return this._remoteControlRaw({
            vin,
            cmdId: '190',
            cmdContent,
            actionLabel: chargePlanEnabled !== null ? 'set_charging_plan_enabled' : 'set_charge_limit',
            vehicle,
        });
    };

    P.getChargeSchedule = async function (vin) {
        try {
            return await this._getChargeSchedule(vin);
        } catch (err) {
            if (!isTokenError(err)) {
                throw err;
            }
            await this._recoverSession(err);
            return await this._getChargeSchedule(vin);
        }
    };

    P._getChargeSchedule = async function (vin) {
        const headers = this._buildSignedHeaders({
            vin,
            bodyParams: { cmdId: '190' },
        });
        Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
        const body = `vin=${quote(vin)}&cmdId=190`;
        const response = await this._post({
            path: '/carownerservice/oversea/vehicle/v1/app/remote/ctl/getAppointment',
            headers,
            data: body,
            cert: this.accountCert,
        });
        let responseBody;
        try {
            responseBody = JSON.parse(response.body);
        } catch {
            this._recordApiResult('charge schedule', response.statusCode, null, 'non_json');
            throw new LeapmotorApiError(`charge schedule returned non-JSON response: ${response.body.slice(0, 200)}`);
        }
        const resultCode = responseBody.result !== undefined ? responseBody.result : responseBody.code;
        const message = responseBody.message;
        this._recordApiResult('charge schedule', response.statusCode, resultCode, message);
        if (response.statusCode !== 200 || resultCode !== 0) {
            if (
                String(message || '')
                    .toLowerCase()
                    .includes('permission')
            ) {
                return {};
            }
            throw new LeapmotorApiError(`Leapmotor charge schedule failed: ${message || response.body.slice(0, 200)}`);
        }
        let schedule = responseBody.data;
        if (!schedule) {
            return {};
        }
        if (typeof schedule === 'string') {
            try {
                schedule = JSON.parse(schedule);
            } catch {
                return {};
            }
        }
        return schedule && typeof schedule === 'object' ? schedule : {};
    };

    // ---- Navigation ----

    P.sendDestination = async function (vin, { address, addressName, latitude, longitude }) {
        const vehicle = await this.findVehicleByVin(vin);
        const cmdContent = compactJson({
            address,
            addressname: addressName,
            latitude: String(latitude),
            linenum: '0',
            longitude: String(longitude),
        });
        return this._remoteControlWithoutPinRaw({
            vin: vehicle.vin,
            cmdId: '180',
            cmdContent,
            actionLabel: 'send_destination',
        });
    };

    // ---- Kern der Fernsteuerung ----

    P._remoteControl = async function ({ vin, action, value = null, cmdContent = null }) {
        if (!this.token) {
            await this.login();
        }
        await this._ensureAccountCert();
        if (!this.operationPassword) {
            throw new LeapmotorAuthError(
                'Keine Fahrzeug-PIN konfiguriert. Lesen funktioniert ohne PIN, Fernsteueraktionen benötigen sie.',
            );
        }
        if (!(action in REMOTE_ACTION_SPECS)) {
            throw new LeapmotorApiError(`Remote action not configured: ${action}`);
        }
        const vehicle = await this.findVehicleByVin(vin);
        const spec = REMOTE_ACTION_SPECS[action];
        let resolvedCmdContent = spec.cmdContent;
        if (cmdContent && typeof cmdContent === 'object') {
            resolvedCmdContent = compactJson(cmdContent);
        } else if (typeof cmdContent === 'string') {
            resolvedCmdContent = cmdContent;
        }
        if (value !== null && value !== undefined) {
            resolvedCmdContent = compactJson({ value: String(value) });
        }
        return this._remoteControlRaw({
            vin: vehicle.vin,
            cmdId: spec.cmdId,
            cmdContent: resolvedCmdContent,
            actionLabel: action,
            vehicle,
        });
    };

    P._remoteControlRaw = async function ({ vin, cmdId, cmdContent, actionLabel, vehicle = null }) {
        this.log.debug(`Starting Leapmotor remote action ${actionLabel} for VIN ${redactVin(vin)}`);
        if (!this.token) {
            await this.login();
        }
        await this._ensureAccountCert();
        if (!this.operationPassword) {
            throw new LeapmotorAuthError(
                'Keine Fahrzeug-PIN konfiguriert. Lesen funktioniert ohne PIN, Fernsteueraktionen benötigen sie.',
            );
        }
        if (vehicle === null) {
            vehicle = await this.findVehicleByVin(vin);
        }

        const operatePassword = deriveOperatePassword(this.operationPassword, this.token);
        await this._ensureRemoteCertSync();

        const verifyHeaders = this._buildOperpwdVerifyHeaders({
            vin,
            operationPassword: operatePassword,
        });
        Object.assign(verifyHeaders, this._authHeaders('application/x-www-form-urlencoded'));
        const verifyBody = `operatePassword=${quote(operatePassword)}&vin=${quote(vin)}`;
        const verifyResponse = await this._post({
            path: '/carownerservice/oversea/vehicle/v1/operPwd/verify',
            headers: verifyHeaders,
            data: verifyBody,
            cert: this.accountCert,
        });
        this.log.debug(`Leapmotor remote verify response for ${actionLabel}: HTTP ${verifyResponse.statusCode}`);
        this._parseApiBody(verifyResponse.statusCode, verifyResponse.body, 'remote verify');

        const headers = this._buildRemoteCtlWriteHeaders({
            vin,
            cmdContent,
            cmdId,
            operationPassword: operatePassword,
        });
        Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
        const body =
            `cmdContent=${quote(cmdContent)}` +
            `&vin=${quote(vin)}` +
            `&cmdId=${quote(cmdId)}` +
            `&operatePassword=${quote(operatePassword)}`;
        const response = await this._post({
            path: '/carownerservice/oversea/vehicle/v1/app/remote/ctl',
            headers,
            data: body,
            cert: this.accountCert,
        });
        this.log.debug(`Leapmotor remote ctl response for ${actionLabel}: HTTP ${response.statusCode}`);
        const result = this._parseApiBody(response.statusCode, response.body, `remote ${actionLabel}`);
        const remoteData = result.data || {};
        const remoteCtlId = remoteData.remoteCtlId;
        if (remoteCtlId) {
            await this._pollRemoteControlResult({
                remoteCtlId: String(remoteCtlId),
                timeoutMs: parseInt(remoteData.queryRemoteCtlResultTimeout || 30000, 10),
                intervalMs: parseInt(remoteData.queryInterval || 2000, 10),
            });
        }
        return result;
    };

    P._remoteControlWithoutPinRaw = async function ({ vin, cmdId, cmdContent, actionLabel }) {
        this.log.debug(`Starting Leapmotor remote action ${actionLabel} for VIN ${redactVin(vin)}`);
        if (!this.token) {
            await this.login();
        }
        await this._ensureAccountCert();

        const headers = this._buildRemoteCtlWriteHeadersWithoutPin({
            vin,
            cmdContent,
            cmdId,
        });
        Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
        const body = `cmdContent=${quote(cmdContent)}&vin=${quote(vin)}&cmdId=${quote(cmdId)}`;
        const response = await this._post({
            path: '/carownerservice/oversea/vehicle/v1/app/remote/ctl',
            headers,
            data: body,
            cert: this.accountCert,
        });
        this.log.debug(`Leapmotor remote ctl response for ${actionLabel}: HTTP ${response.statusCode}`);
        return this._parseApiBody(response.statusCode, response.body, `remote ${actionLabel}`);
    };

    P._ensureRemoteCertSync = async function () {
        if (this.remoteCertSynced) {
            return;
        }
        const headers = this._buildSignedHeaders();
        Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
        const response = await this._post({
            path: '/carownerservice/oversea/vehicle/v1/cert/sync',
            headers,
            data: '',
            cert: this.staticCert, // bewusst das statische App-Zertifikat
        });
        this._parseApiBody(response.statusCode, response.body, 'cert sync');
        this.remoteCertSynced = true;
    };

    P._pollRemoteControlResult = async function ({ remoteCtlId, timeoutMs, intervalMs }) {
        const data = `remoteCtlId=${quote(remoteCtlId)}`;
        const deadline = Date.now() + Math.max(timeoutMs, 1000);
        let lastResult = null;
        while (Date.now() < deadline) {
            const headers = this._buildRemoteCtlResultHeaders({ remoteCtlId });
            Object.assign(headers, this._authHeaders('application/x-www-form-urlencoded'));
            const response = await this._post({
                path: '/carownerservice/oversea/vehicle/v1/app/remote/ctl/result/query',
                headers,
                data,
                cert: this.accountCert,
            });
            lastResult = this._parseApiBody(response.statusCode, response.body, 'remote control result');
            if (lastResult.data === 1) {
                return lastResult;
            }
            const sleepMs = Math.max(intervalMs, 250);
            if (Date.now() + sleepMs >= deadline) {
                break;
            }
            await sleep(sleepMs);
        }
        throw new LeapmotorApiError(`Timed out waiting for remote control result: ${JSON.stringify(lastResult)}`);
    };
};
