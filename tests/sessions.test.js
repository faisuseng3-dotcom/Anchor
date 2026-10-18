// sessionRates och measureQueueRates — hur dörrens hastighet mäts.
// En kö-session är en persons väg genom kön: initial → followup(s) → entered.

import { describe, it, expect } from 'vitest';
import { sessionRates, measureQueueRates, estimateWait, formatWait, NOW, report, session } from './harness.js';

describe('sessionRates — takten ur en session', () => {
  it('räknar rörelse delat med tid', () => {
    // 37 → 7 på 30 minuter = 1,0 personer per minut
    const rates = sessionRates(session('spy-bar', 's1', [[30, 37], [0, 7]]));
    expect(rates).toHaveLength(1);
    expect(rates[0].rate).toBeCloseTo(1.0, 5);
    expect(rates[0].venueId).toBe('spy-bar');
  });

  it('använder första och sista mätpunkten, inte mellanliggande', () => {
    const rates = sessionRates(session('spy-bar', 's1', [[30, 37], [20, 30], [10, 20], [0, 7]]));
    expect(rates).toHaveLength(1);
    expect(rates[0].rate).toBeCloseTo(1.0, 5);
  });

  it('ger en takt per session, inte per rapport', () => {
    const rates = sessionRates([
      ...session('spy-bar', 's1', [[30, 37], [0, 7]]),
      ...session('spy-bar', 's2', [[20, 17], [0, 7]])
    ]);
    expect(rates).toHaveLength(2);
  });

  it('startedAt är sessionens första mätpunkt', () => {
    const rates = sessionRates(session('spy-bar', 's1', [[30, 37], [0, 7]]));
    expect(rates[0].startedAt).toBe(NOW - 30 * 60000);
  });
});

describe('sessionRates — de fyra ogiltighetsreglerna', () => {
  it('förkastar en session med bara en mätpunkt', () => {
    expect(sessionRates(session('spy-bar', 's1', [[20, 37]]))).toHaveLength(0);
  });

  it('förkastar en session kortare än fyra minuter', () => {
    expect(sessionRates(session('spy-bar', 's1', [[3, 37], [0, 17]]))).toHaveLength(0);
  });

  it('godtar en session på precis fyra minuter', () => {
    expect(sessionRates(session('spy-bar', 's1', [[4, 37], [0, 17]]))).toHaveLength(1);
  });

  it('förkastar en session längre än 90 minuter', () => {
    expect(sessionRates(session('spy-bar', 's1', [[95, 37], [0, 7]]))).toHaveLength(0);
  });

  it('förkastar negativ rörelse — kön kan inte växa framför en enskild person', () => {
    expect(sessionRates(session('spy-bar', 's1', [[20, 17], [0, 37]]))).toHaveLength(0);
  });

  it('hoppar över rapporter utan queue_session', () => {
    expect(sessionRates([report('spy-bar', 30, 37), report('spy-bar', 0, 7)])).toHaveLength(0);
  });

  it('hoppar över rapporter där people_ahead är null', () => {
    const rows = session('spy-bar', 's1', [[30, 37], [0, 7]]);
    rows[1].people_ahead = null;
    expect(sessionRates(rows)).toHaveLength(0);
  });
});

describe('sessionRates — när någon står kvar i samma intervall', () => {
  it('uppskattar takten till halva intervallbredden delat med tiden', () => {
    // Intervallet 10–25 har width 15. Står kvar i 20 min → (15/2)/20 = 0,375
    const rates = sessionRates(session('spy-bar', 's1', [[20, 17], [0, 17]]));
    expect(rates).toHaveLength(1);
    expect(rates[0].rate).toBeCloseTo(0.375, 5);
  });

  it('sätter aldrig takten till noll — vi vet inte att kön står still', () => {
    const rates = sessionRates(session('spy-bar', 's1', [[30, 37], [0, 37]]));
    expect(rates[0].rate).toBeGreaterThan(0);
  });

  it('kräver minst tio minuter för att gissa på intervallbredden', () => {
    // Under 10 min är rörelsen för liten att säga något om — sessionen förkastas
    expect(sessionRates(session('spy-bar', 's1', [[8, 17], [0, 17]]))).toHaveLength(0);
    expect(sessionRates(session('spy-bar', 's1', [[10, 17], [0, 17]]))).toHaveLength(1);
  });

  // ── KÄND BUGG — dokumenterad, inte åtgärdad ───────────────────────────────
  //
  // aheadBucket(0).width är 0, så en session där båda mätpunkterna är "Ingen kö"
  // ger (0/2)/mins = 0. Vakten är `if (rate !== null)`, och noll passerar den.
  // Resultatet är en UPPMÄTT DÖRRTAKT PÅ NOLL från någon som rapporterade att det
  // inte fanns någon kö.
  //
  // RÄTT BETEENDE: sessionen ska förkastas. Att ingen kö fanns säger ingenting om
  // hur snabbt dörren släpper in folk.
  //
  // ÅTGÄRD: kräv att intervallet har en bredd innan det gissas på den, alltså
  //   else if (mins >= 10 && aheadBucket(first.people_ahead).width > 0)
  //
  // När buggen är åtgärdad fallerar de tre testerna nedan. Vänd då på dem:
  // toHaveLength(0), och ta bort "KÄND BUGG" ur namnen.
  it('KÄND BUGG: en session med "Ingen kö" i båda ändar ger takten 0', () => {
    const rates = sessionRates(session('spy-bar', 's1', [[20, 0], [0, 0]]));
    expect(rates).toHaveLength(1);
    expect(rates[0].rate).toBe(0);
  });

  it('KÄND BUGG: nås genom ett normalt flöde — "Ingen kö" följt av "Jag är inne"', () => {
    const flow = [
      report('kristall', 12, 0, { session: 'qs-1', type: 'initial' }),
      report('kristall', 0, 0, { session: 'qs-1', type: 'entered' })
    ];
    expect(sessionRates(flow).map((r) => r.rate)).toEqual([0]);
  });

  it('KÄND BUGG: en nollsession gör den visade väntetiden längre', () => {
    // kristall har pace normal (2,0 pers/min). 37 framför → 10–25 min.
    // En session som rapporterat "ingen kö" drar takten till 1,33 → 20–35 min.
    const utan = estimateWait('kristall', [report('kristall', 2, 37)], NOW);
    const med = estimateWait('kristall', [
      ...session('kristall', 's1', [[20, 0], [0, 0]]),
      report('kristall', 2, 37)
    ], NOW);
    expect(utan.rate).toBe(2.0);
    expect(med.rate).toBeLessThan(utan.rate);
    expect(formatWait(utan)).toBe('10–25 min');
    expect(formatWait(med)).toBe('20–35 min');
  });

  it('KÄND BUGG: två nollsessioner får appen att visa "Fullt"', () => {
    // Två personer gick rakt in tidigare under kvällen. Sedan börjar kön byggas.
    // Appen svarar "Fullt" — på data som säger att det inte fanns någon kö.
    const reports = [
      ...session('kristall', 's1', [[25, 0], [5, 0]]),
      ...session('kristall', 's2', [[23, 0], [3, 0]]),
      report('kristall', 2, 37)
    ];
    const est = estimateWait('kristall', reports, NOW);
    expect(est.full).toBe(true);
    expect(formatWait(est)).toBe('Fullt');
  });

  it('en längre stillastående session ger en lägre takt', () => {
    const kort = sessionRates(session('spy-bar', 's1', [[15, 17], [0, 17]]))[0].rate;
    const lang = sessionRates(session('spy-bar', 's2', [[45, 17], [0, 17]]))[0].rate;
    expect(lang).toBeLessThan(kort);
  });
});

describe('measureQueueRates — kvällens fönster', () => {
  it('tar bara sessioner för det efterfrågade stället', () => {
    const reports = [
      ...session('spy-bar', 's1', [[30, 37], [0, 7]]),
      ...session('berns', 's2', [[30, 37], [0, 7]])
    ];
    expect(measureQueueRates('spy-bar', reports, NOW)).toHaveLength(1);
    expect(measureQueueRates('berns', reports, NOW)).toHaveLength(1);
    expect(measureQueueRates('kristall', reports, NOW)).toHaveLength(0);
  });

  it('ser 45 minuter bakåt', () => {
    expect(measureQueueRates('spy-bar', session('spy-bar', 's1', [[44, 37], [30, 7]]), NOW)).toHaveLength(1);
  });

  it('ignorerar sessioner som börjat utanför fönstret', () => {
    // Startar 60 min bakåt: den första mätpunkten faller bort, och då finns bara en punkt kvar
    expect(measureQueueRates('spy-bar', session('spy-bar', 's1', [[60, 37], [30, 7]]), NOW)).toHaveLength(0);
  });

  it('returnerar bara tal, inte objekt', () => {
    const rates = measureQueueRates('spy-bar', session('spy-bar', 's1', [[30, 37], [0, 7]]), NOW);
    expect(typeof rates[0]).toBe('number');
  });
});
