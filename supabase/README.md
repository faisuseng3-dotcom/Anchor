# Notiser om favoriter: servern

Uppsatt i projektet QeueBar (`awwmfsjsrjktekmbgadx`) 2026-11-11 med Supabase CLI (`npx -y supabase@latest`).
Nycklarna ligger i `~/Desktop/qbar-push-nycklar.txt` på datorn där de skapades. Checka aldrig in dem.

| Del | Fil | Hur den kom på plats |
|---|---|---|
| Tabell `push_subscriptions` + RPC:erna `save_push_subscription`, `delete_push_subscription`, `delete_push_subscriptions` | `migrations/20261111000000_push_subscriptions.sql` | `db query --remote -f` |
| Edge Function `notify-favorites` | `functions/notify-favorites/` | `functions deploy notify-favorites --no-verify-jwt --use-api` |
| Hemligheter `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `WEBHOOK_SECRET` | nyckelfilen | `secrets set --env-file` |
| Trigger `notify_favorites` på `reports` (pg_net) | `webhook.sql`, med `<WEBHOOK_SECRET>` utbytt | `db query --remote -f` |
| Gamla öppna tabeller (`favorites`, `user_profiles`, `report_votes`) tömda och stängda | `migrations/20261111010000_lock_legacy_tables.sql` | `db query --remote=awwmfsjsrjktekmbgadx --yes -f`, körd 2026-11-11 |
| `reports.reporter`, `reports_guard` som security definer som också sätter `expires_at`, `delete_my_data`, testrader bort | `migrations/20261111020000_reports_owner.sql` | samma, körd 2026-11-11 |
| `user_id` oläsbart för anon, gamla id bytta, `delete_push_subscriptions` borttagen | `migrations/20261111030000_hide_user_id.sql` | samma, körd 2026-11-11 efter att klienten med `REPORT_COLUMNS` driftsatts (den gamla läste `select('*')`) |
| Tabell `on_my_way` + `start_on_my_way`, `stop_on_my_way`, `on_my_way_counts`; `delete_my_data` tar även "på väg" | `migrations/20261111040000_on_my_way.sql` | samma, körd 2026-11-11 |
| `delete_my_report` (Ångra i Profil) | `migrations/20261111050000_delete_my_report.sql` | samma, körd 2026-11-11 |
| Gallring: pg_cron-jobbet `qbar-gallring` (03:30 UTC) raderar rapporter över 90 dagar och utgångna "på väg"; död `delete_expired_reports` borttagen | `migrations/20261111060000_retention.sql` | samma, körd 2026-11-11 |

`VAPID_PUBLIC_KEY` måste vara samma som `PUSH_PUBLIC_KEY` i `src/main.js`. Byts nycklarna slutar alla befintliga
prenumerationer att fungera. Byts `WEBHOOK_SECRET` måste `webhook.sql` köras om med det nya värdet.

## Ändra funktionen

```bash
npx -y supabase@latest login          # en gång, i din egen terminal
npx -y supabase@latest functions deploy notify-favorites --no-verify-jwt --use-api --project-ref awwmfsjsrjktekmbgadx
```

## Felsökning

- Edge Functions → `notify-favorites` → Logs: "skickat N" per rapport, 401 = fel `x-webhook-secret`.
- Triggerns anrop: `select status_code, content, error_msg from net._http_response order by created desc limit 5;`

## Ta bort allt

```sql
drop trigger if exists notify_favorites on public.reports;
drop function if exists public.notify_favorites_webhook();
drop table if exists public.push_subscriptions;
drop function if exists public.save_push_subscription(text, text, text, text, text[]);
drop function if exists public.delete_push_subscription(text);
drop function if exists public.delete_push_subscriptions(text);
```

och Edge Functions → `notify-favorites` → Delete.
