/* ==========================================================================
   Error handling: 404 for unknown API routes, one JSON error responder.
   Stack traces and secrets are logged server-side, never sent to clients.
   ========================================================================== */
'use strict';

const logger = require('../utils/logger');

function notFound(req, res) {
    res.status(404).json({ error: 'Resource not found.', code: 'not_found' });
}

/** Throw: httpError(400, 'Message', 'code') */
function httpError(status, message, code) {
    const err = new Error(message);
    err.status = status;
    err.code = code || ('error_' + status);
    return err;
}

/* eslint-disable no-unused-vars */
function errorHandler(err, req, res, next) {
    const status = err.status || err.statusCode || 500;
    const code = err.code && typeof err.code === 'string' ? err.code : 'server_error';

    if (status >= 500) {
        logger.error('request failed', {
            method: req.method,
            path: req.originalUrl,
            message: err.message,
            stack: err.stack
        });
    } else {
        logger.debug('request rejected', { method: req.method, path: req.originalUrl, status, message: err.message });
    }

    const body = { error: status >= 500 ? 'Internal server error.' : err.message, code };
    if (err.details) body.details = err.details;
    res.status(status).json(body);
}

/** Wrap async route handlers so rejections reach errorHandler. */
function asyncHandler(fn) {
    return function (req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

module.exports = { notFound, errorHandler, httpError, asyncHandler };
