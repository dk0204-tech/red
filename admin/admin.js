/* ==========================================================================
   MANU CONTROL — organizer dashboard application (vanilla JS, no deps).

   Pages: #/overview  #/ctfs  #/teams  #/submissions  #/leaderboard  #/event  #/audit
   ========================================================================== */
'use strict';

(function () {
    const TOKEN_KEY = 'manu_admin_token';
    const state = {
        token: localStorage.getItem(TOKEN_KEY) || '',
        user: null,
        ctfs: [],
        editingId: null,      // null = create mode
        event: null,
        clockOffset: 0,       // serverNow - clientNow (never trust client clock)
        timer: null
    };

    /* ------------------------------ helpers ------------------------------- */

    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toast(message, isError) {
        const el = $('#toast');
        el.innerText = message;
        el.classList.toggle('error', !!isError);
        el.classList.add('show');
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.remove('show'), 3200);
    }

    function fmtDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return isNaN(d) ? '—' : d.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
    }

    function fmtCountdown(ms) {
        if (ms <= 0) return '00:00:00';
        const t = Math.floor(ms / 1000);
        const h = String(Math.floor(t / 3600)).padStart(2, '0');
        const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
        const s = String(t % 60).padStart(2, '0');
        return h + ':' + m + ':' + s;
    }

    /* ------------------------------- API ---------------------------------- */

    async function api(path, options) {
        const opts = Object.assign({}, options);
        opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {});
        if (state.token) opts.headers.authorization = 'Bearer ' + state.token;

        let res;
        try {
            res = await fetch(path, opts);
        } catch (err) {
            throw new Error('CONNECTION ERROR — dashboard could not reach the Sanctuary network.');
        }
        let body = null;
        try { body = await res.json(); } catch (e) { body = {}; }

        if (res.status === 401 || res.status === 403) {
            if (path.indexOf('/auth/login') === -1) {
                setToken('');
                showLogin();
                throw new Error('Session expired — sign in again.');
            }
        }
        if (!res.ok) {
            throw new Error((body && body.error) || ('Request failed (' + res.status + ').'));
        }
        return body;
    }

    function setToken(token) {
        state.token = token;
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
    }

    /* ------------------------------ login --------------------------------- */

    const gate = $('#login-gate');
    const app = $('#app');

    function showLogin() {
        gate.hidden = false;
        app.hidden = true;
        if (state.timer) { clearInterval(state.timer); state.timer = null; }
    }

    function showApp() {
        gate.hidden = true;
        app.hidden = false;
        $('#topbar-user').textContent = state.user
            ? state.user.username + (state.user.role === 'admin' ? ' // ADMIN' : '')
            : '';
        startEventClock();
        route();
    }

    $('#login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = $('#login-btn');
        const errEl = $('#login-error');
        errEl.textContent = '';
        btn.disabled = true;
        btn.textContent = 'AUTHENTICATING…';
        try {
            const data = await api('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({
                    username: $('#login-ident').value.trim(),
                    password: $('#login-pass').value
                })
            });
            if (!data.user || data.user.role !== 'admin') {
                throw new Error('This account does not have organizer access.');
            }
            setToken(data.token);
            state.user = data.user;
            showApp();
            toast('ACCESS GRANTED // WELCOME BACK');
        } catch (err) {
            errEl.textContent = err.message;
        } finally {
            btn.disabled = false;
            btn.textContent = 'AUTHENTICATE';
        }
    });

    $('#logout-btn').addEventListener('click', () => {
        api('/api/auth/logout', { method: 'POST' }).catch(() => {});
        setToken('');
        state.user = null;
        showLogin();
    });

    /* --------------------------- event clock ------------------------------ */

    async function startEventClock() {
        const chip = $('#topbar-event');
        const tick = () => {
            if (!state.event) return;
            const serverNow = Date.parse(state.event.now) + (Date.now() - state._syncedAt);
            const remaining = Date.parse(state.event.end) - serverNow;
            chip.textContent = (state.event.status === 'live' ? 'EVENT ' : 'EVENT (' + state.event.status.toUpperCase() + ') ') + fmtCountdown(remaining);
        };
        try {
            const data = await api('/api/event');
            state.event = data.event;
            state._syncedAt = Date.now();
            tick();
            if (state.timer) clearInterval(state.timer);
            state.timer = setInterval(tick, 1000);
        } catch (err) {
            chip.textContent = 'EVENT — OFFLINE';
        }
    }

    /* ------------------------------ router -------------------------------- */

    function route() {
        if (app.hidden) return;
        const hash = location.hash || '#/overview';
        const name = (hash.split('/')[1] || 'overview').replace(/[^a-z]/g, '');
        $$('.sidebar a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
        const render = PAGES[name] || PAGES.overview;
        render().catch(err => { $('#content').innerHTML = '<div class="empty">' + esc(err.message) + '</div>'; });
    }
    window.addEventListener('hashchange', route);

    /* ------------------------------ pages --------------------------------- */

    const PAGES = {};

    PAGES.overview = async () => {
        const data = await api('/api/admin/overview');
        const o = data.overview;
        const maxLaunch = Math.max(1, ...data.ctfActivity.map(a => a.launches));
        const rows = data.ctfActivity.map(a => {
            const launchPct = Math.round((a.launches / maxLaunch) * 100);
            const solvePct = Math.round((a.solves / maxLaunch) * 100);
            return `
            <div class="activity-row">
                <div class="name">${esc(a.name)}<small>${esc(a.id)} ${a.enabled ? '' : '// DISABLED'}</small></div>
                <div class="bar-cell">
                    <div class="bar" role="img" aria-label="${a.launches} launches, ${a.solves} solves">
                        <div class="fill-launch" style="width:${launchPct}%"></div>
                    </div>
                    <div class="bar" style="margin-top:4px" aria-hidden="true">
                        <div class="fill-solve" style="width:${solvePct}%"></div>
                    </div>
                </div>
                <div class="bar-legend">${a.launches} launches<br>${a.solves} solves</div>
            </div>`;
        }).join('') || '<div class="empty">No CTFs yet — create one under CTF MANAGEMENT.</div>';

        $('#content').innerHTML = `
            <h1 class="page-title">SYSTEM OVERVIEW</h1>
            <p class="page-sub">Live event telemetry // ${esc(o.event.name)}</p>
            <div class="stat-grid">
                <div class="stat-card"><div class="k">TOTAL TEAMS</div><div class="v cyan">${o.totalTeams}</div></div>
                <div class="stat-card"><div class="k">PARTICIPANTS</div><div class="v">${o.totalUsers}</div></div>
                <div class="stat-card"><div class="k">CTFs SOLVED</div><div class="v green">${o.ctfsSolved}</div></div>
                <div class="stat-card"><div class="k">TOTAL POINTS</div><div class="v amber">${o.totalPoints}</div></div>
                <div class="stat-card"><div class="k">TOTAL LAUNCHES</div><div class="v">${o.totalLaunches}</div></div>
                <div class="stat-card"><div class="k">EVENT (${esc(o.event.status.toUpperCase())})</div><div class="v">${esc(fmtCountdown(o.event.remainingMs))}</div></div>
            </div>
            <div class="panel">
                <h3>CTF ACTIVITY</h3>
                ${rows}
            </div>
            <div class="panel">
                <h3>EVENT WINDOW</h3>
                <table><tbody>
                    <tr><th>Start</th><td class="mono">${fmtDate(o.event.start)}</td></tr>
                    <tr><th>End</th><td class="mono">${fmtDate(o.event.end)}</td></tr>
                    <tr><th>Server time</th><td class="mono">${fmtDate(o.event.now)}</td></tr>
                </tbody></table>
            </div>`;
    };

    PAGES.ctfs = async () => {
        const data = await api('/api/admin/ctfs');
        state.ctfs = data.ctfs;
        const rows = data.ctfs.map(c => `
            <tr data-slug="${esc(c.slug)}">
                <td class="mono">${String(c.order).padStart(2, '0')}</td>
                <td><strong>${esc(c.name)}</strong><br><small style="color:var(--muted)">${esc(c.slug)}</small></td>
                <td><span class="badge sec">${esc(c.sector.toUpperCase())}</span><br><small style="color:var(--muted)">${esc(c.zone || '—')}</small></td>
                <td class="mono">${esc(c.externalUrl || 'NOT CONFIGURED')}</td>
                <td><span class="badge pts">${c.points}P</span> <span class="badge sec">${esc(c.difficulty)}</span></td>
                <td>${c.launches} / ${c.solves}</td>
                <td><span class="badge ${c.enabled ? 'on' : 'off'}">${c.enabled ? 'ENABLED' : 'DISABLED'}</span></td>
                <td class="actions">
                    <button class="btn btn-sm" data-act="edit">EDIT</button>
                    <button class="btn btn-sm ${c.enabled ? 'btn-danger' : ''}" data-act="toggle">${c.enabled ? 'DISABLE' : 'ENABLE'}</button>
                    ${c.externalUrl ? `<button class="btn btn-sm" data-act="test">TEST LINK</button>` : ''}
                    <button class="btn btn-sm btn-danger" data-act="delete">DELETE</button>
                </td>
            </tr>`).join('');

        $('#content').innerHTML = `
            <h1 class="page-title">CTF MANAGEMENT</h1>
            <p class="page-sub">Every terminal in the game reads its URL from here — no code changes needed.</p>
            <div class="panel">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px">
                    <h3 style="margin:0">CONFIGURED CHANNELS (${data.ctfs.length})</h3>
                    <button class="btn btn-primary" id="new-ctf">+ CREATE CTF</button>
                </div>
                <div class="table-wrap">
                    <table>
                        <thead><tr>
                            <th>#</th><th>CTF</th><th>Sector / Zone</th><th>External URL</th>
                            <th>Points</th><th>Launch / Solve</th><th>Status</th><th>Actions</th>
                        </tr></thead>
                        <tbody>${rows || '<tr><td colspan="8" class="empty">No CTFs configured yet.</td></tr>'}</tbody>
                    </table>
                </div>
            </div>`;

        $('#new-ctf').addEventListener('click', () => openCtfModal(null));
        $$('#content tbody tr[data-slug]').forEach(tr => {
            tr.addEventListener('click', async (e) => {
                const btn = e.target.closest('button[data-act]');
                if (!btn) return;
                const slug = tr.dataset.slug;
                const ctf = state.ctfs.find(c => c.slug === slug);
                try {
                    if (btn.dataset.act === 'edit') openCtfModal(ctf);
                    if (btn.dataset.act === 'toggle') {
                        await api('/api/admin/ctfs/' + encodeURIComponent(slug) + '/enabled', {
                            method: 'PATCH', body: JSON.stringify({ enabled: !ctf.enabled })
                        });
                        toast(ctf.enabled ? 'CHANNEL DISABLED // ' + ctf.name : 'CHANNEL ENABLED // ' + ctf.name);
                        PAGES.ctfs();
                    }
                    if (btn.dataset.act === 'test') window.open(ctf.externalUrl, '_blank', 'noopener,noreferrer');
                    if (btn.dataset.act === 'delete') {
                        if (confirm('Delete "' + ctf.name + '"? Launch history for it is removed too.')) {
                            await api('/api/admin/ctfs/' + encodeURIComponent(slug), { method: 'DELETE' });
                            toast('CTF DELETED // ' + ctf.name);
                            PAGES.ctfs();
                        }
                    }
                } catch (err) {
                    toast(err.message, true);
                }
            });
        });
    };

    PAGES.teams = async () => {
        const data = await api('/api/admin/teams');
        const rows = data.teams.map(t => `
            <tr>
                <td class="mono">#${String(t.rank || 0)}</td>
                <td><strong>${esc(t.name)}</strong></td>
                <td class="mono">${esc(t.joinCode)}</td>
                <td>${t.members} / 2</td>
                <td>${t.solved}</td>
                <td><span class="badge pts">${t.points}P</span></td>
                <td class="mono">${fmtDate(t.lastActivity)}</td>
            </tr>`).join('');
        $('#content').innerHTML = `
            <h1 class="page-title">TEAMS</h1>
            <p class="page-sub">Teams of 1–2 participants. Give players the join code so a teammate can link up.</p>
            <div class="panel"><div class="table-wrap"><table>
                <thead><tr><th>Rank</th><th>Team</th><th>Join code</th><th>Members</th><th>Solved</th><th>Points</th><th>Last activity</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="7" class="empty">No teams yet.</td></tr>'}</tbody>
            </table></div></div>`;
    };

    PAGES.submissions = async () => {
        const data = await api('/api/admin/submissions');
        const rows = data.submissions.map(s => `
            <tr>
                <td class="mono">${fmtDate(s.solvedAt)}</td>
                <td><strong>${esc(s.team)}</strong></td>
                <td>${esc(s.user || '—')}</td>
                <td>${esc(s.ctfName)}</td>
                <td><span class="badge sec">${esc(s.sector)}</span></td>
                <td><span class="badge pts">${s.points}P</span></td>
            </tr>`).join('');
        $('#content').innerHTML = `
            <h1 class="page-title">SUBMISSIONS</h1>
            <p class="page-sub">Server-confirmed completions reported by external CTF backends.</p>
            <div class="panel"><div class="table-wrap"><table>
                <thead><tr><th>Time</th><th>Team</th><th>Player</th><th>CTF</th><th>Sector</th><th>Points</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="6" class="empty">No submissions recorded yet.</td></tr>'}</tbody>
            </table></div></div>`;
    };

    PAGES.leaderboard = async () => {
        const data = await api('/api/admin/leaderboard');
        const rows = data.leaderboard.map(r => `
            <tr>
                <td class="mono"><strong>#${r.rank}</strong></td>
                <td><strong>${esc(r.team)}</strong></td>
                <td>${r.members}</td>
                <td>${r.solved}</td>
                <td><span class="badge pts">${r.points}P</span></td>
                <td class="mono">${fmtDate(r.firstSolved)}</td>
                <td class="mono">${fmtDate(r.lastSolved)}</td>
            </tr>`).join('');
        $('#content').innerHTML = `
            <h1 class="page-title">LEADERBOARD</h1>
            <p class="page-sub">Sort: points → CTFs solved → earliest completion.</p>
            <div class="panel"><div class="table-wrap"><table>
                <thead><tr><th>Rank</th><th>Team</th><th>Members</th><th>Solved</th><th>Points</th><th>First solve</th><th>Last solve</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="7" class="empty">Nothing on the board yet.</td></tr>'}</tbody>
            </table></div></div>`;
    };

    PAGES.event = async () => {
        const data = await api('/api/admin/event');
        const ev = data.event;
        const local = (iso) => {
            const d = new Date(iso);
            const pad = n => String(n).padStart(2, '0');
            return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' +
                pad(d.getHours()) + ':' + pad(d.getMinutes());
        };
        $('#content').innerHTML = `
            <h1 class="page-title">EVENT TIMING</h1>
            <p class="page-sub">Authoritative timestamps — players see remaining time computed from the server clock.</p>
            <div class="panel">
                <h3>CURRENT WINDOW</h3>
                <form id="event-form" style="display:flex;flex-direction:column;gap:14px;max-width:520px">
                    <label style="font-size:12px;letter-spacing:.1em;color:var(--muted)">EVENT NAME
                        <input name="name" value="${esc(ev.name)}" maxlength="80"
                            style="width:100%;margin-top:6px;background:#0a0f1e;border:1px solid var(--line);color:var(--text);padding:10px 12px;border-radius:8px;font-family:var(--font-mono)">
                    </label>
                    <label style="font-size:12px;letter-spacing:.1em;color:var(--muted)">START
                        <input name="start" type="datetime-local" value="${local(ev.start)}"
                            style="width:100%;margin-top:6px;background:#0a0f1e;border:1px solid var(--line);color:var(--text);padding:10px 12px;border-radius:8px;font-family:var(--font-mono)">
                    </label>
                    <label style="font-size:12px;letter-spacing:.1em;color:var(--muted)">END
                        <input name="end" type="datetime-local" value="${local(ev.end)}"
                            style="width:100%;margin-top:6px;background:#0a0f1e;border:1px solid var(--line);color:var(--text);padding:10px 12px;border-radius:8px;font-family:var(--font-mono)">
                    </label>
                    <label class="switch-label"><input type="checkbox" name="isActive" ${ev.isActive ? 'checked' : ''}> Event is active</label>
                    <div id="event-error" class="login-error" role="alert"></div>
                    <div><button class="btn btn-primary" type="submit">SAVE EVENT WINDOW</button></div>
                </form>
            </div>`;

        $('#event-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const f = e.target;
            try {
                const body = {
                    name: f.name.value.trim(),
                    start: new Date(f.start.value).toISOString(),
                    end: new Date(f.end.value).toISOString(),
                    isActive: f.isActive.checked
                };
                const res = await api('/api/admin/event', { method: 'PUT', body: JSON.stringify(body) });
                toast('EVENT WINDOW UPDATED');
                startEventClock();
            } catch (err) {
                $('#event-error').textContent = err.message;
            }
        });
    };

    PAGES.audit = async () => {
        const data = await api('/api/admin/audit');
        const rows = data.logs.map(l => `
            <tr>
                <td class="mono">${fmtDate(l.created_at)}</td>
                <td>${esc(l.username || 'system')}</td>
                <td class="mono">${esc(l.action)}</td>
                <td class="mono" style="max-width:420px;overflow:hidden;text-overflow:ellipsis">${esc(JSON.stringify(l.metadata))}</td>
            </tr>`).join('');
        $('#content').innerHTML = `
            <h1 class="page-title">AUDIT LOG</h1>
            <p class="page-sub">Every privileged action is recorded.</p>
            <div class="panel"><div class="table-wrap"><table>
                <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Metadata</th></tr></thead>
                <tbody>${rows || '<tr><td colspan="4" class="empty">No audit entries yet.</td></tr>'}</tbody>
            </table></div></div>`;
    };

    /* --------------------------- CTF modal -------------------------------- */

    const modal = $('#modal');

    function openCtfModal(ctf) {
        state.editingId = ctf ? ctf.slug : null;
        $('#modal-title').textContent = ctf ? 'EDIT CTF // ' + ctf.name : 'CREATE CTF';
        const f = $('#ctf-form');
        f.reset();
        f.slug.value = ctf ? ctf.slug : '';
        f.name.value = ctf ? ctf.name : '';
        f.sector.value = ctf ? ctf.sector : 'community';
        f.zone.value = ctf ? (ctf.zone || '') : '';
        f.points.value = ctf ? ctf.points : 300;
        f.difficulty.value = ctf ? ctf.difficulty : 'MEDIUM';
        f.displayOrder.value = ctf ? ctf.order : 1;
        f.fragmentId.value = ctf ? (ctf.fragmentId || '') : '';
        f.externalUrl.value = ctf ? (ctf.externalUrl || '') : '';
        f.terminalLabel.value = ctf ? (ctf.terminalLabel || '') : '';
        f.description.value = ctf ? (ctf.description || '') : '';
        f.enabled.checked = ctf ? ctf.enabled : true;
        f.slug.readOnly = false;
        $('#form-error').textContent = '';
        modal.hidden = false;
        setTimeout(() => f.slug.focus(), 30);
    }

    function closeModal() { modal.hidden = true; state.editingId = null; }

    $('#modal-close').addEventListener('click', closeModal);
    $('#form-cancel').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

    $('#ctf-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = e.target;
        const payload = {
            slug: f.slug.value.trim().toLowerCase(),
            name: f.name.value.trim(),
            sector: f.sector.value,
            zone: f.zone.value.trim(),
            points: Number(f.points.value),
            difficulty: f.difficulty.value,
            displayOrder: Number(f.displayOrder.value),
            fragmentId: f.fragmentId.value.trim(),
            externalUrl: f.externalUrl.value.trim(),
            terminalLabel: f.terminalLabel.value.trim() || f.name.value.trim(),
            description: f.description.value,
            enabled: f.enabled.checked
        };
        try {
            if (state.editingId) {
                await api('/api/admin/ctfs/' + encodeURIComponent(state.editingId), {
                    method: 'PUT', body: JSON.stringify(payload)
                });
                toast('CTF UPDATED // ' + payload.name);
            } else {
                await api('/api/admin/ctfs', { method: 'POST', body: JSON.stringify(payload) });
                toast('CTF CREATED // ' + payload.name);
            }
            closeModal();
            PAGES.ctfs();
        } catch (err) {
            $('#form-error').textContent = err.message;
        }
    });

    /* ------------------------------ boot ---------------------------------- */

    async function boot() {
        if (!state.token) { showLogin(); return; }
        try {
            const data = await api('/api/auth/me');
            if (!data.user || data.user.role !== 'admin') throw new Error('not admin');
            state.user = data.user;
            showApp();
        } catch (err) {
            setToken('');
            showLogin();
        }
    }

    boot();
})();
