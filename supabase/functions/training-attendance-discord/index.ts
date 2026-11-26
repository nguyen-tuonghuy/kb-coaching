const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const webhook = /^https:\/\/discord\.com\/api\/webhooks\/[0-9]{17,20}\/[A-Za-z0-9_-]{20,150}$/;
const rejectedStatus = new Set([400, 401, 403, 404, 405, 429]);

type Delivery = { id: string; trained_on: string; label: string | null; deadline: string | null };

Deno.serve(async (request) => {
  const publicUrl = Deno.env.get("TRAINING_ATTENDANCE_APP_URL") ??
    "https://nguyen-tuonghuy.github.io/kb-coaching/";
  const appUrl = new URL(publicUrl);
  const allowedOrigin = appUrl.origin;
  const origin = request.headers.get("origin");
  const headers = {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
  const send = (status: number, detail: string) =>
    Response.json(status < 300 ? { message: detail } : { error: detail }, { status, headers });

  if (origin && origin !== allowedOrigin) return send(403, "Origine refusée.");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return send(405, "Méthode refusée.");
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return send(401, "Connexion requise.");

  try {
    const input = await request.json().catch(() => null);
    if (typeof input?.session_id !== "string" || !uuid.test(input.session_id) ||
        typeof input.group_id !== "string" || !uuid.test(input.group_id) ||
        typeof input.reminder !== "boolean") return send(400, "Demande invalide.");

    const base = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!base || !anon || !service) return send(503, "Service Discord indisponible.");
    const userResponse = await fetch(base + "/auth/v1/user", {
      headers: { apikey: anon, authorization },
      signal: AbortSignal.timeout(5000),
    });
    if (!userResponse.ok) return send(401, "Connexion requise.");
    const user = await userResponse.json();
    if (typeof user.id !== "string" || !uuid.test(user.id)) return send(401, "Connexion requise.");

    const rpc = (name: string, args: Record<string, unknown>) =>
      fetch(base + "/rest/v1/rpc/" + name, {
        method: "POST",
        headers: {
          apikey: service,
          authorization: "Bearer " + service,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(8000),
      });
    const group = input.group_id.toLowerCase();
    const configuration = JSON.parse(Deno.env.get("TRAINING_ATTENDANCE_DISCORD_WEBHOOKS") ?? "{}");
    const url = configuration?.[group];
    const hasWebhook = typeof url === "string" && url === url.trim() && webhook.test(url);
    const reservation = await rpc("reserve_training_attendance_discord", {
      p_session: input.session_id,
      p_group: group,
      p_user: user.id,
      p_reminder: input.reminder,
      p_configured: hasWebhook,
    });
    if (!reservation.ok) {
      const failure = await reservation.json().catch(() => null);
      if (failure?.code === "42501") return send(403, "Accès entraîneur requis.");
      if (failure?.code === "55000") return send(409, failure.message);
      return send(503, "Impossible de préparer l’envoi Discord.");
    }
    const delivery: Delivery | null = await reservation.json();
    if (!delivery) return send(409, "Un envoi existe déjà, attend confirmation ou a été effectué il y a moins de 10 minutes.");
    const link = new URL(appUrl);
    link.searchParams.set("player_group", group);
    link.searchParams.set("training_poll", input.session_id);
    const prefix = input.reminder ? "Relance · Sondage de présence" : "Sondage de présence";
    const [year, month, day] = delivery.trained_on.split("-");
    const deadline = delivery.deadline ? "\nÉchéance <t:" + Math.floor(Date.parse(delivery.deadline) / 1000) + ":f>" : "";
    let state = "unknown";
    try {
      const result = await fetch(url + "?wait=true", {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: prefix + " · " + day + "/" + month + "/" + year + deadline + "\nRépondre sur Kinball Coach\n" + link.href,
          embeds: delivery.label ? [{ title: delivery.label.slice(0, 256) }] : [],
          allowed_mentions: { parse: [] },
        }),
        signal: AbortSignal.timeout(8000),
      });
      state = result.ok ? "sent" : rejectedStatus.has(result.status) ? "rejected" : "unknown";
    } catch {
      // Un timeout peut arriver après l’envoi. La réservation bloque toute répétition.
    }
    const outcome = await rpc("finish_training_attendance_discord", { p_id: delivery.id, p_state: state });
    if (!outcome.ok || state === "unknown") return send(502, "Envoi incertain. Vérifie le canal Discord avant toute nouvelle publication.");
    if (state === "rejected") return send(502, "Discord a refusé l’envoi. Vérifie le webhook ou réessaie plus tard.");
    return send(200, input.reminder ? "Relance envoyée sur Discord." : "Sondage publié sur Discord.");
  } catch {
    return send(503, "Discord est indisponible ou n’a pas confirmé l’envoi.");
  }
});
