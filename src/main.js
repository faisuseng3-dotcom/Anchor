import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { createClient } from '@supabase/supabase-js';
import './style.css';

    // ── PWA install prompt ───────────────────────────────────────────────────
    var _deferredInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      _deferredInstallPrompt = e;
    });

    function maybeShowInstallPrompt() {
      if (!_deferredInstallPrompt) return;
      if (window.matchMedia('(display-mode: standalone)').matches) return;
      try { if (localStorage.getItem('qb_install_dismissed')) return; } catch(e) {}
      var card = document.getElementById('install-prompt');
      if (card) card.style.display = 'flex';
    }

    function acceptInstall() {
      if (!_deferredInstallPrompt) return;
      _deferredInstallPrompt.prompt();
      _deferredInstallPrompt.userChoice.then(function() {
        _deferredInstallPrompt = null;
        dismissInstall();
      });
    }

    function dismissInstall() {
      try { localStorage.setItem('qb_install_dismissed', '1'); } catch(e) {}
      var card = document.getElementById('install-prompt');
      if (card) card.style.display = 'none';
    }

    console.log('[QueueBar] Script startar');

    // ── Navigation initieras ALLRA FÖRST — fungerar oavsett CDN ─────────────
    var currentScreen = 'home';
    var prevScreen = 'home';

    function showScreen(name) {
      prevScreen = currentScreen;
      currentScreen = name;
      document.querySelectorAll('.screen').forEach(function(el) {
        el.classList.toggle('active', el.id === 'screen-' + name);
      });
      document.querySelectorAll('.tab').forEach(function(el) {
        el.classList.toggle('active', el.dataset.screen === name);
      });
      if (name === 'home') setTimeout(function() { if (map) map.resize(); if (window.expandSheetHalf === undefined) {} }, 50);
      if (name === 'profile') loadUserHistory();
      if (name === 'report' && prevScreen !== 'report' && typeof rsStep === 'function') {
        selectedRV = null;
        rsStep(1);
        filterReportList();
      }
      if (name === 'explore' && _listIntro) renderExploreVenues();
      console.log('[QueueBar] Byter till skärm:', name);
    }

    // ── Mapbox token ─────────────────────────────────────────────────────────
    mapboxgl.accessToken = 'pk.eyJ1IjoiZmFpc3VzZW5nIiwiYSI6ImNtdWZocnA0YjA2cmszNHNhNGt2ZWJoeWcifQ.Pxmzf6pY69jIwHwdxsFzzg';
    console.log('[QueueBar] Mapbox token satt');

    // ── Supabase ──────────────────────────────────────────────────────────────
    const SUPABASE_URL = 'https://awwmfsjsrjktekmbgadx.supabase.co';
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3d21mc2pzcmprdGVrbWJnYWR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMjMwNzIsImV4cCI6MjEwNTY5OTA3Mn0.i5kS3ipzQ0mSzvVnjPbMiotVVUDYcpdTzQ5_HdCQCqI';

    var supabase = null;
    try {
      supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      console.log('[QueueBar] Supabase klient skapad');
    } catch(err) {
      console.error('[QueueBar] Supabase init misslyckades:', err);
    }

    // ── Feltoast (ersätter conn-banner) ─────────────────────────────────────
    var errToastTimer = null;
    function showConnectionBanner() {
      var toast = document.getElementById('err-toast');
      if (!toast) return;
      toast.classList.add('visible');
      if (errToastTimer) clearTimeout(errToastTimer);
      errToastTimer = setTimeout(function() {
        toast.classList.remove('visible');
      }, 8000);
    }

    function autoRetrySupabase(attempt) {
      if (attempt > 3) {
        console.warn('[QueueBar] Supabase: alla 3 retry-försök misslyckades — kör i offline-läge');
        showOfflineBanner();
        showConnectionBanner();
        return;
      }
      console.log('[QueueBar] Supabase retry ' + attempt + '/3...');
      setTimeout(function() {
        if (supabase) { console.log('[QueueBar] Supabase redan tillgänglig, avbryter retry'); return; }
        try {
          supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
          });
          console.log('[QueueBar] Supabase klient skapad vid auto-retry ' + attempt);
          var toast = document.getElementById('err-toast');
          if (toast) toast.classList.remove('visible');
          loadReports();
          subscribeToReports();
        } catch(err) {
          console.error('[QueueBar] Supabase auto-retry ' + attempt + ' init-fel:', err);
          autoRetrySupabase(attempt + 1);
        }
      }, 1000 * attempt);
    }

    function showOfflineBanner() {
      var el = document.getElementById('explore-offline-banner');
      if (el) return;
      var sticky = document.getElementById('explore-sticky');
      if (!sticky) return;
      var banner = document.createElement('div');
      banner.id = 'explore-offline-banner';
      banner.style.cssText = 'background:rgba(59,130,246,0.12);border-bottom:1px solid rgba(59,130,246,0.22);padding:8px 16px;font-size:13px;color:rgba(255,255,255,0.75);font-family:var(--font-base);';
      banner.textContent = 'Offline-läge — visar sparad data';
      sticky.parentNode.insertBefore(banner, sticky.nextSibling);
    }

    function retrySupabase() {
      console.log('[QueueBar] Försöker återansluta till Supabase...');
      try {
        if (!supabase) {
          supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
          });
        }
        var toast = document.getElementById('err-toast');
        if (toast) toast.classList.remove('visible');
        loadReports();
        subscribeToReports();
      } catch(err) {
        console.error('[QueueBar] Supabase retry misslyckades:', err);
      }
    }

    // ── Data och hjälpfunktioner ─────────────────────────────────────────────
    var userHistory = [];

    const VENUES = [
      { id: 'soap-bar', name: 'Soap Bar', address: 'Nybrogatan 1', area: 'Östermalm', type: 'bar', lat: 59.3349, lng: 18.0735, closing: '03:00', pace: 'fast' },
      { id: 'akkurat', name: 'Akkurat Bar & Restaurang', address: 'Hornsgatan 18', area: 'Slussen', type: 'bar', lat: 59.3190, lng: 18.0640, closing: '01:00', pace: 'fast' },
      { id: 'tjoget', name: 'Tjoget', address: 'Hornsbruksgatan 24', area: 'Hornstull', type: 'bar', lat: 59.3157, lng: 18.0348, closing: '01:00', pace: 'fast' },
      { id: 'sturehof', name: 'Sturehof', address: 'Stureplan 2', area: 'Östermalm', type: 'bar', lat: 59.3361, lng: 18.0733, closing: '02:00', pace: 'fast' },
      { id: 'pelikan', name: 'Pelikan', address: 'Blekingegatan 40', area: 'Södermalm', type: 'bar', lat: 59.3121, lng: 18.0760, closing: '01:00', pace: 'fast' },
      { id: 'morfar-ginko', name: 'Morfar Ginko', address: 'Swedenborgsgatan 13', area: 'Södermalm', type: 'bar', lat: 59.3150, lng: 18.0645, closing: '01:00', pace: 'fast' },
      { id: 'spy-bar', name: 'Spy Bar', address: 'Birger Jarlsgatan 20', area: 'Östermalm', type: 'bar', lat: 59.3360, lng: 18.0730, closing: '05:00', pace: 'slow' },
      { id: 'fasching', name: 'Fasching', address: 'Kungsgatan 63', area: 'Norrmalm', type: 'bar', lat: 59.3350, lng: 18.0620, closing: '03:00', pace: 'fast' },
      { id: 'berns', name: 'Berns', address: 'Berzelii Park', area: 'Norrmalm', type: 'bar', lat: 59.3322, lng: 18.0739, closing: '03:00', pace: 'slow' },
      { id: 'lounge-bar', name: 'The Lounge Bar', address: 'Sveavägen 45', area: 'Norrmalm', type: 'bar', lat: 59.3360, lng: 18.0620, closing: '01:00', pace: 'fast' },
      { id: 'niva22', name: 'Nivå 22', address: 'Fridhemsgatan 17', area: 'Kungsholmen', type: 'bar', lat: 59.3420, lng: 18.0490, closing: '01:00', pace: 'fast' },
      { id: 'cafe-opera', name: 'Café Opera', address: 'Karl XII:s torg 6', area: 'Kungsträdgården', type: 'klubb', lat: 59.3307, lng: 18.0715, closing: '05:00', pace: 'slow' },
      { id: 'tradgarden', name: 'Trädgården', address: 'Hammarby Slussväg 2', area: 'Södermalm', type: 'klubb', lat: 59.3088, lng: 18.0812, closing: '05:00', pace: 'fast' },
      { id: 'under-bron', name: 'Under Bron', address: 'Skansbron 4', area: 'Södermalm', type: 'klubb', lat: 59.3082, lng: 18.0798, closing: '05:00', pace: 'fast' },
      { id: 'sturecompagniet', name: 'Sturecompagniet', address: 'Sturegatan 4', area: 'Östermalm', type: 'klubb', lat: 59.3365, lng: 18.0735, closing: '05:00', pace: 'slow' },
      { id: 'kristall', name: 'Kristall', address: 'Regeringsgatan 12', area: 'Norrmalm', type: 'klubb', lat: 59.3340, lng: 18.0620, closing: '03:00', pace: 'normal' },
      { id: 'golden-hits', name: 'Golden Hits', address: 'Kungsgatan 26', area: 'Norrmalm', type: 'klubb', lat: 59.3340, lng: 18.0630, closing: '03:00', pace: 'normal' },
      { id: 'neu', name: 'Neu', address: 'Östgötagatan 8', area: 'Södermalm', type: 'klubb', lat: 59.3115, lng: 18.0780, closing: '05:00', pace: 'normal' },
      { id: 'end-nightclub', name: 'END Nightclub', address: 'Jakobsgatan 10', area: 'Norrmalm', type: 'klubb', lat: 59.3320, lng: 18.0640, closing: '05:00', pace: 'normal' },
      { id: 'nalen', name: 'Nalen', address: 'Regeringsgatan 74', area: 'Norrmalm', type: 'klubb', lat: 59.3360, lng: 18.0640, closing: '03:00', pace: 'normal' },
      { id: 'mosebacke', name: 'Mosebacke Etablissement', address: 'Mosebacke Torg 3', area: 'Södermalm', type: 'klubb', lat: 59.3184, lng: 18.0743, closing: '03:00', pace: 'normal' },
      { id: 'patricia', name: 'Patricia', address: 'Stadsgårdskajen 152', area: 'Södermalm', type: 'klubb', lat: 59.3190, lng: 18.0650, closing: '05:00', pace: 'normal' },
      { id: 'solidaritet', name: 'Solidaritet', address: 'Långholmsgatan 3', area: 'Hornstull', type: 'klubb', lat: 59.3162, lng: 18.0370, closing: '05:00', pace: 'normal' },
      { id: 'gro', name: 'Gro', address: 'Folkungagatan 84', area: 'Södermalm', type: 'bar', lat: 59.3135, lng: 18.0760, closing: '01:00', pace: 'fast' },
      { id: 'pharmarium', name: 'Pharmarium', address: 'Stortorget 7', area: 'Gamla Stan', type: 'bar', lat: 59.3252, lng: 18.0716, closing: '01:00', pace: 'fast' },
      { id: 'tak', name: 'TAK Stockholm', address: 'Brunkebergstorg 2', area: 'Norrmalm', type: 'bar', lat: 59.3342, lng: 18.0656, closing: '02:00', pace: 'fast' },
      { id: 'drama', name: 'Drama', address: 'Stureplan 4', area: 'Östermalm', type: 'klubb', lat: 59.3363, lng: 18.0731, closing: '05:00', pace: 'slow' },
      { id: 'hells-kitchen', name: "Hell's Kitchen", address: 'Sturegatan 4', area: 'Östermalm', type: 'klubb', lat: 59.336484, lng: 18.073468, closing: '05:00', pace: 'normal' }
    ];

    function computeConfidence(venueReports) {
      if (!venueReports.length) return 0;

      var freshCutoff = Date.now() - 25 * 60 * 1000; // 25 min window
      var freshReports = venueReports.filter(function(r) {
        return new Date(r.created_at).getTime() > freshCutoff;
      });

      if (!freshReports.length) return 0;

      // Agreement: what fraction of fresh reports match the most common status?
      var counts = {};
      freshReports.forEach(function(r) {
        counts[r.queue_status] = (counts[r.queue_status] || 0) + 1;
      });
      var maxAgree = Math.max.apply(null, Object.keys(counts).map(function(k) { return counts[k]; }));
      var agreementRatio = maxAgree / freshReports.length;

      // Volume: 1 report = low, 2-3 = medium, 4+ = high
      var volumeScore = Math.min(freshReports.length / 4, 1);

      // Freshness of newest report (0-20 min = full, older = less)
      var newestAge = (Date.now() - new Date(venueReports[0].created_at).getTime()) / 60000;
      var freshnessScore = Math.max(0, 1 - newestAge / 20);

      // Weighted score 0-1
      var score = agreementRatio * 0.5 + volumeScore * 0.3 + freshnessScore * 0.2;

      // Map to 1-3 bars
      if (score >= 0.65) return 3;
      if (score >= 0.35) return 2;
      return 1;
    }

    // ── Väntetid = kölängd ÷ köns hastighet ──────────────────────────────────
    // Personer per minut som släpps in, startgissning per venue.pace tills kvällens mätningar finns.
    var PACE_RATE = { slow: 1.0, normal: 2.0, fast: 3.0 };
    // people_ahead lagras som knappens mittvärde; width används när någon står kvar i samma intervall.
    var AHEAD_BUCKETS = [
      { mid: 0,  width: 0,  label: 'Ingen kö' },
      { mid: 5,  width: 9,  label: '1–10' },
      { mid: 17, width: 15, label: '10–25' },
      { mid: 37, width: 25, label: '25–50' },
      { mid: 60, width: 30, label: '50+' }
    ];

    function aheadBucket(n) {
      for (var i = AHEAD_BUCKETS.length - 1; i >= 0; i--) {
        if (n >= AHEAD_BUCKETS[i].mid) return AHEAD_BUCKETS[i];
      }
      return AHEAD_BUCKETS[0];
    }

    function isQueueReport(r) {
      return !r.report_type || r.report_type === 'initial';
    }

    function median(values) {
      var s = values.slice().sort(function(a, b) { return a - b; });
      var mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }

    // En hastighet per kö-session (första → sista mätpunkt). Samma regler för ikväll, historik och kalibrering.
    function sessionRates(reports) {
      var sessions = {};
      reports.forEach(function(r) {
        if (!r.queue_session || r.people_ahead == null) return;
        (sessions[r.queue_session] = sessions[r.queue_session] || []).push(r);
      });
      var out = [];
      Object.keys(sessions).forEach(function(id) {
        var s = sessions[id].sort(function(a, b) { return new Date(a.created_at) - new Date(b.created_at); });
        if (s.length < 2) return;
        var first = s[0], last = s[s.length - 1];
        var mins = (new Date(last.created_at) - new Date(first.created_at)) / 60000;
        var moved = first.people_ahead - last.people_ahead;
        if (mins < 4 || mins > 90 || moved < 0) return;
        var rate = null;
        if (moved > 0) rate = moved / mins;
        // Samma intervall båda gångerna: rörelsen är okänd men under intervallets bredd.
        // Kräver att intervallet HAR en bredd. "Ingen kö" har width 0, och en session som
        // rapporterat 0 framför i båda ändar säger ingenting om hur snabbt dörren släpper
        // in folk — utan den här vakten blev takten 0 och drog ner alla andras väntetid.
        else if (mins >= 10 && aheadBucket(first.people_ahead).width > 0) {
          rate = (aheadBucket(first.people_ahead).width / 2) / mins;
        }
        if (rate !== null) out.push({ venueId: first.venue_id, rate: rate, startedAt: new Date(first.created_at).getTime() });
      });
      return out;
    }

    function measureQueueRates(venueId, reports, now) {
      var cutoff = now - 45 * 60 * 1000;
      return sessionRates(reports.filter(function(r) {
        var t = new Date(r.created_at).getTime();
        return r.venue_id === venueId && t >= cutoff && t <= now;
      })).map(function(x) { return x.rate; });
    }

    // Kvällen räknas från 06:00, så fredag 00:30 hör till fredagskvällen.
    function nightKey(t) {
      return { dow: new Date(t - 6 * 3600 * 1000).getDay(), hour: new Date(t).getHours() };
    }

    // Dörrtakt från tidigare kvällar: samma ställe, samma veckodag, ±1 timme. Kvällen kring `at` räknas inte
    // (den täcks av ikvällens mätningar). Kräver ≥3 sessioner.
    var _historicalRates = {};
    var _historicalRatesTest = {};

    function historicalRateFor(venueId, rates, at) {
      var key = nightKey(at);
      var matching = rates.filter(function(x) {
        if (x.venueId !== venueId || Math.abs(x.startedAt - at) < 12 * 3600 * 1000) return false;
        var k = nightKey(x.startedAt);
        var dh = Math.abs(k.hour - key.hour);
        return k.dow === key.dow && Math.min(dh, 24 - dh) <= 1;
      }).map(function(x) { return x.rate; });
      return matching.length >= 3 ? { rate: median(matching), n: matching.length } : null;
    }

    // now/hist kan anges för att räkna om en tidigare tidpunkt (kalibrering); annars just nu.
    function estimateWait(venueId, reports, now, hist) {
      now = now || Date.now();
      if (hist === undefined) hist = _historicalRates[venueId] || null;
      var counted = reports.filter(function(r) {
        var age = now - new Date(r.created_at).getTime();
        return r.venue_id === venueId && isQueueReport(r) && r.people_ahead != null && age >= 0 && age < 45 * 60 * 1000;
      }).sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      if (!counted.length) return null;
      var fresh = counted.filter(function(r) { return now - new Date(r.created_at).getTime() < 20 * 60 * 1000; });
      var ahead = median((fresh.length ? fresh : [counted[0]]).map(function(r) { return r.people_ahead; }));

      // Lager: ikvällens mätningar → tidigare kvällar → startgissning per venue.pace.
      var venue = getVenueById(venueId);
      var prior = hist ? hist.rate : PACE_RATE[(venue && venue.pace) || 'normal'];
      var measured = measureQueueRates(venueId, reports, now);
      var n = measured.length;
      var measuredRate = n ? median(measured) : null;
      var rate = n ? (n * measuredRate + 2 * prior) / (n + 2) : prior;

      var est = { ahead: ahead, rate: rate, source: n ? 'live' : hist ? 'history' : 'estimate', full: false, mins: 0, low: 0, high: 0 };
      if (ahead === 0) return est;
      est.full = n >= 2 && measuredRate < 0.3 && ahead >= 10;
      est.mins = ahead / rate;
      return setWaitRange(est, n >= 3 ? 0.2 : 0.35);
    }

    function setWaitRange(est, spread) {
      est.low = Math.round(est.mins * (1 - spread) / 5) * 5;
      est.high = Math.max(5, Math.round(est.mins * (1 + spread) / 5) * 5);
      return est;
    }

    // Kö när du är framme: nuvarande kö + trenden i kvällens rapporter + andra som är på väg.
    // Bara med ≥3 rapporter de senaste 30 min över ≥10 min — annars är trenden brus.
    function forecastWait(venueId, minsAhead, othersOnWay) {
      var est = estimateWait(venueId, allReports);
      if (!est || est.full || minsAhead < 5) return null;
      var now = Date.now();
      var recent = allReports.filter(function(r) {
        return r.venue_id === venueId && isQueueReport(r) && r.people_ahead != null &&
          now - new Date(r.created_at).getTime() <= 30 * 60 * 1000;
      }).sort(function(a, b) { return new Date(a.created_at) - new Date(b.created_at); });
      if (recent.length < 3) return null;
      var first = recent[0], last = recent[recent.length - 1];
      var spanMins = (new Date(last.created_at) - new Date(first.created_at)) / 60000;
      if (spanMins < 10) return null;
      var growth = (last.people_ahead - first.people_ahead) / spanMins;
      var ahead = Math.max(0, est.ahead + growth * minsAhead) + othersOnWay / 2;
      var fc = { ahead: Math.round(ahead), rate: est.rate, source: est.source, full: false, mins: ahead / est.rate, low: 0, high: 0 };
      return fc.ahead === 0 ? fc : setWaitRange(fc, 0.35);
    }

    // "På väg"-räknare: servern returnerar bara ställen med ≥3 aktiva (on_my_way_counts).
    var _omwCounts = {};
    var _omwTestCounts = {};

    async function loadOnMyWayCounts() {
      if (!supabase) return;
      var res = await supabase.rpc('on_my_way_counts');
      if (res.error) { console.warn('[QueueBar] on_my_way_counts:', res.error.message); return; }
      _omwCounts = {};
      (res.data || []).forEach(function(r) { _omwCounts[r.venue_id] = Number(r.n); });
    }

    function onMyWayCount(venueId) {
      var n = (_omwCounts[venueId] || 0) + (_omwTestCounts[venueId] || 0);
      return n >= 3 ? n : 0;
    }

    function formatWait(est) {
      if (!est) return '';
      if (est.full) return 'Fullt';
      if (est.ahead === 0) return 'Ingen kö';
      if (est.high <= 5) return '<5 min';
      if (est.high > 60) return est.low + '+ min';
      if (est.low < 5) return '<' + est.high + ' min';
      if (est.low === est.high) return '~' + est.low + ' min';
      return est.low + '–' + est.high + ' min';
    }

    function waitToStatus(est) {
      if (est.full) return 'long';
      if (est.ahead === 0 || est.mins < 3) return 'none';
      if (est.mins < 18) return 'short';
      if (est.mins < 30) return 'medium';
      return 'long';
    }

    // Väntetidstext för en venue — samma källa för karta, Utforska, venue-kort, Live och kvällsplan.
    function venueWaitText(venueId) {
      var est = estimateWait(venueId, allReports);
      if (est) return formatWait(est);
      return getStatusLabel(computeStatus(venueId, allReports));
    }

    // Siffran är hjälten, enheten är underordnad ("20–30" stort, "min" litet). Ren text ("Fri", "Fullt") lämnas orörd.
    // Texten kommer från formatWait/getStatusLabel, aldrig från användare, så ingen escaping behövs.
    function waitHtml(text) {
      var m = /^(.*?)\s*(min)$/.exec(text || '');
      if (!m || !m[1]) return text || '';
      return m[1] + '<span class="wait-unit"> min</span>';
    }

    // Väntetiden rullar när den ändras — som ett saldo som uppdateras. Minnet är per yta och ställe, utanför DOM,
    // eftersom listorna ritas om med innerHTML. Första gången ett värde visas rullar det inte (inget att jämföra med),
    // och oförändrat värde rullar aldrig. Riktningen (upp/ned) visar åt vilket håll kön gick.
    // Rullen spelas bara när ytan syns: en ändring som sker bakom en annan skärm visas statiskt när man kommer dit,
    // annars skulle rörelsen vara slut innan någon ser den (samma fälla som listans intro).
    var _waitMemory = {};
    var WAIT_SURFACE_SCREEN = { list: 'explore', best: 'home' };

    // Ungefärligt tal ur texten, bara för att avgöra riktning: "20–30 min" → 25, "55+ min" → 55, "<5 min" → 3.
    function waitNumber(text) {
      if (!text) return null;
      if (text === 'Fullt') return 999;
      if (text === 'Ingen kö' || text === 'Fri') return 0;
      var nums = (text.match(/\d+/g) || []).map(Number);
      if (!nums.length) return null;
      if (text.charAt(0) === '<') return nums[0] * 0.6;
      return nums.length > 1 ? (nums[0] + nums[1]) / 2 : nums[0];
    }

    // surface: 'list' | 'best'. Returnerar markup; vid synlig ändring läggs föregående värde bredvid så CSS kan rulla
    // och färgen glida från förra statusfärgen till den nya.
    function waitRollHtml(surface, venueId, text, color) {
      var key = surface + ':' + venueId;
      var prev = _waitMemory[key];
      _waitMemory[key] = { text: text, color: color };
      var html = waitHtml(text);
      if (!prev || prev.text === text || !text || !prev.text) return html;
      if (currentScreen !== WAIT_SURFACE_SCREEN[surface]) return html;
      var a = waitNumber(prev.text), b = waitNumber(text);
      var dir = (a === null || b === null || a === b) ? 'up' : (b > a ? 'up' : 'down');
      return '<span class="wait-roll wait-roll--' + dir + '" style="--roll-from:' + (prev.color || 'currentColor') + '">' +
        '<span class="wait-roll-old" aria-hidden="true">' + waitHtml(prev.text) + '</span>' +
        '<span class="wait-roll-new">' + html + '</span></span>';
    }

    function computeStatus(venueId, reports) {
      var est = estimateWait(venueId, reports);
      if (est) return waitToStatus(est);
      var venueReports = reports.filter(function(r) { return r.venue_id === venueId && isQueueReport(r); });
      if (!venueReports.length) return 'unknown';
      var freshCutoff = Date.now() - 45 * 60 * 1000;
      var fresh = venueReports.filter(function(r) { return new Date(r.created_at).getTime() > freshCutoff; });
      // Fall back to most recent single report when no fresh data exists
      var pool = fresh.length ? fresh : [venueReports.sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); })[0]];
      var counts = { none: 0, short: 0, medium: 0, long: 0 };
      pool.forEach(function(r) { if (counts[r.queue_status] !== undefined) counts[r.queue_status]++; });
      return Object.entries(counts).sort(function(a, b) { return b[1] - a[1]; })[0][0];
    }

    function getStatusLabel(status) {
      return { none: 'Ingen kö', short: '~15 min', medium: '~25 min', long: '30+ min', unknown: '' }[status] || '';
    }

    function getStatusColor(status) {
      return { none: '#34E07F', free: '#34E07F', short: '#FFD23F', medium: '#FF8A3D', long: '#FF4D5E', unknown: '#85858A' }[status] || '#85858A';
    }

    function getStatusClass(status) {
      return { none: 'free', short: 'short', medium: 'medium', long: 'long', unknown: 'unknown' }[status] || 'unknown';
    }

    function getVenueById(id) {
      return VENUES.find(function(v) { return v.id === id; });
    }

    // All text som kommer från databasen (andras rapporter) måste gå genom den här innan den hamnar i HTML.
    function escapeHtml(str) {
      return String(str).replace(/[&<>"']/g, function(c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function timeAgo(dateString) {
      var mins = Math.floor((new Date() - new Date(dateString)) / 60000);
      if (mins < 1) return 'nyss';
      if (mins < 60) return mins + ' min sedan';
      return Math.floor(mins / 60) + ' tim sedan';
    }

    function showToast(msg) {
      var t = document.createElement('div');
      t.className = 'toast';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function() { t.remove(); }, 3000);
    }

    // ── Dela (Share) ─────────────────────────────────────────────────────────────
    function shareVenue(venueId) {
      var venue = getVenueById(venueId);
      if (!venue) return;
      var waitText = venueWaitText(venueId);
      var statusText = waitText
        ? venue.name + ' — ' + (waitText === 'Ingen kö' || waitText === 'Fullt' ? waitText.toLowerCase() : waitText + ' kö') + ' just nu'
        : venue.name + ' — ingen data just nu';

      if (navigator.share) {
        navigator.share({
          title: 'Qbar',
          text: statusText,
          url: window.location.origin
        }).catch(function() {});
      } else {
        var full = statusText + ' — ' + window.location.origin;
        navigator.clipboard.writeText(full).then(function() {
          showToast('Kopierat till urklipp');
        }).catch(function() {
          showToast(statusText);
        });
      }
    }

    // ── Bevaka (Watch) ────────────────────────────────────────────────────────────
    var STATUS_RANK_NUM = { none: 0, free: 0, short: 1, medium: 2, long: 3 };

    function getWatched() {
      try { return JSON.parse(localStorage.getItem('qb_watched') || '{}'); } catch(e) { return {}; }
    }

    function saveWatched(obj) {
      try { localStorage.setItem('qb_watched', JSON.stringify(obj)); } catch(e) {}
    }

    function isWatching(venueId) {
      return !!getWatched()[venueId];
    }

    function toggleWatch(venueId) {
      var watched = getWatched();
      if (watched[venueId] !== undefined) {
        delete watched[venueId];
        saveWatched(watched);
        renderExploreVenues();
        showToast('Bevakning avstängd');
        return;
      }
      // Request notification permission first
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(function(perm) {
          if (perm === 'granted') {
            var status = computeStatus(venueId, allReports);
            watched[venueId] = status;
            saveWatched(watched);
            renderExploreVenues();
            showToast('Bevakar kön — du får en notis om kön minskar');
          }
        });
      } else {
        var status = computeStatus(venueId, allReports);
        watched[venueId] = status;
        saveWatched(watched);
        renderExploreVenues();
        if (Notification.permission === 'granted') {
          showToast('Bevakar kön — du får en notis om kön minskar');
        } else {
          showToast('Bevakar kön (aktivera notiser för pushnotiser)');
        }
      }
    }

    function checkWatchedVenueAlerts() {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      var watched = getWatched();
      var changed = false;
      Object.keys(watched).forEach(function(venueId) {
        var prevStatus = watched[venueId];
        var currStatus = computeStatus(venueId, allReports);
        var prevRank = STATUS_RANK_NUM[prevStatus] !== undefined ? STATUS_RANK_NUM[prevStatus] : 1;
        var currRank = STATUS_RANK_NUM[currStatus] !== undefined ? STATUS_RANK_NUM[currStatus] : 1;
        // Status improved (rank went down)
        if (currRank < prevRank) {
          var venue = getVenueById(venueId);
          var name = venue ? venue.name : venueId;
          var msg = currRank === 0 ? 'Fri ingång nu!' : (currStatus === 'short' ? 'Ca 15 min kö nu' : 'Ca 25 min kö nu');
          try {
            new Notification('Qbar — ' + name, {
              body: msg,
              icon: '/favicon.ico',
              tag: 'qb-' + venueId
            });
          } catch(e) {}
          watched[venueId] = currStatus;
          changed = true;
        } else if (currStatus && currStatus !== prevStatus) {
          // Update stored status even if not improved (so we track from latest)
          watched[venueId] = currStatus;
          changed = true;
        }
      });
      if (changed) saveWatched(watched);
    }

    var favorites = JSON.parse(localStorage.getItem('qb_favorites') || '[]');
    function isFavorite(venueId) { return favorites.indexOf(venueId) > -1; }

    var activeVenue = null;
    var allReports = [];
    var _planningMode = false;
    var _planVenues = [];

    var BAR_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-secondary)"><path d="M4 5h16l-8 9z"/><line x1="12" y1="14" x2="12" y2="20"/><line x1="8" y1="20" x2="16" y2="20"/></svg>';
    var CLUB_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-secondary)"><circle cx="12" cy="12" r="9"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><ellipse cx="12" cy="12" rx="4" ry="9"/></svg>';

    // Minuter kvar till stängning, eller null om tiden saknas. En enda beräkning som både listan och kortet använder,
    // så att "Stänger snart" aldrig kan visa olika saker. Stängning före 06:00 räknas som nästa dygn (02:00 = 26:00).
    function minutesToClose(venue) {
      if (!venue || !venue.closing) return null;
      var p = venue.closing.split(':');
      var h = parseInt(p[0], 10), m = parseInt(p[1] || 0, 10);
      if (isNaN(h)) return null;
      var total = h < 6 ? (h + 24) * 60 + m : h * 60 + m;
      var d = new Date(), nowMin = d.getHours() * 60 + d.getMinutes();
      if (nowMin < 12 * 60) nowMin += 1440;
      return total - nowMin;
    }

    // Riktning på kön: jämför de två senaste köstatusarna. null när det inte finns två rapporter eller de är lika,
    // och då visas ingenting — en trend vi inte har får inte uppfinnas.
    var TREND_RANK = { free: 0, none: 0, short: 1, medium: 2, long: 3 };
    function queueTrend(reports) {
      if (!reports || reports.length < 2) return null;
      var a = TREND_RANK[reports[0].queue_status], b = TREND_RANK[reports[1].queue_status];
      a = a !== undefined ? a : 1; b = b !== undefined ? b : 1;
      if (a > b) return 'up';
      if (a < b) return 'down';
      return null;
    }

    // A — vad som hänt. En rad som jämför den senaste rapporten med den innan, i det som faktiskt rapporterades (antal
    // framför), med klockslag: "12:02 → 12:09 · 10–25 → 25–50". Raden finns bara när båda rapporterna har antal och antalet
    // ändrats. Annars ingenting — en förändring vi inte kan belägga får inte uppfinnas. Riktningen (▲/▼) följer antalet.
    function queueChange(reports) {
      if (!reports || reports.length < 2) return null;
      var a = reports[0], b = reports[1];
      if (a.people_ahead == null || b.people_ahead == null) return null;
      var from = aheadBucket(b.people_ahead), to = aheadBucket(a.people_ahead);
      if (from.label === to.label) return null;
      return { dir: a.people_ahead > b.people_ahead ? 'up' : 'down', from: from.label, to: to.label, t0: b.created_at, t1: a.created_at };
    }

    function clockOfIso(iso) {
      var d = new Date(iso);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    function queueChangeHtml(reports) {
      var ch = queueChange(reports);
      if (!ch) return '';
      var cls = ch.dir === 'up' ? 'vc-chg--up' : 'vc-chg--down';
      return '<div class="vc-chg ' + cls + '"><span class="vc-chg-dir">' + (ch.dir === 'up' ? '▲' : '▼') + '</span>' +
        '<span class="vc-chg-time">' + clockOfIso(ch.t0) + ' → ' + clockOfIso(ch.t1) + '</span>' +
        '<span class="vc-chg-val">' + ch.from + ' → ' + ch.to + '</span></div>';
    }

    // B — rapporterna själva, nyast överst, som ett kvitto: klockslag, vad som rapporterades, hur länge sedan.
    // Fälls ut på begäran (samma mönster som "tidigare rapporter" i Live). Visar de senaste 45 minuterna, inget uppfunnet:
    // en rapport utan antal står som "Kö, ej mätt" i sin statusfärg. Färgen är statusen, som överallt annars.
    var _vcListOpen = false;
    function queueListHtml(reports) {
      var WINDOW = 45 * 60 * 1000, now = Date.now();
      var rows = reports.filter(function(r) { return now - new Date(r.created_at).getTime() <= WINDOW; });
      if (rows.length < 2) return '';
      var label = { none: 'Ingen kö', free: 'Ingen kö', short: 'Kort kö', medium: 'Medel kö', long: 'Lång kö' };
      var body = rows.map(function(r) {
        var ago = Math.max(0, Math.floor((now - new Date(r.created_at)) / 60000));
        var what = r.people_ahead != null ? (r.people_ahead ? aheadBucket(r.people_ahead).label + ' i kö' : 'Ingen kö') : (label[r.queue_status] || 'Kö') + ' · ej mätt';
        return '<li class="vc-rep"><span class="vc-rep-dot" style="background:' + getStatusColor(r.queue_status) + '"></span>' +
          '<span class="vc-rep-time">' + clockOfIso(r.created_at) + '</span>' +
          '<span class="vc-rep-what">' + what + '</span>' +
          '<span class="vc-rep-ago">' + (ago < 1 ? 'NU' : ago + 'M') + '</span></li>';
      }).join('');
      return '<button class="vc-reps-toggle" aria-expanded="' + _vcListOpen + '" onclick="toggleVcReports()">' +
        '<span>' + rows.length + ' rapporter senaste 45 min</span>' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
        '<ul class="vc-reps"' + (_vcListOpen ? '' : ' hidden') + '>' + body + '</ul>';
    }

    function toggleVcReports() {
      _vcListOpen = !_vcListOpen;
      var wrap = document.getElementById('vc-timeline');
      var list = wrap && wrap.querySelector('.vc-reps');
      var btn = wrap && wrap.querySelector('.vc-reps-toggle');
      if (!list || !btn) return;
      list.hidden = !_vcListOpen;
      btn.setAttribute('aria-expanded', String(_vcListOpen));
    }

    function openVenueCard(venue, source) {
      console.log('[QueueBar] openVenueCard:', venue.id, '| källa:', source || 'lista');
      if (map && venue.lat && venue.lng) {
        map.flyTo({ center: [venue.lng, venue.lat], zoom: 14, duration: 800 });
      }
      activeVenue = venue;
      var status = computeStatus(venue.id, allReports);
      var reports = allReports.filter(function(r) { return r.venue_id === venue.id && isQueueReport(r); })
        .sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      document.getElementById('vc-name').textContent = venue.name;
      var est = estimateWait(venue.id, allReports);
      var waitText = venueWaitText(venue.id);
      var minsOld = reports.length ? (Date.now() - new Date(reports[0].created_at)) / 60000 : Infinity;
      var card = document.getElementById('venue-card');
      card.classList.toggle('vc--aging', minsOld >= 15 && minsOld < 45);
      card.classList.toggle('vc--nodata', !waitText);
      card.style.setProperty('--st', waitText ? getStatusColor(status) : '#55555B');
      var vcStatus = document.getElementById('vc-status');
      vcStatus.innerHTML = waitText ? waitHtml(waitText) : '–';
      vcStatus.style.color = waitText ? getStatusColor(status) : '';
      // Rad under siffran: vad siffran bygger på (antal i kö, uppmätt eller uppskattad, ålder)
      var subParts = [];
      if (est) subParts.push(aheadBucket(est.ahead).label + (est.ahead ? ' i kö' : ''));
      if (est && !est.full && est.ahead && est.source !== 'live') subParts.push('≈ uppskattning');
      if (minsOld >= 15 && minsOld < 45) subParts.push('kan vara gammal');
      document.getElementById('vc-sub').textContent = waitText ? subParts.join(' · ') : 'Ingen färsk rapport';

      // Stämplade uppgifter: korta etiketter, exakt tid och räknebara värden. Raden finns bara om vi har något ärligt att säga.
      // Klockslaget (22:43) står tillsammans med åldern, eftersom "8 min sedan" blir fel om man tittar en minut senare.
      var facts = [];
      var trend = queueTrend(reports);
      if (trend) facts.push({ k: 'Trend', v: trend === 'up' ? '▲ ÖKAR' : '▼ MINSKAR', cls: trend === 'up' ? 'vc-fact--up' : 'vc-fact--down' });
      if (reports.length) {
        var ageMin = Math.max(0, Math.floor((Date.now() - new Date(reports[0].created_at)) / 60000));
        facts.push({ k: 'Rapport', v: clockOfIso(reports[0].created_at) + ' · ' + (ageMin < 1 ? 'NU' : ageMin < 60 ? ageMin + 'M' : Math.floor(ageMin / 60) + 'H'), cls: minsOld >= 45 ? 'vc-fact--stale' : '' });
      }
      if (reports.length > 1) facts.push({ k: 'Antal', v: reports.length + ' ST' });
      var omwN = onMyWayCount(venue.id);
      if (omwN) facts.push({ k: 'På väg', v: '~' + omwN });
      var toClose = minutesToClose(venue);
      if (toClose !== null) {
        var soon = toClose > 0 && toClose <= 90;
        facts.push({ k: 'Stänger', v: venue.closing + (soon ? ' · ' + toClose + 'M' : ''), cls: soon ? 'vc-fact--soon' : '' });
      }
      document.getElementById('vc-facts').innerHTML = facts.map(function(f) {
        return '<div class="vc-fact ' + (f.cls || '') + '"><dt>' + f.k + '</dt><dd>' + f.v + '</dd></div>';
      }).join('') || '<div class="vc-fact"><dt>Rapporter</dt><dd>INGA</dd></div>';
      _vcListOpen = false; // varje kort börjar hopfällt
      document.getElementById('vc-timeline').innerHTML = queueChangeHtml(reports) + queueListHtml(reports);
      document.getElementById('vc-area').textContent = venue.area + ' · ' + venueTypeLabel(venue.type);
      var favBtn = document.getElementById('vc-fav');
      if (favBtn) favBtn.classList.toggle('fav', isFavorite(venue.id));
      document.getElementById('vc-overlay').style.display = 'block';
      card.style.removeProperty('--vc-drag');
      document.getElementById('vc-overlay').style.removeProperty('--vc-overlay');
      card.classList.remove('vc-dragging', 'vc-settling');
      card.style.display = 'block';
      card.style.animation = 'slideUp 0.25s cubic-bezier(0.16,1,0.3,1)';
    }

    // Kortets knappar — activeVenue är modul-lokal, så inline-onclick går via dessa
    function vcOnMyWay() { if (activeVenue) goOnMyWay(activeVenue.id); }
    function vcShare() { if (activeVenue) shareVenue(activeVenue.id); }
    function vcToggleFavorite(event) {
      if (!activeVenue) return;
      var btn = event.currentTarget;
      toggleFavorite(event, activeVenue.id).then(function() {
        if (activeVenue) btn.classList.toggle('fav', isFavorite(activeVenue.id));
      });
    }

    function closeVenueCard() {
      var card = document.getElementById('venue-card');
      // Stänger från där fingret släppte (--vc-drag), så kortet inte hoppar upp innan det glider ut
      card.classList.remove('vc-dragging', 'vc-settling');
      card.style.animation = 'slideDown 0.2s cubic-bezier(0.36,0,0.66,0) forwards';
      document.getElementById('vc-overlay').style.display = 'none';
      setTimeout(function() {
        card.style.display = 'none';
        card.style.animation = '';
        card.style.removeProperty('--vc-drag');
        document.getElementById('vc-overlay').style.removeProperty('--vc-overlay');
        activeVenue = null;
      }, 200);
    }

    // Dra kortet nedåt för att stänga. Följer fingret 1:1, stänger vid >120 px eller en snabb sänkning (>0.5 px/ms),
    // annars fjädrar det tillbaka. Uppåt går det inte att dra (gummiband: 15 % av rörelsen), så kortet aldrig lämnar kanten.
    (function setupVenueCardDrag() {
      var card = document.getElementById('venue-card');
      var grab = document.getElementById('vc-grab');
      var overlay = document.getElementById('vc-overlay');
      if (!card || !grab) return;
      var startY = 0, lastY = 0, lastT = 0, velocity = 0, dragging = false, pointerId = null;

      function offset(dy) { return dy > 0 ? dy : dy * 0.15; }
      function apply(dy) {
        var o = offset(dy);
        card.style.setProperty('--vc-drag', o + 'px');
        // Bakgrunden ljusnar i takt med att kortet sjunker, så det syns att det håller på att försvinna
        var fade = Math.max(0, 1 - Math.max(0, o) / 320);
        overlay.style.setProperty('--vc-overlay', String(fade));
      }

      grab.addEventListener('pointerdown', function(e) {
        if (e.button !== undefined && e.button !== 0) return;
        dragging = true; pointerId = e.pointerId;
        startY = lastY = e.clientY; lastT = performance.now(); velocity = 0;
        card.classList.remove('vc-settling');
        card.classList.add('vc-dragging');
        card.style.animation = 'none';
        if (grab.setPointerCapture) { try { grab.setPointerCapture(pointerId); } catch (err) {} }
      });

      grab.addEventListener('pointermove', function(e) {
        if (!dragging || e.pointerId !== pointerId) return;
        var now = performance.now();
        var dt = now - lastT;
        if (dt > 0) velocity = (e.clientY - lastY) / dt;
        lastY = e.clientY; lastT = now;
        apply(e.clientY - startY);
      });

      function release(e) {
        if (!dragging || (e && e.pointerId !== pointerId)) return;
        dragging = false;
        card.classList.remove('vc-dragging');
        var dy = lastY - startY;
        if (dy > 120 || velocity > 0.5) {
          closeVenueCard();
        } else {
          // Fjädra tillbaka: övergången tar kortet till 0 px och bakgrunden till full styrka
          card.classList.add('vc-settling');
          card.style.animation = '';
          card.style.setProperty('--vc-drag', '0px');
          overlay.style.setProperty('--vc-overlay', '1');
          setTimeout(function() { card.classList.remove('vc-settling'); }, 340);
        }
        if (grab.releasePointerCapture) { try { grab.releasePointerCapture(pointerId); } catch (err) {} }
      }
      grab.addEventListener('pointerup', release);
      grab.addEventListener('pointercancel', release);
    })();

    function goToReport() {
      closeVenueCard();
      showScreen('report');
      if (activeVenue) {
        selectedRV = activeVenue;
        document.getElementById('rs-vname').textContent = activeVenue.name;
        rsStep(2);
      }
    }

    function openDirections() {
      if (!activeVenue) return;
      window.open('https://www.google.com/maps/dir/?api=1&destination=' + activeVenue.lat + ',' + activeVenue.lng, '_blank');
    }

    function renderVenueCard(venue) {
      var status = computeStatus(venue.id, allReports);
      var label = venueWaitText(venue.id);
      var cls = getStatusClass(status);
      var reports = allReports.filter(function(r) { return r.venue_id === venue.id && isQueueReport(r); });
      var badgeHtml = label
        ? '<span class="vcard-status-badge ' + cls + '">' +
            '<span class="vcard-status-dot"></span>' + label +
          '</span>'
        : '<div class="vcard-none">' + (allReports.length === 0 ? 'Inga rapporter ännu – bli först' : 'Ingen rapport') + '</div>';
      return '<div class="vcard" onclick="openVenueCard(getVenueById(\'' + venue.id + '\'))">' +
        '<div class="vcard-top">' +
          '<span class="vcard-name">' + venue.name + '</span>' +
          '<span class="vcard-badge">' + (venue.type === 'bar' ? BAR_SVG : CLUB_SVG) + '</span>' +
        '</div>' +
        '<button class="heart-btn' + (isFavorite(venue.id) ? ' fav' : '') + '" onclick="toggleFavorite(event, \'' + venue.id + '\')" aria-label="Favorit">' +
          '<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' +
        '</button>' +
        badgeHtml +
        (reports.length > 0 ? '<div class="vcard-count">' + reports.length + ' rapport' + (reports.length > 1 ? 'er' : '') + '</div>' : '') +
        '<div class="vcard-sep"></div>' +
        '<div class="vcard-row"><span>Stänger ' + venue.closing + '</span><span>' + venue.area + '</span></div>' +
        '</div>';
    }

    function renderCompactVenueRow(venue) {
      var status = computeStatus(venue.id, allReports);
      var label = venueWaitText(venue.id);
      var cls = getStatusClass(status);
      var dotColor = cls === 'unknown' ? '#55555B' : getStatusColor(cls);
      return '<div class="vcrow" onclick="openVenueCard(getVenueById(\'' + venue.id + '\'), \'sheet\')">' +
        '<span class="vcrow-dot" style="background:' + dotColor + '"></span>' +
        '<div class="vcrow-info">' +
          '<div class="vcrow-name">' + venue.name + '</div>' +
          '<div class="vcrow-area">' + venue.area + '</div>' +
        '</div>' +
        (label ? '<span class="vcrow-badge ' + cls + '">' + label + '</span>' : '<span class="vcrow-badge unknown">–</span>') +
        '</div>';
    }

    function renderHomeVenues() {
      var el = document.getElementById('sheet-list');
      if (el) el.innerHTML = VENUES.map(renderCompactVenueRow).join('');
      var cnt = document.getElementById('sheet-count');
      if (cnt) cnt.textContent = VENUES.length + ' ställen nära dig';
      renderBestNowCard();
    }

    // Kartans enda kort: svaret på "vart går vi nu?". Visar bara färsk data (computeBestNow: ≤30 min).
    function renderBestNowCard() {
      var card = document.getElementById('best-now-card');
      if (!card) return;
      var best = computeBestNow();
      if (!best) {
        var anyData = allReports.length > 0;
        card.innerHTML = '<button class="bn-card bn-card--empty" onclick="showScreen(\'explore\')">' +
          '<span class="bn-eyebrow">Bäst nu</span>' +
          '<span class="bn-empty-text">' + (anyData ? 'Ingen färsk rapport om kort kö just nu' : 'Inga rapporter ännu i kväll') + '</span>' +
          '<span class="bn-cta">Se alla ställen →</span>' +
          '</button>';
        return;
      }
      var v = best.venue;
      var wait = venueWaitText(v.id) || 'Ingen kö';
      var latest = allReports.filter(function(r) { return r.venue_id === v.id && isQueueReport(r); })
        .sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); })[0];
      var meta = [v.area, venueTypeLabel(v.type)];
      if (best.dist != null) meta.push(best.dist < 1 ? Math.round(best.dist * 10) * 100 + ' m' : best.dist.toFixed(1) + ' km');
      if (latest) meta.push(timeAgo(latest.created_at));
      card.innerHTML = '<button class="bn-card" style="--st:' + getStatusColor(best.status) + '" onclick="openVenueCard(getVenueById(\'' + v.id + '\'), \'bast-nu\')">' +
        '<span class="bn-eyebrow">Bäst nu</span>' +
        '<span class="bn-row">' +
          '<span class="bn-name">' + v.name + '</span>' +
          '<span class="bn-wait">' + waitRollHtml('best', v.id, wait, getStatusColor(best.status)) + '</span>' +
        '</span>' +
        '<span class="bn-meta">' + meta.filter(Boolean).join(' · ') + '</span>' +
        '</button>';
    }

    console.log('[QueueBar] Renderar venues');
    renderHomeVenues();

    // ── Bottom sheet drag ────────────────────────────────────────────────────
    (function() {
      var sheet = document.getElementById('nearby-sheet');
      if (!sheet) return;

      var PEEK = 0;       // px from bottom (just handle visible)
      var sheetHeight = 0;
      var currentSnap = 'peek';

      function getAppHeight() {
        var app = document.getElementById('app');
        return app ? app.offsetHeight : window.innerHeight;
      }
      function getNavHeight() {
        return 64 + (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sab') || '0') || 0);
      }

      function snapTo(snap, animated) {
        sheetHeight = sheet.offsetHeight;
        var appH = getAppHeight();
        var navH = 64; // approx
        var listEl = sheet.querySelector('.sheet-list');

        var translateY;
        if (snap === 'peek') {
          translateY = sheetHeight - 48;
          if (listEl) { listEl.style.maxHeight = '0px'; listEl.style.overflow = 'hidden'; }
        } else if (snap === 'half') {
          var halfH = appH * 0.45;
          translateY = sheetHeight - halfH;
          if (listEl) { listEl.style.maxHeight = (halfH - 48) + 'px'; listEl.style.overflow = 'auto'; }
        } else {
          var fullH = appH * 0.85;
          translateY = sheetHeight - fullH;
          if (listEl) { listEl.style.maxHeight = (fullH - 48) + 'px'; listEl.style.overflow = 'auto'; }
        }
        translateY = Math.max(translateY, 0);
        currentSnap = snap;
        sheet.style.transition = animated ? 'transform var(--dur-slow) var(--ease-out)' : 'none';
        sheet.style.transform = 'translateY(' + translateY + 'px)';
      }

      // init after DOM settles
      setTimeout(function() { snapTo('peek', false); }, 100);
      window.addEventListener('resize', function() { snapTo(currentSnap, false); });

      var startY = 0, startTranslate = 0, isDragging = false, velSamples = [];

      function getTranslateY() {
        var t = new WebKitCSSMatrix(getComputedStyle(sheet).transform);
        return t.m42;
      }

      sheet.addEventListener('touchstart', function(e) {
        var handle = e.target.closest('#sheet-handle-row');
        if (!handle) return;
        isDragging = true;
        startY = e.touches[0].clientY;
        startTranslate = getTranslateY();
        velSamples = [];
        sheet.style.transition = 'none';
      }, { passive: true });

      document.addEventListener('touchmove', function(e) {
        if (!isDragging) return;
        var dy = e.touches[0].clientY - startY;
        var newT = Math.max(0, startTranslate + dy);
        sheet.style.transform = 'translateY(' + newT + 'px)';
        velSamples.push({ t: Date.now(), y: e.touches[0].clientY });
        if (velSamples.length > 5) velSamples.shift();
      }, { passive: true });

      document.addEventListener('touchend', function() {
        if (!isDragging) return;
        isDragging = false;
        sheetHeight = sheet.offsetHeight;
        var appH = getAppHeight();

        // velocity
        var vel = 0;
        if (velSamples.length >= 2) {
          var last = velSamples[velSamples.length - 1];
          var prev = velSamples[0];
          var dt = last.t - prev.t;
          if (dt > 0) vel = (last.y - prev.y) / dt; // px/ms, positive = downward
        }

        var cur = getTranslateY();
        var fullT = sheetHeight - appH * 0.85;
        var halfT = sheetHeight - appH * 0.45;

        var snap;
        if (vel < -0.5) snap = 'full';
        else if (vel > 0.5) snap = 'peek';
        else if (cur <= (fullT + halfT) / 2) snap = 'full';
        else if (cur <= (halfT + (sheetHeight - 48)) / 2) snap = 'half';
        else snap = 'peek';

        snapTo(snap, true);
      });

      // expose for map click
      window.expandSheetHalf = function() { snapTo('half', true); };
    })();

    function focusExploreSearch() {
      showScreen('explore');
      setTimeout(function() {
        var inp = document.getElementById('explore-search');
        if (inp) { inp.focus(); inp.select(); }
      }, 150);
    }

    // ── Kartans inline-sökning ──────────────────────────────────────────────
    var _mapSearchActive = false;

    function onMapSearchInput(val) {
      var clearBtn = document.getElementById('map-search-clear');
      if (clearBtn) clearBtn.style.display = val.length ? 'block' : 'none';
      renderMapSearchResults(val.trim());
    }

    function onMapSearchFocus() {
      _mapSearchActive = true;
      var inp = document.getElementById('map-search-input');
      renderMapSearchResults(inp ? inp.value.trim() : '');
    }

    function onMapSearchBlur() {
      // Delay to allow click on result to fire first
      setTimeout(function() {
        if (!_mapSearchActive) return;
        _mapSearchActive = false;
        document.getElementById('map-search-results').style.display = 'none';
        document.getElementById('map-search-float').style.borderRadius = '12px';
      }, 200);
    }

    function onMapSearchKey(e) {
      if (e.key === 'Escape') {
        clearMapSearch();
        document.getElementById('map-search-input').blur();
      }
    }

    function clearMapSearch() {
      var inp = document.getElementById('map-search-input');
      if (inp) { inp.value = ''; inp.focus(); }
      document.getElementById('map-search-clear').style.display = 'none';
      document.getElementById('map-search-results').style.display = 'none';
      document.getElementById('map-search-float').style.borderRadius = '12px';
    }

    function renderMapSearchResults(query) {
      var resultsEl = document.getElementById('map-search-results');
      var floatEl = document.getElementById('map-search-float');
      if (!resultsEl) return;

      if (query.length < 1) {
        resultsEl.style.display = 'none';
        floatEl.style.borderRadius = '12px';
        return;
      }

      var hits = venueSearch(query, VENUES).slice(0, 6);

      floatEl.style.borderRadius = '12px 12px 10px 10px';
      resultsEl.style.display = 'block';

      if (!hits.length) {
        resultsEl.innerHTML = '<div class="msearch-empty">Inga resultat för "' + query + '"</div>';
        return;
      }

      resultsEl.innerHTML = hits.map(function(v) {
        var status = computeStatus(v.id, allReports);
        var dotColor = STATUS_COLORS[status] || '#6B7280';
        var typeLabel = venueTypeLabel(v.type);
        return '<div class="msearch-row" onmousedown="selectMapSearchVenue(\'' + v.id + '\')">' +
          '<div class="msearch-dot" style="background:' + dotColor + '"></div>' +
          '<div class="msearch-name">' + v.name + '</div>' +
          '<div class="msearch-meta">' + v.area + ' · ' + typeLabel + '</div>' +
          '</div>';
      }).join('');
    }

    function selectMapSearchVenue(venueId) {
      _mapSearchActive = false;
      var v = VENUES.find(function(x) { return x.id === venueId; });
      if (!v) return;

      // Clear search
      var inp = document.getElementById('map-search-input');
      if (inp) inp.blur();
      document.getElementById('map-search-results').style.display = 'none';
      document.getElementById('map-search-float').style.borderRadius = '12px';

      // Fly map to venue
      if (map) {
        map.flyTo({ center: [v.lng, v.lat], zoom: 15, duration: 600 });
      }

      // Open venue card after fly animation
      setTimeout(function() { openVenueCard(v); }, 400);
    }

    // ── Karta ────────────────────────────────────────────────────────────────
    var map = null;

    var venueGeoJSON = {
      type: 'FeatureCollection',
      features: VENUES.map(function(v) {
        return {
          type: 'Feature', id: v.id,
          geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
          properties: { id: v.id, name: v.name, type: v.type, status: 'unknown', wait_label: '', pill_image: '', urgent: 0, ring_image: '' }
        };
      })
    };

    function showMapError(msg) {
      var mapEl = document.getElementById('map');
      if (!mapEl) return;
      mapEl.style.display = 'flex';
      mapEl.style.alignItems = 'center';
      mapEl.style.justifyContent = 'center';
      mapEl.style.background = 'var(--surface)';
      mapEl.innerHTML = '<div class="map-error-inner"><span>' + (msg || 'Kartan kunde inte laddas') + '</span><small>Övriga funktioner fungerar normalt</small></div>';
    }

    if (mapboxgl) {
      console.log('[QueueBar] Initierar Mapbox-karta');
      try {
        map = new mapboxgl.Map({
          container: 'map',
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [18.0686, 59.3293],
          zoom: 12.5,
          minZoom: 11,
          maxZoom: 17,
          pitch: 0,
          maxPitch: 50,
          bearing: 0,
          pitchWithRotate: false,
          dragRotate: false,
          logoPosition: 'bottom-right',
          attributionControl: false
        });
        map.touchZoomRotate.disableRotation();

        function addMapIcon(map, name, drawFn) {
          var size = 28;
          var canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          var ctx = canvas.getContext('2d');
          drawFn(ctx, size);
          var imageData = ctx.getImageData(0, 0, size, size);
          map.addImage(name, { width: size, height: size, data: imageData.data });
        }

        // Statusfärger för kartnålar (hero-färger från CLAUDE.md)
        var PIN_STATUS_COLORS = {
          none: getStatusColor('free'), short: getStatusColor('short'), medium: getStatusColor('medium'), long: getStatusColor('long'), unknown: '#55555B'
        };

        // Ikoner i 24×24-viewBox. Bar = cocktailglas, klubb = musiknot.
        function drawBarGlyph(ctx) {
          ctx.lineWidth = 2.4;
          ctx.stroke(new Path2D('M19 3l-7 8-7-8Z'));
          ctx.fill(new Path2D('M7.6 6h8.8L12 11Z'));
          ctx.stroke(new Path2D('M12 11v10 M8 21h8'));
        }
        function drawClubGlyph(ctx) {
          ctx.lineWidth = 2.4;
          ctx.stroke(new Path2D('M9 18V5l12-2v13'));
          ctx.stroke(new Path2D('M9 9l12-2'));
          ctx.beginPath(); ctx.arc(6, 18, 3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(18, 16, 3, 0, Math.PI * 2); ctx.fill();
        }

        // Rund statusskiva med typ-ikon (avgångstavla-stil). Okänd/ingen data = ihålig grå ring,
        // så att avsaknad av data syns istället för att se ut som en status. Ritas i 2x för skärpa.
        function addTypePin(map, name, color, glyphFn) {
          var PR = 2, W = 36, H = 36;
          var canvas = document.createElement('canvas');
          canvas.width = W * PR; canvas.height = H * PR;
          var ctx = canvas.getContext('2d');
          ctx.scale(PR, PR);
          var cx = W / 2, cy = H / 2, r = 15;
          var hollow = /-unknown$/.test(name);

          // Mörk ring runt skivan skiljer nålen från kartan och från grannar
          ctx.beginPath();
          ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
          ctx.fillStyle = '#0B0B0D';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          if (hollow) {
            ctx.fillStyle = '#151517';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#55555B';
            ctx.stroke();
          } else {
            ctx.fillStyle = color;
            ctx.fill();
          }

          var glyphColor = hollow ? '#85858A' : '#0B0B0D';
          var iconSize = 17, s = iconSize / 24;
          ctx.save();
          ctx.translate(cx - iconSize / 2, cy - iconSize / 2);
          ctx.scale(s, s);
          ctx.strokeStyle = glyphColor;
          ctx.fillStyle = glyphColor;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          glyphFn(ctx);
          ctx.restore();

          var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          if (map.hasImage(name)) map.removeImage(name);
          map.addImage(name, { width: canvas.width, height: canvas.height, data: imageData.data }, { pixelRatio: PR });
        }

        function registerTypePins(map) {
          Object.keys(PIN_STATUS_COLORS).forEach(function(status) {
            addTypePin(map, 'pin-bar-' + status,  PIN_STATUS_COLORS[status], drawBarGlyph);
            addTypePin(map, 'pin-club-' + status, PIN_STATUS_COLORS[status], drawClubGlyph);
          });
        }

        // Pill med väntetiden inuti: kartan blir sin egen lista. Färgen är status, formen visar typ (glas = bar, not = klubb)
        // och siffran är det du frågar efter. Bilderna ritas första gången kartan behöver dem (styleimagemissing),
        // eftersom texten ("5–10", "Fri", "Fullt") ändras med datan. Namn: pill|status|typ|text.
        var _pillNames = {};
        function roundedPath(ctx, x, y, w, h, r) {
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
          ctx.lineTo(x + w, y + h - r); ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
          ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
          ctx.lineTo(x, y + r); ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
          ctx.closePath();
        }
        function drawPill(map, name) {
          var parts = name.split('|');
          var status = parts[1], type = parts[2], text = parts.slice(3).join('|');
          var color = PIN_STATUS_COLORS[status] || PIN_STATUS_COLORS.unknown;
          var PR = 2, H = 28, OUT = 2, PAD = 9, GLYPH = 13, GAP = 5;
          var FONT = '700 13px Satoshi, system-ui, sans-serif', UNIT_FONT = '600 10px Satoshi, system-ui, sans-serif';
          var hasUnit = /\d/.test(text);

          var meas = document.createElement('canvas').getContext('2d');
          meas.font = FONT; var tw = meas.measureText(text).width;
          meas.font = UNIT_FONT; var uw = hasUnit ? meas.measureText('min').width + 2 : 0;
          var W = Math.ceil(PAD + GLYPH + GAP + tw + uw + PAD) + OUT * 2, TH = H + OUT * 2;

          var canvas = document.createElement('canvas');
          canvas.width = W * PR; canvas.height = TH * PR;
          var ctx = canvas.getContext('2d');
          ctx.scale(PR, PR);

          // Mörk kant skiljer pillen från kartan och från grannpillar
          roundedPath(ctx, 0, 0, W, TH, TH / 2);
          ctx.fillStyle = '#0B0B0D'; ctx.fill();
          roundedPath(ctx, OUT, OUT, W - OUT * 2, H, H / 2);
          ctx.fillStyle = color; ctx.fill();

          var ink = '#0B0B0D';
          ctx.save();
          ctx.translate(OUT + PAD, OUT + (H - GLYPH) / 2);
          ctx.scale(GLYPH / 24, GLYPH / 24);
          ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          (type === 'bar' ? drawBarGlyph : drawClubGlyph)(ctx);
          ctx.restore();

          ctx.textBaseline = 'middle'; ctx.fillStyle = ink;
          var tx = OUT + PAD + GLYPH + GAP, ty = OUT + H / 2 + 0.5;
          ctx.font = FONT; ctx.fillText(text, tx, ty);
          if (hasUnit) { ctx.font = UNIT_FONT; ctx.globalAlpha = 0.75; ctx.fillText('min', tx + tw + 2, ty + 0.5); ctx.globalAlpha = 1; }

          var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          if (map.hasImage(name)) map.removeImage(name);
          map.addImage(name, { width: canvas.width, height: canvas.height, data: imageData.data }, { pixelRatio: PR });
          _pillNames[name] = true;
        }

        // Ringen som andas runt en brådskande pill: samma mått som pillen plus 5 px utanför, bara en tunn linje i statusfärgen.
        // Namn: ring|<pillens text>, eftersom bredden följer texten.
        function drawRing(map, name) {
          var text = name.slice(5);
          var PR = 2, H = 28, OUT = 2, PAD = 9, GLYPH = 13, GAP = 5, EXTRA = 6;
          var FONT = '700 13px Satoshi, system-ui, sans-serif', UNIT_FONT = '600 10px Satoshi, system-ui, sans-serif';
          var hasUnit = /\d/.test(text);
          var meas = document.createElement('canvas').getContext('2d');
          meas.font = FONT; var tw = meas.measureText(text).width;
          meas.font = UNIT_FONT; var uw = hasUnit ? meas.measureText('min').width + 2 : 0;
          var pillW = Math.ceil(PAD + GLYPH + GAP + tw + uw + PAD) + OUT * 2, pillH = H + OUT * 2;
          var W = pillW + EXTRA * 2, TH = pillH + EXTRA * 2;
          var canvas = document.createElement('canvas');
          canvas.width = W * PR; canvas.height = TH * PR;
          var ctx = canvas.getContext('2d');
          ctx.scale(PR, PR);
          roundedPath(ctx, 1.5, 1.5, W - 3, TH - 3, (TH - 3) / 2);
          ctx.lineWidth = 2; ctx.strokeStyle = PIN_STATUS_COLORS.long; ctx.stroke();
          var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          if (map.hasImage(name)) map.removeImage(name);
          map.addImage(name, { width: canvas.width, height: canvas.height, data: imageData.data }, { pixelRatio: PR });
        }

        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

        // Kartans färger. dark-v11 har vatten, byggnader och mark i nästan samma grå (12–15 %), så Stockholm blir en platt
        // yta. Här får vatten en kall blåton och parker en dämpad grön, medan vägar och byggnader hålls tillbaka — så att
        // statusfärgerna på nålarna är det starkaste på kartan. Varje lager sätts bara om det finns (Mapbox kan ändra stilen),
        // och ett enskilt fel får aldrig stoppa resten av kartan.
        var MAP_THEME = {
          background: '#0E0F12',
          // Vatten och parker är ljusare än dark-v11:s grå (1,56× och 1,62× bakgrunden mot 1,12×) så att de läses som färg
          // och inte som svart. Gränsen sattes av statusfärgerna: röd "lång kö" ovanpå vatten ger 3,78:1 och på park 3,65:1
          // (krav: minst 3,5). Väntetiden står aldrig direkt på kartan — den ligger i en pill med egen fyllning och mörk
          // kant, och kluster har samma. Det som ligger direkt på kartan är etiketter, och de är mätta separat.
          water: '#0A3566',
          waterDeep: '#082C57',
          shore: '#3D88E0',       // strandlinje: 3,4:1 mot vattnet, så kustlinjen ritar upp Stockholm
          park: '#153F2A',        // grönare än tidigare (mättnad 0,45 → 0,50) med samma ljushet; röd 3,65:1, etikett 4,43:1
          land: '#191A20',
          building: '#1E2026',
          buildingTop: '#262932', // taket på 3D-byggnader (ljusare än väggen så formen läses)
          roadMinor: '#2E3140',
          roadMajor: '#6A5238',   // varm ton mot kall bakgrund: huvudleder blir artärer (2,4:1 mot marken)
          roadHighway: '#A07A45', // motorvägar och trunk (4,4:1 mot marken)
          label: '#9A9EAD',
          labelWater: '#8FB6E0'   // 5,8:1 mot vattnet
        };
        function themeMap(map) {
          function paint(id, prop, value) {
            if (!map.getLayer(id)) return;
            try { map.setPaintProperty(id, prop, value); } catch (e) { console.warn('[QueueBar] Kartfärg hoppades över:', id, e.message); }
          }
          paint('land', 'background-color', MAP_THEME.background);
          paint('water', 'fill-color', MAP_THEME.water);
          paint('waterway', 'line-color', MAP_THEME.water);
          paint('national-park', 'fill-color', MAP_THEME.park);
          paint('landuse', 'fill-color', MAP_THEME.park);
          paint('land-structure-polygon', 'fill-color', MAP_THEME.land);
          paint('building', 'fill-color', MAP_THEME.building);
          // Vägar i tre nivåer efter klass: motorväg/trunk varmast, primär/sekundär varma, resten neutrala.
          // Det är ett uttryck på ett enda lager (road-simple täcker alla klasser), så det kostar inga extra lager.
          var roadColor = ['match', ['get', 'class'],
            ['motorway', 'trunk', 'motorway_link', 'trunk_link'], MAP_THEME.roadHighway,
            ['primary', 'secondary', 'primary_link', 'secondary_link'], MAP_THEME.roadMajor,
            MAP_THEME.roadMinor];
          paint('road-simple', 'line-color', roadColor);
          paint('bridge-simple', 'line-color', roadColor);
          paint('tunnel-simple', 'line-color', MAP_THEME.roadMinor);
          ['road-path', 'road-pedestrian', 'road-steps', 'road-path-trail', 'road-path-cycleway-piste'
          ].forEach(function(id) { paint(id, 'line-color', MAP_THEME.roadMinor); });
          paint('bridge-case-simple', 'line-color', MAP_THEME.land);

          // Strandlinje: ett tunt ljusare streck längs vattnet. Dark-v11 har ingen, så vi lägger ett lager ovanpå
          // vattnet. Det ritar upp Stockholm som en stad vid vatten, och kostar inget i läsbarhet (en linje, inte en yta).
          if (map.getLayer('water') && !map.getLayer('water-shore')) {
            try {
              map.addLayer({
                id: 'water-shore', type: 'line', source: 'composite', 'source-layer': 'water',
                minzoom: 10,
                layout: { 'line-join': 'round' },
                paint: {
                  'line-color': MAP_THEME.shore,
                  'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.35, 14, 0.7],
                  'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 1.4]
                }
              }, 'building');
            } catch (e) { console.warn('[QueueBar] Strandlinje hoppades över:', e.message); }
          }

          // 3D-byggnader. Samma källa som det platta byggnadslagret, men som extruderade volymer. De platta byggnaderna
          // göms när 3D tar över (zoom 15), så att inget ritas dubbelt. Väggen är dämpad och taket något ljusare.
          // Höjderna är verkliga (height-egenskapen i kartdatan), men i 60 % så att staden inte blir en vägg framför nålarna.
          if (map.getLayer('building') && !map.getLayer('building-3d')) {
            try {
              map.addLayer({
                id: 'building-3d', type: 'fill-extrusion', source: 'composite', 'source-layer': 'building',
                minzoom: 14.5,
                filter: ['all', ['!=', ['get', 'type'], 'building:part'], ['==', ['get', 'underground'], 'false']],
                paint: {
                  'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'height'], 0, MAP_THEME.building, 60, MAP_THEME.buildingTop],
                  'fill-extrusion-height': ['*', ['coalesce', ['get', 'height'], 8], 0.6],
                  'fill-extrusion-base': ['*', ['coalesce', ['get', 'min_height'], 0], 0.6],
                  'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, 0.92],
                  'fill-extrusion-vertical-gradient': true
                }
              }, 'road-label-simple');
              map.setPaintProperty('building', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 14.5, 1, 15.5, 0]);
            } catch (e) { console.warn('[QueueBar] 3D-byggnader hoppades över:', e.message); }
          }
          // Etiketter: vatten får en blå ton (Mälaren, Saltsjön), övrigt dämpas så nålarna vinner
          ['road-label-simple', 'settlement-subdivision-label', 'settlement-minor-label', 'settlement-major-label',
           'natural-point-label', 'natural-line-label', 'waterway-label'].forEach(function(id) { paint(id, 'text-color', MAP_THEME.label); });
          ['water-point-label', 'water-line-label'].forEach(function(id) { paint(id, 'text-color', MAP_THEME.labelWater); });
          // Allt som inte hjälper valet av ställe döljs: affärer, hållplatser, bensinstationer och liknande
          ['poi-label', 'airport-label'].forEach(function(id) {
            if (map.getLayer(id)) { try { map.setLayoutProperty(id, 'visibility', 'none'); } catch (e) {} }
          });
        }

        map.on('load', function() {
          console.log('[QueueBar] Mapbox karta laddad — lägger till lager');

          // Pill-bilder ritas på begäran. Satoshi måste vara laddat först, annars mäts texten med reservtypsnittet
          // och pillen blir fel bred. Om typsnittet inte hinner laddas ritas pillen ändå (reservtypsnitt), men bara en gång.
          map.on('styleimagemissing', function(e) {
            if (!e.id) return;
            var isPill = e.id.indexOf('pill|') === 0, isRing = e.id.indexOf('ring|') === 0;
            if (!isPill && !isRing) return;
            var draw = function() {
              if (map.hasImage(e.id)) return;
              if (isPill) drawPill(map, e.id); else drawRing(map, e.id);
            };
            // Synkront när typsnittet redan finns: då hinner Mapbox få bilden direkt och loggar ingen varning.
            // Asynkront först om Satoshi inte hunnit laddas.
            if (!document.fonts || !document.fonts.check || document.fonts.check('700 13px Satoshi')) { draw(); }
            else { document.fonts.load('700 13px Satoshi').then(draw, draw); }
          });
          themeMap(map);
          registerTypePins(map);

          map.addSource('venues', {
            type: 'geojson', data: venueGeoJSON,
            cluster: true, clusterMaxZoom: 13, clusterRadius: 40,
            // Värsta kön i gruppen (0 = ingen kö … 3 = lång) och hur många som har färsk data. Klustret får färg efter
            // värsta status, för det är det man frågar sig på kartan: "går det att ta sig in där?". Ställen utan data
            // (status "unknown") räknas inte som bra eller dåliga, så de påverkar inte färgen.
            clusterProperties: {
              worst: ['max', ['match', ['get', 'status'], 'long', 3, 'medium', 2, 'short', 1, 'none', 0, -1]],
              n_known: ['+', ['case', ['==', ['get', 'status'], 'unknown'], 0, 1]]
            }
          });

          map.addLayer({
            id: 'clusters', type: 'circle', source: 'venues',
            filter: ['has', 'point_count'],
            paint: {
              // Fyllning = värsta status i gruppen. Grått när ingen i gruppen har färsk data (vi vet inget).
              'circle-color': ['case',
                ['==', ['get', 'n_known'], 0], '#2A2B31',
                ['==', ['get', 'worst'], 3], getStatusColor('long'),
                ['==', ['get', 'worst'], 2], getStatusColor('medium'),
                ['==', ['get', 'worst'], 1], getStatusColor('short'),
                getStatusColor('free')],
              'circle-radius': ['step', ['get', 'point_count'], 18, 6, 21, 16, 24],
              // Mörk kant skiljer klustret från kartan och från grannklustren
              'circle-stroke-width': 3,
              'circle-stroke-color': '#0B0B0D'
            }
          });

          map.addLayer({
            id: 'cluster-count', type: 'symbol', source: 'venues',
            filter: ['has', 'point_count'],
            layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 14, 'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'], 'text-allow-overlap': true },
            // Mörk siffra på färgad fyllning (som i nålarna), ljus på grå
            paint: { 'text-color': ['case', ['==', ['get', 'n_known'], 0], '#F5F5F4', '#0B0B0D'] }
          });

          // Ställen med färsk data: pill med väntetid. Ställen utan data: den tomma ringen (pin-*-unknown), så att
          // "vi vet inget" aldrig ser ut som en status. Samma namn skapas i pill_image nedan.
          map.addLayer({
            id: 'venues-pins', type: 'symbol', source: 'venues',
            filter: ['!', ['has', 'point_count']],
            layout: {
              'icon-image': ['case',
                ['==', ['get', 'status'], 'unknown'],
                  ['concat', ['match', ['get', 'type'], 'bar', 'pin-bar-', 'pin-club-'], 'unknown'],
                ['get', 'pill_image']
              ],
              'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.85, 15, 1.05],
              'icon-anchor': 'center',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              // Längre köer ritas överst när nålar överlappar
              'symbol-sort-key': ['match', ['get', 'status'], 'long', 4, 'medium', 3, 'short', 2, 'none', 1, 0]
            },
            paint: {
              // Ingen data = visuellt nedtonad
              'icon-opacity': ['match', ['get', 'status'], 'unknown', 0.7, 1]
            }
          });

          // venue-label layer removed — markers are pure status circles

          // Liv på kartan kommer från data. En ring runt pillen andas bara när kön är lång OCH färsk (< 20 min) — samma regel
          // som den pulserande pricken i listan. Ställen med fri ingång pulserar inte längre: de är inte brådskande, och
          // en rörelse som inte betyder något tar bort värdet av den som gör det.
          // Ringen är en pill-formad bild (pill-ring) under pillen, så den följer pillens bredd i stället för att vara en cirkel.
          map.addLayer({
            id: 'venues-urgent', type: 'symbol', source: 'venues',
            filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'urgent'], 1]],
            layout: {
              'icon-image': ['get', 'ring_image'],
              'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.85, 15, 1.05],
              'icon-anchor': 'center',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true
            },
            paint: { 'icon-opacity': 0 }
          }, 'venues-pins');

          // Andning: opacity 0 → 0,7 → 0 på ~2,2 s. Bara ett paint-värde per bildruta, och bara när något är brådskande.
          var _breathStart = performance.now();
          function animateUrgent() {
            if (map && map.getLayer('venues-urgent') && !document.hidden && _hasUrgent) {
              var t = ((performance.now() - _breathStart) % 2200) / 2200;
              var o = 0.7 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
              map.setPaintProperty('venues-urgent', 'icon-opacity', o);
            }
            requestAnimationFrame(animateUrgent);
          }
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            requestAnimationFrame(animateUrgent);
          } else {
            // Stillbild i stället för rörelse: ringen syns, den andas inte
            map.setPaintProperty('venues-urgent', 'icon-opacity', 0.55);
          }

          map.on('click', 'clusters', function(e) {
            var id = e.features[0].properties.cluster_id;
            var coords = e.features[0].geometry.coordinates;
            map.getSource('venues').getClusterExpansionZoom(id, function(err, zoom) {
              if (!err) map.easeTo({ center: coords, zoom: Math.min(zoom + 1, 15), duration: 500 });
            });
          });

          map.on('click', 'venues-pins', function(e) {
            var venue = getVenueById(e.features[0].properties.id);
            console.log('[QueueBar] Kartmarkörsklick:', e.features[0].properties.id);
            if (venue) openVenueCard(venue, 'karta');
          });

          ['venues-pins', 'clusters'].forEach(function(l) {
            map.on('mouseenter', l, function() { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', l, function() { map.getCanvas().style.cursor = ''; });
          });

          // Uppdatera markörerna med ev. redan inladdad data
          if (allReports.length > 0) updateMapStatuses();

          // Startkamera: en gång, när kartan öppnas. Zoomar in från lite längre ut och lutar kartan 28° så att staden får djup.
          // Lutningen hålls lågt med flit: högre döljer ställen bakom hus och gör pillerna svåra att träffa. Användaren kan
          // själv luta med två fingrar (touchPitch); dragRotate är fortfarande avstängt. Bara om användaren inte redan rört kartan,
          // och hoppas över med rörelsebegränsning (då startar kartan direkt i sitt slutläge).
          var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (reduceMotion) {
            map.jumpTo({ pitch: 28 });
          } else {
            map.jumpTo({ zoom: 11.6, pitch: 0 });
            setTimeout(function() {
              if (map && !_userMovedMap) map.easeTo({ zoom: 12.6, pitch: 28, duration: 2200, easing: function(t) { return 1 - Math.pow(1 - t, 3); } });
            }, 350);
          }
          console.log('[QueueBar] Kartlager klara');
        });
        var _userMovedMap = false;
        ['dragstart', 'zoomstart', 'pitchstart'].forEach(function(ev) {
          map.on(ev, function(e) { if (e.originalEvent) _userMovedMap = true; });
        });

        // Fix 4 — map.on('error'): logga, visa felläge, låt resten leva
        map.on('error', function(e) {
          console.error('[QueueBar] Mapbox-fel:', e.error ? e.error.message : e);
          map = null;
          showMapError('Kartan kunde inte laddas');
        });

      } catch(err) {
        console.error('[QueueBar] Mapbox init kastade:', err);
        map = null;
        showMapError('Kartan kunde inte startas');
      }
    } else {
      showMapError('Mapbox GL JS laddades inte');
    }

    // ── Supabase-funktioner ──────────────────────────────────────────────────
    function getUserId() {
      var id = localStorage.getItem('qb_user_id');
      if (!id) {
        id = 'user-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('qb_user_id', id);
      }
      return id;
    }

    function showSkeletons() {
      var lists = ['sheet-list'];
      lists.forEach(function(id) {
        var el = document.getElementById(id);
        if (el && !el.querySelector('.vcard') && !el.querySelector('.vcrow')) {
          el.innerHTML = [1,2,3,4].map(function() {
            return '<div class="skeleton skeleton-card"></div>';
          }).join('');
        }
      });
      var exploreList = document.getElementById('explore-list');
      if (exploreList && !exploreList.querySelector('.erow')) {
        exploreList.innerHTML = '<div class="venue-group">' + [1,2,3,4,5].map(function() {
          return '<div class="skeleton-erow"></div>';
        }).join('') + '</div>';
      }
    }

    function showExploreError() {
      var el = document.getElementById('explore-list');
      if (!el) return;
      el.innerHTML = '<div class="explore-error-state">' +
        '<svg class="explore-err-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
        '<div class="explore-err-title">Kunde inte ladda data</div>' +
        '<div class="explore-err-sub">Kontrollera anslutningen</div>' +
        '<button class="explore-err-btn" onclick="loadReports()">Försök igen</button>' +
        '</div>';
    }

    var STATUS_COLORS = {
      free: '#34E07F', short: '#FFD23F', medium: '#FF8A3D', long: '#FF4D5E', unknown: '#55555B'
    };

    // Hur det gick med den senaste inläsningen: 'loading' | 'ok' | 'error'.
    // Utan den här kan en tom vy inte skilja "inga rapporter i Stockholm" från "vi nådde
    // inte servern", och ett serverfel visades som en lugn kväll.
    var _loadState = 'loading';

    // Vid fel: behåll rapporterna vi redan har, men märk dem som osäkra. Finns inga alls är
    // felläget allt vi kan visa. Rör inte explore-listan när den har data — att tömma en
    // fungerande lista för att en enda pollning missade är sämre än att visa den med varning.
    function renderLoadFailure() {
      if (!allReports.length) showExploreError();
      if (typeof renderExploreSummary === 'function') renderExploreSummary();
      if (typeof renderLiveFeed === 'function') renderLiveFeed();
    }

    async function loadReports() {
      if (!supabase) {
        console.warn('[QueueBar] loadReports: supabase är null');
        _loadState = 'error';
        if (testDataEnabled()) injectTestData();
        updateMapStatuses();
        renderHomeVenues();
        if (typeof renderExploreVenues === 'function') renderExploreVenues();
        if (typeof renderLiveFeed === 'function') renderLiveFeed();
        if (typeof updateProfileStats === 'function') updateProfileStats();
        checkWatchedVenueAlerts();
        updateOnMyWayUI();
        return;
      }
      showSkeletons();
      console.log('[QueueBar] loadReports startar');
      var now = new Date().toISOString();
      try {
        var result = await supabase.from('reports').select('*', { count: 'exact' }).gte('expires_at', now).order('created_at', { ascending: false }).limit(100);
        console.log('[QueueBar] loadReports råsvar — status:', result.status, result.statusText,
          '| count:', result.count, '| rader:', result.data ? result.data.length : 'null',
          '| error:', result.error || 'ingen');
        if (result.error) {
          console.error('[QueueBar] loadReports Supabase-fel (fullt objekt):', JSON.stringify(result.error));
          _loadState = 'error';
          renderLoadFailure();
        }
        if (result.data) {
          _loadState = 'ok';
          // Bara kända ställen: venue_id hamnar i onclick-attribut och okända id:n kan inte visas meningsfullt ändå.
          allReports = result.data.filter(function(r) { return getVenueById(r.venue_id); });
          console.log('[QueueBar] loadReports: ' + allReports.length + ' Supabase-rapporter inladdade');
          if (testDataEnabled()) injectTestData();
          updateMapStatuses();
          renderHomeVenues();
          if (typeof renderExploreVenues === 'function') renderExploreVenues();
          if (typeof renderLiveFeed === 'function') renderLiveFeed();
          if (typeof updateProfileStats === 'function') updateProfileStats();
          checkWatchedVenueAlerts();
          updateOnMyWayUI();
          loadOnMyWayCounts().then(updateOnMyWayUI);
        }
      } catch(err) {
        console.error('[QueueBar] loadReports kastade:', err);
        _loadState = 'error';
        renderLoadFailure();
      }
    }

    // Texten på pillen: samma källa som listan och kortet (venueWaitText), men korta former så pillen håller sig smal.
    // "Ingen kö" blir "Fri", som i listan. Tom text = vi vet inget, och då ritas ingen pill.
    function pillText(venueId) {
      var t = venueWaitText(venueId) || '';
      if (t === 'Ingen kö') return 'Fri';
      return t.replace(/\s*min$/, '');
    }

    // Brådskande = lång kö OCH en kö-rapport yngre än 20 min. Exakt samma regel som den pulserande pricken i listan
    // (showPulseDot i renderExploreVenueRow), så kartan och listan aldrig är oense om vad som är akut.
    var _hasUrgent = false;
    function isUrgent(venueId, status) {
      if (status !== 'long') return false;
      var latest = 0;
      allReports.forEach(function(r) {
        if (r.venue_id !== venueId || !isQueueReport(r)) return;
        var t = new Date(r.created_at).getTime();
        if (t > latest) latest = t;
      });
      return latest > 0 && (Date.now() - latest) / 60000 < 20;
    }

    function updateMapStatuses() {
      if (!map || !venueGeoJSON) return;
      if (!map.getSource('venues')) return;
      _hasUrgent = false;
      var updated = venueGeoJSON.features.map(function(f) {
        var id = f.properties.id;
        var status = computeStatus(id, allReports);
        var text = pillText(id);
        // Pillens bildnamn bär allt som ritas: status (färg), typ (ikon) och text. Bilden skapas första gången kartan ber om den.
        var pill = status === 'unknown' || !text ? '' : 'pill|' + status + '|' + (f.properties.type === 'bar' ? 'bar' : 'club') + '|' + text;
        var urgent = pill && isUrgent(id, status);
        if (urgent) _hasUrgent = true;
        return Object.assign({}, f, {
          properties: Object.assign({}, f.properties, {
            status: pill ? status : 'unknown',
            wait_label: venueWaitText(id),
            pill_image: pill,
            urgent: urgent ? 1 : 0,
            ring_image: urgent ? 'ring|' + text : ''
          })
        });
      });
      map.getSource('venues').setData({ type: 'FeatureCollection', features: updated });
    }

    function subscribeToReports() {
      if (!supabase) return;
      supabase.channel('reports').on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, function() {
        console.log('[QueueBar] Realtime: ny händelse i reports');
        loadReports().then(loadHistoricalPatterns);
      }).subscribe();
      console.log('[QueueBar] Prenumererar på realtidsuppdateringar');
    }

    // Testdata visas bara med ?testdata=true eller efter den hemliga växlingen Alt + 2.
    var TESTDATA_KEY = 'qb_testdata';

    function testDataEnabled() {
      if (new URLSearchParams(location.search).get('testdata') === 'true') return true;
      try { return localStorage.getItem(TESTDATA_KEY) === '1'; } catch(e) { return false; }
    }

    function toggleTestData() {
      try { localStorage.setItem(TESTDATA_KEY, testDataEnabled() ? '0' : '1'); } catch(err) {}
      // Ladda om utan ?testdata så att växlingen alltid gäller och ingen testdata ligger kvar i minnet.
      location.href = location.pathname;
    }

    // Alt + 2 (Option + 2 på Mac). Inte i textfält — där skriver Option/AltGr + 2 "@".
    document.addEventListener('keydown', function(e) {
      if (e.code !== 'Digit2' || !e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      toggleTestData();
    });

    function injectTestData() {
      var now = Date.now();
      var _testUsers = ['usr-a1b2', 'usr-c3d4', 'usr-e5f6', 'usr-g7h8', 'usr-i9j0', 'usr-k1l2', 'usr-m3n4', 'usr-o5p6'];
      var _tIdx = 0;
      function ago(mins) { return new Date(now - mins * 60 * 1000).toISOString(); }
      // ahead = knappens mittvärde (0, 5, 17, 37, 60). opts.session/type bygger kö-sessioner för uppmätt hastighet.
      function r(venueId, minsAgo, ahead, opts) {
        opts = opts || {};
        var type = opts.type || 'initial';
        var rep = { id: 'test-' + venueId + '-' + minsAgo + '-' + type, venue_id: venueId, people_ahead: ahead,
                    report_type: type, queue_session: opts.session || null,
                    created_at: ago(minsAgo), expires_at: ago(minsAgo - 45), user_id: _testUsers[_tIdx++ % _testUsers.length] };
        if (opts.comment) rep.comment = opts.comment;
        var v = getVenueById(venueId);
        rep.queue_status = waitToStatus({ ahead: ahead, mins: ahead / PACE_RATE[v.pace], full: false });
        return rep;
      }
      var testReports = [
        // spy-bar — långsam dörr, uppmätt: 25–50 → 10–25 på 25 min
        r('spy-bar', 40, 17), r('spy-bar', 30, 37, { session: 'ts-spy' }), r('spy-bar', 5, 17, { session: 'ts-spy', type: 'followup' }), r('spy-bar', 2, 0, { session: 'ts-spy', type: 'entered' }),
        r('spy-bar', 4, 37, { comment: 'VIP-kö öppen' }),
        // under-bron — snabb dörr, uppmätt: 25–50 → 1–10 på 10 min
        r('under-bron', 14, 37, { session: 'ts-ub' }), r('under-bron', 4, 5, { session: 'ts-ub', type: 'followup' }), r('under-bron', 8, 17),
        // drama — fullt: två sessioner står kvar nära dörren (1–10) i ~20 min
        r('drama', 20, 5, { session: 'ts-dr1' }), r('drama', 2, 5, { session: 'ts-dr1', type: 'followup' }),
        r('drama', 22, 5, { session: 'ts-dr2' }), r('drama', 1, 5, { session: 'ts-dr2', type: 'followup' }),
        r('drama', 6, 37),
        // uppskattning från dörrtakt (inga sessioner)
        r('cafe-opera', 35, 37), r('cafe-opera', 10, 60), r('cafe-opera', 2, 60, { comment: 'Fri entré t.o.m. 23:30' }),
        r('berns', 28, 17), r('berns', 15, 37), r('berns', 3, 37),
        r('sturecompagniet', 40, 17), r('sturecompagniet', 20, 37), r('sturecompagniet', 5, 37),
        r('sturehof', 30, 5), r('sturehof', 10, 17),
        r('soap-bar', 40, 5), r('soap-bar', 15, 17), r('soap-bar', 3, 17),
        r('pelikan', 35, 17), r('pelikan', 12, 37),
        r('akkurat', 20, 5), r('akkurat', 6, 17),
        r('tradgarden', 35, 5), r('tradgarden', 18, 17), r('tradgarden', 4, 37),
        r('tak', 30, 37), r('tak', 12, 37), r('tak', 4, 17),
        r('pharmarium', 15, 17), r('pharmarium', 1, 5),
        // ingen kö
        r('tjoget', 25, 0), r('tjoget', 8, 0),
        r('morfar-ginko', 30, 0), r('morfar-ginko', 10, 0),
        r('solidaritet', 30, 0), r('solidaritet', 10, 0),
        // gammal data (25 min) — visas som "kan vara gammal"
        r('gro', 40, 5), r('gro', 25, 0)
      ];
      // Remove old test entries, then prepend fresh ones
      allReports = allReports.filter(function(r) { return !r.id || !String(r.id).startsWith('test-'); });
      allReports = testReports.concat(allReports);
      console.log('[QueueBar] injectTestData: ' + testReports.length + ' testrap injicerade, totalt ' + allReports.length + ' rapporter för ' + VENUES.length + ' venues');

      // Historical patterns for test mode — simulate typical Friday night data
      // Sturecompagniet under tröskeln (3) — ska inte visas.
      _omwTestCounts = { 'spy-bar': 5, 'berns': 3, 'sturecompagniet': 2 };
      // Café Opera: ingen session ikväll men dörrtakt från tidigare fredagar.
      _historicalRatesTest = { 'cafe-opera': { rate: 0.7, n: 6 } };
      _historicalRates = Object.assign({}, _historicalRates, _historicalRatesTest);
      var testDow = new Date().getDay();
      var testHour = new Date().getHours();
      _historicalPatterns = {
        'cafe-opera':      { level: 'long',   count: 8,  dow: testDow, hour: testHour },
        'spy-bar':         { level: 'long',   count: 6,  dow: testDow, hour: testHour },
        'sturecompagniet': { level: 'medium', count: 5,  dow: testDow, hour: testHour },
        'berns':           { level: 'short',  count: 4,  dow: testDow, hour: testHour },
        'under-bron':      { level: 'free',   count: 3,  dow: testDow, hour: testHour }
      };
    }

    async function submitReport(venueId, venueName, peopleAhead, comment) {
      if (!supabase) throw new Error('Supabase är inte tillgänglig');
      var userId = getUserId();
      var now = new Date();
      var recent = allReports.filter(function(r) { return r.user_id === userId && isQueueReport(r) && (now - new Date(r.created_at)) < 20 * 60 * 1000; });
      if (recent.length > 0) {
        var wait = Math.ceil(20 - (now - new Date(recent[0].created_at)) / 60000);
        throw new Error('Vänta ' + wait + ' minuter innan nästa rapport');
      }
      var draft = { venue_id: venueId, people_ahead: peopleAhead, report_type: 'initial', created_at: now.toISOString() };
      // Status för just den här rapporten: dess antal + kvällens uppmätta hastighet, inte andras köantal.
      var rateContext = allReports.filter(function(r) { return r.venue_id !== venueId || !isQueueReport(r); });
      var queueStatus = waitToStatus(estimateWait(venueId, [draft].concat(rateContext)));
      var insertObj = {
        venue_id: venueId, venue_name: venueName, queue_status: queueStatus, user_id: userId,
        people_ahead: peopleAhead, report_type: 'initial', queue_session: newQueueSessionId(),
        expires_at: new Date(now.getTime() + 45 * 60 * 1000).toISOString()
      };
      if (comment) insertObj.comment = comment;
      var result;
      try {
        result = await supabase.from('reports').insert(insertObj);
        if (result.error && result.error.message && result.error.message.toLowerCase().includes('comment')) {
          // Column missing — retry without comment
          delete insertObj.comment;
          result = await supabase.from('reports').insert(insertObj);
        }
      } catch(e) { result = { error: e }; }
      if (result.error) throw result.error;
      startQueueSession({ id: insertObj.queue_session, venueId: venueId, venueName: venueName, ahead: peopleAhead, at: now.getTime() });
      await supabase.rpc('increment_points', { p_user_id: userId, p_points: 10 });
      await loadReports();
      return true;
    }

    function newQueueSessionId() {
      return 'qs-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    function reportErrorText(err) {
      var msg = (err && err.message) || '';
      if (msg.indexOf('Vänta') === 0) return msg;
      if (msg.indexOf('rate_limited') >= 0) return 'Du har redan rapporterat nyss — vänta en stund';
      if (msg.indexOf('too_soon') >= 0) return 'Vänta några minuter innan du uppdaterar igen';
      if (msg.indexOf('session_') >= 0) return 'Din kö-rapport har gått ut — rapportera på nytt';
      return 'Fel — försök igen';
    }

    // ── Kö-session: "Står du kvar?" + "Jag är inne" ──────────────────────────
    // Sparas i telefonen; varje uppföljning blir en mätpunkt för köns hastighet (measureQueueRates).
    var QS_KEY = 'qb_queue_session';
    var QS_MAX_AGE = 90 * 60 * 1000;
    var QS_MIN_GAP = 4 * 60 * 1000;
    var QS_MAX_FOLLOWUPS = 4;

    function getQueueSession() {
      var s = null;
      try { s = JSON.parse(localStorage.getItem(QS_KEY) || 'null'); } catch(e) {}
      if (s && Date.now() - s.startedAt > QS_MAX_AGE) { endQueueSession(); return null; }
      return s;
    }

    function startQueueSession(r) {
      if (_onMyWay) cancelOnMyWay();
      var s = { id: r.id, venueId: r.venueId, venueName: r.venueName, startedAt: r.at, lastAhead: r.ahead, lastAt: r.at, followups: 0 };
      try { localStorage.setItem(QS_KEY, JSON.stringify(s)); } catch(e) {}
      updateOnMyWayUI();
    }

    function endQueueSession() {
      try { localStorage.removeItem(QS_KEY); } catch(e) {}
      updateOnMyWayUI();
    }

    async function submitSessionReport(type, peopleAhead) {
      var s = getQueueSession();
      if (!s) throw new Error('session_expired');
      if (!supabase) throw new Error('Supabase är inte tillgänglig');
      var now = new Date();
      var draft = { venue_id: s.venueId, people_ahead: peopleAhead, report_type: 'initial', created_at: now.toISOString() };
      var rateContext = allReports.filter(function(r) { return r.venue_id !== s.venueId || !isQueueReport(r); });
      var result = await supabase.from('reports').insert({
        venue_id: s.venueId, venue_name: s.venueName, user_id: getUserId(),
        queue_status: waitToStatus(estimateWait(s.venueId, [draft].concat(rateContext))),
        people_ahead: peopleAhead, report_type: type, queue_session: s.id,
        expires_at: new Date(now.getTime() + 45 * 60 * 1000).toISOString()
      });
      if (result.error) throw result.error;
      return { session: s, at: now.getTime() };
    }

    function queueSessionUpdate() {
      var s = getQueueSession();
      if (!s) return;
      if (Date.now() - s.lastAt < QS_MIN_GAP) {
        showToast('Vänta ' + Math.ceil((QS_MIN_GAP - (Date.now() - s.lastAt)) / 60000) + ' min innan du uppdaterar');
        return;
      }
      openQuickReport(s.venueId, 'followup');
    }

    async function submitQueueFollowup(peopleAhead) {
      try {
        var res = await submitSessionReport('followup', peopleAhead);
        var s = res.session;
        s.lastAhead = peopleAhead; s.lastAt = res.at; s.followups++;
        try { localStorage.setItem(QS_KEY, JSON.stringify(s)); } catch(e) {}
        showToast('Tack — nu vet vi hur snabbt kön rör sig');
        updateOnMyWayUI();
        loadReports();
      } catch(err) { showToast(reportErrorText(err)); }
    }

    async function queueSessionEntered() {
      try {
        var res = await submitSessionReport('entered', 0);
        var mins = Math.max(1, Math.round((res.at - res.session.startedAt) / 60000));
        endQueueSession();
        if (supabase) await supabase.rpc('increment_points', { p_user_id: getUserId(), p_points: 5 });
        showToast('Inne efter ' + mins + ' min — tack!');
        loadReports();
      } catch(err) { showToast(reportErrorText(err)); }
    }

    function dismissQueueSession() {
      endQueueSession();
    }

    // Geolocation (passiv, en gång — för avstånd i explore-rader)
    window._userPos = null;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function(pos) {
        window._userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (typeof renderExploreVenues === 'function') renderExploreVenues();
      }, function() {}, { timeout: 8000, maximumAge: 300000 });
    }

    // ── Historiska mönster ───────────────────────────────────────────────────
    var _historicalPatterns = {};

    async function loadHistoricalPatterns() {
      if (!supabase) return;
      try {
        var now = new Date();
        var dow = now.getDay();
        var hour = now.getHours();
        var eightWeeksAgo = new Date(now - 8 * 7 * 24 * 3600 * 1000).toISOString();
        var result = await supabase
          .from('reports')
          .select('venue_id, queue_status, created_at')
          .gte('created_at', eightWeeksAgo)
          .not('queue_status', 'eq', 'none')
          .eq('report_type', 'initial');
        if (result.error || !result.data) return;
        var byVenue = {};
        result.data.forEach(function(r) {
          var d = new Date(r.created_at);
          var rdow = d.getDay();
          var rhour = d.getHours();
          if (rdow !== dow) return;
          if (Math.abs(rhour - hour) > 1) return;
          if (!byVenue[r.venue_id]) byVenue[r.venue_id] = {};
          byVenue[r.venue_id][r.queue_status] = (byVenue[r.venue_id][r.queue_status] || 0) + 1;
        });
        _historicalPatterns = {};
        Object.keys(byVenue).forEach(function(vid) {
          var counts = byVenue[vid];
          var total = Object.values(counts).reduce(function(a, b) { return a + b; }, 0);
          if (total < 3) return;
          var modal = Object.keys(counts).reduce(function(a, b) { return counts[a] >= counts[b] ? a : b; });
          _historicalPatterns[vid] = { level: modal, count: total, dow: dow, hour: hour };
        });
        renderExploreVenues();
      } catch(e) {}
    }

    // ── Historisk dörrtakt + kalibrering ─────────────────────────────────────
    // Hämtar kö-sessioner 8 veckor bakåt. PostgREST ger max 1000 rader — flytta till en RPC när datan växer.
    var _calibration = [];

    async function loadHistoricalRates() {
      if (!supabase) return;
      var since = new Date(Date.now() - 8 * 7 * 24 * 3600 * 1000).toISOString();
      var res = await supabase.from('reports')
        .select('venue_id, queue_session, people_ahead, report_type, created_at')
        .not('queue_session', 'is', null)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (res.error || !res.data) {
        if (res.error) console.warn('[QueueBar] loadHistoricalRates:', res.error.message);
        return;
      }
      var rates = sessionRates(res.data);
      var now = Date.now();
      var next = {};
      VENUES.forEach(function(v) {
        var h = historicalRateFor(v.id, rates, now);
        if (h) next[v.id] = h;
      });
      _historicalRates = Object.assign(next, _historicalRatesTest);
      _calibration = computeCalibration(res.data, rates);
      if (_calibration.length) console.log('[QueueBar] Kalibrering — skriv qbCalibration() i konsolen för tabellen');
      renderExploreVenues();
      updateMapStatuses();
    }

    // Jämför vad appen hade sagt när kön-sessionen startade med verklig tid till "Jag är inne".
    // fel = verklig − förutsagd: plus betyder att appen lovade för kort väntan.
    function computeCalibration(history, rates) {
      var bySession = {};
      history.forEach(function(r) { (bySession[r.queue_session] = bySession[r.queue_session] || []).push(r); });
      var perVenue = {};
      history.forEach(function(r) {
        if (r.report_type !== 'entered') return;
        var start = bySession[r.queue_session].reduce(function(a, b) { return new Date(a.created_at) <= new Date(b.created_at) ? a : b; });
        if (start === r || !start.people_ahead) return;
        var startAt = new Date(start.created_at).getTime();
        var actual = (new Date(r.created_at).getTime() - startAt) / 60000;
        if (actual < 1 || actual > 120) return;
        var before = history.filter(function(x) { return x.venue_id === r.venue_id && new Date(x.created_at).getTime() <= startAt; });
        var est = estimateWait(r.venue_id, before, startAt, historicalRateFor(r.venue_id, rates, startAt));
        if (!est) return;
        var range = setWaitRange({ mins: start.people_ahead / est.rate }, 0.35);
        (perVenue[r.venue_id] = perVenue[r.venue_id] || []).push({
          err: actual - range.mins, inRange: actual >= range.low && actual <= range.high
        });
      });
      function summarize(name, rows) {
        return {
          venue: name, sessions: rows.length,
          medianErrorMin: Math.round(median(rows.map(function(x) { return Math.abs(x.err); }))),
          biasMin: Math.round(median(rows.map(function(x) { return x.err; }))),
          inRangePct: Math.round(100 * rows.filter(function(x) { return x.inRange; }).length / rows.length)
        };
      }
      var out = Object.keys(perVenue).map(function(vid) {
        var v = getVenueById(vid);
        return summarize(v ? v.name : vid, perVenue[vid]);
      }).sort(function(a, b) { return b.sessions - a.sessions; });
      var all = [].concat.apply([], Object.keys(perVenue).map(function(k) { return perVenue[k]; }));
      if (all.length) out.unshift(summarize('Alla', all));
      return out;
    }

    function qbCalibration() {
      if (!_calibration.length) { console.log('[QueueBar] Ingen kalibrering än — kräver avslutade "Jag är inne"-sessioner.'); return []; }
      console.table(_calibration);
      return _calibration;
    }

    // Fix 4 — loadReports alltid, oavsett karta
    console.log('[QueueBar] Startar initial datainläsning');
    loadReports().then(loadHistoricalPatterns).then(loadHistoricalRates);
    setInterval(loadHistoricalRates, 30 * 60 * 1000);
    subscribeToReports();
    if (supabase) {
      setInterval(loadReports, 30000);
    } else {
      showConnectionBanner();
    }

    // ── Favoriter ────────────────────────────────────────────────────────────
    async function toggleFavorite(event, venueId) {
      event.stopPropagation();
      var btn = event.currentTarget;
      btn.style.animation = 'none';
      setTimeout(function() { btn.style.animation = 'heartBounce 0.4s ease'; }, 10);
      var idx = favorites.indexOf(venueId);
      if (idx > -1) {
        favorites.splice(idx, 1);
        if (supabase) await supabase.from('favorites').delete().eq('venue_id', venueId).eq('user_id', getUserId());
      } else {
        favorites.push(venueId);
        if (supabase) await supabase.from('favorites').insert({ venue_id: venueId, user_id: getUserId() });
      }
      localStorage.setItem('qb_favorites', JSON.stringify(favorites));
      showToast(favorites.includes(venueId) ? 'Sparad som favorit' : 'Borttagen från favoriter');
      renderHomeVenues();
      if (typeof renderExploreVenues === 'function') renderExploreVenues();
    }

    // ── Consent ──────────────────────────────────────────────────────────────
    function checkConsent() {
      if (!localStorage.getItem('qb_consent')) {
        document.getElementById('consent-modal').style.display = 'flex';
      } else if (!localStorage.getItem('qb_onboarding_done')) {
        showOnboarding();
      }
    }
    function acceptConsent() {
      localStorage.setItem('qb_consent', 'true');
      document.getElementById('consent-modal').style.display = 'none';
      showOnboarding();
    }
    function declineConsent() {
      localStorage.setItem('qb_consent', 'declined');
      document.getElementById('consent-modal').style.display = 'none';
    }

    // ── Onboarding ───────────────────────────────────────────────────────────
    var OB = [
      {
        screen: 'home',
        title: 'Se läget, välj stället',
        subtitle: 'Varje prick är en krog — just nu',
        pos: { bottom: 'calc(72px + env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)' },
        arrow: 'arr-u', arrowX: '50%'
      },
      {
        screen: 'explore',
        title: 'Välj rätt ställe',
        subtitle: 'Aldrig chansa med kön igen',
        pos: { top: '24%', right: '8px' },
        arrow: 'arr-l', arrowY: '22px'
      },
      {
        screen: 'live',
        title: 'Direkt från kön',
        subtitle: 'Från de som är ute just nu',
        pos: { bottom: 'calc(72px + env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)' },
        arrow: 'arr-d', arrowX: '50%'
      },
      {
        screen: 'home',
        title: 'Står du i kö? Rapportera',
        subtitle: 'Fem sekunder — och alla ser läget',
        target: 'report-btn',
        pos: { bottom: 'calc(72px + env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)' },
        arrow: 'arr-d', arrowX: '50%'
      }
    ];
    var obStep = 0;

    function obGetTarget(screen, s) {
      if (s && s.target === 'report-btn') {
        return document.querySelector('.tab--report .tab-report-disc') || document.querySelector('.tab--report');
      }
      if (screen === 'explore') {
        return document.querySelector('#explore-list .erow:not(.erow--empty)') ||
               document.querySelector('#explore-list .erow');
      } else if (screen === 'live') {
        return document.querySelector('#live-feed > *');
      } else if (screen === 'profile') {
        return document.querySelector('#screen-profile .screen-head');
      }
      return null;
    }

    function obPlaceSpotRing(el) {
      var spot = document.getElementById('ob-spotlight');
      if (!spot) return;
      var pad = 8;
      var r = el.getBoundingClientRect();
      spot.style.left = (r.left - pad) + 'px';
      spot.style.top = (r.top - pad) + 'px';
      spot.style.width = (r.width + pad * 2) + 'px';
      spot.style.height = (r.height + pad * 2) + 'px';
      spot.style.display = 'block';
    }

    function obApplyWidgetSpot(dim, spot, bubble, target, ar, BW, EDGE) {
      var tr = target.getBoundingClientRect();
      if (tr.width === 0) return;
      var PAD = 12;
      var GAP = 14;
      var navH = 80;

      // Rectangular hole in the dim overlay at the target widget
      dim.classList.add('dim-rect');
      dim.style.setProperty('--hx', (tr.left - PAD) + 'px');
      dim.style.setProperty('--hy', (tr.top - PAD) + 'px');
      dim.style.setProperty('--hw', (tr.width + PAD * 2) + 'px');
      dim.style.setProperty('--hh', (tr.height + PAD * 2) + 'px');

      // Spotlight ring on the target widget
      obPlaceSpotRing(target);

      // Bubble centered below (or above if near bottom)
      var bLeft = Math.max(ar.left + EDGE, Math.min(ar.right - BW - EDGE, tr.left + tr.width / 2 - BW / 2));
      var ax = Math.max(14, Math.min(BW - 14, tr.left + tr.width / 2 - bLeft));
      bubble.style.left = bLeft + 'px';
      bubble.style.setProperty('--ax', ax + 'px');

      if ((tr.bottom + GAP + 130) < (ar.bottom - navH)) {
        bubble.classList.add('arr-u');
        bubble.style.top = (tr.bottom + GAP) + 'px';
      } else {
        bubble.classList.add('arr-d');
        bubble.style.top = (tr.top - GAP - 120) + 'px';
        setTimeout(function() {
          var bh = bubble.getBoundingClientRect().height;
          if (bh > 0) bubble.style.top = (tr.top - GAP - bh) + 'px';
        }, 30);
      }
    }

    function obSetupStep(s) {
      var bubble = document.getElementById('ob-bubble');
      var dim = document.getElementById('ob-dim');
      var spot = document.getElementById('ob-spotlight');
      var app = document.getElementById('app');
      var BW = 196;
      var EDGE = 14;

      // Reset
      bubble.style.top = ''; bubble.style.bottom = '';
      bubble.style.left = ''; bubble.style.right = '';
      bubble.style.transform = '';
      bubble.classList.remove('arr-d', 'arr-u', 'arr-l', 'arr-r');
      bubble.style.removeProperty('--ax');
      bubble.style.removeProperty('--ay');
      dim.classList.remove('dim-circle', 'dim-rect');
      dim.style.removeProperty('--sx'); dim.style.removeProperty('--sy'); dim.style.removeProperty('--sr');
      dim.style.removeProperty('--hx'); dim.style.removeProperty('--hy'); dim.style.removeProperty('--hw'); dim.style.removeProperty('--hh');
      if (spot) spot.style.display = 'none';

      var ar = app ? app.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };

      if (s.screen === 'home' && !s.target && map && typeof map.project === 'function') {
        var venue = VENUES.find(function(v) { return v.id === 'spy-bar'; });
        if (venue) {
          var px = map.project([venue.lng, venue.lat]);
          var cr = map.getContainer().getBoundingClientRect();
          var x = Math.round(cr.left + px.x);
          var y = Math.round(cr.top + px.y);
          if (px.x >= -20 && px.x <= cr.width + 20 && px.y >= -20 && px.y <= cr.height + 20) {
            dim.classList.add('dim-circle');
            dim.style.setProperty('--sx', x + 'px');
            dim.style.setProperty('--sy', y + 'px');
            dim.style.setProperty('--sr', '22px');
            var bLeft = Math.max(ar.left + EDGE, Math.min(ar.right - BW - EDGE, x - BW / 2));
            var ax = Math.max(14, Math.min(BW - 14, x - bLeft));
            bubble.style.left = bLeft + 'px';
            bubble.style.setProperty('--ax', ax + 'px');
            if (y > (ar.top + ar.height * 0.38)) {
              bubble.classList.add('arr-d');
              bubble.style.top = (y - 20 - 100) + 'px';
              setTimeout(function() {
                var bh = bubble.getBoundingClientRect().height;
                if (bh > 0) bubble.style.top = (y - 20 - bh) + 'px';
                obPlaceSpotRing(bubble);
              }, 30);
            } else {
              bubble.classList.add('arr-u');
              bubble.style.top = (y + 20) + 'px';
              obPlaceSpotRing(bubble);
            }
            return;
          }
        }
      }

      // Steps 2-4: spotlight the target widget, bubble adjacent to it
      var _dim = dim; var _spot = spot; var _bubble = bubble; var _ar = ar;
      setTimeout(function() {
        var target = obGetTarget(s.screen, s);
        if (target) {
          obApplyWidgetSpot(_dim, _spot, _bubble, target, _ar, BW, EDGE);
        }
      }, 80);
    }

    function showOnboarding() {
      var overlay = document.getElementById('onboarding-overlay');
      if (!overlay) return;
      obStep = 0;
      obRenderScreen();
      obRenderContent();
      overlay.classList.add('active');
      obSetupStep(OB[obStep]);
      setTimeout(function() {
        var bubble = document.getElementById('ob-bubble');
        bubble.classList.remove('ob-hiding');
        bubble.classList.add('ob-visible');
      }, 60);
    }

    function obRenderScreen() {
      var s = OB[obStep];
      document.querySelectorAll('.screen').forEach(function(el) {
        el.classList.toggle('active', el.id === 'screen-' + s.screen);
      });
      if (s.screen === 'home' && map) setTimeout(function() { map.resize(); }, 50);
    }

    function obRenderContent() {
      var s = OB[obStep];
      document.getElementById('ob-counter').textContent = '0' + (obStep + 1) + ' — 0' + OB.length;
      document.getElementById('ob-title').textContent = s.title;
      document.getElementById('ob-subtitle').textContent = s.subtitle;
      document.getElementById('ob-next').textContent = obStep === OB.length - 1 ? 'Kom igång' : 'Nästa →';
    }

    function obNext() {
      if (obStep < OB.length - 1) {
        var bubble = document.getElementById('ob-bubble');
        bubble.classList.remove('ob-visible');
        bubble.classList.add('ob-hiding');
        setTimeout(function() {
          obStep++;
          obRenderScreen();
          obRenderContent();
          obSetupStep(OB[obStep]);
          bubble.classList.remove('ob-hiding');
          bubble.classList.add('ob-visible');
        }, 180);
      } else {
        obSkip();
      }
    }

    function obSkip() {
      localStorage.setItem('qb_onboarding_done', 'true');
      var overlay = document.getElementById('onboarding-overlay');
      if (!overlay) return;
      var bubble = document.getElementById('ob-bubble');
      bubble.classList.remove('ob-visible');
      bubble.classList.add('ob-hiding');
      setTimeout(function() {
        overlay.style.transition = 'opacity 200ms ease';
        overlay.style.opacity = '0';
        setTimeout(function() {
          overlay.classList.remove('active');
          overlay.style.opacity = '';
          overlay.style.transition = '';
          bubble.classList.remove('ob-hiding', 'ob-visible');
          var dim = document.getElementById('ob-dim');
          dim.classList.remove('dim-circle', 'dim-rect');
          dim.style.removeProperty('--sx'); dim.style.removeProperty('--sy'); dim.style.removeProperty('--sr');
          dim.style.removeProperty('--hx'); dim.style.removeProperty('--hy'); dim.style.removeProperty('--hw'); dim.style.removeProperty('--hh');
          var spot = document.getElementById('ob-spotlight');
          if (spot) spot.style.display = 'none';
          showScreen('home');
        }, 210);
      }, 160);
    }

    // ── Dataradering ─────────────────────────────────────────────────────────
    async function deleteAllUserData() {
      if (!supabase) { localStorage.clear(); location.reload(); return; }
      var userId = getUserId();
      await Promise.all([
        supabase.from('reports').delete().eq('user_id', userId),
        supabase.from('favorites').delete().eq('user_id', userId),
        supabase.from('user_profiles').delete().eq('user_id', userId)
      ]);
      localStorage.clear();
      location.reload();
    }

    // ── Gemensam fuzzy-sökning ───────────────────────────────────────────────
    // Returns {v, s} pairs sorted by relevance score (highest first).
    // Use venueSearch() for sorted results; venueScore() for the raw score.
    //
    // Score tiers (length-gated to avoid single-char flooding):
    //   100 exact name match
    //    90 name starts with query
    //    85 compact match ("spybar" → "Spy Bar")          requires len ≥ 2
    //    70 any word in name starts with query
    //    60 compact contains query                         requires len ≥ 3
    //    50 name contains query as substring               requires len ≥ 2
    //    40 area name starts with query                    requires len ≥ 2
    //    30 area contains query                            requires len ≥ 3
    //    20 address contains query                         requires len ≥ 3
    //    10 fuzzy char-sequence in compact name            requires len ≥ 3
    //    -1 no match → excluded

    function _searchNorm(s) {
      return s.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, ' ').trim();
    }
    function _searchCompact(s) { return _searchNorm(s).replace(/\s/g, ''); }

    function venueScore(query, v) {
      var q  = _searchNorm(query);
      var qc = _searchCompact(query);
      var ql = qc.length;

      var name  = _searchNorm(v.name);
      var namec = _searchCompact(v.name);
      var area  = _searchNorm(v.area);
      var addr  = _searchNorm(v.address);

      if (name === q)              return 100;
      if (name.startsWith(q))     return 90;

      var words = name.split(' ');
      if (words.some(function(w) { return w.startsWith(q); })) return 70;

      if (ql >= 2 && namec.startsWith(qc))  return 85;
      if (ql >= 3 && namec.includes(qc))    return 60;
      if (ql >= 2 && name.includes(q))      return 50;
      if (ql >= 2 && area.startsWith(q))    return 40;
      if (ql >= 3 && area.includes(q))      return 30;
      if (ql >= 3 && addr.includes(q))      return 20;

      // Fuzzy: every char in query appears in order in compact name (3+ chars only)
      if (ql >= 3) {
        var ni = 0;
        for (var ci = 0; ci < qc.length; ci++) {
          ni = namec.indexOf(qc[ci], ni);
          if (ni === -1) return -1;
          ni++;
        }
        return 10;
      }
      return -1;
    }

    function venueSearch(query, venues) {
      if (!query) return venues.slice();
      return venues
        .map(function(v) { return { v: v, s: venueScore(query, v) }; })
        .filter(function(x) { return x.s >= 0; })
        .sort(function(a, b) { return b.s - a.s; })
        .map(function(x) { return x.v; });
    }

    // ── Utforska ─────────────────────────────────────────────────────────────
    var _exploreFilter = 'all'; // 'all' | 'free' | 'short' | 'long'
    var exploreFilter = 'all'; // legacy alias kept for safety
    var exploreDebounceTimer = null;

    // Sticky header shadow on scroll
    (function() {
      var wrap = document.getElementById('explore-list-wrap');
      var sticky = document.getElementById('explore-sticky');
      if (wrap && sticky) {
        wrap.addEventListener('scroll', function() {
          sticky.classList.toggle('scrolled', wrap.scrollTop > 4);
        });
      }
    })();

    function setFilter(f, btn) {
      // Legacy — kept for any external calls
      setExploreFilter(f);
    }

    function venueTypeLabel(type) {
      if (!type) return '';
      var t = type.toLowerCase();
      if (t === 'bar') return 'Bar';
      if (t === 'club' || t === 'nightclub' || t === 'klubb') return 'Klubb';
      return type.charAt(0).toUpperCase() + type.slice(1);
    }

    function setExploreFilter(f) {
      _exploreFilter = f;
      exploreFilter = f; // keep legacy alias in sync
      document.querySelectorAll('.fbtn[data-filter]').forEach(function(b) {
        b.classList.toggle('active', b.dataset.filter === f);
      });
      renderExploreVenues();
    }

    function debouncedFilterExplore() {
      // 28 venues — fuzzy sort is synchronous and fast enough to run immediately
      clearTimeout(exploreDebounceTimer);
      exploreDebounceTimer = setTimeout(renderExploreVenues, 60);
    }

    var STATUS_Y = { none: 0, free: 0, short: 1, medium: 2, long: 2 };

    function renderSparkline(venueReports, statusColor) {
      if (!venueReports || venueReports.length < 2) {
        return '<svg width="40" height="14" viewBox="0 0 40 14" fill="none" xmlns="http://www.w3.org/2000/svg">' +
          '<polyline points="0,7 40,7" stroke="#E5E7EB" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>';
      }
      var pts = venueReports.slice(-5).sort(function(a, b) { return new Date(a.created_at) - new Date(b.created_at); });
      var yVals = pts.map(function(r) { return STATUS_Y[r.queue_status] !== undefined ? STATUS_Y[r.queue_status] : 1; });
      var n = yVals.length;
      var coords = yVals.map(function(y, i) {
        var x = n === 1 ? 20 : (i / (n - 1)) * 40;
        var svgY = 2 + (y / 2) * 10;
        return x.toFixed(1) + ',' + svgY.toFixed(1);
      }).join(' ');
      return '<svg width="40" height="14" viewBox="0 0 40 14" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<polyline points="' + coords + '" stroke="' + statusColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
    }

    function formatAbsTime(dateStr) {
      var d = new Date(dateStr);
      return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    }

    var _exsumInterval = null;

    // Status bara om ett ställe har en kö-rapport från de senaste 45 min (samma gräns som "inaktuell" i listan).
    function venueFreshStatus(venueId) {
      var cutoff = Date.now() - 45 * 60 * 1000;
      var fresh = allReports.some(function(r) {
        return r.venue_id === venueId && isQueueReport(r) && new Date(r.created_at).getTime() > cutoff;
      });
      return fresh ? computeStatus(venueId, allReports) : 'unknown';
    }

    function computeExploreSummary() {
      var fresh = VENUES.filter(function(v) { return venueFreshStatus(v.id) !== 'unknown'; }).length;
      var lastTs = null;
      allReports.forEach(function(r) {
        if (!isQueueReport(r)) return;
        var t = new Date(r.created_at).getTime();
        if (!lastTs || t > lastTs) lastTs = t;
      });
      return { fresh: fresh, venueTotal: VENUES.length, lastTs: lastTs, total: allReports.length };
    }

    function exsumTimeSince(ms) {
      if (!ms) return null;
      var mins = Math.round((Date.now() - ms) / 60000);
      if (mins < 1) return 'nyss';
      return mins + ' min sedan';
    }

    // ── Färskhetsrad ──────────────────────────────────────────────────────────
    // Ersätter den gamla "Stockholm just nu"-widgeten: antalen per status finns redan i filterchipsen,
    // så här visas bara det chipsen inte säger — hur färsk datan är.
    // `state` skickas in i stället för att läsas globalt, så funktionen är ren och testbar.
    // Den måste kunna skilja tre lägen åt: vi nådde inte servern, Stockholm är tyst,
    // eller här är datan. Slås de två första samman blir ett serverfel en lugn kväll.
    function exsumText(d, state) {
      if (state === 'error') {
        return d.total
          ? 'Ingen kontakt med servern · siffrorna kan vara gamla'
          : 'Ingen kontakt med servern';
      }
      if (state === 'loading') return 'Hämtar rapporter…';
      if (d.total === 0) return 'Inga rapporter än — bli först att rapportera';
      var since = exsumTimeSince(d.lastTs);
      return d.fresh + ' av ' + d.venueTotal + ' ställen har färsk rapport' + (since ? ' · senast ' + since : '');
    }

    function renderExploreSummary() {
      var el = document.getElementById('explore-summary');
      if (!el) return;
      el.style.display = 'block';
      // Felvarianten markeras med en prick via ::before, inte ett barnelement — intervallet
      // nedan sätter textContent, vilket hade raderat ett <span>.
      var cls = 'exsum-line' + (_loadState === 'error' ? ' exsum-line--error' : '');
      el.innerHTML = '<div class="' + cls + '" id="exsum-line">' + exsumText(computeExploreSummary(), _loadState) + '</div>';

      // Åldras även utan ny data
      clearInterval(_exsumInterval);
      _exsumInterval = setInterval(function() {
        var line = document.getElementById('exsum-line');
        if (!line) { clearInterval(_exsumInterval); return; }
        line.className = 'exsum-line' + (_loadState === 'error' ? ' exsum-line--error' : '');
        line.textContent = exsumText(computeExploreSummary(), _loadState);
      }, 30000);
    }

    function renderExploreVenueRow(venue, index, bestData) {
      var isBest = !!bestData;
      var bastReason = '';
      if (bestData) {
        if (bestData.status === 'free') bastReason = 'Fri ingång';
        else if (bestData.status === 'short') bastReason = 'Kortast kö';
      }
      var now = new Date();
      var venueReports = allReports.filter(function(r) { return r.venue_id === venue.id && isQueueReport(r); })
        .sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      var latestReport = venueReports[0] || null;
      var status = computeStatus(venue.id, allReports);
      var est = estimateWait(venue.id, allReports);
      var cls = getStatusClass(status);
      var color = STATUS_COLORS[cls] || getStatusColor('unknown');
      var hasData = venueReports.length > 0;
      var minsOld = hasData && latestReport ? (now - new Date(latestReport.created_at)) / 60000 : Infinity;
      var isAging = hasData && minsOld >= 15 && minsOld < 45;
      var isStale = hasData && minsOld >= 45;
      var isEmpty = !hasData || isStale;

      // Visual level (4 tiers)
      var level; // 'long' | 'medium' | 'free' | 'empty'
      if (!hasData) {
        level = 'empty';
      } else if (status === 'long') {
        level = 'long';
      } else if (status === 'free' || status === 'none') {
        level = 'free';
      } else {
        level = 'medium'; // short or medium
      }

      var levelBg = { long: 'rgba(255,77,94,0.06)', medium: 'rgba(255,138,61,0.04)', free: 'rgba(52,224,127,0.05)', empty: 'rgba(255,255,255,0.02)' }[level];
      var stateClass = isEmpty ? ' erow--empty' : (isAging ? ' erow--stale' : '');
      var agingStyle = '';
      var barColor = isEmpty ? 'rgba(255,255,255,0.08)' : color;

      // Hero number
      var heroText, heroColor;
      if (!hasData) {
        heroText = '–'; heroColor = '#85858A';
      } else {
        heroText = (est ? est.ahead === 0 : (status === 'free' || status === 'none')) ? 'Fri' : venueWaitText(venue.id);
        // Nivån "medium" täcker kort+medel för bakgrunden — siffran får exakt statusfärg
        var heroColors = { free: '#34E07F', medium: getStatusColor(status), long: '#FF4D5E' };
        heroColor = heroColors[level] || '#85858A';
      }

      // Freshness check for pulse dot: only show if long AND report < 20 min old
      var minutesSince = latestReport ? (Date.now() - new Date(latestReport.created_at)) / 60000 : Infinity;
      var showPulseDot = level === 'long' && minutesSince < 20;
      var pulseHtml = showPulseDot ? '<span class="erow-pulse-dot"></span>' : '';

      // Trend (replaces badge — new information, not redundant with hero)
      var trendHtml = '';
      var STATUS_RANK = { free: 0, none: 0, short: 1, medium: 2, long: 3 };
      if (hasData && venueReports.length >= 2) {
        var r1 = venueReports[0].queue_status; // newest
        var r2 = venueReports[1].queue_status; // previous
        var rank1 = STATUS_RANK[r1] !== undefined ? STATUS_RANK[r1] : 1;
        var rank2 = STATUS_RANK[r2] !== undefined ? STATUS_RANK[r2] : 1;
        if (rank1 > rank2) {
          trendHtml = '<span class="erow-trend erow-trend--up">↑ Ökar</span>';
        } else if (rank1 < rank2) {
          trendHtml = '<span class="erow-trend erow-trend--down">↓ Minskar</span>';
        }
      }

      // Tertiary row: antal rapporter + ålder (ersätter konfidensstaplar, "pers bekräftade" och sparkline)
      var reportCount = venueReports.length;

      // Distance (if available)
      var typeLabel = venueTypeLabel(venue.type);
      var metaText = venue.area + (typeLabel ? ' · ' + typeLabel : '');
      if (window._userPos && venue.lat && venue.lng) {
        var dlat = (venue.lat - window._userPos.lat) * 111000;
        var dlng = (venue.lng - window._userPos.lng) * 111000 * Math.cos(venue.lat * Math.PI / 180);
        var dist = Math.round(Math.sqrt(dlat * dlat + dlng * dlng) / 100) * 100;
        metaText = venue.area + (typeLabel ? ' · ' + typeLabel : '') + ' · ' + (dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : dist + 'm');
      }

      var delay = _listIntro ? (index * 75 + 340) + 'ms' : '0ms';
      var levelClass = level === 'long' ? ' erow--long' : level === 'medium' ? ' erow--medium' : level === 'free' ? ' erow--free' : '';

      // Planning mode
      var planIdx = _planVenues.indexOf(venue.id);
      var planBadge = (_planningMode && planIdx >= 0)
        ? '<div class="plan-badge" style="margin-right:8px">' + (planIdx + 1) + '</div>'
        : (_planningMode ? '<div class="plan-badge plan-badge--empty" style="margin-right:8px"></div>' : '');
      var rowOnClick = _planningMode
        ? 'togglePlanVenue(\'' + venue.id + '\')'
        : 'openVenueCard(getVenueById(\'' + venue.id + '\'),\'explore\')';

      return '<div class="erow' + stateClass + levelClass + (isBest ? ' erow--best' : '') + (_listIntro ? ' erow--intro' : '') + '" data-venue="' + venue.id + '" style="--row-delay:' + delay + ';background-color:' + levelBg + ';" onclick="' + rowOnClick + '">' +
        '<div class="erow-left-bar" style="background:' + barColor + '"></div>' +
        '<div class="erow-inner">' +
          planBadge +
          '<div class="erow-body">' +
            (isBest ? '<div class="bast-chip"><span class="bast-chip-dot"></span>Bäst nu' + (bastReason ? ' · ' + bastReason : '') + '</div>' : '') +
            '<div class="erow-name-row">' +
              pulseHtml +
              '<div class="erow-name">' + venue.name + '</div>' +
              (isFavorite(venue.id) ? '<svg class="erow-fav" viewBox="0 0 24 24" aria-label="Favorit"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' : '') +
              (isWatching(venue.id) ? '<svg class="erow-watch" viewBox="0 0 24 24" aria-label="Bevakas"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' : '') +
            '</div>' +
            '<div class="erow-meta">' + metaText + '</div>' +
            (function() {
              var pat = _historicalPatterns[venue.id];
              var patLabels = { long: 'Brukar vara lång kö nu', medium: 'Brukar vara medel kö nu', short: 'Brukar vara kort kö nu', free: 'Brukar vara fri ingång nu' };
              // Historiskt mönster visas bara när färsk data saknas — annars konkurrerar det med verkligheten
              var patHtml = (isEmpty && pat && patLabels[pat.level]) ? '<span class="hist-chip hist-chip--' + pat.level + '">' + patLabels[pat.level] + '</span>' : '';
              var recentWithComment = venueReports.filter(function(r) {
                return r.comment && (Date.now() - new Date(r.created_at).getTime()) < 30 * 60 * 1000;
              }).sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); })[0];
              var commentHtml = recentWithComment ? '<div class="erow-comment">"' + escapeHtml(recentWithComment.comment) + '"</div>' : '';
              var closingSoonHtml = '';
              if (venue.closing) {
                var cParts = venue.closing.split(':');
                var cH = parseInt(cParts[0]), cM = parseInt(cParts[1] || 0);
                var cTotal = cH < 6 ? (cH + 24) * 60 + cM : cH * 60 + cM;
                var nowD = new Date(); var nowAdj = nowD.getHours() * 60 + nowD.getMinutes();
                if (nowAdj < 12 * 60) nowAdj += 1440;
                var minsLeft = cTotal - nowAdj;
                if (minsLeft > 0 && minsLeft <= 90) {
                  closingSoonHtml = '<span class="erow-tertiary-sep">·</span><span class="erow-closing">Stänger ' + venue.closing + '</span>';
                }
              }
              var estHtml = est && est.ahead && !est.full && est.source !== 'live' ? '<span class="erow-tertiary-sep">·</span><span class="erow-est-label">≈ uppskattning</span>' : '';
              var tertiaryHtml = (hasData && !isStale)
                ? '<div class="erow-tertiary">' +
                    '<span>' + reportCount + ' rapport' + (reportCount === 1 ? '' : 'er') + '</span>' +
                    '<span class="erow-tertiary-sep">·</span>' +
                    '<span' + (isAging ? ' class="erow-stale-label"' : '') + '>' + timeAgo(latestReport.created_at) + (isAging ? ' · äldre' : '') + '</span>' +
                    estHtml +
                    closingSoonHtml +
                  '</div>'
                : '<div class="erow-tertiary">' +
                    (patHtml || '<span class="erow-empty-cta">' + (isStale ? 'Ingen färsk rapport' : 'Ingen data i kväll') + ' — rapportera</span>') +
                    closingSoonHtml +
                  '</div>';
              return tertiaryHtml + commentHtml;
            })() +
          '</div>' +
          '<div class="erow-right">' +
            '<span class="erow-hero' + (_listIntro ? ' erow-hero--animate' : '') + '" style="color:' + heroColor + '">' + waitRollHtml('list', venue.id, heroText, heroColor) + '</span>' +
            (isStale ? '' : trendHtml) +
          '</div>' +
        '</div>' +
        '</div>';
    }

    function goToVenueOnMap(venue) {
      if (!venue) return;
      showScreen('home');
      if (map && venue.lat && venue.lng) {
        setTimeout(function() {
          map.flyTo({ center: [venue.lng, venue.lat], zoom: 16, duration: 800 });
        }, 80);
      }
      setTimeout(function() { openVenueCard(venue, 'explore'); }, 200);
    }

    // ── Kvällsplanering ──────────────────────────────────────────────────────────

    function togglePlanningMode() {
      _planningMode = !_planningMode;
      _planVenues = [];
      renderExploreVenues();
      // Update plan chip label
      var planChip = document.querySelector('.fbtn--plan');
      if (planChip) planChip.textContent = _planningMode ? 'Avbryt plan' : 'Planera kväll';
      // Legacy btn (no longer in DOM, guard kept)
      var btn = document.getElementById('plan-mode-btn');
      if (btn) btn.textContent = _planningMode ? 'Avbryt' : 'Planera kväll';
      var bar = document.getElementById('plan-bar');
      if (bar) bar.style.display = _planningMode ? 'flex' : 'none';
      var createBtn = document.getElementById('plan-create-btn');
      if (createBtn) { createBtn.disabled = true; createBtn.textContent = 'Välj 2–4 ställen'; }
    }

    function togglePlanVenue(venueId) {
      if (!_planningMode) return;
      var idx = _planVenues.indexOf(venueId);
      if (idx >= 0) {
        _planVenues.splice(idx, 1);
      } else if (_planVenues.length < 4) {
        _planVenues.push(venueId);
      }
      renderExploreVenues();
      var bar = document.getElementById('plan-bar');
      if (bar) {
        var count = _planVenues.length;
        var createBtn = document.getElementById('plan-create-btn');
        if (createBtn) {
          createBtn.disabled = count < 2;
          createBtn.textContent = count >= 2 ? 'Skapa plan (' + count + ')' : 'Välj ' + (2 - count) + ' till';
        }
      }
    }

    function computeEveningPlan() {
      if (_planVenues.length < 2) return;
      var STATUS_SCORE = { free: 0, short: 1, medium: 2, long: 3, none: 1 };

      var scored = _planVenues.map(function(vid) {
        var venue = getVenueById(vid);
        var status = computeStatus(vid, allReports);
        var statusScore = STATUS_SCORE[status] !== undefined ? STATUS_SCORE[status] : 1;
        var closingMins = 999;
        if (venue && venue.closing) {
          var parts = venue.closing.split(':');
          var h = parseInt(parts[0]), m = parseInt(parts[1] || 0);
          closingMins = h < 6 ? (h + 24) * 60 + m : h * 60 + m;
        }
        var distScore = 0;
        if (window._userPos && venue) {
          var dlat = venue.lat - window._userPos.lat;
          var dlng = venue.lng - window._userPos.lng;
          distScore = Math.sqrt(dlat * dlat + dlng * dlng) * 100;
        }
        return { id: vid, venue: venue, status: status, statusScore: statusScore, closingMins: closingMins, distScore: distScore };
      });

      scored.sort(function(a, b) {
        if (a.closingMins !== b.closingMins) return a.closingMins - b.closingMins;
        if (a.statusScore !== b.statusScore) return a.statusScore - b.statusScore;
        return a.distScore - b.distScore;
      });

      showEveningPlan(scored);
    }

    function showEveningPlan(scored) {
      var items = scored.map(function(s, i) {
        var label = venueWaitText(s.id);
        var color = label ? getStatusColor(s.status) : 'var(--text-muted)';
        var closing = s.venue && s.venue.closing ? 'Stänger ' + s.venue.closing : '';
        var area = s.venue ? s.venue.area : '';
        return '<div class="plan-item">'
          + '<div class="plan-item-num">' + (i + 1) + '</div>'
          + '<div class="plan-item-body">'
          + '<div class="plan-item-name">' + (s.venue ? s.venue.name : s.id) + '</div>'
          + '<div class="plan-item-meta">' + [area, closing].filter(Boolean).join(' · ') + '</div>'
          + '</div>'
          + '<div class="plan-item-wait" style="color:' + color + '">' + (label || 'Ingen data') + '</div>'
          + '</div>';
      }).join('');

      var modal = document.createElement('div');
      modal.id = 'plan-modal';
      modal.innerHTML = '<div class="plan-modal-dim" onclick="closePlanModal()"></div>'
        + '<div class="plan-modal-sheet">'
        + '<div class="plan-modal-eyebrow">Din kvällsplan</div>'
        + '<div class="plan-modal-sub">Ordning efter stängningstid, sedan kö just nu</div>'
        + items
        + '<button class="plan-modal-close" onclick="closePlanModal()">Klar</button>'
        + '</div>';
      document.body.appendChild(modal);

      _planningMode = false;
      _planVenues = [];
      renderExploreVenues();
      var planChip = document.querySelector('.fbtn--plan');
      if (planChip) planChip.textContent = 'Planera kväll';
      var bar = document.getElementById('plan-bar');
      if (bar) bar.style.display = 'none';
    }

    function closePlanModal() {
      var m = document.getElementById('plan-modal');
      if (m) m.remove();
    }

    function computeBestNow() {
      var now = new Date();
      var nowH = now.getHours() + now.getMinutes() / 60;
      var freshCutoff = Date.now() - 30 * 60 * 1000;

      function distKm(lat1, lng1, lat2, lng2) {
        var R = 6371;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLng = (lng2 - lng1) * Math.PI / 180;
        var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
                Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
                Math.sin(dLng/2)*Math.sin(dLng/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      }

      function closingHour(str) {
        var parts = str.split(':');
        var h = parseInt(parts[0]);
        return h < 12 ? h + 24 : h;
      }

      var candidates = VENUES.filter(function(v) {
        var status = computeStatus(v.id, allReports);
        if (status !== 'free' && status !== 'short') return false;
        var fresh = allReports.some(function(r) {
          return r.venue_id === v.id && new Date(r.created_at).getTime() > freshCutoff;
        });
        if (!fresh) return false;
        var cl = closingHour(v.closing);
        var nowAdj = nowH < 12 ? nowH + 24 : nowH;
        if (cl - nowAdj < 0.75) return false;
        return true;
      });

      if (!candidates.length) return null;

      candidates = candidates.map(function(v) {
        var status = computeStatus(v.id, allReports);
        var score = status === 'free' ? 2 : 1;
        var dist = null;
        if (window._userPos) {
          dist = distKm(window._userPos.lat, window._userPos.lng, v.lat, v.lng);
          score -= dist * 0.1;
        }
        var reports = allReports.filter(function(r) { return r.venue_id === v.id; });
        var latest = reports.reduce(function(max, r) { return Math.max(max, new Date(r.created_at).getTime()); }, 0);
        var minsAgo = (Date.now() - latest) / 60000;
        score += Math.max(0, (30 - minsAgo) / 30) * 0.5;
        return { venue: v, status: status, score: score, dist: dist };
      });

      candidates.sort(function(a, b) { return b.score - a.score; });
      return candidates[0] || null;
    }

    // Raderna glider in en gång — första gången listan visas med riktig data. All omritning efter det
    // (filter, sökning, ny rapport var 30:e sekund) byter innehåll utan att animera om, enligt /anti-ai-design.
    var _listIntro = true;

        function renderExploreVenues() {
      renderExploreSummary();
      var q = (document.getElementById('explore-search') || {}).value || '';
      q = q.toLowerCase();
      var el = document.getElementById('explore-list');
      if (!el) return;

      // Base list: fuzzy search, preserves relevance order when query present
      var list = q ? venueSearch(q, VENUES) : VENUES.slice();

      // Status-based filter (new chip logic)
      if (_exploreFilter === 'free') {
        list = list.filter(function(v) {
          var s = computeStatus(v.id, allReports);
          return s === 'free' || s === 'none';
        });
      } else if (_exploreFilter === 'short') {
        list = list.filter(function(v) {
          var s = computeStatus(v.id, allReports);
          return s === 'short' || s === 'medium';
        });
      } else if (_exploreFilter === 'long') {
        list = list.filter(function(v) {
          var s = computeStatus(v.id, allReports);
          return s === 'long';
        });
      } else if (_exploreFilter === 'bar') {
        list = list.filter(function(v) { return v.type === 'bar'; });
      } else if (_exploreFilter === 'klubb') {
        list = list.filter(function(v) { return v.type === 'klubb'; });
      }
      // 'all' — no additional filter

      // Filter context line
      var contextEl = document.getElementById('filter-context');
      if (_exploreFilter !== 'all') {
        var label = { free: 'venues med fri ingång just nu', short: 'venues med kort kö just nu', long: 'venues med lång kö just nu', bar: 'barer', klubb: 'klubbar' }[_exploreFilter] || '';
        if (contextEl) { contextEl.textContent = list.length + ' ' + label; contextEl.style.display = 'block'; }
      } else {
        if (contextEl) contextEl.style.display = 'none';
      }

      if (!list.length) {
        var rawQ = document.getElementById('explore-search') ? document.getElementById('explore-search').value : '';
        var filterLabels = { free: 'fri ingång', short: 'kort kö', long: 'lång kö', bar: 'typ bar', klubb: 'typ klubb' };
        var emptyTitle, emptySub;
        if (_exploreFilter !== 'all' && !rawQ) {
          emptyTitle = 'Inga ställen med ' + (filterLabels[_exploreFilter] || _exploreFilter) + ' just nu';
          emptySub = 'Färsk data saknas eller ingen matchar — kolla igen om en stund';
        } else {
          var term = rawQ ? '”' + escapeHtml(rawQ) + '”' : '';
          emptyTitle = 'Inga resultat' + (term ? ' för ' + term : '');
          emptySub = 'Prova ett annat namn eller område';
        }
        el.innerHTML = '<div class="explore-empty">' +
          '<div class="explore-empty-title">' + emptyTitle + '</div>' +
          '<div class="explore-empty-sub">' + emptySub + '</div>' +
          '</div>';
        updateFilterCounts();
        return;
      }

      // Sort strategy:
      //   No query  → urgency (long first) then recency; stale venues last
      //   Query set → relevance score first; within same score bucket: urgency then recency
      var URGENCY_RANK = { long: 3, medium: 2, short: 1, none: 0, free: 0, unknown: -1 };
      var activeQuery = (document.getElementById('explore-search') || {}).value || '';
      list = list.slice().sort(function(a, b) {
        var aReports = allReports.filter(function(r) { return r.venue_id === a.id; });
        var bReports = allReports.filter(function(r) { return r.venue_id === b.id; });
        var aLatest = aReports.length > 0 ? Math.max.apply(null, aReports.map(function(r) { return new Date(r.created_at).getTime(); })) : 0;
        var bLatest = bReports.length > 0 ? Math.max.apply(null, bReports.map(function(r) { return new Date(r.created_at).getTime(); })) : 0;
        var now45 = Date.now() - 45 * 60 * 1000;
        var aFresh = aLatest > now45;
        var bFresh = bLatest > now45;

        // When searching: relevance score is primary sort key
        if (activeQuery.trim()) {
          var aScore = venueScore(activeQuery, a);
          var bScore = venueScore(activeQuery, b);
          if (bScore !== aScore) return bScore - aScore;
          // Tie-break within same score: fresh + urgency
          if (!aFresh && bFresh) return 1;
          if (aFresh && !bFresh) return -1;
          var aStatus = computeStatus(a.id, allReports);
          var bStatus = computeStatus(b.id, allReports);
          var aRank = URGENCY_RANK[aStatus] !== undefined ? URGENCY_RANK[aStatus] : -1;
          var bRank = URGENCY_RANK[bStatus] !== undefined ? URGENCY_RANK[bStatus] : -1;
          return bRank - aRank;
        }

        // No query: urgency sort, stale last
        if (!aFresh && bFresh) return 1;
        if (aFresh && !bFresh) return -1;
        if (!aFresh && !bFresh) return a.name.localeCompare(b.name, 'sv');
        var aStatus = computeStatus(a.id, allReports);
        var bStatus = computeStatus(b.id, allReports);
        var aRank = URGENCY_RANK[aStatus] !== undefined ? URGENCY_RANK[aStatus] : -1;
        var bRank = URGENCY_RANK[bStatus] !== undefined ? URGENCY_RANK[bStatus] : -1;
        if (bRank !== aRank) return bRank - aRank;
        return bLatest - aLatest;
      });

      // “Bäst just nu” — pin best venue at top when filter is 'all'
      var bestVenueId = null;
      if (_exploreFilter === 'all') {
        var best = computeBestNow();
        if (best) {
          bestVenueId = best.venue.id;
          // Move best venue to front of list
          list = list.filter(function(v) { return v.id !== bestVenueId; });
          list.unshift(best.venue);
        }
      }

      // Sektionsrubriker: de med färsk rapport först, resten (inga eller inaktuella rapporter) samlade sist.
      // Färskheten kommer från venueFreshStatus, så rubrikerna aldrig motsäger färskhetsraden.
      function hasFreshReport(v) { return venueFreshStatus(v.id) !== 'unknown'; }
      var freshList = [], staleList = [];
      list.forEach(function(v) { (hasFreshReport(v) ? freshList : staleList).push(v); });
      function rowsHtml(items) {
        return items.map(function(v) {
          return renderExploreVenueRow(v, list.indexOf(v), v.id === bestVenueId ? best : null);
        }).join('');
      }
      function sectionHtml(title, items) {
        return '<div class="list-section">' + title + '<span class="list-section-n">' + items.length + '</span></div>' +
          '<div class="venue-group">' + rowsHtml(items) + '</div>';
      }
      // Rubriker behövs bara när båda grupperna finns och listan inte är filtrerad eller sökt — annars är en rubrik brus.
      var showSections = freshList.length && staleList.length && _exploreFilter === 'all' && !activeQuery.trim();
      el.innerHTML = showSections
        ? sectionHtml('Färska rapporter', freshList) + sectionHtml('Utan färsk rapport', staleList)
        : '<div class="venue-group">' + rowsHtml(list) + '</div>';

      // Intro förbrukas när listan har ritats färdigt, alltså så fort laddningen inte längre pågår. Det gäller även en
      // lista utan data: raderna har då redan visat sig, och den första rapporten fyller en rad som redan står still.
      if (_listIntro && _loadState !== 'loading' && currentScreen === 'explore') _listIntro = false;

      updateFilterCounts();
    }

    function updateFilterCounts() {
      var counts = { all: 0, free: 0, short: 0, long: 0 };
      VENUES.forEach(function(v) {
        var s = computeStatus(v.id, allReports);
        counts.all++;
        if (s === 'free' || s === 'none') counts.free++;
        if (s === 'short' || s === 'medium') counts.short++;
        if (s === 'long') counts.long++;
      });
      var fcAll   = document.getElementById('fc-all');
      var fcFree  = document.getElementById('fc-free');
      var fcShort = document.getElementById('fc-short');
      var fcLong  = document.getElementById('fc-long');
      if (fcAll)   fcAll.textContent   = counts.all;
      if (fcFree)  fcFree.textContent  = counts.free  || '';
      if (fcShort) fcShort.textContent = counts.short || '';
      if (fcLong)  fcLong.textContent  = counts.long  || '';
    }

    renderExploreVenues();

    // ── Live-feed ─────────────────────────────────────────────────────────────
    var _liveExpanded = new Set();

    // Vilka rapporter som redan har visats i Live. Bara en rapport som inte finns här är "ny" och får glida in.
    // Första ritningen med data fyller bara minnet (annars skulle hela listan animeras vid sidladdning).
    var _liveSeen = new Set();
    var _liveSeenReady = false;
    function liveReportKey(r) { return r.id != null ? String(r.id) : r.venue_id + '|' + r.created_at; }

    function _liveRowHtml(r, isSub, olderCount) {
      var liveDescriptors = { none: 'Ingen kö', free: 'Ingen kö', short: 'Kort kö', medium: 'Medel kö', long: 'Lång kö' };
      var qs = r.queue_status;
      var descriptor = liveDescriptors[qs];
      if (!descriptor) return '';
      // Hjälten är det som faktiskt rapporterades — inte appens uppskattning.
      if (r.people_ahead != null) descriptor = r.people_ahead ? aheadBucket(r.people_ahead).label + ' före' : 'Ingen kö';
      var color = getStatusColor(qs);
      var d = new Date(r.created_at);
      var clock = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      if (isSub) {
        return '<div class="lv-old"><span class="lv-old-time">' + clock + '</span>' +
          '<span class="lv-old-val" style="color:' + color + '">' + descriptor + '</span>' +
          (r.comment ? '<span class="lv-old-note">"' + escapeHtml(r.comment) + '"</span>' : '') + '</div>';
      }
      var venue = getVenueById(r.venue_id);
      var name = venue ? venue.name : escapeHtml(r.venue_name || r.venue_id);
      var nowWait = venueWaitText(r.venue_id);
      var area = venue ? venue.area + ' · ' + venueTypeLabel(venue.type) : '';
      // Hjälten är rapporterat antal; "framför" som enhet. Ren text (t.ex. "Kort kö") får ingen enhet.
      var hasCount = r.people_ahead != null && r.people_ahead > 0;
      var heroText = hasCount ? aheadBucket(r.people_ahead).label : (r.people_ahead === 0 ? 'Ingen kö' : descriptor);
      var heroSmall = !hasCount ? ' style="color:' + color + ';font-size:18px;letter-spacing:-0.03em"' : ' style="color:' + color + '"';
      var subParts = [timeAgo(r.created_at)];
      if (nowWait) subParts.push('nu ' + nowWait);
      var olderBtn = '';
      if (olderCount) {
        var open = _liveExpanded.has(r.venue_id);
        olderBtn = '<button class="lv-more' + (open ? ' lv-more--open' : '') + '" aria-expanded="' + open + '" ' +
          'aria-label="' + (open ? 'Dölj tidigare rapporter' : olderCount + ' tidigare ' + (olderCount === 1 ? 'rapport' : 'rapporter')) + '" ' +
          'onclick="event.stopPropagation();toggleLiveVenue(\'' + r.venue_id + '\')">' +
          '<span>' + (open ? 'Dölj' : '+' + olderCount + ' tidigare') + '</span>' +
          '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></button>';
      }
      return '<div class="lv-row" role="button" tabindex="0" onclick="openVenueCard(\'' + r.venue_id + '\')">' +
        '<span class="lv-bar" style="background:' + color + '"></span>' +
        '<div class="lv-inner"><div class="lv-body">' +
          '<div class="lv-name">' + name + '</div>' +
          (area ? '<div class="lv-meta">' + area + '</div>' : '') +
          (r.comment ? '<div class="lv-comment">"' + escapeHtml(r.comment) + '"</div>' : '') +
          '<div class="lv-sub">' + subParts.join(' · ') + '</div>' +
        '</div>' +
        '<div class="lv-right"><span class="lv-hero"' + heroSmall + '>' + heroText + '</span>' +
          (hasCount ? '<span class="lv-unit">framför</span>' : '') + olderBtn + '</div></div></div>';
    }

    // Senaste "Jag är inne" — verklig väntetid från en kö-session, inte en uppskattning.
    function _liveEnteredHtml(venueId, cutoff) {
      var entered = allReports.filter(function(r) {
        return r.venue_id === venueId && r.report_type === 'entered' && r.queue_session && new Date(r.created_at).getTime() > cutoff;
      }).sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); })[0];
      if (!entered) return '';
      var start = allReports.filter(function(r) { return r.queue_session === entered.queue_session; })
        .reduce(function(min, r) { var t = new Date(r.created_at).getTime(); return t < min ? t : min; }, Infinity);
      var mins = Math.round((new Date(entered.created_at).getTime() - start) / 60000);
      if (!isFinite(mins) || mins < 1) return '';
      return '<div class="lv-entered"><span class="lv-check"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span>' +
        '<span>Inne efter <b>' + mins + ' min</b></span><small>uppmätt · ' + timeAgo(entered.created_at) + '</small></div>';
    }

    function toggleLiveVenue(venueId) {
      if (_liveExpanded.has(venueId)) { _liveExpanded.delete(venueId); } else { _liveExpanded.add(venueId); }
      renderLiveFeed();
    }

    function renderLiveFeed() {
      var el = document.getElementById('live-feed');
      if (!el) return;
      // Pricken på Live-fliken säger något bara om det finns en färsk rapport (< 10 min) — annars visas den inte.
      var navDot = document.querySelector('.live-dot');
      if (navDot) {
        var freshCut = Date.now() - 10 * 60 * 1000;
        var hasFresh = allReports.some(function(r) { return isQueueReport(r) && new Date(r.created_at).getTime() > freshCut; });
        navDot.classList.toggle('on', hasFresh);
      }
      var subText = document.getElementById('live-sub-text');
      if (!supabase) {
        if (subText) subText.textContent = 'Offline';
        el.innerHTML = '<div class="lv-empty"><svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a15 15 0 0 1 20 0"/><path d="M5 12.5a10.5 10.5 0 0 1 14 0"/><path d="M8.5 16a5.5 5.5 0 0 1 7 0"/><line x1="3" y1="3" x2="21" y2="21"/></svg>' +
          '<div class="lv-empty-title">Ingen anslutning</div><p class="lv-empty-sub">Livedata är inte tillgänglig just nu.</p>' +
          '<button class="empty-btn" onclick="retrySupabase()">Försök igen</button></div>';
        return;
      }
      var now = new Date();
      var cutoff = now - 45 * 60 * 1000;
      var recent = allReports.filter(function(r) { return isQueueReport(r) && new Date(r.created_at).getTime() > cutoff; });
      // Nådde vi inte servern vet vi ingenting om kvällen. Säg det, i stället för att
      // visa samma tomma läge som när Stockholm faktiskt är tyst.
      if (_loadState === 'error' && !recent.length) {
        if (subText) subText.textContent = 'Ingen kontakt';
        el.innerHTML = '<div class="lv-empty"><svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a15 15 0 0 1 20 0"/><path d="M5 12.5a10.5 10.5 0 0 1 14 0"/><path d="M8.5 16a5.5 5.5 0 0 1 7 0"/><line x1="3" y1="3" x2="21" y2="21"/></svg>' +
          '<div class="lv-empty-title">Ingen kontakt med servern</div><p class="lv-empty-sub">Vi vet inte hur köerna ser ut just nu.</p>' +
          '<button class="empty-btn" onclick="loadReports()">Försök igen</button></div>';
        return;
      }
      if (!recent.length) {
        if (subText) subText.textContent = 'Inga rapporter senaste 45 min';
        el.innerHTML = '<div class="lv-empty"><svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a15 15 0 0 1 20 0"/><path d="M5 12.5a10.5 10.5 0 0 1 14 0"/><path d="M8.5 16a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/></svg>' +
          '<div class="lv-empty-title">Inga rapporter ännu</div><p class="lv-empty-sub">Nya köuppdateringar dyker upp här så fort någon rapporterar.</p></div>';
        return;
      }
      // Group by venue, sort each group newest-first
      var groups = {};
      recent.forEach(function(r) {
        if (!groups[r.venue_id]) groups[r.venue_id] = [];
        groups[r.venue_id].push(r);
      });
      Object.keys(groups).forEach(function(vid) {
        groups[vid].sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      });
      // Sort venues by their latest report time
      var venueIds = Object.keys(groups).sort(function(a, b) {
        return new Date(groups[b][0].created_at) - new Date(groups[a][0].created_at);
      });
      var items = venueIds.map(function(vid) {
        var reports = groups[vid];
        var older = reports.slice(1);
        var mainRow = _liveRowHtml(reports[0], false, older.length);
        if (!mainRow) return '';
        var html = mainRow + _liveEnteredHtml(vid, cutoff);
        if (older.length && _liveExpanded.has(vid)) {
          html += '<div class="lv-older">' + older.map(function(r) { return _liveRowHtml(r, true); }).filter(Boolean).join('') + '</div>';
        }
        // Ny = den senaste rapporten har inte visats förut. Rörelse bara när Live syns och minnet är fyllt,
        // annars (sidladdning, annan skärm) visas den utan animation och räknas som sedd.
        var isNew = _liveSeenReady && currentScreen === 'live' && !_liveSeen.has(liveReportKey(reports[0]));
        return '<div class="lv-item' + (isNew ? ' lv-item--new' : '') + '">' + html + '</div>';
      }).filter(Boolean);
      // Minnet fylls på med allt som nu visas, även när vi inte animerade. Då animeras en rapport aldrig två gånger.
      // Det börjar först när Live har ritats med data, så första ritningen aldrig räknas som "ny".
      venueIds.forEach(function(vid) { _liveSeen.add(liveReportKey(groups[vid][0])); });
      _liveSeenReady = true;
      if (subText) {
        subText.textContent = _loadState === 'error'
          ? 'Ingen kontakt · kan vara gammalt'
          : items.length + (items.length === 1 ? ' ställe' : ' ställen') + ' · 45 min';
      }
      el.innerHTML = '<div class="lv-group">' + items.join('') + '</div>';
    }

    renderLiveFeed();
    (function() {
      var wrap = document.getElementById('live-list-wrap');
      var sticky = document.getElementById('live-sticky');
      if (wrap && sticky) wrap.addEventListener('scroll', function() { sticky.classList.toggle('scrolled', wrap.scrollTop > 4); });
    })();
    setInterval(function() { if (typeof renderLiveFeed === 'function') renderLiveFeed(); }, 30000);

    // ── På väg ────────────────────────────────────────────────────────────────
    // Sparas i telefonen så att den överlever en omladdning. Vid framkomst blir den en fråga
    // om kön, så att den som ändå går dit blir rapportör i rätt ögonblick.
    var OMW_KEY = 'qb_on_my_way';
    var OMW_PROMPT_WINDOW = 30 * 60 * 1000;
    var _onMyWay = null; // { venueId, arrivalTime (ms), walkMins, timerId }

    function saveOnMyWay() {
      try {
        if (_onMyWay) localStorage.setItem(OMW_KEY, JSON.stringify({ venueId: _onMyWay.venueId, arrivalTime: _onMyWay.arrivalTime, walkMins: _onMyWay.walkMins }));
        else localStorage.removeItem(OMW_KEY);
      } catch(e) {}
    }

    function scheduleArrival() {
      if (_onMyWay.timerId) clearTimeout(_onMyWay.timerId);
      var ms = _onMyWay.arrivalTime - Date.now();
      _onMyWay.timerId = ms > 0 ? setTimeout(updateOnMyWayUI, ms) : null;
    }

    function restoreOnMyWay() {
      var saved = null;
      try { saved = JSON.parse(localStorage.getItem(OMW_KEY) || 'null'); } catch(e) {}
      if (!saved || !getVenueById(saved.venueId) || Date.now() > saved.arrivalTime + OMW_PROMPT_WINDOW) {
        try { localStorage.removeItem(OMW_KEY); } catch(e) {}
        return;
      }
      _onMyWay = { venueId: saved.venueId, arrivalTime: saved.arrivalTime, walkMins: saved.walkMins, timerId: null };
      scheduleArrival();
    }

    function goOnMyWay(venueId) {
      var venue = getVenueById(venueId);
      if (!venue) return;
      if (_onMyWay && _onMyWay.timerId) clearTimeout(_onMyWay.timerId);
      // Den som går till ett annat ställe står inte längre i sin gamla kö.
      if (getQueueSession()) endQueueSession();

      var walkMins = 15;
      if (window._userPos) {
        var dlat = venue.lat - window._userPos.lat;
        var dlng = venue.lng - window._userPos.lng;
        var distKm = Math.sqrt(dlat * dlat + dlng * dlng) * 111;
        walkMins = Math.max(2, Math.round(distKm / (5 / 60)));
      }

      _onMyWay = { venueId: venueId, arrivalTime: Date.now() + walkMins * 60 * 1000, walkMins: walkMins, timerId: null };
      scheduleArrival();
      saveOnMyWay();
      if (supabase) supabase.rpc('start_on_my_way', { p_user_id: getUserId(), p_venue_id: venueId, p_minutes: walkMins })
        .then(function(res) { if (res.error) console.warn('[QueueBar] start_on_my_way:', res.error.message); });

      showToast('På väg till ' + venue.name + ' — ca ' + walkMins + ' min');
      updateOnMyWayUI();
      closeVenueCard();
    }

    function cancelOnMyWay() {
      if (_onMyWay && _onMyWay.timerId) clearTimeout(_onMyWay.timerId);
      if (_onMyWay && supabase) supabase.rpc('stop_on_my_way', { p_user_id: getUserId() })
        .then(function(res) { if (res.error) console.warn('[QueueBar] stop_on_my_way:', res.error.message); });
      _onMyWay = null;
      saveOnMyWay();
      updateOnMyWayUI();
    }

    function onMyWayArrived() {
      if (!_onMyWay) return;
      _onMyWay.arrivalTime = Date.now();
      scheduleArrival();
      saveOnMyWay();
      updateOnMyWayUI();
    }

    function onMyWayReport() {
      if (!_onMyWay) return;
      openQuickReport(_onMyWay.venueId);
    }

    function updateOnMyWayUI() {
      var banner = document.getElementById('omw-banner');
      if (!banner) return;
      var qs = getQueueSession();
      if (qs) {
        renderQueueSessionBanner(banner, qs);
        return;
      }
      if (_onMyWay && Date.now() > _onMyWay.arrivalTime + OMW_PROMPT_WINDOW) {
        _onMyWay = null;
        saveOnMyWay();
      }
      if (!_onMyWay) {
        banner.style.display = 'none';
        return;
      }
      var venue = getVenueById(_onMyWay.venueId);
      var name = venue ? venue.name : _onMyWay.venueId;
      var minsLeft = Math.round((_onMyWay.arrivalTime - Date.now()) / 60000);
      var arrived = minsLeft <= 0;

      var kicker, big, sub, actions;
      if (arrived) {
        kicker = 'Framme?';
        big = name;
        sub = 'Hur många står framför dig?';
        actions = '<button class="qs-btn" onclick="cancelOnMyWay()">Kom inte dit</button>'
          + '<button class="qs-btn qs-btn--primary" onclick="onMyWayReport()">Rapportera kön</button>';
      } else {
        var waitNow = venueWaitText(_onMyWay.venueId);
        var pat = _historicalPatterns[_onMyWay.venueId];
        var hintMap = { free: 'brukar vara fri ingång nu', short: 'brukar vara kort kö nu', medium: 'brukar vara medel kö nu', long: 'brukar vara lång kö nu' };
        var fc = forecastWait(_onMyWay.venueId, minsLeft, Math.max(0, onMyWayCount(_onMyWay.venueId) - 1));
        var fcText = fc ? formatWait(fc) : '';
        var context = fc ? (fcText === 'Ingen kö' ? 'troligen ingen kö då' : 'troligen ' + fcText + ' kö då')
          : waitNow ? 'kön nu ' + waitNow : (pat && hintMap[pat.level]) || 'ingen färsk rapport';
        kicker = 'På väg · ' + name;
        big = '<span class="qs-num">~' + minsLeft + ' min</span> <span class="qs-unit">kvar</span>';
        sub = context;
        actions = '<button class="qs-btn" onclick="onMyWayArrived()">Jag är framme</button>';
      }
      banner.style.display = 'block';
      banner.innerHTML = '<div class="qs-row"><div class="qs-text">'
        + '<div class="qs-kicker"><span class="qs-live"></span>' + kicker + '</div>'
        + '<div class="qs-title">' + big + '</div>'
        + '<div class="qs-sub">' + sub + '</div></div>'
        + '<button class="qs-close" onclick="cancelOnMyWay()" aria-label="Avbryt">×</button></div>'
        + '<div class="qs-actions">' + actions + '</div>';
    }

    function renderQueueSessionBanner(banner, qs) {
      var sinceLast = Date.now() - qs.lastAt;
      var canUpdate = sinceLast >= QS_MIN_GAP && qs.followups < QS_MAX_FOLLOWUPS;
      var inQueue = Math.max(0, Math.round((Date.now() - (qs.startedAt || qs.lastAt)) / 60000)) || 0;
      var ahead = aheadBucket(qs.lastAhead).label + (qs.lastAhead ? ' framför' : '');
      var sub = canUpdate
        ? ahead + ' · ' + timeAgo(new Date(qs.lastAt).toISOString()) + ' · hur många nu?'
        : ahead + ' · ' + timeAgo(new Date(qs.lastAt).toISOString());
      banner.style.display = 'block';
      banner.innerHTML = '<div class="qs-row"><div class="qs-text">'
        + '<div class="qs-kicker"><span class="qs-live"></span>I kön · ' + qs.venueName + '</div>'
        + '<div class="qs-title"><span class="qs-num">' + inQueue + ' min</span> <span class="qs-unit">i kön</span></div>'
        + '<div class="qs-sub">' + sub + '</div></div>'
        + '<button class="qs-close" onclick="dismissQueueSession()" aria-label="Avsluta">×</button></div>'
        + '<div class="qs-actions">'
        + (canUpdate ? '<button class="qs-btn" onclick="queueSessionUpdate()">Uppdatera</button>' : '')
        + '<button class="qs-btn qs-btn--primary" onclick="queueSessionEntered()">Jag är inne</button>'
        + '</div>';
    }

    // Bannerns höjd skjuter ner kartans sökfält och skärmrubriker så att inget döljs.
    (function() {
      var b = document.getElementById('omw-banner');
      if (!b || typeof ResizeObserver === 'undefined') return;
      new ResizeObserver(function() {
        var h = b.style.display === 'none' ? 0 : b.offsetHeight + 8;
        document.documentElement.style.setProperty('--banner-h', h + 'px');
      }).observe(b);
    })();

    restoreOnMyWay();
    updateOnMyWayUI();
    setInterval(updateOnMyWayUI, 60000);

    // ── Rapportera ────────────────────────────────────────────────────────────
    var selectedRV = null;

    function filterReportList() {
      var q = (document.getElementById('rs-search').value || '').toLowerCase();
      var el = document.getElementById('rs-list');
      var cutoff2h = Date.now() - 2 * 60 * 60 * 1000;
      // Latest report per venue within 2h
      var latestTs = {};
      allReports.forEach(function(r) {
        var t = new Date(r.created_at).getTime();
        if (t < cutoff2h) return;
        if (!latestTs[r.venue_id] || t > latestTs[r.venue_id]) latestTs[r.venue_id] = t;
      });
      var list = q ? venueSearch(q, VENUES) : VENUES.slice();
      var pos = window._userPos;
      function distM(v) {
        if (!pos) return null;
        var dLat = (v.lat - pos.lat) * 111320;
        var dLng = (v.lng - pos.lng) * 111320 * Math.cos(pos.lat * Math.PI / 180);
        return Math.sqrt(dLat * dLat + dLng * dLng);
      }
      // Utan sökord: närmast först om platsen är känd, annars senast rapporterat. Med sökord: relevans.
      if (!q) {
        list.sort(function(a, b) {
          if (pos) return distM(a) - distM(b);
          var at = latestTs[a.id] || 0;
          var bt = latestTs[b.id] || 0;
          if (at && !bt) return -1;
          if (!at && bt) return 1;
          if (!at && !bt) return a.name.localeCompare(b.name, 'sv');
          return bt - at;
        });
      }
      var freshCut = Date.now() - 45 * 60 * 1000;
      el.innerHTML = list.map(function(v) {
        var rsTypeLbl = venueTypeLabel(v.type);
        var fresh = latestTs[v.id] && latestTs[v.id] > freshCut;
        var dotColor = fresh ? getStatusColor(computeStatus(v.id, allReports)) : 'transparent';
        var d = distM(v);
        var metaParts = [v.area + (rsTypeLbl ? ' · ' + rsTypeLbl : '')];
        if (d != null) metaParts.push(d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(1).replace('.', ',') + ' km');
        var ago = latestTs[v.id] ? timeAgo(new Date(latestTs[v.id]).toISOString()) : 'ingen rapport ikväll';
        return '<button class="rs-item" onclick="pickRV(\'' + v.id + '\')">' +
          '<span class="rs-dot' + (fresh ? '' : ' rs-dot--none') + '" style="background:' + dotColor + '"></span>' +
          '<span class="rs-text"><span class="rs-name">' + v.name + '</span><span class="rs-area">' + metaParts.join(' · ') + '</span></span>' +
          '<span class="rs-ago">' + ago + '</span></button>';
      }).join('');
    }

    // Visar ett av de tre stegen och håller stegräknaren i synk.
    function rsStep(n) {
      document.getElementById('rs1').style.display = n === 1 ? 'block' : 'none';
      document.getElementById('rs2').style.display = n === 2 ? 'flex' : 'none';
      document.getElementById('rs3').style.display = n === 3 ? 'flex' : 'none';
      var c = document.getElementById('rp-step-counter');
      if (c) { c.textContent = n + ' / 3'; c.style.display = ''; }
      // Bekräftelsen ritas om varje gång steg 3 visas: klassen tas bort, layouten tvingas, och sätts på igen
      var icon = document.getElementById('rs-success-icon');
      if (icon) {
        icon.classList.remove('rs-success-on');
        if (n === 3) { void icon.offsetWidth; icon.classList.add('rs-success-on'); }
      }
    }

    function pickRV(id) {
      selectedRV = getVenueById(id);
      document.getElementById('rs-vname').textContent = selectedRV.name;
      rsStep(2);
    }

    function backToRs1() {
      rsStep(1);
    }

    // Raden för ett ställe lyser till en kort stund efter att användaren rapporterat: "din rapport landade här".
    // Anropas efter submitReport, som redan har laddat om rapporterna, så raden visar det nya värdet.
    function flashVenueRow(venueId) {
      if (currentScreen !== 'explore') return;
      var rows = document.querySelectorAll('#explore-list .erow');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute('data-venue') === venueId) {
          rows[i].classList.remove('erow--landed');
          void rows[i].offsetWidth;
          rows[i].classList.add('erow--landed');
          return;
        }
      }
    }

    async function pickAhead(peopleAhead) {
      if (!selectedRV) return;
      var commentEl = document.getElementById('rs-comment');
      var comment = commentEl ? commentEl.value.trim().slice(0, 80) : '';
      try {
        await submitReport(selectedRV.id, selectedRV.name, peopleAhead, comment);
        if (commentEl) commentEl.value = '';
        maybeShowInstallPrompt();
        rsStep(3);
        var dest = (prevScreen && prevScreen !== 'report') ? prevScreen : null;
        var reportedId = selectedRV.id;
        selectedRV = null;
        setTimeout(function() {
          rsStep(1);
          document.getElementById('rs-search').value = '';
          filterReportList();
          if (dest) showScreen(dest);
          // Markeringen sker först när raden syns, annars har den spelats färdigt bakom tacksidan
          if (dest === 'explore') flashVenueRow(reportedId);
        }, 2800);
      } catch(err) { showToast(reportErrorText(err)); }
    }

    // ── Snabbrapport (bottom sheet från Utforska) ────────────────────────────
    var qrVenue = null;
    var qrMode = 'initial';

    function openQuickReport(venueId, mode) {
      qrVenue = getVenueById(venueId);
      if (!qrVenue) return;
      qrMode = mode === 'followup' ? 'followup' : 'initial';
      document.getElementById('qr-vname').textContent = qrVenue.name;
      document.getElementById('qr-question').textContent = qrMode === 'followup' ? 'Hur många är framför dig nu?' : 'Hur många står framför dig?';
      document.getElementById('qr-overlay').style.display = 'block';
      var sheet = document.getElementById('qr-sheet');
      sheet.style.display = 'block';
      sheet.classList.add('visible');
    }

    function closeQuickReport() {
      document.getElementById('qr-overlay').style.display = 'none';
      var sheet = document.getElementById('qr-sheet');
      sheet.style.animation = 'slideDown 0.2s cubic-bezier(0.36,0,0.66,0) forwards';
      setTimeout(function() {
        sheet.style.display = 'none';
        sheet.classList.remove('visible');
        sheet.style.animation = '';
        qrVenue = null;
      }, 200);
    }

    async function quickPickAhead(peopleAhead) {
      if (!qrVenue) return;
      var v = qrVenue;
      var mode = qrMode;
      closeQuickReport();
      if (mode === 'followup') { submitQueueFollowup(peopleAhead); return; }
      try {
        await submitReport(v.id, v.name, peopleAhead);
        maybeShowInstallPrompt();
        flashVenueRow(v.id);
        showToast('Rapport skickad — tack!');
        loadReports();
      } catch(e) {
        showToast(reportErrorText(e));
      }
    }

    filterReportList();

    // ── Profil ────────────────────────────────────────────────────────────────
    function updateProfileStats() {
      var userId = getUserId();
      var allMine = userHistory.length > 0
        ? userHistory
        : allReports.filter(function(r) { return r.user_id === userId; });
      var mine = allMine.filter(isQueueReport);

      var sr = document.getElementById('stat-r');
      var text = document.getElementById('pf-reports-text');
      if (sr) sr.textContent = mine.length;
      if (text) {
        text.textContent = mine.length === 0
          ? 'Du har inte rapporterat någon kö än.'
          : (mine.length === 1 ? 'kö du har hjälpt andra med' : 'köer du har hjälpt andra med');
      }
    }

    async function loadUserHistory() {
      if (!supabase) return;
      var userId = getUserId();
      try {
        var result = await supabase.from('reports').select('*').eq('user_id', userId).order('created_at', { ascending: false });
        if (result.data && result.data.length > 0) {
          userHistory = result.data;
          updateProfileStats();
        }
      } catch(err) {
        console.error('[QueueBar] loadUserHistory kastade:', err);
      }
    }

    function showPrivacyPolicy() {
      alert('Integritetspolicy\n\nQbar sparar ett anonymt ID, körapporter och favoriter.\nVi säljer aldrig din data.\nSupabase (EU) används som databas.\nMapbox används för kartan.\n\nKontakt: support@queuebar.se');
    }

    function confirmDelete() {
      if (confirm('Är du säker? All din data raderas permanent.')) deleteAllUserData();
    }

    updateProfileStats();

    console.log('[QueueBar] Initiering klar');
    checkConsent();

// Expose functions referenced in inline event handlers (onclick, oninput, etc.)
// Required because Vite modules are not globally scoped.
Object.assign(window, {
  acceptConsent,
  acceptInstall,
  backToRs1,
  cancelOnMyWay,
  clearMapSearch,
  closePlanModal,
  closeQuickReport,
  closeVenueCard,
  computeEveningPlan,
  confirmDelete,
  declineConsent,
  debouncedFilterExplore,
  dismissInstall,
  dismissQueueSession,
  filterReportList,
  getVenueById,
  goOnMyWay,
  goToReport,
  loadReports,
  obNext,
  onMyWayArrived,
  onMyWayReport,
  obSkip,
  onMapSearchBlur,
  onMapSearchFocus,
  onMapSearchInput,
  onMapSearchKey,
  openDirections,
  openQuickReport,
  openVenueCard,
  pickAhead,
  pickRV,
  qbCalibration,
  queueSessionEntered,
  queueSessionUpdate,
  quickPickAhead,
  retrySupabase,
  selectMapSearchVenue,
  setExploreFilter,
  shareVenue,
  showPrivacyPolicy,
  showScreen,
  toggleFavorite,
  toggleLiveVenue,
  toggleVcReports,
  togglePlanningMode,
  togglePlanVenue,
  vcOnMyWay,
  vcShare,
  vcToggleFavorite,
});
