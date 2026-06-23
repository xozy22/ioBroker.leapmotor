'use strict';

const path = require('path');
const { tests } = require('@iobroker/testing');

// Validiert package.json und io-package.json gegen die ioBroker-Anforderungen.
tests.packageFiles(path.join(__dirname, '..'));
