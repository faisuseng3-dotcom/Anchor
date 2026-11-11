// Notistexten för en ny rapport. Ren funktion utan Deno eller nätverk, så att den går att testa i Node
// (tests/notify.test.js). Intervallen är desamma som AHEAD_BUCKETS i src/main.js; testet larmar om de glider isär.
const AHEAD_TEXT = [
  [60, 'Över 50 personer i kö'],
  [37, '25–50 personer i kö'],
  [17, '10–25 personer i kö'],
  [5, '1–10 personer i kö'],
  [0, 'Ingen kö just nu']
];

// r: raden ur reports. sessionStartedAt: första rapporten i samma kö-session (bara för 'entered').
// null = ingen notis: uppföljningar, rapporter utan antal och "inne" som inte går att mäta.
export function notificationFor(r, sessionStartedAt) {
  if (!r || !r.venue_id || !r.venue_name) return null;
  const base = { title: r.venue_name, tag: 'venue-' + r.venue_id, url: '/?venue=' + encodeURIComponent(r.venue_id) };
  if (r.report_type === 'entered') {
    if (!sessionStartedAt) return null;
    const mins = Math.round((new Date(r.created_at) - new Date(sessionStartedAt)) / 60000);
    return mins >= 1 ? { ...base, body: 'Någon kom in efter ' + mins + ' min i kön' } : null;
  }
  if (r.report_type !== 'initial' || typeof r.people_ahead !== 'number' || r.people_ahead < 0) return null;
  const text = AHEAD_TEXT.find(([mid]) => r.people_ahead >= mid)[1];
  return { ...base, body: r.people_ahead > 0 && r.queue_status === 'long' ? text + ' · lång kö' : text };
}
