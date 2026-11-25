import webPush from 'npm:web-push@3.6.7';

type Lease = { event: string; device: string; lease: string };

type Delivery = Lease & {
  kind: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  group: string | null;
  player: string | null;
  staff: boolean | null;
  send: boolean;
};

const env = (name: string) => Deno.env.get(name) ?? '';
const endpointPattern = /^https:\/\/(fcm\.googleapis\.com|(?:[a-z0-9-]+\.)?push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com|android\.googleapis\.com)\/[A-Za-z0-9_/?=%.&:+~-]+$/;

async function rpc(name: string, body: object = {}) {
  const role = env('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: role, authorization: `Bearer ${role}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function validEndpoint(endpoint: string) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || !endpointPattern.test(endpoint)) return false;
  try { return new URL(endpoint).href === endpoint; }
  catch { return false; }
}

async function send(job: Delivery) {
  const result = { event: job.event, device: job.device, lease: job.lease, outcome: 'skip', retry_after: 0 };
  if (!job.send) return result;
  if (!validEndpoint(job.endpoint)) {
    console.warn('[web-push] invalid provider', job.event);
    return { ...result, outcome: 'expired' };
  }
  let request;
  try {
    request = webPush.generateRequestDetails({
      endpoint: job.endpoint,
      keys: { p256dh: job.p256dh, auth: job.auth },
    }, JSON.stringify({
      id: job.event, device: job.device, kind: job.kind,
      group: job.group, player: job.player, staff: job.staff,
    }), {
      vapidDetails: {
        subject: env('VAPID_SUBJECT'),
        publicKey: env('VAPID_PUBLIC_KEY'),
        privateKey: env('VAPID_PRIVATE_KEY'),
      },
      TTL: 900,
      topic: job.event.replaceAll('-', ''),
    });
  } catch {
    console.error('[web-push] cannot prepare delivery', job.event);
    return { ...result, outcome: 'retry' };
  }
  try {
    const response = await fetch(job.endpoint, {
      method: 'POST',
      headers: request.headers as Record<string, string>,
      body: new Uint8Array(request.body!),
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    await response.body?.cancel();
    if (response.ok) return { ...result, outcome: 'sent' };
    if (response.status === 404 || response.status === 410) return { ...result, outcome: 'expired' };
    console.warn('[web-push] provider HTTP', response.status, job.event);
    const header = response.headers.get('retry-after');
    const seconds = header && /^\d+$/.test(header) ? Number(header) :
      header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) : 0;
    return {
      ...result,
      outcome: [401, 403, 408, 429].includes(response.status) || response.status >= 500 ? 'retry' : 'skip',
      retry_after: Number.isFinite(seconds) ? Math.max(0, Math.min(1800, seconds)) : 0,
    };
  } catch {
    console.warn('[web-push] provider unavailable', job.event);
    return { ...result, outcome: 'retry' };
  }
}

Deno.serve(async request => {
  const secret = env('WEB_PUSH_DISPATCH_SECRET');
  if (request.method !== 'POST' || !/^[a-f0-9]{64}$/.test(secret) || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response(null, { status: 403 });
  }
  if (!['VAPID_SUBJECT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].every(env)) {
    return new Response(null, { status: 503 });
  }
  try {
    const jobs: Lease[] = await rpc('claim_web_push');
    const results = [];
    try {
      for (let i = 0; i < jobs.length; i += 5) {
        const prepared: Delivery[] = await rpc('prepare_web_push', { p_jobs: jobs.slice(i, i + 5) });
        results.push(...await Promise.all(prepared.map(send)));
      }
    } finally {
      if (results.length) await rpc('finish_web_push', { p_results: results });
    }
    return new Response(null, { status: 204 });
  } catch {
    console.error('[web-push] dispatch failed');
    return new Response(null, { status: 503 });
  }
});
