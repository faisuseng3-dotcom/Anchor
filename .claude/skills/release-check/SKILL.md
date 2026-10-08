# /release-check

Pre-release checklist before merging `claude/queuebar-expo-setup-do34fo` → `main` for Vercel deploy.

## Trigger

`/release-check`

## Process

### STEP 1 — Automated checks (must all pass)

```bash
node scripts/check.js
```

If any check fails: **stop**. Fix before proceeding.

### STEP 2 — File integrity

```bash
# Confirm single-file structure
ls -la index.html vercel.json

# File size check
wc -c index.html
echo "Target: < 300KB"

# No .env committed
git status | grep "\.env"
# Must be empty

# No debug artifacts
grep -n "console\.log\|debugger\|TODO\|FIXME\|HACK" index.html | grep -v "\[QueueBar\]"
# [QueueBar] prefixed logs are intentional diagnostics — others are not
```

### STEP 3 — Configuration check

```bash
# vercel.json headers
cat vercel.json
# Must contain: "Cache-Control": "no-cache, no-store, must-revalidate"

# Mapbox token present (not empty)
grep -o "pk\.[a-zA-Z0-9._-]*" index.html | head -1
# Must return a token starting with pk.

# Supabase URL present
grep -o "https://[a-z0-9]*\.supabase\.co" index.html | head -1
# Must return a URL

# Supabase anon key present
grep -o "eyJ[a-zA-Z0-9._-]*" index.html | head -1
# Must return a JWT-shaped token
```

### STEP 4 — Functionality verification (manual, with testdata)

Open the app locally in a browser (or use `python3 -m http.server 8080` + `?testdata=true`):

- [ ] Home screen loads map with venue markers
- [ ] Venue markers show correct status colors from testdata
- [ ] Opening a venue card shows correct queue time
- [ ] Explore screen loads with "Stockholm just nu" widget
- [ ] Widget shows 3 KORT / 7 MEDEL / 7 LÅNG (testdata values — verify in console)
- [ ] Explore list: venues with data appear before venues without data
- [ ] Pelikan and Drama rows: red background tint + pulse dot visible
- [ ] Morfar Ginko / Solidaritet: green background tint
- [ ] Venues without data: gray, dimmed (0.55 opacity), appear last
- [ ] Filter buttons (Alla / Barer / Klubbar / Happy Hour) work
- [ ] Live feed shows report history
- [ ] Profile screen loads without error

### STEP 5 — Error state check

Open with no testdata and no Supabase (simulate: temporarily remove token from URL):
- [ ] App does not crash
- [ ] Shows empty states gracefully
- [ ] "Stockholm just nu" widget shows 0/0/0 + no-data message

### STEP 6 — Git state

```bash
git log --oneline -5
git status
# Must be clean (nothing uncommitted)

git diff origin/main...HEAD --stat
# Review what's changed since last deploy
```

### STEP 7 — Merge

Only after all steps pass:

```bash
git checkout main
git pull origin main
git merge claude/queuebar-expo-setup-do34fo
git push origin main
```

Vercel auto-deploys from `main` push.

### STEP 8 — Post-deploy verification

After Vercel deploy completes (~1 min):
- [ ] Production URL loads
- [ ] Mapbox map renders (token URL allowlist must include Vercel domain)
- [ ] Supabase connection works (reports load without `[QueueBar] loadReports Supabase-fel`)
- [ ] No JS errors in console

### STEP 9 — Mapbox token domains (first deploy to new URL only)

If deploying to a new Vercel URL:
- Go to Mapbox account → Tokens
- Add the new Vercel domain to allowed URLs
- Format: `https://your-project.vercel.app`

### Known production issues to monitor

- Supabase RLS may block `SELECT` for anonymous users — check console for RLS errors
- Realtime subscription may not fire in production if Supabase plan limits connections
- If `allReports` always 0 in production: run RLS SQL from Supabase dashboard (see earlier session notes)

## Release decision

| Condition | Action |
|-----------|--------|
| All steps pass | Merge and deploy |
| `scripts/check.js` fails | Fix before proceeding |
| Functional verification fails | Fix before proceeding |
| Only STEP 4 optional items fail | Document and deploy with known limitation |
| Production Supabase errors | Deploy UI, investigate RLS separately |
