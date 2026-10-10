/* ==========================================================================
   Small hand-rolled input validation helpers (no extra dependency).
   Every controller validates before touching the database.
   ========================================================================== */
'use strict';

const { httpError } = require('./error.middleware');

function str(body, field, opts) {
    const options = opts || {};
    const raw = body ? body[field] : undefined;
    if (raw === undefined || raw === null || raw === '') {
        if (options.required === false) return options.default !== undefined ? options.default : '';
        throw httpError(400, `"${field}" is required.`, 'validation_error');
    }
    if (typeof raw !== 'string') throw httpError(400, `"${field}" must be a string.`, 'validation_error');
    const value = raw.trim();
    if (value.length > (options.max || 200)) {
        throw httpError(400, `"${field}" is too long (max ${options.max || 200}).`, 'validation_error');
    }
    if (options.min && value.length < options.min) {
        throw httpError(400, `"${field}" must be at least ${options.min} characters.`, 'validation_error');
    }
    if (options.pattern && !options.pattern.test(value)) {
        throw httpError(400, options.message || `"${field}" has an invalid format.`, 'validation_error');
    }
    return value;
}

function int(body, field, opts) {
    const options = opts || {};
    const raw = body ? body[field] : undefined;
    if (raw === undefined || raw === null || raw === '') {
        if (options.required === false) return options.default;
        throw httpError(400, `"${field}" is required.`, 'validation_error');
    }
    const value = Number(raw);
    if (!Number.isInteger(value)) throw httpError(400, `"${field}" must be an integer.`, 'validation_error');
    if (options.min !== undefined && value < options.min) throw httpError(400, `"${field}" must be >= ${options.min}.`, 'validation_error');
    if (options.max !== undefined && value > options.max) throw httpError(400, `"${field}" must be <= ${options.max}.`, 'validation_error');
    return value;
}

function bool(body, field, opts) {
    const options = opts || {};
    const raw = body ? body[field] : undefined;
    if (raw === undefined || raw === null) {
        if (options.required === false) return options.default;
        throw httpError(400, `"${field}" is required.`, 'validation_error');
    }
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true' || raw === 1 || raw === '1') return true;
    if (raw === 'false' || raw === 0 || raw === '0') return false;
    throw httpError(400, `"${field}" must be a boolean.`, 'validation_error');
}

function pick(body, field, allowed, opts) {
    const options = opts || {};
    const raw = str(body, field, Object.assign({ required: options.required !== false }, options));
    if (raw === '' && options.required === false) return options.default;
    const lower = allowed.map(a => a.toLowerCase());
    const idx = lower.indexOf(raw.toLowerCase());
    if (idx === -1) {
        throw httpError(400, `"${field}" must be one of: ${allowed.join(', ')}.`, 'validation_error');
    }
    return allowed[idx];
}

module.exports = { str, int, bool, pick };
