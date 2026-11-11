// Skickar en notis till alla som har stället som favorit, för varje ny rapport (utom uppföljningar och den egna).
// Anropas av databas-webhooken på INSERT i reports, se supabase/README.md.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { notificationFor } from './notify.js';

webpush.setVapidDetails('mailto:support@queuebar.se', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  // Anon-nyckeln är publik; utan hemligheten kunde vem som helst skicka notiser med påhittat innehåll.
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) return new Response('nej', { status: 401 });
  const r = (await req.json()).record;

  let startedAt = null;
  if (r?.report_type === 'entered' && r.queue_session) {
    const { data } = await db.from('reports').select('created_at')
      .eq('queue_session', r.queue_session).order('created_at').limit(1);
    startedAt = data?.[0]?.created_at ?? null;
  }
  const n = notificationFor(r, startedAt);
  if (!n) return new Response('ingen notis');

  const { data: subs, error } = await db.from('push_subscriptions').select('endpoint, p256dh, auth')
    .contains('venue_ids', [r.venue_id]).neq('user_id', r.user_id);
  if (error) return new Response(error.message, { status: 500 });

  const payload = JSON.stringify(n), gone: string[] = [];
  await Promise.all(subs.map((s) =>
    // TTL 15 min: en körapport som kommer fram senare än så säger inget om kön längre.
    webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 900, urgency: 'high' })
      .catch((e) => {
        if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.endpoint); // avinstallerad eller avstängd
        else console.error('push misslyckades', e.statusCode, e.body);
      })
  ));
  if (gone.length) await db.from('push_subscriptions').delete().in('endpoint', gone);
  return new Response('skickat ' + (subs.length - gone.length));
});
