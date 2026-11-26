const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const vm = require('node:vm');

const source = stripTypeScriptTypes(readFileSync(
  join(__dirname, '../supabase/functions/training-attendance-discord/index.ts'), 'utf8',
));
const group = '99999999-9999-4999-8999-999999999999';
const session = '40000000-0000-4000-8000-000000000001';
const user = '11111111-1111-4111-8111-111111111111';
const deliveryId = '55555555-5555-4555-8555-555555555555';
const webhook = 'https://discord.com/api/webhooks/123456789012345678/' + 'x'.repeat(40);
const appUrl = 'https://example.test/kinball(coach)/?mode=joueur';

async function invoke({
  label = 'Entraînement de décembre', deadline = null, reminder = false, webhookUrl = webhook,
  origin = 'https://example.test', authorization = 'Bearer test-token',
  authenticated = true, authorized = true, duplicate = false, discordStatus = 200,
} = {}) {
  let handle;
  const calls = [];
  const env = {
    TRAINING_ATTENDANCE_APP_URL: appUrl,
    TRAINING_ATTENDANCE_DISCORD_WEBHOOKS: JSON.stringify({ [group]: webhookUrl }),
    SUPABASE_URL: 'https://database.test',
    SUPABASE_ANON_KEY: 'test-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  };
  vm.runInNewContext(source, {
    Deno: { env: { get: name => env[name] }, serve: callback => { handle = callback; } },
    Response, URL, AbortSignal,
    fetch: async (url, options) => {
      const body = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ url, options, body });
      if (url.endsWith('/auth/v1/user')) {
        return authenticated ? Response.json({ id: user }) : new Response(null, { status: 401 });
      }
      if (url.endsWith('/reserve_training_attendance_discord')) {
        if (!authorized) return Response.json({ code: '42501' }, { status: 403 });
        if (!body.p_configured) return Response.json({ code: '55000', message: 'Webhook invalide' }, { status: 400 });
        return Response.json(duplicate ? null : { id: deliveryId, trained_on: '2026-12-20', label, deadline });
      }
      if (url.endsWith('/finish_training_attendance_discord')) return new Response(null, { status: 204 });
      if (url === webhook + '?wait=true') {
        if (discordStatus === 'timeout') throw new Error('Timeout simulé');
        return Response.json({}, { status: discordStatus });
      }
      throw new Error('URL inattendue');
    },
  });
  const headers = { origin };
  if (authorization) headers.authorization = authorization;
  const response = await handle(new Request('https://edge.test', {
    method: 'POST', headers,
    body: JSON.stringify({ group_id: group, session_id: session, reminder }),
  }));
  return { response, calls };
}

test('publie un seul embed avec la date complète et un lien profond masqué', async () => {
  const { response, calls } = await invoke();
  assert.equal(response.status, 200);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[1].body, {
    p_session: session, p_group: group, p_user: user, p_reminder: false, p_configured: true,
  });
  const [post, finish] = calls.slice(2);
  assert.equal(post.url, webhook + '?wait=true');
  assert.equal(post.options.method, 'POST');
  assert.equal(post.options.redirect, 'error');
  assert.deepEqual({ ...post.options.headers }, { 'Content-Type': 'application/json' });
  const link = 'https://example.test/kinball%28coach%29/?mode=joueur&player_group=' + group + '&training_poll=' + session;
  assert.deepEqual(post.body, {
    embeds: [{
      title: '📋 Sondage de présence',
      description: [
        '**Séance** · Entraînement de décembre',
        '**Date** · dimanche 20 décembre 2026',
        '',
        "Merci d'indiquer votre disponibilité pour cet entraînement : présent, absent ou incertain.",
        '[Répondre au sondage sur Kinball Coach](' + link + ')',
      ].join('\n'),
      footer: { text: 'Kinball Coach · Gestion des entraînements' },
    }],
    allowed_mentions: { parse: [] },
  });
  assert.deepEqual(finish.body, { p_id: deliveryId, p_state: 'sent' });
});

test('un rappel affiche l’échéance en heure de Paris et accepte une séance sans nom', async () => {
  const { response, calls } = await invoke({ reminder: true, label: null, deadline: '2026-12-19T23:30:00Z' });
  assert.equal(response.status, 200);
  assert.equal(calls[1].body.p_reminder, true);
  const [embed] = calls[2].body.embeds;
  assert.equal(embed.title, 'Rappel — Sondage de présence');
  assert.match(embed.description, /^\*\*Séance\*\* · Entraînement\n/);
  assert.match(embed.description, /\*\*Échéance de réponse\*\* · dimanche 20 décembre 2026 à 00:30 \(heure de Paris\)/);
});

test('un nom de séance ne peut pas injecter un lien Markdown ni déclencher de mention', async () => {
  const label = '@everyone\n[faux lien](https://example.test)';
  const { response, calls } = await invoke({ label });
  assert.equal(response.status, 200);
  const { embeds, allowed_mentions } = calls[2].body;
  assert.equal(embeds[0].description.split('\n')[0], '**Séance** · @everyone \\[faux lien\\]\\(https://example.test\\)');
  assert.deepEqual(allowed_mentions, { parse: [] });
});

test('origine, authentification, habilitation, webhook et réservation protègent toujours l’envoi', async () => {
  for (const [options, status, callCount] of [
    [{ origin: 'https://other.test' }, 403, 0],
    [{ authorization: null }, 401, 0],
    [{ authenticated: false }, 401, 1],
    [{ authorized: false }, 403, 2],
    [{ webhookUrl: webhook.replace('discord.com', 'discord.com.other.test') }, 409, 2],
    [{ webhookUrl: webhook + '?wait=false' }, 409, 2],
    [{ duplicate: true }, 409, 2],
    [{ duplicate: true, reminder: true }, 409, 2],
  ]) {
    const { response, calls } = await invoke(options);
    assert.equal(response.status, status);
    assert.equal(calls.length, callCount);
    assert.ok(calls.every(call => call.url.startsWith('https://database.test/')));
  }
});

test('un refus Discord et une réponse incertaine conservent des états distincts sans réessai', async () => {
  for (const [discordStatus, state] of [[429, 'rejected'], [500, 'unknown'], ['timeout', 'unknown']]) {
    const { response, calls } = await invoke({ discordStatus });
    assert.equal(response.status, 502);
    assert.equal(calls.length, 4);
    assert.equal(calls[2].url, webhook + '?wait=true');
    assert.deepEqual(calls[3].body, { p_id: deliveryId, p_state: state });
  }
});
