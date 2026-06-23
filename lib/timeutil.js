'use strict';

/**
 * Zeitfenster-Helfer für die optionalen Verlaufs-Endpunkte.
 * Portiert aus den _*_window-Funktionen der api.py.
 *
 * Die App-Mitschnitte verwenden die Zeitzone Europe/Berlin. Der DST-korrekte
 * Offset wird über Intl ermittelt.
 */

/**
 * Offset von Europe/Berlin gegenüber UTC (in ms) zum gegebenen Zeitpunkt.
 *
 * @param date
 */
function berlinOffsetMs(date) {
    const tz = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
    const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
    return tz.getTime() - utc.getTime();
}

/**
 * Liefert den UTC-Zeitstempel (ms) für Mitternacht Berlin-Zeit des gegebenen Tages.
 *
 * @param date
 */
function berlinMidnightMs(date) {
    const offset = berlinOffsetMs(date);
    const berlin = new Date(date.getTime() + offset);
    const y = berlin.getUTCFullYear();
    const m = berlin.getUTCMonth();
    const d = berlin.getUTCDate();
    // Mitternacht in Berlin-lokaler Zeit, zurück nach UTC
    const midnightAsUtc = Date.UTC(y, m, d, 0, 0, 0, 0);
    return midnightAsUtc - offset;
}

/**
 * ISO-Wochentag Montag=0 ... Sonntag=6 in Berlin-Zeit.
 *
 * @param date
 */
function berlinWeekday(date) {
    const offset = berlinOffsetMs(date);
    const berlin = new Date(date.getTime() + offset);
    // getUTCDay: Sonntag=0 ... Samstag=6  ->  Montag=0 ... Sonntag=6
    return (berlin.getUTCDay() + 6) % 7;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * App-Fenster für die 7-Tage-Kilometer/Energie-Detailabfrage (in ms).
 *
 * @param now
 * @returns {[number, number]} [begintime, endtime]
 */
function lastSevenDayWindowMs(now = new Date()) {
    const todayMidnight = berlinMidnightMs(now);
    const start = todayMidnight - 7 * DAY_MS;
    const end = todayMidnight + DAY_MS - 1000;
    return [start, end];
}

/**
 * Vorige Montag-bis-Sonntag-Woche für getLastweekEC (in Sekunden).
 *
 * @param now
 * @returns {[number, number]} [begintime, endtime]
 */
function previousWeekWindowSeconds(now = new Date()) {
    const todayMidnight = berlinMidnightMs(now);
    const weekday = berlinWeekday(now);
    const thisMonday = todayMidnight - weekday * DAY_MS;
    const start = thisMonday - 7 * DAY_MS;
    const end = thisMonday - 1000;
    return [Math.floor(start / 1000), Math.floor(end / 1000)];
}

module.exports = {
    lastSevenDayWindowMs,
    previousWeekWindowSeconds,
    berlinMidnightMs,
};
