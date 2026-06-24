'use strict';

/**
 * Normalisierung der Leapmotor-Statusdaten.
 * Portiert aus normalize_vehicle und den zugehörigen Helfern der api.py.
 *
 * Liefert eine verschachtelte Struktur mit interpretierten Werten plus einen
 * `raw`-Block mit allen numerischen Rohsignalen (für Diagnose).
 */

// ---- Basis-Helfer ----

function safeInt(raw) {
    if (raw == null) {
        return null;
    }
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? null : n;
}

function safeFloat(raw) {
    if (raw == null) {
        return null;
    }
    const n = parseFloat(raw);
    return Number.isNaN(n) ? null : n;
}

function toBar(raw) {
    const n = safeFloat(raw);
    if (n == null) {
        return null;
    }
    return Math.round((n / 100.0) * 100) / 100;
}

function oneIsOn(raw) {
    const v = safeInt(raw);
    if (v == null) {
        return null;
    }
    return v === 1;
}

function twoIsOn(raw) {
    const v = safeInt(raw);
    if (v == null) {
        return null;
    }
    return v === 2;
}

function notZero(raw) {
    if (raw == null) {
        return null;
    }
    return String(raw) !== '0';
}

function positiveInt(raw) {
    const v = safeInt(raw);
    if (v == null) {
        return null;
    }
    return v > 0;
}

function safeBool(raw) {
    if (raw == null) {
        return null;
    }
    if (typeof raw === 'boolean') {
        return raw;
    }
    if (typeof raw === 'number') {
        return raw !== 0;
    }
    const normalized = String(raw).trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }
    return null;
}

function whToKwh(raw) {
    const v = safeFloat(raw);
    if (v == null) {
        return null;
    }
    return Math.round((v / 1000.0) * 100) / 100;
}

// ---- Signalaufbereitung ----

/**
 * Mappt benannte T03-Statusfelder auf die numerischen Signal-IDs der APK.
 *
 * @param statusData
 */
function namedStatusToSignal(statusData) {
    const mapped = {};
    const fieldMap = {
        soc: '1204',
        chargeRemainTime: '1200',
        batteryCurrent: '1178',
        batteryVoltage: '1177',
        dcInputFastCharge: '1197',
        expectedMileage: '3260',
        speed: '1319',
        totalMileage: '1318',
        gearStatus: '1010',
        latitude: '3725',
        longitude: '3724',
        acSwitch: '1938',
        acSetting: '2183',
        leftFrontWindowPercent: '3727',
        rightFrontWindowPercent: '3728',
        leftRearWindowPercent: '1879',
        rightRearWindowPercent: '1880',
        leftFrontTirePressure: '2646',
        rightFrontTirePressure: '2653',
        leftRearTirePressure: '2660',
        rightRearTirePressure: '2667',
        leftFrontTirePressureState: '2641',
        rightFrontTirePressureState: '2648',
        leftRearTirePressureState: '2655',
        rightRearTirePressureState: '2662',
    };
    for (const [source, target] of Object.entries(fieldMap)) {
        if (statusData[source] != null) {
            mapped[target] = statusData[source];
        }
    }
    if (statusData.expectedMileage != null) {
        mapped['2188'] = statusData.expectedMileage;
    }
    if (statusData.acSetting != null) {
        mapped['2184'] = statusData.acSetting;
    }

    const boolMap = {
        driverDoorLockStatus: '1298',
        lbcmDriverDoorStatus: '1277',
        rbcmDriverDoorStatus: '1278',
        lbcmLeftRearDoorStatus: '1279',
        rbcmRightRearDoorStatus: '1280',
        bbcmBackDoorStatus: '1281',
        driverWindowStatus: '1693',
        rightFrontWindowStatus: '1694',
        leftRearWindowStatus: '1695',
        rightRearWindowStatus: '1696',
        bcmKeyPositionOn1: '1256',
        bcmKeyPositionOn2: '1257',
        bcmKeyPositionOn3: '1258',
    };
    for (const [source, target] of Object.entries(boolMap)) {
        if (statusData[source] != null) {
            mapped[target] = statusData[source] ? 1 : 0;
        }
    }

    if (statusData.chargeState != null) {
        const chargeState = safeInt(statusData.chargeState);
        mapped['1149'] = chargeState;
        mapped['47'] = [1, 2].includes(chargeState) ? 1 : 0;
    }
    if (statusData.collectTime != null) {
        mapped.sts = statusData.collectTime;
    } else if (statusData.collectTimeMs != null) {
        mapped.sts = statusData.collectTimeMs;
    }
    return mapped;
}

/**
 * Liefert die numerische Signal-Map inkl. Fallback aus benannten Feldern.
 *
 * @param statusData
 */
function statusDataSignal(statusData) {
    const rawSignal = statusData.signal || {};
    const signal = rawSignal && typeof rawSignal === 'object' ? { ...rawSignal } : {};
    const namedSignal = namedStatusToSignal(statusData);
    for (const [key, value] of Object.entries(namedSignal)) {
        if (signal[key] === undefined) {
            signal[key] = value;
        }
    }
    return signal;
}

function chargePlanFromNamedStatus(statusData) {
    const chargeLimit = statusData.chargesocSetting;
    const chargeTime = statusData.chargeTimeSetting;
    if (chargeLimit == null && chargeTime == null) {
        return {};
    }
    const plan = {};
    if (chargeLimit != null) {
        plan.percent = chargeLimit;
    }
    if (chargeTime != null) {
        plan.beginTime = chargeTime;
    }
    return plan;
}

// ---- Interpretation ----

function gearState(signal) {
    return { 0: 'P', 1: 'R', 2: 'N', 3: 'D' }[safeInt(signal['1010'])] ?? null;
}

function rangeMode(signal) {
    return { 0: 'CLTC', 1: 'WLTP' }[safeInt(signal['3262'])] ?? null;
}

function deriveVehicleState(signal) {
    const gear = safeInt(signal['1010']);
    if (gear != null) {
        if ([1, 3].includes(gear)) {
            return 'driving';
        }
        if ([0, 2].includes(gear)) {
            return 'parked';
        }
    }
    const speed = safeFloat(signal['1319']);
    if (speed != null) {
        return speed > 0 ? 'driving' : 'parked';
    }
    const on3 = oneIsOn(signal['1258']);
    if (on3 != null) {
        return 'parked';
    }
    return null;
}

function isLocked(signal) {
    const lockStatus = safeInt(signal['1298']);
    if (lockStatus == null) {
        return null;
    }
    if (lockStatus === 1) {
        return true;
    }
    if (lockStatus === 0) {
        return false;
    }
    return null;
}

function chargingPowerKw(signal) {
    const current = safeFloat(signal['1178']);
    const voltage = safeFloat(signal['1177']);
    if (current == null || voltage == null) {
        return null;
    }
    const absCurrent = Math.abs(current);
    const rawPowerKw = Math.abs(current * voltage) / 1000.0;
    if (absCurrent < 1.0) {
        return 0.0;
    }
    if (absCurrent < 3.0) {
        const remaining = safeInt(signal['1200']);
        if (remaining == null && rawPowerKw < 1.0) {
            return null;
        }
    }
    return Math.round(rawPowerKw * 100) / 100;
}

/**
 * Vorzeichenbehaftete Batterieleistung in kW (negativ = laden, positiv = entladen/fahren).
 *
 * @param signal
 */
function batteryPowerKw(signal) {
    const current = safeFloat(signal['1178']);
    const voltage = safeFloat(signal['1177']);
    if (current == null || voltage == null) {
        return null;
    }
    return Math.round(((current * voltage) / 1000.0) * 100) / 100;
}

/**
 * True, wenn alle vier Reifendruck-Alarme inaktiv sind.
 *
 * @param signal
 */
function tiresAllOk(signal) {
    const alarms = ['2641', '2648', '2655', '2662'].map(id => safeInt(signal[id]));
    if (alarms.some(a => a == null)) {
        return null;
    }
    return alarms.every(a => a === 0);
}

function isCharging(signal) {
    const remaining = safeInt(signal['1200']);
    const current = safeFloat(signal['1178']);
    const powerKw = chargingPowerKw(signal);
    if (current != null) {
        if (Math.abs(current) < 1.0) {
            return false;
        }
        if (Math.abs(current) < 3.0) {
            return remaining != null && (remaining > 0 || (powerKw != null && powerKw >= 1.0));
        }
        return remaining != null || (powerKw != null && powerKw >= 1.0);
    }
    if (powerKw != null) {
        return powerKw >= 1.0 && remaining != null;
    }
    const connection = safeInt(signal['1149']);
    if (connection === 2) {
        return true;
    }
    if (connection === 0 || connection === 1) {
        return false;
    }
    return false;
}

function isPluggedIn(signal) {
    const plug = safeInt(signal['47']);
    if (plug != null) {
        return plug === 1;
    }
    const connection = safeInt(signal['1149']);
    if (connection != null) {
        return [1, 2].includes(connection);
    }
    return null;
}

function isRegening(signal) {
    const plugged = isPluggedIn(signal);
    if (plugged == null) {
        return null;
    }
    if (plugged) {
        return false;
    }
    return isCharging(signal);
}

function chargeIsFinished(signal) {
    if (isCharging(signal)) {
        return false;
    }
    if (!isPluggedIn(signal)) {
        return false;
    }
    if (oneIsOn(signal['3736'])) {
        return true;
    }
    const connection = safeInt(signal['1149']);
    if (connection !== 2) {
        return false;
    }
    const remaining = safeInt(signal['1200']);
    const current = safeFloat(signal['1178']);
    const powerKw = chargingPowerKw(signal);
    const currentIdle = current != null && Math.abs(current) < 1.0;
    const powerIdle = powerKw == null || powerKw < 1.0;
    return currentIdle && powerIdle && (remaining == null || remaining === 0);
}

function chargingConnectionState(signal) {
    if (isCharging(signal)) {
        return 'charging';
    }
    if (chargeIsFinished(signal)) {
        return 'finished';
    }
    const current = safeFloat(signal['1178']);
    if (current != null && Math.abs(current) < 1.0) {
        return isPluggedIn(signal) ? 'plugged_in' : 'unplugged';
    }
    const connection = safeInt(signal['1149']);
    if (connection === 0) {
        return 'unplugged';
    }
    if (connection === 1) {
        return 'plugged_in';
    }
    if (connection === 2) {
        return isPluggedIn(signal) ? 'plugged_in' : 'charging';
    }
    return null;
}

/**
 * EVCC-Statusbuchstabe aus dem Verbindungszustand (A=getrennt, B=verbunden, C=lädt).
 *
 * @param connectionState
 */
function evccStatus(connectionState) {
    return { unplugged: 'A', plugged_in: 'B', charging: 'C', finished: 'B' }[connectionState] ?? null;
}

function climateMode(signal) {
    const mode = safeInt(signal['3713']);
    return { 0: 'off', 1: 'fast_cool', 3: 'fast_heat', 4: 'quick_ventilation' }[mode] ?? null;
}

function tirePressuresBar(signal) {
    return {
        tire_pressure_front_left_bar: toBar(signal['2646']),
        tire_pressure_front_right_bar: toBar(signal['2653']),
        tire_pressure_rear_left_bar: toBar(signal['2660']),
        tire_pressure_rear_right_bar: toBar(signal['2667']),
    };
}

function sumDetailField(detail, field) {
    if (!Array.isArray(detail)) {
        return null;
    }
    let total = 0.0;
    let found = false;
    for (const item of detail) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const value = safeFloat(item[field]);
        if (value == null) {
            continue;
        }
        total += value;
        found = true;
    }
    return found ? total : null;
}

function energyBreakdownPercentages(data) {
    const values = {
        driving: safeFloat(data.driverEC),
        climate: safeFloat(data.acEC),
        other: safeFloat(data.otherEC),
    };
    const total = Object.values(values).reduce((acc, v) => acc + (v != null ? v : 0), 0);
    if (total <= 0) {
        return { driving: null, climate: null, other: null };
    }
    const out = {};
    for (const [key, value] of Object.entries(values)) {
        out[key] = value != null ? Math.round(((value * 100) / total) * 10) / 10 : null;
    }
    return out;
}

function vehicleStatusCarTypePath(carType) {
    const normalized = String(carType || 'C10')
        .trim()
        .toLowerCase();
    if (normalized === 'b10' || normalized === 'b11') {
        return 'c10';
    }
    return normalized || 'c10';
}

/**
 * Alle numerischen Rohsignale ohne Standortsignale.
 *
 * @param signal
 */
function supportRawSignals(signal) {
    const locationIds = new Set(['2190', '2191', '3724', '3725']);
    const out = {};
    for (const [id, value] of Object.entries(signal)) {
        if (/^\d+$/.test(String(id)) && !locationIds.has(String(id))) {
            out[id] = value;
        }
    }
    return out;
}

// ---- Hauptfunktion ----

/**
 * Normalisiert ein Fahrzeugdatenpaket aus dem API-Client.
 *
 * @param {object} bundle - { vehicle, status, mileage, consumptionRank, consumptionBreakdown, picture, chargingDaily, notifications }
 * @param {string|null} userId
 * @returns {object}
 */
function normalizeVehicle(bundle, userId) {
    const vehicle = bundle.vehicle;
    const statusJson = bundle.status || {};
    const statusData = statusJson.data || {};
    const signal = statusDataSignal(statusData);
    const config = statusData.config || {};
    const chargePlan = config['3'] || chargePlanFromNamedStatus(statusData);
    const mileageData = (bundle.mileage || {}).data || {};
    const rankData = (bundle.consumptionRank || {}).data || {};
    const rankResult = rankData.rankResult || {};
    const weeklyEc = rankData.weeklyEC || [];
    const breakdownData = (bundle.consumptionBreakdown || {}).data || {};
    const pictureData = (bundle.picture || {}).data || {};
    const chargeRecords = ((bundle.chargingDaily || {}).data || {}).list || [];
    const lastCharge = chargeRecords[0] || null;
    const vehicleState = deriveVehicleState(signal);
    const tirePressures = tirePressuresBar(signal);
    const last7DaysEnergy = sumDetailField(mileageData.detail, 'accumulatedEnergyConsume');
    const lastWeekSplit = energyBreakdownPercentages(breakdownData);
    const statusEndpointPath = vehicleStatusCarTypePath(vehicle.car_type);

    return {
        vehicle: {
            vin: vehicle.vin,
            user_id: userId,
            car_id: vehicle.car_id,
            car_type: vehicle.car_type,
            nickname: vehicle.nickname,
            is_shared: vehicle.is_shared,
            year: vehicle.year,
            abilities: vehicle.abilities || [],
        },
        status: {
            battery_percent: signal['1204'],
            fuel_level_percent: safeFloat(signal['3235']),
            remaining_range_km: signal['3260'],
            fuel_range_km: safeInt(signal['3259']),
            combined_range_km: safeInt(signal['3261']),
            odometer_km: signal['1318'],
            speed_kmh: safeFloat(signal['1319']),
            gear: gearState(signal),
            is_driving: vehicleState != null ? vehicleState === 'driving' : null,
            battery_percent_precise: safeFloat(signal['100003']),
            cltc_range_km: safeInt(signal['3257']),
            wltp_max_range_km: safeInt(signal['3257']),
            live_remaining_range_km: safeInt(signal['2188']),
            range_mode: rangeMode(signal),
            is_locked: isLocked(signal),
            is_parked: vehicleState != null ? vehicleState === 'parked' : null,
            vehicle_state: vehicleState,
            interior_temp_c: signal['1349'],
            climate_set_temp_left_c: signal['2183'],
            climate_set_temp_right_c: signal['2184'],
            last_vehicle_timestamp: signal.sts,
        },
        location: {
            latitude: signal['3725'] != null ? signal['3725'] : signal['2190'],
            longitude: signal['3724'] != null ? signal['3724'] : signal['2191'],
            privacy_gps: statusData.privacyGPS,
            privacy_data: statusData.privacyData,
            last_vehicle_timestamp: signal.sts,
        },
        charging: {
            is_charging: isCharging(signal),
            is_plugged_in: isPluggedIn(signal),
            is_regening: isRegening(signal),
            connection_state: chargingConnectionState(signal),
            evcc_status: evccStatus(chargingConnectionState(signal)),
            charge_limit_percent: chargePlan.percent,
            remaining_charge_minutes: safeInt(signal['1200']),
            charging_power_kw: chargingPowerKw(signal),
            battery_power_kw: batteryPowerKw(signal),
            ac_gun_connected: oneIsOn(signal['47']),
            charging_current_a: safeFloat(signal['1178']),
            charging_voltage_v: safeFloat(signal['1177']),
            dc_cable_connected: notZero(signal['1197']),
            charging_planned_enabled: chargePlan.isEnable,
            charging_planned_start: chargePlan.beginTime,
            charging_planned_end: chargePlan.endTime,
            charging_planned_cycles: chargePlan.cycles,
            charging_planned_circulation: chargePlan.circulation,
            charging_plan_updated_at: chargePlan.updateTime,
        },
        history: {
            total_mileage_km: mileageData.totalmileage,
            total_mileage_mi: safeFloat(mileageData.totalmileageMile),
            delivery_days: mileageData.deliveryDays,
            total_energy_kwh: safeFloat(mileageData.totalEnergy),
            last_7_days_mileage_km: mileageData.totalAccumulatedMileage,
            last_7_days_mileage_mi: safeFloat(mileageData.totalAccumulatedMileageMile),
            last_7_days_energy_kwh: last7DaysEnergy,
            average_consumption_6w_kwh_100km: safeFloat(rankResult.hundredKmEC),
            average_consumption_6w_mi_kwh: safeFloat(rankResult.hundredMiKwhEC),
            consumption_rank: rankResult.rank,
            weekly_consumption: weeklyEc,
            last_week_driving_energy_kwh: safeFloat(breakdownData.driverEC),
            last_week_climate_energy_kwh: safeFloat(breakdownData.acEC),
            last_week_other_energy_kwh: safeFloat(breakdownData.otherEC),
            last_week_driving_energy_percent: lastWeekSplit.driving,
            last_week_climate_energy_percent: lastWeekSplit.climate,
            last_week_other_energy_percent: lastWeekSplit.other,
        },
        charging_history: {
            last_charge_energy_kwh: lastCharge ? safeFloat(lastCharge.chargeInEnergy) : null,
            last_charge_type: lastCharge ? lastCharge.chargeType : null,
            last_charge_start_ts: lastCharge ? lastCharge.chargeGunStartTs : null,
            last_charge_end_ts: lastCharge ? lastCharge.chargeGunEndTs : null,
        },
        media: {
            car_picture_status: pictureData.key ? 'available' : 'unavailable',
            car_picture_url: pictureData.shareBindUrl,
            car_picture_key: pictureData.key,
            car_picture_whole: pictureData.whole,
        },
        diagnostics: {
            ...tirePressures,
            status_endpoint_path: statusEndpointPath,
            status_signal_count: Object.keys(signal).length,
            status_has_config: Boolean(config && Object.keys(config).length),
            remote_session_active: oneIsOn(signal['1256']) || oneIsOn(signal['1257']),
            vehicle_security_active: positiveInt(signal['1255']),
            vehicle_ready: oneIsOn(signal['1258']),
            driver_door_open: oneIsOn(signal['1277']),
            passenger_door_open: oneIsOn(signal['1278']),
            rear_left_door_open: oneIsOn(signal['1279']),
            rear_right_door_open: oneIsOn(signal['1280']),
            trunk_open: oneIsOn(signal['1281']),
            ptc_power_w: safeInt(signal['1348']),
            ptc_state: safeInt(statusData.ptcState),
            ptc_power_setting_value: safeInt(statusData.ptcPowerSettingValue),
            parking_brake_active: oneIsOn(signal['1480']),
            battery_min_temp_c: safeInt(signal['1182']),
            battery_thermal_request: safeInt(signal['1186']),
            battery_heating: signal['1186'] != null ? safeInt(signal['1186']) === 4 : null,
            available_energy_kwh: whToKwh(statusData.dumpEnergy),
            front_left_window_open: notZero(signal['1693']),
            front_right_window_open: notZero(signal['1694']),
            rear_left_window_open: notZero(signal['1695']),
            rear_right_window_open: notZero(signal['1696']),
            skylight_open: notZero(signal['1724']),
            sunshade_position: safeInt(statusData.sunShade),
            windows_remote_supported: safeBool(statusData.isSupportWindowsRemoteControl),
            front_left_window_position_percent: safeInt(signal['3727']),
            front_right_window_position_percent: safeInt(signal['3728']),
            rear_left_window_position_percent: safeInt(signal['1879']),
            rear_right_window_position_percent: safeInt(signal['1880']),
            climate_on: oneIsOn(signal['1938']),
            climate_mode: climateMode(signal),
            outdoor_temp_c: safeFloat(statusData.outdoorTemp),
            climate_fan_volume: safeInt(statusData.acAirVolume),
            climate_fan_volume_setting: safeInt(statusData.acAirVolumeSetting),
            climate_air_direction: safeInt(statusData.acWindDirection),
            climate_temp_mode: safeBool(statusData.acTempMode),
            climate_cooling_heating_mode: safeInt(statusData.acCoolingAndHeating),
            climate_min_single_temp_c: safeFloat(statusData.minSingleTemp),
            air_recirculation:
                statusData.acCircleMode != null ? safeBool(statusData.acCircleMode) : notZero(signal['1943']),
            bluetooth_enabled: safeBool(statusData.bluetoothState),
            hotspot_enabled: safeBool(statusData.hotspotState),
            door_control_allowed: safeBool(statusData.bcmDoorCtrlAllow),
            fast_cooling_active: twoIsOn(signal['2669']),
            fast_heating_active: twoIsOn(signal['2681']),
            windshield_defrosting: positiveInt(signal['1945']),
            rear_window_heating: oneIsOn(signal['1946']),
            steering_wheel_heating: twoIsOn(signal['1816']),
            steering_wheel_heating_remaining_minutes: safeInt(signal['1624']),
            driver_seat_heating_level: safeInt(signal['2100']),
            passenger_seat_heating_level: safeInt(signal['2118']),
            driver_seat_ventilation_level: safeInt(signal['2101']),
            passenger_seat_ventilation_level: safeInt(signal['2119']),
            left_mirror_heating: oneIsOn(signal['49']),
            right_mirror_heating: oneIsOn(signal['50']),
            park_assist_enabled: oneIsOn(signal['2189']),
            sentinel_mode: oneIsOn(signal['3636']),
            parking_photo: oneIsOn(signal['3638']),
            fully_charged: signal['3736'] != null ? oneIsOn(signal['3736']) : safeBool(statusData.chargeCompleted),
            healthy_charging_enabled: oneIsOn(signal['48']),
            speed_limit_enabled: oneIsOn(signal['12054']),
            speed_limit_kmh: safeInt(signal['6048']),
            speed_limit_unit: signal['6047'] != null ? String(signal['6047']) : null,
            tire_pressure_alarm_front_left: safeInt(signal['2641']),
            tire_pressure_alarm_front_right: safeInt(signal['2648']),
            tire_pressure_alarm_rear_left: safeInt(signal['2655']),
            tire_pressure_alarm_rear_right: safeInt(signal['2662']),
            tire_pressure_all_ok: tiresAllOk(signal),
        },
        raw: supportRawSignals(signal),
        notifications: bundle.notifications || {
            unread_count: null,
            last_message_title: null,
            last_message_time: null,
        },
        raw_updated_at: Date.now() / 1000,
    };
}

module.exports = {
    normalizeVehicle,
    // exportiert für mögliche Tests
    statusDataSignal,
    isCharging,
    isLocked,
    deriveVehicleState,
    chargingPowerKw,
};
