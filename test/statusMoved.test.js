const test = require('node:test');
const assert = require('node:assert');
const getStatus = require('../src/getStatus');

test('a file that sits somewhere else than .bmc says is reported as moved', () => {
  const status = {
    P: 'code', p: 'code', U: null, u: null,
    N: 'user/a', n: 'user/a', T: 'USER', t: 'USER',
    m: 'src/user/a.js', M: 'src/user/ventas/a.js',
  };
  const changes = getStatus.getChangesFromStatus(status);
  assert.ok(changes.includes(getStatus.ChangeType.LOCAL_MOVED), 'LOCAL_MOVED should fire');
});

test('a file where .bmc says it is, is not reported as moved', () => {
  const status = {
    P: 'code', p: 'code', U: null, u: null,
    N: 'user/a', n: 'user/a', T: 'USER', t: 'USER',
    m: 'src/user/a.js', M: 'src/user/a.js',
  };
  const changes = getStatus.getChangesFromStatus(status);
  assert.ok(!changes.includes(getStatus.ChangeType.LOCAL_MOVED), 'LOCAL_MOVED should not fire');
});

test('a client action with no local file at all is not reported as moved', () => {
  const status = {
    P: 'code', p: 'code', U: null, u: null,
    N: 'user/a', n: 'user/a', T: 'USER', t: 'USER',
    m: null, M: null,
  };
  const changes = getStatus.getChangesFromStatus(status);
  assert.ok(!changes.includes(getStatus.ChangeType.LOCAL_MOVED), 'LOCAL_MOVED should not fire');
});
