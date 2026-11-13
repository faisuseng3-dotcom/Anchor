-- reports_guard söker på user_id (+ created_at) vid varje rapport, delete_my_data/delete_my_report på user_id och
-- profilens historik på reporter sorterat på created_at. Utan index läses hela tabellen, som rymmer 90 dagars rapporter.
create index if not exists reports_user_created_idx on public.reports (user_id, created_at);
create index if not exists reports_reporter_created_idx on public.reports (reporter, created_at desc);
