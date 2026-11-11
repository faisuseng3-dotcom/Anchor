// Notistexten som servern skickar (supabase/functions/notify-favorites/notify.js).
import { describe, it, expect } from 'vitest';
import { notificationFor } from '../supabase/functions/notify-favorites/notify.js';
import { AHEAD_BUCKETS } from './harness.js';

const base = { venue_id: 'spy-bar', venue_name: 'Spy Bar', report_type: 'initial', created_at: '2026-11-13T22:30:00Z' };

describe('notificationFor', () => {
  it('har en text per intervall i appen, så att notisen säger samma sak som knappen man tryckte på', () => {
    const bodies = AHEAD_BUCKETS.map((b) => notificationFor({ ...base, people_ahead: b.mid }).body);
    expect(bodies).toEqual(['Ingen kö just nu', '1–10 personer i kö', '10–25 personer i kö', '25–50 personer i kö', 'Över 50 personer i kö']);
  });

  it('säger "lång kö" bara när rapporten själv bedömdes lång, aldrig vid "Ingen kö"', () => {
    expect(notificationFor({ ...base, people_ahead: 37, queue_status: 'long' }).body).toBe('25–50 personer i kö · lång kö');
    expect(notificationFor({ ...base, people_ahead: 37, queue_status: 'medium' }).body).toBe('25–50 personer i kö');
    expect(notificationFor({ ...base, people_ahead: 0, queue_status: 'long' }).body).toBe('Ingen kö just nu');
  });

  it('ersätter förra notisen från samma ställe och öppnar stället', () => {
    const n = notificationFor({ ...base, people_ahead: 5 });
    expect(n).toMatchObject({ title: 'Spy Bar', tag: 'venue-spy-bar', url: '/?venue=spy-bar' });
  });

  it('räknar "kom in" från sessionens första rapport', () => {
    const r = { ...base, report_type: 'entered', people_ahead: 0 };
    expect(notificationFor(r, '2026-11-13T22:12:00Z').body).toBe('Någon kom in efter 18 min i kön');
    expect(notificationFor(r, null)).toBeNull();
    expect(notificationFor(r, r.created_at)).toBeNull(); // ingen tid i kön att visa
  });

  it('skickar ingen notis för uppföljningar eller rapporter utan antal', () => {
    expect(notificationFor({ ...base, report_type: 'followup', people_ahead: 17 })).toBeNull();
    expect(notificationFor({ ...base, people_ahead: null })).toBeNull();
    expect(notificationFor({ ...base, venue_name: null, people_ahead: 5 })).toBeNull();
  });
});
