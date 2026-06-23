'use strict';

/**
 * Verifizierte Fernsteuerungs-Payloads und Payload-Builder.
 * Portiert aus leap_api/remote.py sowie den _build_*-Helfern der api.py.
 */

const crypto = require('crypto');
const C = require('./constants');

/**
 * Verifizierte Fernsteuer-Aktionen: action -> { cmdId, cmdContent }.
 */
const REMOTE_ACTION_SPECS = {
    [C.REMOTE_CTL_UNLOCK]: { cmdId: '110', cmdContent: '{"value":"unlock"}' },
    [C.REMOTE_CTL_LOCK]: { cmdId: '110', cmdContent: '{"value":"lock"}' },
    [C.REMOTE_CTL_UNLOCK_CHARGER]: {
        cmdId: '192',
        cmdContent: '{"operation":"unlock"}',
    },
    [C.REMOTE_CTL_TRUNK]: { cmdId: '130', cmdContent: '{"value":"true"}' },
    [C.REMOTE_CTL_TRUNK_OPEN]: { cmdId: '130', cmdContent: '{"value":"true"}' },
    [C.REMOTE_CTL_TRUNK_CLOSE]: { cmdId: '130', cmdContent: '{"value":"false"}' },
    [C.REMOTE_CTL_FIND_CAR]: { cmdId: '120', cmdContent: '{"value":"true"}' },
    [C.REMOTE_CTL_SUNSHADE]: { cmdId: '240', cmdContent: '{"value":"10"}' },
    [C.REMOTE_CTL_SUNSHADE_OPEN]: { cmdId: '240', cmdContent: '{"value":"10"}' },
    [C.REMOTE_CTL_SUNSHADE_CLOSE]: { cmdId: '240', cmdContent: '{"value":"0"}' },
    [C.REMOTE_CTL_BATTERY_PREHEAT]: {
        cmdId: '160',
        cmdContent: '{"value":"ptcon"}',
    },
    [C.REMOTE_CTL_BATTERY_PREHEAT_OFF]: {
        cmdId: '160',
        cmdContent: '{"value":"ptcoff"}',
    },
    [C.REMOTE_CTL_STEERING_WHEEL_HEAT_ON]: {
        cmdId: '320',
        cmdContent: '{"level":"2"}',
    },
    [C.REMOTE_CTL_STEERING_WHEEL_HEAT_OFF]: {
        cmdId: '320',
        cmdContent: '{"level":"1"}',
    },
    [C.REMOTE_CTL_REARVIEW_MIRROR_HEAT_ON]: {
        cmdId: '440',
        cmdContent: '{"value":"2"}',
    },
    [C.REMOTE_CTL_REARVIEW_MIRROR_HEAT_OFF]: {
        cmdId: '440',
        cmdContent: '{"value":"1"}',
    },
    [C.REMOTE_CTL_SEAT_HEAT]: {
        cmdId: '301',
        cmdContent: '{"position":"driver","level":"3"}',
    },
    [C.REMOTE_CTL_SEAT_VENTILATION]: {
        cmdId: '370',
        cmdContent: '{"position":"driver","level":"3"}',
    },
    [C.REMOTE_CTL_WINDOWS]: { cmdId: '230', cmdContent: '{"value":"2"}' },
    [C.REMOTE_CTL_WINDOWS_OPEN]: { cmdId: '230', cmdContent: '{"value":"2"}' },
    [C.REMOTE_CTL_WINDOWS_CLOSE]: { cmdId: '230', cmdContent: '{"value":"0"}' },
    [C.REMOTE_CTL_AC_SWITCH]: { cmdId: '170', cmdContent: '{"operate":"off"}' },
    [C.REMOTE_CTL_AC_ON]: {
        cmdId: '170',
        cmdContent:
            '{"circle":"out","mode":"nohotcold","operate":"manual","position":"all","temperature":"24","windlevel":"4","wshld":"1"}',
    },
    [C.REMOTE_CTL_AC_OFF]: { cmdId: '170', cmdContent: '{"operate":"off"}' },
    [C.REMOTE_CTL_QUICK_COOL]: {
        cmdId: '170',
        cmdContent:
            '{"circle":"in","mode":"cold","operate":"manual","position":"all","temperature":"18","windlevel":"7","wshld":"1"}',
    },
    [C.REMOTE_CTL_QUICK_HEAT]: {
        cmdId: '170',
        cmdContent:
            '{"circle":"in","mode":"hot","operate":"manual","position":"all","temperature":"32","windlevel":"7","wshld":"1"}',
    },
    [C.REMOTE_CTL_WINDSHIELD_DEFROST]: {
        cmdId: '170',
        cmdContent:
            '{"circle":"in","mode":"hot","operate":"manual","position":"all","temperature":"32","windlevel":"7","wshld":"2"}',
    },
};

/**
 * kompaktes JSON wie Python json.dumps(separators=(',', ':'))
 *
 * @param obj
 */
function compactJson(obj) {
    return JSON.stringify(obj);
}

/**
 * Baut die Sitzheizung/-belüftung-Payload des internationalen App-Clients.
 *
 * @param position
 * @param level
 */
function buildSeatComfortPayload(position, level) {
    if (position !== 'driver' && position !== 'copilot') {
        throw new Error(`Unsupported seat position: ${position}`);
    }
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 3) {
        throw new Error(`Seat comfort level must be an integer from 0 to 3: ${level}`);
    }
    return compactJson({ position, level: String(level) });
}

/**
 * Baut die cmdId=170 Klima-Payload des offiziellen App-Clients.
 *
 * @param root0
 * @param root0.temperature
 * @param root0.mode
 * @param root0.windlevel
 * @param root0.circle
 * @param root0.operate
 */
function buildClimatePayload({ temperature, mode, windlevel, circle, operate }) {
    let resolvedMode = mode || 'nohotcold';
    if (resolvedMode === 'wind') {
        resolvedMode = 'nohotcold';
    }
    const resolvedCircle = circle || 'out';
    const resolvedTemperature = temperature == null ? 24 : parseInt(temperature, 10);
    const resolvedWindlevel = windlevel == null ? 4 : parseInt(windlevel, 10);

    if (!['cold', 'hot', 'nohotcold'].includes(resolvedMode)) {
        throw new Error('Climate mode must be one of: cold, hot, wind, nohotcold.');
    }
    if (!['in', 'out'].includes(resolvedCircle)) {
        throw new Error('Climate circulation must be one of: in, out.');
    }
    if (resolvedTemperature < 18 || resolvedTemperature > 32) {
        throw new Error('Climate temperature must be between 18 and 32.');
    }
    if (resolvedWindlevel < 1 || resolvedWindlevel > 7) {
        throw new Error('Climate fan level must be between 1 and 7.');
    }

    return {
        circle: resolvedCircle,
        mode: resolvedMode,
        operate,
        position: 'all',
        temperature: String(resolvedTemperature),
        windlevel: String(resolvedWindlevel),
        wshld: '1',
    };
}

/**
 * Normalisiert App-Wochentage 0=Sonntag..6=Samstag und entfernt Duplikate.
 *
 * @param days
 */
function normalizeScheduleDays(days) {
    const normalized = [];
    for (const day of days || []) {
        const dayInt = parseInt(day, 10);
        if (!(dayInt >= 0 && dayInt <= 6)) {
            throw new Error(`Climate schedule day must be 0..6: ${day}`);
        }
        if (!normalized.includes(dayInt)) {
            normalized.push(dayInt);
        }
    }
    return normalized;
}

/**
 * Normalisiert einen ISO-Datetime-Wert auf das lokale App-Stringformat.
 *
 * @param startTime
 */
function normalizeScheduleStartTime(startTime) {
    const text = String(startTime || '').trim();
    if (!text) {
        throw new Error('Climate schedule start_time is required.');
    }
    const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
    if (!m) {
        throw new Error(`Invalid schedule start_time: ${startTime}`);
    }
    return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:00`;
}

/**
 * App-förmige opake Schedule-ID.
 *
 * @param nowMs
 */
function newScheduleId(nowMs) {
    return `ios_${crypto.randomUUID().replace(/-/g, '')}${Math.floor(nowMs / 1000)}`;
}

/**
 * Baut einen Klima-Vorkonditionierungs-Eintrag für cmdId 171.
 *
 * @param root0
 * @param root0.startTime
 * @param root0.mode
 * @param root0.operate
 * @param root0.temperature
 * @param root0.fanSpeed
 * @param root0.recirculate
 * @param root0.windshieldDefrost
 * @param root0.days
 * @param root0.enabled
 * @param root0.setId
 */
function buildClimateScheduleEntry({
    startTime,
    mode = 'nohotcold',
    operate = 'manual',
    temperature = 26,
    fanSpeed = 4,
    recirculate = false,
    windshieldDefrost = false,
    days = [],
    enabled = true,
    setId = null,
}) {
    if (!['cold', 'hot', 'nohotcold'].includes(mode)) {
        throw new Error(`Unsupported climate schedule mode: ${mode}`);
    }
    if (!['manual', 'auto'].includes(operate)) {
        throw new Error(`Unsupported climate schedule operation: ${operate}`);
    }
    if (!(parseInt(temperature, 10) >= 18 && parseInt(temperature, 10) <= 32)) {
        throw new Error(`Climate schedule temperature must be 18..32: ${temperature}`);
    }
    if (!(parseInt(fanSpeed, 10) >= 1 && parseInt(fanSpeed, 10) <= 7)) {
        throw new Error(`Climate schedule fan speed must be 1..7: ${fanSpeed}`);
    }
    const normalizedDays = normalizeScheduleDays(days);
    const nowMs = Date.now();
    return {
        mode,
        operate,
        temperature: String(parseInt(temperature, 10)),
        circle: recirculate ? 'in' : 'out',
        windlevel: String(parseInt(fanSpeed, 10)),
        wshld: windshieldDefrost ? '2' : '1',
        days: normalizedDays,
        on: enabled ? '1' : '0',
        position: 'all',
        start_time: normalizeScheduleStartTime(startTime),
        set_id: setId && String(setId).trim() ? String(setId).trim() : newScheduleId(nowMs),
        update_time: String(nowMs),
    };
}

/**
 * Sitz-Code für die Prepare-Car-Payload.
 *
 * @param mode
 * @param level
 * @param label
 */
function prepareCarSeatCode(mode, level, label) {
    if (!['off', 'heat', 'ventilation'].includes(mode)) {
        throw new Error(`Prepare-car ${label} seat mode must be off, heat or ventilation: ${mode}`);
    }
    if (mode === 'off') {
        return '0';
    }
    const levelInt = parseInt(level, 10);
    if (!(levelInt >= 1 && levelInt <= 3)) {
        throw new Error(`Prepare-car ${label} seat level must be 1..3: ${level}`);
    }
    return mode === 'heat' ? String(levelInt) : String(10 + levelInt);
}

/**
 * Formatiert Koordinaten wie die App, ohne wissenschaftliche Notation.
 *
 * @param value
 */
function formatPrepareCarCoordinate(value) {
    let s = Number(value).toFixed(8);
    s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
}

/**
 * Optionale Navigations-Sync-Payload innerhalb von prepare-car.
 *
 * @param root0
 * @param root0.destinationName
 * @param root0.destinationAddress
 * @param root0.destinationLatitude
 * @param root0.destinationLongitude
 */
function buildPrepareCarDestination({
    destinationName,
    destinationAddress,
    destinationLatitude,
    destinationLongitude,
}) {
    const hasDestination = [destinationName, destinationAddress, destinationLatitude, destinationLongitude].some(
        v => v != null && v !== '',
    );
    if (!hasDestination) {
        return null;
    }
    if (destinationLatitude == null || destinationLongitude == null) {
        throw new Error('Prepare-car destination requires latitude and longitude.');
    }
    const name = String(destinationName || '').trim();
    if (!name) {
        throw new Error('Prepare-car destination requires destination_name.');
    }
    const address = String(destinationAddress || name).trim();
    return {
        address,
        addressname: name,
        addresskey: '',
        config: '0110',
        latitude: formatPrepareCarCoordinate(destinationLatitude),
        longitude: formatPrepareCarCoordinate(destinationLongitude),
        linenum: '0',
        enable: true,
    };
}

/**
 * Baut das cmdId 360/361 datacontent-Bündel.
 *
 * @param opts
 */
function buildPrepareCarDatacontent(opts) {
    const {
        climateEnabled = true,
        mode = 'cold',
        operate = 'manual',
        temperature = 18,
        fanSpeed = 7,
        recirculate = true,
        windshieldDefrost = false,
        driverSeat = 'off',
        driverSeatLevel = 3,
        passengerSeat = 'off',
        passengerSeatLevel = 3,
        steeringWheelHeat = false,
        mirrorHeat = false,
    } = opts;

    const datacontent = {};
    if (climateEnabled) {
        if (!['cold', 'hot', 'nohotcold'].includes(mode)) {
            throw new Error(`Prepare-car climate mode must be cold, hot or nohotcold: ${mode}`);
        }
        if (!['manual', 'auto'].includes(operate)) {
            throw new Error(`Prepare-car operation must be manual or auto: ${operate}`);
        }
        if (!(parseInt(temperature, 10) >= 18 && parseInt(temperature, 10) <= 32)) {
            throw new Error(`Prepare-car temperature must be 18..32: ${temperature}`);
        }
        if (!(parseInt(fanSpeed, 10) >= 1 && parseInt(fanSpeed, 10) <= 7)) {
            throw new Error(`Prepare-car fan speed must be 1..7: ${fanSpeed}`);
        }
        datacontent.air_condition = {
            mode,
            temperature: String(parseInt(temperature, 10)),
            circle: recirculate ? 'in' : 'out',
            windlevel: String(parseInt(fanSpeed, 10)),
            wshld: windshieldDefrost ? '2' : '1',
            operate,
            position: 'all',
            enable: true,
        };
    }

    const seatSetting = {
        driver: prepareCarSeatCode(driverSeat, driverSeatLevel, 'driver'),
        copilot: prepareCarSeatCode(passengerSeat, passengerSeatLevel, 'passenger'),
        left_rear: '0',
        right_rear: '0',
    };
    if (Object.values(seatSetting).some(v => v !== '0')) {
        datacontent.seat_setting = { ...seatSetting, enable: true };
    }

    if (steeringWheelHeat) {
        datacontent.steeringWheelHeatCtrl = { enable: true, level: '2' };
    }
    if (mirrorHeat) {
        datacontent.rearMirrorHeating = { enable: true, value: '2' };
    }

    const destination = buildPrepareCarDestination(opts);
    if (destination) {
        datacontent.syn_path = destination;
    }

    if (Object.keys(datacontent).length === 0) {
        throw new Error('Prepare-car requires at least one enabled dimension.');
    }
    return datacontent;
}

/**
 * Baut einen Prepare-Car-Schedule-Eintrag für cmdId 361.
 *
 * @param opts
 */
function buildPrepareCarScheduleEntry(opts) {
    const nowMs = Date.now();
    return {
        datacontent: buildPrepareCarDatacontent(opts),
        days: normalizeScheduleDays(opts.days || []),
        enable: Boolean(opts.enabled != null ? opts.enabled : true),
        set_id: opts.setId && String(opts.setId).trim() ? String(opts.setId).trim() : newScheduleId(nowMs),
        start_time: normalizeScheduleStartTime(opts.startTime),
    };
}

// ---- Laderplan-Helfer ----

function safeInt(raw) {
    if (raw == null) {
        return null;
    }
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
}

/**
 * Normalisiert Status- und Appointment-Ladeplan-Schlüsselvarianten.
 *
 * @param plan
 */
function normalizeChargePlan(plan) {
    if (!plan || typeof plan !== 'object') {
        return {};
    }
    const pick = (a, b) => (plan[a] !== undefined ? plan[a] : plan[b]);
    return {
        isEnable: pick('isEnable', 'chargeEnable'),
        percent: pick('percent', 'chargesoc'),
        circulation: plan.circulation,
        cycles: plan.cycles,
        endTime: pick('endTime', 'endtime'),
        recharge: plan.recharge,
        beginTime: pick('beginTime', 'starttime'),
    };
}

function chargePlanIsComplete(plan) {
    return Boolean(plan.beginTime && plan.endTime && plan.cycles && safeInt(plan.percent) !== null);
}

function mergeChargePlans(primary, fallback) {
    const out = {};
    for (const [key, value] of Object.entries(primary)) {
        out[key] = value !== null && value !== undefined && value !== '' ? value : fallback[key];
    }
    return out;
}

module.exports = {
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
};
