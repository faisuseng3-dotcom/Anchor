// computeBestNow — svaret på "vart går vi nu?" på kartan, i listan och i den blå ramen.
// Buggen som låstes fast: filtret letade efter status 'free', men modellen kallar ingen kö för 'none',
// så ett ställe utan kö kunde aldrig bli "Bäst nu".

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { computeBestNow, setTestReports, report, NOW } from './harness.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); setTestReports([]); });

describe('computeBestNow', () => {
  it('väljer ett ställe utan kö före ett med kort kö', () => {
    setTestReports([report('neu', 5, 0), report('kristall', 5, 17)]);
    const best = computeBestNow();
    expect(best.venue.id).toBe('neu');
    expect(best.status).toBe('none');
  });

  it('hittar ett bästa ställe när alla färska ställen saknar kö', () => {
    setTestReports([report('neu', 5, 0), report('patricia', 8, 0)]);
    expect(computeBestNow()).not.toBeNull();
  });

  it('räknar inte en uppföljning som färsk kömätning', () => {
    // Senaste kömätningen är 40 min gammal; uppföljningen för 3 min sedan gör den inte färsk.
    setTestReports([
      report('kristall', 40, 17, { session: 's1' }),
      report('kristall', 3, 5, { session: 's1', type: 'followup' })
    ]);
    expect(computeBestNow()).toBeNull();
  });

  it('väljer aldrig ett ställe med lång kö', () => {
    setTestReports([report('kristall', 5, 60)]);
    expect(computeBestNow()).toBeNull();
  });

  it('tid tills du är inne avgör: kort kö runt hörnet slår ingen kö 2,7 km bort', () => {
    // Du står vid Kristall. Neu (2,7 km, ~32 min promenad) har ingen kö; Kristall har 10–25 framför (~9 min).
    setTestReports([report('neu', 5, 0), report('kristall', 5, 17)], { lat: 59.334, lng: 18.062, acc: 10 });
    expect(computeBestNow().venue.id).toBe('kristall');
  });
});
