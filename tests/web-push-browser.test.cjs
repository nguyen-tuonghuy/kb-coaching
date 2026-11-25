const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const source = name => readFileSync(join(__dirname, '..', name), 'utf8');
const user = '00000000-0000-4000-8000-000000000001';
const otherUser = '00000000-0000-4000-8000-000000000002';
const device = '00000000-0000-4000-8000-000000000003';
const eventId = '00000000-0000-4000-8000-000000000004';
const group = '00000000-0000-4000-8000-000000000005';
const scope = 'https://test.example/kb-coaching/';

test('service worker preserves activation, filters device and safely routes clicks', async () => {
  const handlers = {}, shown = [], focused = [], opened = [], deleted = [];
  let binding = device, windows = [];
  const registration = {
    scope, showNotification(title, options) { shown.push({ title, ...options }); },
  };
  vm.runInNewContext(source('service-worker.js'), {
    URL, URLSearchParams,
    self: { addEventListener: (name, fn) => { handlers[name] = fn; }, registration, clients: { claim: async () => {} } },
    caches: {
      keys: async () => ['kinball-coach-old', 'kc-device-binding-v1'],
      delete: async key => deleted.push(key),
      open: async () => ({ match: async () => ({ text: async () => binding }) }),
    },
    clients: { claim: async () => {}, matchAll: async () => windows, openWindow: async url => opened.push(url) },
  });
  const invoke = (name, event) => handlers[name]({ ...event, waitUntil: promise => { event.promise = promise; } }) || event.promise;
  await invoke('activate', {});
  assert.deepEqual(deleted, ['kinball-coach-old']);
  const payload = { id: eventId, device, kind: 'message', group, body: 'private', url: 'https://outside.test' };
  await invoke('push', { data: { json: () => ({ ...payload, device: otherUser }) } });
  assert.equal(shown.length, 0);
  await invoke('push', { data: { json: () => payload } });
  assert.equal(shown[0].title, 'Nouveau message');
  assert.equal(shown[0].tag, eventId);
  assert.doesNotMatch(JSON.stringify(shown[0]), /private|outside/);

  await invoke('notificationclick', { notification: { ...shown[0], close() {} } });
  const target = scope + 'index.html?player_group=' + group + '#player-messages';
  assert.deepEqual(opened, [target]);

  windows = [{ url: scope + 'index.html', navigate: async url => ({ focus: async () => focused.push(url) }) }];
  await invoke('notificationclick', { notification: { ...shown[0], close() {} } });
  assert.deepEqual(focused, [target]);
  await invoke('push', { data: { json: () => ({ ...payload, kind: 'collection' }) } });
  await invoke('notificationclick', { notification: { ...shown[1], close() {} } });
  const collectionTarget = scope + 'index.html?player_group=' + group + '#player-results';
  assert.deepEqual(focused, [target, collectionTarget]);
  binding = otherUser;
  await invoke('notificationclick', { notification: { ...shown[0], close() {} } });
  assert.deepEqual(focused, [target, collectionTarget]);
});

test('settings request permission only on enable and remove the previous account binding', async t => {
  const shell = source('js/shared/page-shell.js').match(/"webPushSettings": `([\s\S]*?)`,/)[1];
  const dom = new JSDOM(shell, { url: scope, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  let subscription = null, bound = '', permissionRequests = 0, unsubscribed = 0;
  const saved = [], rpcCalls = [];
  const dialog = w.document.querySelector('dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  const actual = { endpoint: 'https://fcm.googleapis.com/fcm/send/demo',
    toJSON: () => ({ keys: { p256dh: 'public', auth: 'auth' } }),
    unsubscribe: async () => { subscription = null; unsubscribed++; } };
  const registration = {
    scope, active: true, getNotifications: async () => [],
    pushManager: {
      getSubscription: async () => subscription,
      subscribe: async () => (subscription = actual),
    },
  };
  const permission = { permission: 'default', async requestPermission() {
    permissionRequests++; return (this.permission = 'granted');
  } };
  const query = {
    select() { return query; }, eq() { return query; },
    maybeSingle: async () => ({ data: { training: false } }),
    upsert: async data => { saved.push(data); return {}; },
  };
  let sessionOwner = user;
  const db = {
    auth: { getSession: async () => ({ data: { session: { user: { id: sessionOwner } } } }) },
    from: () => query,
    rpc(name, args) {
      rpcCalls.push({ name, args });
      const values = { web_push_public_key: 'B' + 'a'.repeat(86), register_web_push: device };
      const result = Promise.resolve({ data: values[name] });
      result.abortSignal = () => result;
      return result;
    },
  };
  w.eval(source('js/web-push-settings.js').replace(/^export /gm, '') + '\nwindow.openPushSettings=openSettings;');
  Object.assign(w, {
    isSecureContext: true, PushManager: {}, Notification: permission, Response, AbortSignal,
    caches: { open: async () => ({
      put: async (_key, value) => { bound = await value.text(); },
      delete: async () => { bound = ''; },
    }) },
  });
  Object.defineProperty(w.navigator, 'serviceWorker', { value: { getRegistration: async () => registration, register: async () => ({ update: async () => {} }) } });
  w.eval(source('js/pwa.js').replace('  const pushModule =', '  window.testLifecycle = lifecycle;\n  const pushModule ='));
  async function click(action) {
    const button = dialog.querySelector(`[data-push-action="${action}"]`);
    assert.equal(button.disabled, false);
    await button.onclick();
  }
  const settle = () => new Promise(resolve => setImmediate(resolve));
  w.openPushSettings(db, user, w.testLifecycle);
  await settle();
  assert.equal(permissionRequests, 0);
  assert.equal(dialog.querySelector('[name=training]').checked, false);
  await click('save');
  assert.equal(saved[0].user_id, user);
  permission.requestPermission = async () => { permissionRequests++; return (permission.permission = 'denied'); };
  await click('enable');
  assert.equal(permissionRequests, 1);
  assert.equal(subscription, null);
  assert.match(dialog.querySelector('[role=status]').textContent, /bloquées/);

  permission.permission = 'granted';
  dialog.close();
  w.openPushSettings(db, user, w.testLifecycle);
  await settle();
  await click('enable');
  assert.equal(bound, device);
  assert.equal(rpcCalls.find(call => call.name === 'register_web_push').args.p_owner, user);
  await click('test');
  assert.ok(rpcCalls.find(call => call.name === 'test_web_push').args.p_proof);
  await click('disable');
  assert.equal(bound, '');
  assert.equal(unsubscribed, 1);
  assert.ok(rpcCalls.some(call => call.name === 'disable_web_push'));
  const activation = click('enable');
  const logout = w.KinballWebPush.disconnect(db, user);
  await Promise.all([activation, logout]);
  assert.equal(bound, '');
  dialog.close();
  w.openPushSettings(db, user, w.testLifecycle);
  await settle();
  await click('enable');
  sessionOwner = otherUser;
  await w.KinballWebPush.reconcile(otherUser);
  assert.equal(bound, '');
  assert.equal(unsubscribed, 3);
  assert.equal(w.localStorage.getItem('kc-web-push-device:/kb-coaching/'), null);
});
