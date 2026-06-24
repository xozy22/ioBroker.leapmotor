'use strict';

const path = require('path');
const { tests } = require('@iobroker/testing');

// Startet den Adapter in einer temporären ioBroker-Umgebung und prüft,
// dass er ohne kritischen Fehler hochfährt (ohne Zugangsdaten meldet er
// kontrolliert einen Konfigurationsfehler, stürzt aber nicht ab).
tests.integration(path.join(__dirname, '..'));
