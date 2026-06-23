'use strict';

/**
 * Metadaten für ioBroker-Objekte: Einheiten/Rollen der Lese-States sowie die
 * Definition der schreibbaren Steuer-States.
 */

// Anzeigenamen der Lese-Kanäle
const CHANNEL_NAMES = {
    vehicle: 'Fahrzeug-Stammdaten',
    status: 'Status',
    location: 'Standort',
    charging: 'Laden',
    history: 'Verlauf',
    charging_history: 'Ladeverlauf',
    media: 'Medien',
    diagnostics: 'Diagnose',
    raw: 'Rohsignale',
    notifications: 'Benachrichtigungen',
};

/**
 * Metadaten für einzelne Lese-States, Schlüssel = "<channel>.<feld>".
 * Felder ohne Eintrag erhalten automatisch abgeleiteten Typ und Rolle "state".
 */
const STATE_META = {
    'status.battery_percent': {
        unit: '%',
        role: 'value.battery',
        type: 'number',
    },
    'status.battery_percent_precise': {
        unit: '%',
        role: 'value.battery',
        type: 'number',
    },
    'status.fuel_level_percent': { unit: '%', role: 'value', type: 'number' },
    'status.remaining_range_km': {
        unit: 'km',
        role: 'value.distance',
        type: 'number',
    },
    'status.fuel_range_km': {
        unit: 'km',
        role: 'value.distance',
        type: 'number',
    },
    'status.combined_range_km': {
        unit: 'km',
        role: 'value.distance',
        type: 'number',
    },
    'status.cltc_range_km': {
        unit: 'km',
        role: 'value.distance',
        type: 'number',
    },
    'status.wltp_max_range_km': {
        unit: 'km',
        role: 'value.distance',
        type: 'number',
    },
    'status.live_remaining_range_km': {
        unit: 'km',
        role: 'value.distance',
        type: 'number',
    },
    'status.odometer_km': { unit: 'km', role: 'value.distance', type: 'number' },
    'status.speed_kmh': { unit: 'km/h', role: 'value.speed', type: 'number' },
    'status.interior_temp_c': {
        unit: '°C',
        role: 'value.temperature',
        type: 'number',
    },
    'status.climate_set_temp_left_c': {
        unit: '°C',
        role: 'value.temperature',
        type: 'number',
    },
    'status.climate_set_temp_right_c': {
        unit: '°C',
        role: 'value.temperature',
        type: 'number',
    },
    'status.is_locked': { role: 'indicator.lock', type: 'boolean' },
    'status.is_driving': { role: 'indicator', type: 'boolean' },
    'status.is_parked': { role: 'indicator', type: 'boolean' },
    'status.gear': { role: 'text', type: 'string' },
    'status.vehicle_state': { role: 'text', type: 'string' },
    'status.range_mode': { role: 'text', type: 'string' },
    'status.last_vehicle_timestamp': { role: 'value.time', type: 'number' },

    'location.latitude': { role: 'value.gps.latitude', type: 'number' },
    'location.longitude': { role: 'value.gps.longitude', type: 'number' },

    'charging.is_charging': { role: 'indicator.charging', type: 'boolean' },
    'charging.is_plugged_in': { role: 'indicator.connected', type: 'boolean' },
    'charging.is_regening': { role: 'indicator', type: 'boolean' },
    'charging.connection_state': { role: 'text', type: 'string' },
    'charging.charge_limit_percent': {
        unit: '%',
        role: 'value.battery',
        type: 'number',
    },
    'charging.remaining_charge_minutes': {
        unit: 'min',
        role: 'value',
        type: 'number',
    },
    'charging.charging_power_kw': {
        unit: 'kW',
        role: 'value.power',
        type: 'number',
    },
    'charging.charging_current_a': {
        unit: 'A',
        role: 'value.current',
        type: 'number',
    },
    'charging.charging_voltage_v': {
        unit: 'V',
        role: 'value.voltage',
        type: 'number',
    },
    'charging.dc_cable_connected': { role: 'indicator', type: 'boolean' },
    'charging.charging_planned_enabled': { role: 'indicator', type: 'boolean' },

    'history.total_mileage_km': {
        unit: 'km',
        role: 'value.distance',
        type: 'number',
    },
    'history.total_energy_kwh': {
        unit: 'kWh',
        role: 'value.energy',
        type: 'number',
    },
    'history.last_7_days_mileage_km': {
        unit: 'km',
        role: 'value.distance',
        type: 'number',
    },
    'history.last_7_days_energy_kwh': {
        unit: 'kWh',
        role: 'value.energy',
        type: 'number',
    },
    'history.average_consumption_6w_kwh_100km': {
        unit: 'kWh/100km',
        role: 'value',
        type: 'number',
    },
    'history.last_week_driving_energy_kwh': {
        unit: 'kWh',
        role: 'value.energy',
        type: 'number',
    },
    'history.last_week_climate_energy_kwh': {
        unit: 'kWh',
        role: 'value.energy',
        type: 'number',
    },
    'history.last_week_other_energy_kwh': {
        unit: 'kWh',
        role: 'value.energy',
        type: 'number',
    },

    'charging_history.last_charge_energy_kwh': {
        unit: 'kWh',
        role: 'value.energy',
        type: 'number',
    },

    'media.car_picture_url': { role: 'text.url', type: 'string' },

    'diagnostics.tire_pressure_front_left_bar': {
        unit: 'bar',
        role: 'value',
        type: 'number',
    },
    'diagnostics.tire_pressure_front_right_bar': {
        unit: 'bar',
        role: 'value',
        type: 'number',
    },
    'diagnostics.tire_pressure_rear_left_bar': {
        unit: 'bar',
        role: 'value',
        type: 'number',
    },
    'diagnostics.tire_pressure_rear_right_bar': {
        unit: 'bar',
        role: 'value',
        type: 'number',
    },
    'diagnostics.outdoor_temp_c': {
        unit: '°C',
        role: 'value.temperature',
        type: 'number',
    },
    'diagnostics.battery_min_temp_c': {
        unit: '°C',
        role: 'value.temperature',
        type: 'number',
    },
    'diagnostics.ptc_power_w': { unit: 'W', role: 'value.power', type: 'number' },
    'diagnostics.available_energy_kwh': {
        unit: 'kWh',
        role: 'value.energy',
        type: 'number',
    },
    'diagnostics.driver_door_open': { role: 'sensor.door', type: 'boolean' },
    'diagnostics.passenger_door_open': { role: 'sensor.door', type: 'boolean' },
    'diagnostics.rear_left_door_open': { role: 'sensor.door', type: 'boolean' },
    'diagnostics.rear_right_door_open': { role: 'sensor.door', type: 'boolean' },
    'diagnostics.trunk_open': { role: 'sensor.door', type: 'boolean' },
    'diagnostics.front_left_window_open': {
        role: 'sensor.window',
        type: 'boolean',
    },
    'diagnostics.front_right_window_open': {
        role: 'sensor.window',
        type: 'boolean',
    },
    'diagnostics.rear_left_window_open': {
        role: 'sensor.window',
        type: 'boolean',
    },
    'diagnostics.rear_right_window_open': {
        role: 'sensor.window',
        type: 'boolean',
    },
    'diagnostics.skylight_open': { role: 'sensor.window', type: 'boolean' },

    'notifications.unread_count': { role: 'value', type: 'number' },
    'notifications.last_message_title': { role: 'text', type: 'string' },
};

/**
 * Schreibbare Steuer-States im Kanal "control".
 * handler(client, vin, value) führt den Befehl aus.
 * type "button": role button, momentaner Auslöser (Wert wird ignoriert).
 */
const CONTROLS = [
    {
        id: 'lock',
        name: 'Verriegeln (true) / Entriegeln (false)',
        type: 'boolean',
        role: 'switch.lock',
        handler: (client, vin, value) => (value ? client.lockVehicle(vin) : client.unlockVehicle(vin)),
    },
    {
        id: 'climate',
        name: 'Klimatisierung ein/aus',
        type: 'boolean',
        role: 'switch',
        handler: (client, vin, value) => (value ? client.acOn(vin) : client.acOff(vin)),
    },
    {
        id: 'charge_limit',
        name: 'Ladelimit',
        type: 'number',
        role: 'level.battery',
        unit: '%',
        min: 50,
        max: 100,
        handler: (client, vin, value) => client.setChargeLimit(vin, parseInt(value, 10)),
    },
    {
        id: 'charging_plan_enabled',
        name: 'Ladeplan aktiv',
        type: 'boolean',
        role: 'switch',
        handler: (client, vin, value) => client.setChargingPlanEnabled(vin, Boolean(value)),
    },
    {
        id: 'trunk_open',
        name: 'Kofferraum öffnen',
        type: 'boolean',
        role: 'button',
        handler: (client, vin) => client.openTrunk(vin),
    },
    {
        id: 'trunk_close',
        name: 'Kofferraum schließen',
        type: 'boolean',
        role: 'button',
        handler: (client, vin) => client.closeTrunk(vin),
    },
    {
        id: 'find_car',
        name: 'Fahrzeug suchen (Hupe/Licht)',
        type: 'boolean',
        role: 'button',
        handler: (client, vin) => client.findVehicle(vin),
    },
    {
        id: 'windows_open',
        name: 'Fenster öffnen',
        type: 'boolean',
        role: 'button',
        handler: (client, vin) => client.openWindows(vin),
    },
    {
        id: 'windows_close',
        name: 'Fenster schließen',
        type: 'boolean',
        role: 'button',
        handler: (client, vin) => client.closeWindows(vin),
    },
    {
        id: 'sunshade_open',
        name: 'Sonnenrollo öffnen',
        type: 'boolean',
        role: 'button',
        handler: (client, vin) => client.openSunshade(vin),
    },
    {
        id: 'sunshade_close',
        name: 'Sonnenrollo schließen',
        type: 'boolean',
        role: 'button',
        handler: (client, vin) => client.closeSunshade(vin),
    },
    {
        id: 'unlock_charger',
        name: 'Ladestecker entriegeln',
        type: 'boolean',
        role: 'button',
        handler: (client, vin) => client.unlockCharger(vin),
    },
    {
        id: 'steering_wheel_heat',
        name: 'Lenkradheizung ein/aus',
        type: 'boolean',
        role: 'switch',
        handler: (client, vin, value) => (value ? client.steeringWheelHeatOn(vin) : client.steeringWheelHeatOff(vin)),
    },
    {
        id: 'mirror_heat',
        name: 'Spiegelheizung ein/aus',
        type: 'boolean',
        role: 'switch',
        handler: (client, vin, value) => (value ? client.rearviewMirrorHeatOn(vin) : client.rearviewMirrorHeatOff(vin)),
    },
    {
        id: 'battery_preheat',
        name: 'Batterievorheizung ein/aus',
        type: 'boolean',
        role: 'switch',
        handler: (client, vin, value) => (value ? client.batteryPreheat(vin) : client.batteryPreheatOff(vin)),
    },
    {
        id: 'seat_heat_driver',
        name: 'Sitzheizung Fahrer (0-3)',
        type: 'number',
        role: 'level',
        min: 0,
        max: 3,
        handler: (client, vin, value) => client.seatHeat(vin, 'driver', parseInt(value, 10)),
    },
    {
        id: 'seat_heat_passenger',
        name: 'Sitzheizung Beifahrer (0-3)',
        type: 'number',
        role: 'level',
        min: 0,
        max: 3,
        handler: (client, vin, value) => client.seatHeat(vin, 'copilot', parseInt(value, 10)),
    },
    {
        id: 'seat_ventilation_driver',
        name: 'Sitzbelüftung Fahrer (0-3)',
        type: 'number',
        role: 'level',
        min: 0,
        max: 3,
        handler: (client, vin, value) => client.seatVentilation(vin, 'driver', parseInt(value, 10)),
    },
    {
        id: 'seat_ventilation_passenger',
        name: 'Sitzbelüftung Beifahrer (0-3)',
        type: 'number',
        role: 'level',
        min: 0,
        max: 3,
        handler: (client, vin, value) => client.seatVentilation(vin, 'copilot', parseInt(value, 10)),
    },
    {
        id: 'quick_cool',
        name: 'Schnellkühlung',
        type: 'boolean',
        role: 'button',
        handler: (client, vin) => client.quickCool(vin),
    },
    {
        id: 'quick_heat',
        name: 'Schnellheizung',
        type: 'boolean',
        role: 'button',
        handler: (client, vin) => client.quickHeat(vin),
    },
    {
        id: 'windshield_defrost',
        name: 'Frontscheibe enteisen',
        type: 'boolean',
        role: 'button',
        handler: (client, vin) => client.windshieldDefrost(vin),
    },
    {
        id: 'refresh',
        name: 'Daten jetzt aktualisieren',
        type: 'boolean',
        role: 'button',
        handler: null, // wird in main.js gesondert behandelt
    },
];

module.exports = { CHANNEL_NAMES, STATE_META, CONTROLS };
