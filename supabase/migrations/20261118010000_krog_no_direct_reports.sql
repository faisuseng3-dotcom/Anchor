-- Ett inloggat ställe (rollen authenticated, bara krog.html) läser aldrig reports eller skriver rapporter direkt: allt går
-- via venue_stats(). Appen har inga konton och kör alltid som anon (persistSession: false), så den påverkas inte.
-- Anons läsrätt (REPORT_COLUMNS, utan user_id) är appens och finns kvar.
revoke all on public.reports from authenticated;
