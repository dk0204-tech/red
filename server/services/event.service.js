/* ==========================================================================
   Event service — authoritative event timing. Clients compute remaining
   time from server timestamps, never from their own clock.
   ========================================================================== */
'use strict';

const eventModel = require('../models/event.model');

function serialize(row, serverNow) {
    const now = serverNow || new Date();
    const start = new Date(row.start_time);
    const end = new Date(row.end_time);
    const active = row.is_active !== false;

    let status = 'upcoming';
    if (!active) status = 'paused';
    else if (now >= end) status = 'ended';
    else if (now >= start) status = 'live';

    return {
        name: row.event_name,
        start: start.toISOString(),
        end: end.toISOString(),
        now: now.toISOString(),
        isActive: active,
        status,
        remainingMs: Math.max(0, end.getTime() - now.getTime()),
        elapsedMs: Math.max(0, now.getTime() - start.getTime())
    };
}

async function getEvent() {
    let row = null;
    try {
        row = await eventModel.get();
    } catch (err) {
        row = null;
    }
    return serialize(row || eventModel.fromEnv());
}

async function updateEvent({ eventName, startTime, endTime, isActive }) {
    let row = await eventModel.get();
    if (!row) {
        const base = eventModel.fromEnv();
        row = base;
    }
    const updated = await eventModel.update({
        eventName: eventName !== undefined ? eventName : row.event_name,
        startTime: startTime !== undefined ? startTime : row.start_time,
        endTime: endTime !== undefined ? endTime : row.end_time,
        isActive: isActive !== undefined ? isActive : row.is_active
    });
    return serialize(updated);
}

module.exports = { getEvent, updateEvent, serialize };
