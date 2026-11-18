# Notiser om favoriter: servern

Uppsatt i projektet QeueBar (`awwmfsjsrjktekmbgadx`) 2026-11-11 med Supabase CLI (`npx -y supabase@latest`).
Nycklarna ligger i `~/Desktop/qbar-push-nycklar.txt` på datorn där de skapades. Checka aldrig in dem.

| Del | Fil | Hur den kom på plats |
|---|---|---|
| Baslinje: `reports`, `favorites`, `user_profiles`, `report_votes` som de skapades i webbgränssnittet, med de första policyerna, den första `reports_guard` och realtid för `reports` | `migrations/20260901000000_baseline.sql` | körs **inte** mot produktionen (allt finns redan där); bara mot en tom databas |
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
| Spärr per nät: högst 10 kömätningar i timmen per IP (`reports_guard`, `ip_limited`), hashad med salt i `app_secrets`, logg i `report_ip_log` som jobbet `qbar-iplogg` rensar | `migrations/20261111070000_ip_limit.sql` | samma, körd 2026-11-11 |
| Index på `reports (user_id, created_at)` och `reports (reporter, created_at desc)` | `migrations/20261112000000_reports_indexes.sql` | samma, körd 2026-11-12 |
| Spärren per `user_id` mellan kömätningar 20 → 5 min (`reports_guard`, `rate_limited`) | `migrations/20261113000000_report_cooldown.sql` | samma, körd 2026-11-13 |
| Kommentarer nollas (`reports_no_comment`), push bara till webbläsarnas push-tjänster (`save_push_subscription`) | `migrations/20261112010000_launch_hardening.sql` | samma, körd 2026-11-13; `notify-favorites` driftsatt samma dag (titel ur `venue-names.js`) |
| Spärren per nät 10 → 50 kömätningar i timmen (en klubbs wifi är en IP); `report_type` `refused`/`left` ("Kom inte in", "Gav upp") avslutar sessionen | `migrations/20261115000000_ip_limit_and_queue_exits.sql` | samma, körd 2026-11-15 |
| Qbar för krogar: `venue_accounts`, `venue_notes`, `save_venue_note`, `venue_stats` och modellen i SQL (`qbar_*`) | `migrations/20261118000000_krog.sql` | samma, körd 2026-11-18 |
| Ett inloggat ställe (`authenticated`) läser eller skriver aldrig `reports` direkt, bara via `venue_stats()` | `migrations/20261118010000_krog_no_direct_reports.sql` | samma, körd 2026-11-18 |
| Auth: Site URL och Redirect URLs `https://anchor-queuebar.vercel.app/krog.html`, `http://localhost:5173/krog.html`; registrering avstängd (`disable_signup`) | Management API (`PATCH /v1/projects/…/config/auth`) | satt 2026-11-18 |

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

## Lägg till ett ställe med avtal (krog.html)

Auth används bara av krog.html; Qbar-appen har inga konton. Registrering är avstängd, så bara adresser som lagts in
under Users kan logga in.

1. Authentication → Users → Add user → Create user med "Auto Confirm User", med ställets e-post.
2. Lägg till avtalet. `venue_id` måste vara exakt id:t i `VENUES` (`src/main.js`), `pace` samma som där (`slow`,
   `normal` eller `fast`):
   ```sql
   insert into venue_accounts (email, venue_id, pace) values ('kvall@berns.se', 'berns', 'slow');
   ```
3. Ändras `pace` i `VENUES`: `update venue_accounts set pace = '…' where venue_id = '…';`. Ändras namn eller ställen:
   `node scripts/venue-names.mjs` (krogsidan tar namnet därifrån). Hamnar stället i `HIDDEN_VENUES` eller tas bort
   ur `VENUES` säger krogsidan "Syns inte i Qbar"; säg upp avtalet eller öppna stället igen.

Avtalet upphör: `delete from venue_accounts where email = '…';` (raden i `venue_notes` försvinner ur appen efter 06:00).

Supabases inbyggda e-post skickar 2 mejl i timmen (`rate_limit_email_sent`); koppla egen SMTP (Authentication →
SMTP Settings) före fler än några ställen. Kopplas qbar.se: lägg till `https://qbar.se/krog.html` under Redirect URLs.

### Demo

`supabase/demo-krog.sql` lägger 8 veckors kvällar på det påhittade stället `qbar-demo` (inte i `VENUES`, syns aldrig i
appen) och kopplar kontot `demo@queuebar.se` (auth-användaren skapad 2026-11-18). Kör om före varje demo; läs
kommentaren överst först. Inloggningslänk utan mejl:

```bash
SK=$(npx -y supabase@latest projects api-keys --project-ref awwmfsjsrjktekmbgadx -o json | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0)).find(k=>k.name==='service_role').api_key)")
curl -s -X POST https://awwmfsjsrjktekmbgadx.supabase.co/auth/v1/admin/generate_link -H "apikey: $SK" -H "Authorization: Bearer $SK" \
  -H 'content-type: application/json' -d '{"type":"magiclink","email":"demo@queuebar.se","redirect_to":"https://anchor-queuebar.vercel.app/krog.html"}'
```

`action_link` i svaret loggar in (en gång, inom en timme).

