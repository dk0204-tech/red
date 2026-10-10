/* temporary URL policy checks — deleted after use */
const { validateCtfUrl } = require('./server/utils/url');
const PROD = { allowLocal: false, allowHttp: false };   // production policy
const DEV = { allowLocal: true, allowHttp: true };      // development policy
const cases = [
  ['https://ctf.example.com/x', PROD, true],
  ['javascript:alert(1)', PROD, false],
  ['javascript:alert(1)', DEV, false],                 // never allowed, even in dev
  ['data:text/html,x', PROD, false],
  ['file:///etc/passwd', PROD, false],
  ['vbscript:msgbox', PROD, false],
  ['http://insecure.example.com', PROD, false],        // http not allowed (prod policy)
  ['http://insecure.example.com', DEV, true],
  ['https://localhost:9999', PROD, false],             // local blocked (prod policy)
  ['https://localhost:9999', DEV, true],
  ['https://127.0.0.1/x', PROD, false],
  ['https://user:pass@ctf.example.com', PROD, false],
  ['not a url', PROD, false],
  ['', PROD, false],
  ['https://sub.ctf.example.com/very/deep/path?x=1#f', PROD, true]
];
let fail = 0;
for (const [value, opts, expect] of cases) {
  const res = validateCtfUrl(value, opts);
  const pass = res.ok === expect;
  if (!pass) fail++;
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + JSON.stringify(value) + ' → ' + res.ok + (res.ok ? '' : ' (' + res.reason + ')'));
}
if (fail) { console.log('FAILURES: ' + fail); process.exit(1); }
console.log('ALL PASS (' + cases.length + ' cases)');
