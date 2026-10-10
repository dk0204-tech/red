/* Secure service-to-service completion callback. */
'use strict';

const ctfService = require('../services/ctf.service');
const { asyncHandler } = require('../middleware/error.middleware');
const { integrationLimiter } = require('../middleware/rateLimit.middleware');

/**
 * POST /api/integrations/ctf-complete
 * Body: { ctfId, teamId, result: 'solved'|'attempt' }
 * Auth: Authorization: Bearer <CTF_SERVICE_TOKEN>  (or X-Service-Token)
 * Points are always taken from our database — a caller can never award
 * itself points, and an unauthenticated browser gets a 401.
 */
const complete = [
    integrationLimiter,
    asyncHandler(async (req, res) => {
        const result = await ctfService.completeFromService(req.body || {}, req);
        res.status(201).json(result);
    })
];

module.exports = { complete };
