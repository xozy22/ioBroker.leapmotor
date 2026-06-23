'use strict';

/**
 * Fehlerklassen der Leapmotor-API.
 * Portiert aus custom_components/leapmotor/leap_api/exceptions.py des HA-Projekts.
 */

class LeapmotorApiError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LeapmotorApiError';
    }
}

class LeapmotorAuthError extends LeapmotorApiError {
    constructor(message) {
        super(message);
        this.name = 'LeapmotorAuthError';
    }
}

class LeapmotorAccountCertError extends LeapmotorAuthError {
    constructor(message) {
        super(message);
        this.name = 'LeapmotorAccountCertError';
    }
}

class LeapmotorMissingAppCertError extends LeapmotorAuthError {
    constructor(message) {
        super(message);
        this.name = 'LeapmotorMissingAppCertError';
    }
}

class LeapmotorNoVehicleError extends LeapmotorApiError {
    constructor(message) {
        super(message);
        this.name = 'LeapmotorNoVehicleError';
    }
}

/**
 * Erkennt, ob ein Fehler auf ein ungültiges/abgelaufenes Token hinweist.
 *
 * @param err
 */
function isTokenError(err) {
    const message = String(err && err.message ? err.message : err).toLowerCase();
    return (
        message.includes('token') &&
        ['invalid', 'expired', 'expire', 'unauthorized', 'not valid'].some(marker => message.includes(marker))
    );
}

module.exports = {
    LeapmotorApiError,
    LeapmotorAuthError,
    LeapmotorAccountCertError,
    LeapmotorMissingAppCertError,
    LeapmotorNoVehicleError,
    isTokenError,
};
