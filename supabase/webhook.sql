-- Webhooken: varje ny rapport anropar Edge Function notify-favorites. Samma sak som Database → Webhooks i panelen.
-- Kör med <WEBHOOK_SECRET> utbytt mot värdet i nyckelfilen. Hemligheten checkas aldrig in, därför ligger filen
-- utanför migrations/. pg_net skickar efter commit och i bakgrunden: en rapport sparas även om anropet misslyckas.
create extension if not exists pg_net;

create or replace function public.notify_favorites_webhook() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://awwmfsjsrjktekmbgadx.supabase.co/functions/v1/notify-favorites',
    body := jsonb_build_object('type', 'INSERT', 'table', 'reports', 'record', to_jsonb(new)),
    headers := jsonb_build_object('content-type', 'application/json', 'x-webhook-secret', '<WEBHOOK_SECRET>'),
    timeout_milliseconds := 5000
  );
  return new;
end $$;
revoke all on function public.notify_favorites_webhook() from public, anon, authenticated;

drop trigger if exists notify_favorites on public.reports;
create trigger notify_favorites after insert on public.reports
  for each row execute function public.notify_favorites_webhook();
