const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createECDH, randomBytes, webcrypto } = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');
const webPush = require('web-push');

test('dispatcher authenticates cron and sends encrypted nonredirecting requests only to allowlisted providers', async () => {
  const source = readFileSync(join(__dirname, '../supabase/functions/web-push/index.ts'), 'utf8');
  const keys = webPush.generateVAPIDKeys();
  const recipient = createECDH('prime256v1');
  const env = {
    WEB_PUSH_DISPATCH_SECRET: 'a'.repeat(64), SUPABASE_SERVICE_ROLE_KEY: 'staging-role',
    SUPABASE_URL: 'https://database.test', VAPID_SUBJECT: 'mailto:push@example.test',
    VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey,
  };
  const to = suffix => 'https://fcm.googleapis.com/fcm/send/' + suffix;
  const job = (number, endpoint, send = true) => ({
    endpoint, send, kind: 'message', event: '00000000-0000-4000-8000-00000000000' + number,
    device: 'device', lease: 'lease', group: null, player: null, staff: false,
    p256dh: recipient.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url'),
  });
  const jobs = [job(1, to('ok')), job(2, to('expired')), job(3, to('busy')),
    job(4, 'https://fcm.googleapis.com.attacker.test/evil'), job(5, to('disabled'), false),
    job(6, to('../encoded')), job(7, to('linebreak\n'))];
  let handler;
  const calls = [], results = [];
  const providerStatus = { [to('ok')]: 201, [to('expired')]: 410, [to('busy')]: 429 };
  const code = stripTypeScriptTypes(source.replace(/^import .+;$/m, ''));
  vm.runInNewContext(code, {
    console: { warn() {}, error() {} }, webPush, Response, AbortSignal, Uint8Array, URL,
    Deno: { env: { get: name => env[name] }, serve: callback => { handler = callback; } },
    fetch: async (url, request) => {
      calls.push({ url, request });
      if (url.endsWith('/claim_web_push')) return Response.json(jobs.map(({event,device,lease}) => ({event,device,lease})));
      if (url.endsWith('/prepare_web_push')) {
        const ids = JSON.parse(request.body).p_jobs.map(job => job.event);
        return Response.json(jobs.filter(job => ids.includes(job.event)));
      }
      if (url.endsWith('/finish_web_push')) {
        results.push(...JSON.parse(request.body).p_results);
        return new Response(null, { status: 204 });
      }
      assert.ok(url in providerStatus);
      assert.equal(request.redirect, 'error');
      assert.equal(request.headers['Content-Encoding'], 'aes128gcm');
      assert.match(request.headers.Authorization, /^vapid /);
      assert.ok(request.body.byteLength > 80);
      assert.doesNotMatch(Buffer.from(request.body).toString(), /message|device/);
      return new Response(null, { status: providerStatus[url], headers: { 'Retry-After': '150' } });
    },
  });

  assert.equal((await handler(new Request('https://edge.test', { method: 'POST' }))).status, 403);
  assert.deepEqual(calls, []);
  const response = await handler(new Request('https://edge.test', {
    method: 'POST', headers: { authorization: 'Bearer ' + env.WEB_PUSH_DISPATCH_SECRET },
  }));
  assert.equal(response.status, 204);
  assert.deepEqual(results.map(item => item.outcome), ['sent','expired','retry','expired','skip','expired','expired']);
  assert.equal(results[2].retry_after, 150);
  assert.equal(calls.length, 7);
});


test('offline generator makes matching VAPID keys and a separate 256-bit Cron secret', async () => {
  const html = readFileSync(join(__dirname, '../tools/web-push-keys.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const fields = new Map(['generate','status','public','private','dispatch','reveal'].map(id => [id, {}]));
  vm.runInNewContext(script, {
    crypto: webcrypto, location: { protocol: 'file:' }, btoa,
    document: { getElementById: id => fields.get(id) },
  });
  await fields.get('generate').onclick();
  const key = createECDH('prime256v1');
  key.setPrivateKey(Buffer.from(fields.get('private').value, 'base64url'));
  assert.ok(key.getPublicKey().toString('base64url') === fields.get('public').value);
  assert.ok(/^[a-f0-9]{64}$/.test(fields.get('dispatch').value));
});
