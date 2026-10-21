// Karakteriseringstester: låser väntetidsmodellens GRÄNSER innan någon refaktor.
//
// wait.test.js beskriver vad modellen gör. Den här filen låser var den slutar göra det:
// de exakta trösklarna, de tomma fallen och de ogiltiga värdena. Varje förväntat värde är
// läst ur src/main.js, inte härlett från dokumentationen.
//
// Fallerar ett test här har beteendet ändrats. Uppdatera inte siffran — ta reda på varför.

import { describe, it, expect, afterEach } from 'vitest';
import {
  estimateWait, formatWait, setWaitRange, venueWaitText, computeStatus,
  getStatusLabel, _setAllReports, PACE_RATE, report, NOW
} from './harness.js';

describe('estimateWait — tomhet och ogiltig indata', () => {
  it('returnerar null för en tom rapportlista', () => {
    expect(estimateWait('spy-bar', [], NOW)).toBeNull();
  });

  it('returnerar null när alla rapporter gäller andra ställen', () => {
    expect(estimateWait('spy-bar', [report('berns', 2, 37)], NOW)).toBeNull();
  });

  it('filtrerar bort people_ahead null — filtret är != null', () => {
    expect(estimateWait('spy-bar', [report('spy-bar', 2, null)], NOW)).toBeNull();
  });

  it('filtrerar bort people_ahead undefined', () => {
    expect(estimateWait('spy-bar', [report('spy-bar', 2, undefined)], NOW)).toBeNull();
  });

  it('ett okänt venueId kraschar inte — takten faller till normal', () => {
    // (venue && venue.pace) || 'normal' — utan den vakten hade getVenueById
    // returnerat undefined och uppslagningen kastat.
    const est = estimateWait('finns-inte', [report('finns-inte', 2, 37)], NOW);
    expect(est.rate).toBe(PACE_RATE.normal);
  });

  it('utelämnad now betyder nu', () => {
    // now = now || Date.now(). Rapporten byggs mot verklig klocka, inte riggens NOW.
    const fresh = report('spy-bar', 2, 37, { at: Date.now() });
    expect(estimateWait('spy-bar', [fresh])).not.toBeNull();
  });
});

describe('estimateWait — de exakta trösklarna', () => {
  it('en rapport på exakt 45 minuter räknas INTE — jämförelsen är <', () => {
    expect(estimateWait('spy-bar', [report('spy-bar', 45, 37)], NOW)).toBeNull();
  });

  it('44,9 minuter räknas fortfarande', () => {
    expect(estimateWait('spy-bar', [report('spy-bar', 44.9, 37)], NOW)).not.toBeNull();
  });

  it('en rapport skapad i samma stund räknas — jämförelsen är >= 0', () => {
    expect(estimateWait('spy-bar', [report('spy-bar', 0, 37)], NOW)).not.toBeNull();
  });

  it('exakt 20 minuter är inte färskt och hamnar utanför medianen', () => {
    // Vore 20 min färskt blev medianen av [5, 37] = 21. Den är det inte, så bara
    // den 10 minuter gamla rapporten bildar medianen.
    const reports = [report('spy-bar', 10, 5), report('spy-bar', 20, 37)];
    expect(estimateWait('spy-bar', reports, NOW).ahead).toBe(5);
  });

  it('19,9 minuter är färskt och ingår i medianen', () => {
    const reports = [report('spy-bar', 10, 5), report('spy-bar', 19.9, 37)];
    expect(estimateWait('spy-bar', reports, NOW).ahead).toBe(21);
  });

  it('spreaden byter från 0,35 till 0,2 vid exakt tre mätta sessioner', () => {
    // spy-bar har pace slow, alltså prior 1,0. Varje session nedan mäter exakt 1,0
    // personer per minut, så rate blir (n·1 + 2·1)/(n+2) = 1,0 oavsett n — och mins
    // blir 37 i båda fallen. Då är spreaden det enda som skiljer utfallen.
    const ahead = report('spy-bar', 2, 37);
    const two = [
      ...[[30, 37], [0, 7]].map(([m, a], i) => report('spy-bar', m, a, { session: 's1', type: i ? 'followup' : 'initial' })),
      ...[[20, 37], [0, 17]].map(([m, a], i) => report('spy-bar', m, a, { session: 's2', type: i ? 'followup' : 'initial' })),
      ahead
    ];
    const three = two.concat(
      [[40, 60], [0, 20]].map(([m, a], i) => report('spy-bar', m, a, { session: 's3', type: i ? 'followup' : 'initial' }))
    );

    const estTwo = estimateWait('spy-bar', two, NOW);
    const estThree = estimateWait('spy-bar', three, NOW);

    expect(estTwo.mins).toBe(37);
    expect(estThree.mins).toBe(37);
    expect([estTwo.low, estTwo.high]).toEqual([25, 50]);
    expect([estThree.low, estThree.high]).toEqual([30, 45]);
  });
});

describe('estimateWait — antalet färska rapporter', () => {
  it('en enda färsk rapport ger sitt eget värde', () => {
    expect(estimateWait('spy-bar', [report('spy-bar', 2, 17)], NOW).ahead).toBe(17);
  });

  it('två färska rapporter ger en halvtalsmedian som inte är något knappvärde', () => {
    // median av jämnt antal är medelvärdet av de två mittersta. 5 och 17 ger 11,
    // vilket inte är ett av knapparnas mittvärden (0, 5, 17, 37, 60).
    const reports = [report('spy-bar', 2, 5), report('spy-bar', 4, 17)];
    expect(estimateWait('spy-bar', reports, NOW).ahead).toBe(11);
  });
});

describe('estimateWait — noll kö och "Fullt"', () => {
  it('noll kö ger ett intervall som är noll brett', () => {
    const est = estimateWait('spy-bar', [report('spy-bar', 2, 0)], NOW);
    expect([est.low, est.high]).toEqual([0, 0]);
  });

  it('noll kö kan ALDRIG bli "Fullt" — returen ligger före raden som sätter full', () => {
    // Två sessioner som stått helt still skulle annars uppfylla full-villkoret.
    // estimateWait returnerar vid ahead === 0 innan full beräknas.
    const reports = [
      ...[[40, 17], [5, 17]].map(([m, a], i) => report('spy-bar', m, a, { session: 's1', type: i ? 'followup' : 'initial' })),
      ...[[38, 17], [6, 17]].map(([m, a], i) => report('spy-bar', m, a, { session: 's2', type: i ? 'followup' : 'initial' })),
      report('spy-bar', 2, 0)
    ];
    const est = estimateWait('spy-bar', reports, NOW);
    expect(est.ahead).toBe(0);
    expect(est.full).toBe(false);
    expect(formatWait(est)).toBe('Ingen kö');
  });

  it('en uppmätt takt på exakt 0,3 ger inte "Fullt" — villkoret är strikt <', () => {
    // Intervallet 10–25 har bredd 15. Står någon kvar i det i exakt 25 minuter blir
    // den gissade takten (15/2)/25 = 0,3. Tröskeln är measuredRate < 0,3.
    const reports = [
      ...[[25, 17], [0, 17]].map(([m, a], i) => report('kristall', m, a, { session: 's1', type: i ? 'followup' : 'initial' })),
      ...[[26, 17], [1, 17]].map(([m, a], i) => report('kristall', m, a, { session: 's2', type: i ? 'followup' : 'initial' })),
      report('kristall', 2, 17)
    ];
    expect(estimateWait('kristall', reports, NOW).full).toBe(false);
  });
});

describe('formatWait och setWaitRange — gränserna i texten', () => {
  it('ger tom sträng även för undefined, inte bara null', () => {
    expect(formatWait(undefined)).toBe('');
  });

  it('nedre gränsen får bli noll medan den övre golvas till fem', () => {
    const est = setWaitRange({ mins: 0.5 }, 0.35);
    expect([est.low, est.high]).toEqual([0, 5]);
  });

  it('exakt 60 minuter visas som intervall, över 60 som öppet', () => {
    expect(formatWait({ ahead: 37, low: 40, high: 60, full: false })).toBe('40–60 min');
    expect(formatWait({ ahead: 37, low: 45, high: 65, full: false })).toBe('45+ min');
  });
});

describe('venueWaitText — den enda vägen till en väntetid', () => {
  afterEach(() => _setAllReports([]));

  it('läser allReports ur modulen och formaterar skattningen', () => {
    // spy-bar har pace slow (1,0). 37 framför utan mätta sessioner ger mins 37 och
    // spread 0,35, alltså 25–50. venueWaitText tar ingen now, så rapporten byggs
    // mot verklig klocka.
    _setAllReports([report('spy-bar', 2, 37, { at: Date.now() })]);
    expect(venueWaitText('spy-bar')).toBe('25–50 min');
  });

  it('faller tillbaka på getStatusLabel när skattningen är null', () => {
    // En timme gammal rapport faller utanför estimateWaits 45-minutersfönster, men
    // computeStatus har inget åldersfilter på sin reserv — den tar den senaste
    // rapportens queue_status. En gammal rapport ger därmed en bestämd text.
    _setAllReports([report('spy-bar', 60, 37, { at: Date.now(), status: 'long' })]);
    const reports = [report('spy-bar', 60, 37, { at: Date.now(), status: 'long' })];
    expect(estimateWait('spy-bar', reports)).toBeNull();
    expect(computeStatus('spy-bar', reports)).toBe('long');
    expect(venueWaitText('spy-bar')).toBe(getStatusLabel('long'));
    expect(venueWaitText('spy-bar')).toBe('30+ min');
  });
});
