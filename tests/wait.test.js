// Väntetidsmodellen: estimateWait → setWaitRange → formatWait → waitToStatus.
// Karakteriseringstester: de låser fast beteendet som det är i dag, innan koden rörs.

import { describe, it, expect } from 'vitest';
import {
  estimateWait, formatWait, waitToStatus, setWaitRange, aheadBucket, median,
  NOW, report, session, waitText
} from './harness.js';

describe('estimateWait — takten avgör svaret', () => {
  it('samma kölängd ger olika väntetid beroende på dörren', () => {
    // Detta är hela modellens poäng. 37 framför är inte en väntetid i sig.
    expect(waitText('spy-bar', [report('spy-bar', 5, 37)])).toBe('25–50 min');   // pace: slow
    expect(waitText('soap-bar', [report('soap-bar', 5, 37)])).toBe('10–15 min'); // pace: fast
    expect(waitText('kristall', [report('kristall', 5, 37)])).toBe('10–25 min'); // pace: normal
  });

  it('ingen kö rapporterad ger "Ingen kö" utan intervall', () => {
    const est = estimateWait('kristall', [report('kristall', 3, 0)], NOW);
    expect(est.ahead).toBe(0);
    expect(est.mins).toBe(0);
    expect(formatWait(est)).toBe('Ingen kö');
  });

  it('en lång kö över en timme visas som öppet intervall', () => {
    expect(waitText('berns', [report('berns', 5, 60)])).toBe('40+ min');
  });

  it('en kort kö vid snabb dörr visas som under fem minuter', () => {
    expect(waitText('tjoget', [report('tjoget', 2, 5)])).toBe('<5 min');
  });
});

describe('estimateWait — färskhetsfönstren', () => {
  it('returnerar null när den enda rapporten är äldre än 45 minuter', () => {
    expect(estimateWait('spy-bar', [report('spy-bar', 50, 37)], NOW)).toBeNull();
    expect(waitText('spy-bar', [report('spy-bar', 50, 37)])).toBeNull();
  });

  it('räknar med en rapport som är 44 minuter gammal', () => {
    expect(estimateWait('spy-bar', [report('spy-bar', 44, 37)], NOW)).not.toBeNull();
  });

  it('ignorerar rapporter från framtiden', () => {
    expect(estimateWait('spy-bar', [report('spy-bar', -5, 37)], NOW)).toBeNull();
  });

  it('använder medianen av rapporter under 20 minuter', () => {
    const reports = [
      report('spy-bar', 2, 5),
      report('spy-bar', 8, 37),
      report('spy-bar', 15, 17)
    ];
    expect(estimateWait('spy-bar', reports, NOW).ahead).toBe(17);
  });

  it('en avvikande rapport bland tre kan inte dra iväg siffran', () => {
    const utan = estimateWait('spy-bar', [report('spy-bar', 2, 17), report('spy-bar', 5, 17)], NOW);
    const med = estimateWait('spy-bar', [
      report('spy-bar', 2, 17), report('spy-bar', 5, 17), report('spy-bar', 8, 60)
    ], NOW);
    expect(med.ahead).toBe(utan.ahead);
  });

  it('faller tillbaka på enbart den senaste när inget är färskare än 20 minuter', () => {
    const reports = [report('spy-bar', 25, 5), report('spy-bar', 40, 60)];
    expect(estimateWait('spy-bar', reports, NOW).ahead).toBe(5);
  });
});

describe('estimateWait — bara initial-rapporter mäter kölängd', () => {
  it('en followup räknas inte som en kömätning', () => {
    const reports = [report('spy-bar', 5, 17, { type: 'followup', session: 's1' })];
    expect(estimateWait('spy-bar', reports, NOW)).toBeNull();
  });

  it('en entered räknas inte heller', () => {
    const reports = [report('spy-bar', 5, 0, { type: 'entered', session: 's1' })];
    expect(estimateWait('spy-bar', reports, NOW)).toBeNull();
  });

  it('en rapport utan report_type behandlas som initial (äldre rader)', () => {
    const gammal = { ...report('spy-bar', 5, 37) };
    delete gammal.report_type;
    expect(estimateWait('spy-bar', [gammal], NOW)).not.toBeNull();
  });

  it('rapporter för andra ställen påverkar inte kölängden', () => {
    const reports = [report('spy-bar', 5, 37), report('berns', 2, 5)];
    expect(estimateWait('spy-bar', reports, NOW).ahead).toBe(37);
  });
});

describe('estimateWait — källan redovisas', () => {
  it('utan mätningar är källan en uppskattning', () => {
    expect(estimateWait('spy-bar', [report('spy-bar', 5, 37)], NOW).source).toBe('estimate');
  });

  it('med en mätt session ikväll är källan live', () => {
    const reports = [...session('spy-bar', 's1', [[30, 37], [0, 7]]), report('spy-bar', 2, 17)];
    expect(estimateWait('spy-bar', reports, NOW).source).toBe('live');
  });

  it('med historik men inga mätningar ikväll är källan history', () => {
    const hist = { rate: 0.5, n: 4 };
    expect(estimateWait('spy-bar', [report('spy-bar', 5, 37)], NOW, hist).source).toBe('history');
  });

  it('historiken används som takt när ikvällens mätningar saknas', () => {
    const hist = { rate: 0.5, n: 4 }; // halv person per minut — mycket långsammare än pace slow
    const est = estimateWait('spy-bar', [report('spy-bar', 5, 37)], NOW, hist);
    expect(est.rate).toBe(0.5);
    expect(est.mins).toBe(74);
  });
});

describe('estimateWait — priorn dämpar ny mätdata', () => {
  it('priorn väger som två sessioner', () => {
    // spy-bar har pace slow = 1.0. En session à 1.2 → (1*1.2 + 2*1.0) / 3
    const reports = [...session('spy-bar', 's1', [[30, 37], [0, 1]]), report('spy-bar', 2, 37)];
    const est = estimateWait('spy-bar', reports, NOW);
    expect(est.rate).toBeGreaterThan(1.0);
    expect(est.rate).toBeLessThan(1.2);
  });

  it('tre mätningar flyttar fortfarande inte siffran hela vägen', () => {
    // Dokumenterad svaghet B-01: priorn väger 40 % även vid tre mätningar.
    const reports = [
      ...session('spy-bar', 's1', [[40, 37], [10, 1]]),
      ...session('spy-bar', 's2', [[38, 37], [8, 1]]),
      ...session('spy-bar', 's3', [[36, 37], [6, 1]]),
      report('spy-bar', 2, 37)
    ];
    const est = estimateWait('spy-bar', reports, NOW);
    expect(est.rate).toBeLessThan(1.2);
  });
});

describe('estimateWait — "Fullt"', () => {
  it('kräver minst två mätta sessioner — aldrig på enbart venue.pace', () => {
    const est = estimateWait('spy-bar', [report('spy-bar', 2, 60)], NOW);
    expect(est.full).toBe(false);
    expect(formatWait(est)).not.toBe('Fullt');
  });

  it('visas när två sessioner stått kvar i samma intervall över en halvtimme', () => {
    const reports = [
      ...session('kristall', 's1', [[40, 17], [5, 17]]),
      ...session('kristall', 's2', [[38, 17], [6, 17]]),
      report('kristall', 2, 17)
    ];
    const est = estimateWait('kristall', reports, NOW);
    expect(est.full).toBe(true);
    expect(formatWait(est)).toBe('Fullt');
  });

  it('en kortare stillastående session räcker inte — width/2 sätter ett golv för takten', () => {
    // Står någon kvar i intervallet 10–25 (width 15) i 20 min blir uppmätt takt
    // (15/2)/20 = 0,375, vilket ligger över tröskeln 0,3. "Fullt" visas alltså inte.
    // Det är avsiktlig försiktighet: vi vet bara att kön rört sig MINDRE än intervallets
    // bredd — inte att den står still. Jämför föregående test, där 35 min ger 0,21.
    const reports = [
      ...session('kristall', 's1', [[30, 17], [10, 17]]),
      ...session('kristall', 's2', [[28, 17], [8, 17]]),
      report('kristall', 2, 17)
    ];
    expect(estimateWait('kristall', reports, NOW).full).toBe(false);
  });

  it('visas när kön faktiskt mätts stå nästan still', () => {
    const reports = [
      ...session('kristall', 's1', [[30, 37], [10, 36]]),
      ...session('kristall', 's2', [[28, 37], [8, 36]]),
      report('kristall', 2, 37)
    ];
    expect(estimateWait('kristall', reports, NOW).full).toBe(true);
  });

  it('visas inte när kön är kort, även om den står still', () => {
    const reports = [
      ...session('kristall', 's1', [[30, 5], [10, 5]]),
      ...session('kristall', 's2', [[28, 5], [8, 5]]),
      report('kristall', 2, 5)
    ];
    expect(estimateWait('kristall', reports, NOW).full).toBe(false);
  });
});

describe('setWaitRange — osäkerheten', () => {
  it('±35 procent med få mätningar', () => {
    const est = setWaitRange({ mins: 40 }, 0.35);
    expect(est.low).toBe(25);   // 40 × 0,65 = 26 → 25
    expect(est.high).toBe(55);  // 40 × 1,35 = 54 → 55
  });

  it('±20 procent med minst tre mätningar', () => {
    const est = setWaitRange({ mins: 40 }, 0.2);
    expect(est.low).toBe(30);
    expect(est.high).toBe(50);
  });

  it('övre gränsen är alltid minst fem minuter', () => {
    expect(setWaitRange({ mins: 0.5 }, 0.35).high).toBe(5);
  });

  it('gränserna avrundas till närmaste fem minuter', () => {
    const est = setWaitRange({ mins: 23 }, 0.35);
    expect(est.low % 5).toBe(0);
    expect(est.high % 5).toBe(0);
  });
});

describe('formatWait — texten', () => {
  const f = (o) => formatWait({ ahead: 17, full: false, mins: 20, low: 0, high: 0, ...o });

  it('Fullt går före allt annat', () => {
    expect(f({ full: true, ahead: 0 })).toBe('Fullt');
  });

  it('visar aldrig en naken siffra utan osäkerhetsmarkering', () => {
    const texter = [
      f({ ahead: 0 }), f({ low: 0, high: 5 }), f({ low: 40, high: 80 }),
      f({ low: 0, high: 15 }), f({ low: 20, high: 20 }), f({ low: 25, high: 50 })
    ];
    for (const t of texter) {
      const nakenSiffra = /^\d+ min$/.test(t);
      expect(nakenSiffra, `"${t}" saknar osäkerhetsmarkering`).toBe(false);
    }
  });

  it('formaterar varje gren', () => {
    expect(f({ ahead: 0 })).toBe('Ingen kö');
    expect(f({ low: 0, high: 5 })).toBe('<5 min');
    expect(f({ low: 40, high: 80 })).toBe('40+ min');
    expect(f({ low: 0, high: 15 })).toBe('<15 min');
    expect(f({ low: 20, high: 20 })).toBe('~20 min');
    expect(f({ low: 25, high: 50 })).toBe('25–50 min');
  });

  it('ger tom sträng utan skattning', () => {
    expect(formatWait(null)).toBe('');
  });
});

describe('waitToStatus — nivå och därmed färg', () => {
  it('trösklarna ligger på 18 och 30 minuter; "Ingen kö" bara när ingen står framför', () => {
    expect(waitToStatus({ ahead: 0, mins: 0, full: false })).toBe('none');
    // 1–10 personer vid en snabb dörr är kort kö, inte "Ingen kö" — texten bredvid säger "<5 min"
    expect(waitToStatus({ ahead: 5, mins: 1.7, full: false })).toBe('short');
    expect(waitToStatus({ ahead: 17, mins: 3, full: false })).toBe('short');
    expect(waitToStatus({ ahead: 17, mins: 17.9, full: false })).toBe('short');
    expect(waitToStatus({ ahead: 17, mins: 18, full: false })).toBe('medium');
    expect(waitToStatus({ ahead: 17, mins: 29.9, full: false })).toBe('medium');
    expect(waitToStatus({ ahead: 37, mins: 30, full: false })).toBe('long');
  });

  it('Fullt är alltid long', () => {
    expect(waitToStatus({ ahead: 60, mins: 5, full: true })).toBe('long');
  });
});

describe('aheadBucket och median', () => {
  it('varje mittvärde hamnar i rätt intervall', () => {
    expect(aheadBucket(0).label).toBe('Ingen kö');
    expect(aheadBucket(5).label).toBe('1–10');
    expect(aheadBucket(17).label).toBe('10–25');
    expect(aheadBucket(37).label).toBe('25–50');
    expect(aheadBucket(60).label).toBe('50+');
  });

  it('median hanterar jämnt och ojämnt antal', () => {
    expect(median([5])).toBe(5);
    expect(median([5, 17, 37])).toBe(17);
    expect(median([5, 17])).toBe(11);
    expect(median([37, 5, 17])).toBe(17); // osorterad indata
  });
});
