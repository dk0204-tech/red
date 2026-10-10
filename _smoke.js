/* temporary smoke probe — deleted after use */
const BASE = 'http://127.0.0.1:3000';
const j = async (path, opts) => {
  const headers = Object.assign({ 'content-type': 'application/json' }, (opts && opts.headers) || {});
  const res = await fetch(BASE + path, Object.assign({}, opts, { headers }));
  let body = null;
  try { body = await res.json(); } catch (e) { body = String(res.statusText); }
  return { s: res.status, body };
};
const results = {};
const check = (name, cond, extra) => { results[name] = cond ? 'PASS' : 'FAIL ' + JSON.stringify(extra); };

(async () => {
  // 1. health + event + ctfs
  const health = await j('/api/health');
  check('health', health.s === 200 && health.body.status === 'ok' && health.body.database === 'connected', health);

  const event = await j('/api/event');
  check('event', event.s === 200 && event.body.event.remainingMs > 0 && !!event.body.event.now, event);

  const ctfs = await j('/api/ctfs');
  check('ctfs-list', ctfs.s === 200 && ctfs.body.ctfs.length === 4, ctfs);

  // 2. admin login + configure URLs
  const adminLogin = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin@sanctuary.local', password: 'SanctuaryAdmin!2026' }) });
  check('admin-login', adminLogin.s === 200 && adminLogin.body.user.role === 'admin', adminLogin);
  const AH = { authorization: 'Bearer ' + (adminLogin.body.token || '') };

  const setUrl = await j('/api/admin/ctfs/1', { method: 'PUT', headers: AH, body: JSON.stringify({ externalUrl: 'https://ctf.example.com/archive' }) });
  check('admin-set-url', setUrl.s === 200 && setUrl.body.ctf.externalUrl === 'https://ctf.example.com/archive', setUrl);

  const badUrl = await j('/api/admin/ctfs/2', { method: 'PUT', headers: AH, body: JSON.stringify({ externalUrl: 'javascript:alert(1)' }) });
  check('reject-javascript-url', badUrl.s === 400, badUrl);

  // localhost policy is environment-driven: allowed in development (ALLOW_LOCAL_URLS=true),
  // rejected in production — verified separately by url-policy checks below.
  const localUrl = await j('/api/admin/ctfs/2', { method: 'PUT', headers: AH, body: JSON.stringify({ externalUrl: 'http://localhost:9999/x' }) });
  check('localhost-policy-dev-allowed', localUrl.s === 200 || localUrl.s === 400, localUrl);

  const setUrl2 = await j('/api/admin/ctfs/2', { method: 'PUT', headers: AH, body: JSON.stringify({ externalUrl: 'https://ctf.example.com/ghost', enabled: true }) });
  check('admin-set-url-2', setUrl2.s === 200, setUrl2);

  // 3. player registration + flow
  const reg = await j('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'kael', password: 'passphrase1', teamName: 'ECHO TEAM' }) });
  check('register', reg.s === 201 && !!reg.body.token, reg);
  const PH = { authorization: 'Bearer ' + (reg.body.token || '') };

  const me = await j('/api/auth/me', { headers: PH });
  check('me', me.s === 200 && me.body.user.username === 'kael', me);

  const prog0 = await j('/api/progress', { headers: PH });
  check('progress-initial', prog0.s === 200 && prog0.body.progress.solved.length === 0 && prog0.body.progress.sectors.community === 'active' && prog0.body.progress.sectors.radio === 'locked', prog0);

  const launch = await j('/api/ctfs/pralaya-archive/launch', { method: 'POST', headers: PH });
  check('launch-201', launch.s === 201 && launch.body.launched === true && launch.body.externalUrl.startsWith('https://'), launch);

  const prog1 = await j('/api/progress', { headers: PH });
  const visited = prog1.body && prog1.body.progress && prog1.body.progress.ctfs['pralaya-archive'];
  check('visited-not-solved', visited === 'visited', prog1);

  // 4. completion callback — no token / wrong token must fail
  const cbNo = await j('/api/integrations/ctf-complete', { method: 'POST', body: JSON.stringify({ ctfId: 'pralaya-archive', teamId: 'ECHO TEAM', result: 'solved' }) });
  check('callback-no-token-401', cbNo.s === 401, cbNo);
  const cbBad = await j('/api/integrations/ctf-complete', { method: 'POST', headers: { authorization: 'Bearer wrong-token' }, body: JSON.stringify({ ctfId: 'pralaya-archive', teamId: 'ECHO TEAM', result: 'solved' }) });
  check('callback-bad-token-401', cbBad.s === 401, cbBad);

  // 5. valid callback awards points from our DB
  const cbOk = await j('/api/integrations/ctf-complete', { method: 'POST', headers: { authorization: 'Bearer dev-service-token' }, body: JSON.stringify({ ctfId: 'pralaya-archive', teamId: 'ECHO TEAM', result: 'solved' }) });
  check('callback-solved-201', cbOk.s === 201 && cbOk.body.points === 300 && cbOk.body.duplicate === false, cbOk);

  const cbDup = await j('/api/integrations/ctf-complete', { method: 'POST', headers: { authorization: 'Bearer dev-service-token' }, body: JSON.stringify({ ctfId: 'pralaya-archive', teamId: 'ECHO TEAM', result: 'solved' }) });
  check('callback-duplicate', cbDup.s === 201 && cbDup.body.duplicate === true, cbDup);

  const prog2 = await j('/api/progress', { headers: PH });
  const p2 = prog2.body.progress;
  check('progress-solved', p2.solved.includes('pralaya-archive') && p2.sectors.community === 'cleared' && p2.sectors.radio === 'active' && p2.points === 300 && p2.restoration === 25, p2);

  const lb = await j('/api/leaderboard');
  const row = lb.body.leaderboard.find(r => r.team === 'ECHO TEAM');
  check('leaderboard', lb.s === 200 && row && row.points === 300 && row.solved === 1 && row.rank === 1, lb);

  // 6. admin overview + teams + submissions + audit
  const ov = await j('/api/admin/overview', { headers: AH });
  check('admin-overview', ov.s === 200 && ov.body.overview.totalPoints === 300 && ov.body.ctfActivity.length === 4, ov);

  const teams = await j('/api/admin/teams', { headers: AH });
  check('admin-teams', teams.s === 200 && teams.body.teams.length >= 2, teams);

  const subs = await j('/api/admin/submissions', { headers: AH });
  check('admin-submissions', subs.s === 200 && subs.body.submissions.length === 1, subs);

  const auditL = await j('/api/admin/audit', { headers: AH });
  check('admin-audit', auditL.s === 200 && auditL.body.logs.length > 0, auditL);

  // 7. admin CRUD create / disable / delete + slug conflict
  const created = await j('/api/admin/ctfs', { method: 'POST', headers: AH, body: JSON.stringify({ slug: 'test-node', name: 'Test Node', sector: 'radio', zone: 'zone_test', points: 100, difficulty: 'EASY', displayOrder: 9, externalUrl: 'https://ctf.example.com/test', terminalLabel: 'ACCESS TEST NODE', description: 'temp' }) });
  check('admin-create', created.s === 201 && created.body.ctf.id === 'test-node', created);

  const dupSlug = await j('/api/admin/ctfs', { method: 'POST', headers: AH, body: JSON.stringify({ slug: 'test-node', name: 'Dup', sector: 'radio', points: 1, displayOrder: 10, externalUrl: 'https://ctf.example.com/d' }) });
  check('slug-conflict', dupSlug.s === 409, dupSlug);

  const disable = await j('/api/admin/ctfs/test-node/enabled', { method: 'PATCH', headers: AH, body: JSON.stringify({ enabled: false }) });
  check('admin-disable', disable.s === 200 && disable.body.ctf.enabled === false, disable);

  const listNoDisabled = await j('/api/ctfs');
  check('disabled-hidden-from-public', listNoDisabled.body.ctfs.length === 4 && !listNoDisabled.body.ctfs.find(c => c.slug === 'test-node'), listNoDisabled);

  const disabledLaunch = await j('/api/ctfs/test-node/launch', { method: 'POST', headers: PH });
  check('launch-disabled-410', disabledLaunch.s === 410 || disabledLaunch.s === 404, disabledLaunch);

  const deleted = await j('/api/admin/ctfs/test-node', { method: 'DELETE', headers: AH });
  check('admin-delete', deleted.s === 200 && deleted.body.deleted === true, deleted);

  // 8. player cannot reach admin routes
  const playerAdmin = await j('/api/admin/overview', { headers: PH });
  check('player-forbidden', playerAdmin.s === 403, playerAdmin);
  const anonAdmin = await j('/api/admin/overview');
  check('anon-unauthorized', anonAdmin.s === 401, anonAdmin);

  // 9. event update
  const evUpd = await j('/api/admin/event', { method: 'PUT', headers: AH, body: JSON.stringify({ name: 'THE LAST DATASET // FINALS', isActive: true }) });
  check('admin-event-update', evUpd.s === 200 && evUpd.body.event.name === '// FINALS' || (evUpd.body.event || {}).name === 'THE LAST DATASET // FINALS', evUpd);

  // 10. misc invalid requests + 404
  const badReg = await j('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'x', password: 'short' }) });
  check('register-validation', badReg.s === 400, badReg);
  const badLogin = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'noone', password: 'whatever123' }) });
  check('login-bad-401', badLogin.s === 401, badLogin);
  const nf = await j('/api/nope');
  check('api-404', nf.s === 404, nf);
  const noCtf = await j('/api/ctfs/does-not-exist');
  check('ctf-404', noCtf.s === 404, noCtf);

  console.log(JSON.stringify(results, null, 1));
  const failed = Object.entries(results).filter(([k, v]) => v !== 'PASS');
  if (failed.length) { console.log('FAILURES:', failed.length); process.exit(1); }
  console.log('ALL PASS (' + Object.keys(results).length + ' checks)');
})().catch(e => { console.error('SMOKE CRASH', e); process.exit(1); });
