import 'mapbox-gl/dist/mapbox-gl.css';
import { createClient } from '@supabase/supabase-js';
import './style.css';

    // ── PWA install prompt ───────────────────────────────────────────────────
    var _deferredInstallPrompt = null;
    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault();
      _deferredInstallPrompt = e;
    });

    // Visas efter första rapporten. Chrome/Android ger en riktig installationsdialog (beforeinstallprompt). iPhone har
    // ingen sådan — där säger kortet hur man gör i Safari, i stället för att aldrig visas för de flesta användarna.
    function maybeShowInstallPrompt() {
      var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
      var ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      if (standalone || (!_deferredInstallPrompt && !ios)) return;
      try { if (localStorage.getItem('qb_install_dismissed')) return; } catch(e) {}
      var card = document.getElementById('install-prompt');
      if (!card) return;
      if (!_deferredInstallPrompt) {
        card.querySelector('.ip-sub').textContent = 'Tryck på Dela och sedan "Lägg till på hemskärmen"';
        card.querySelector('.ip-accept').hidden = true;
      }
      card.style.display = 'flex';
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
      if (name !== currentScreen && _vcMode) vcHideNow(); // kortet hör till skärmen det öppnades på
      prevScreen = currentScreen;
      currentScreen = name;
      document.querySelectorAll('.screen').forEach(function(el) {
        el.classList.toggle('active', el.id === 'screen-' + name);
      });
      document.querySelectorAll('.tab').forEach(function(el) {
        el.classList.toggle('active', el.dataset.screen === name);
      });
      if (name === 'home') setTimeout(function() { if (map) map.resize(); }, 50);
      if (name === 'profile') loadUserHistory();
      if (name === 'report' && prevScreen !== 'report' && typeof rsStep === 'function') {
        selectedRV = null;
        rsStep(1);
        filterReportList();
      }
      // Listan ritas om varje gång den visas, så avstånd och åldrar stämmer — position och klocka har gått sedan sist.
      if (name === 'explore') renderExploreVenues();
      if (name === 'live') renderLiveFeed();
      console.log('[QueueBar] Byter till skärm:', name);
    }

    // ── Mapbox ───────────────────────────────────────────────────────────────
    // Kartbiblioteket (~1,7 MB) är en egen fil som hämtas direkt men inte står i vägen: listan, datan och introt behöver
    // inte vänta på det. Kartan skapas när både biblioteket och introts ring är klara (se afterRing).
    var mapboxgl = null;
    var _mapboxLoad = import('mapbox-gl').then(function(m) {
      mapboxgl = m.default;
      mapboxgl.accessToken = 'pk.eyJ1IjoiZmFpc3VzZW5nIiwiYSI6ImNtdWZocnA0YjA2cmszNHNhNGt2ZWJoeWcifQ.Pxmzf6pY69jIwHwdxsFzzg';
    });

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

    // ── Felruta på kartan ───────────────────────────────────────────────────
    // Följer inläsningsläget: syns så länge appen saknar kontakt med servern, försvinner när en läsning lyckas. Förut
    // visades den bara om klienten inte gick att skapa vid start — vid ett riktigt nätfel syntes inget på kartan.
    function updateConnectionToast() {
      var toast = document.getElementById('err-toast');
      if (toast) toast.classList.toggle('visible', !supabase || _loadState === 'error');
    }

    function retrySupabase() {
      console.log('[QueueBar] Försöker återansluta till Supabase...');
      try {
        // Ny klient och ny prenumeration bara om ingen fanns. En redan ansluten kanal tål inte en andra
        // .on('postgres_changes') och kastade ett fel.
        if (!supabase) {
          supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
          });
          subscribeToReports();
        }
        loadReports();
      } catch(err) {
        console.error('[QueueBar] Supabase retry misslyckades:', err);
      }
    }

    // ── Data och hjälpfunktioner ─────────────────────────────────────────────
    var userHistory = [];

    const VENUES = [
      { id: 'soap-bar', name: 'Soap Bar', address: 'Nybrogatan 1', area: 'Östermalm', type: 'bar', lat: 59.3349, lng: 18.0735, closing: '03:00', pace: 'fast' },
      { id: 'akkurat', name: 'Akkurat Bar & Restaurang', address: 'Hornsgatan 18', area: 'Slussen', type: 'bar', lat: 59.319809, lng: 18.068854, closing: '01:00', pace: 'fast' },
      { id: 'tjoget', name: 'Tjoget', address: 'Hornsbruksgatan 24', area: 'Hornstull', type: 'bar', lat: 59.3157, lng: 18.0348, closing: '01:00', pace: 'fast' },
      { id: 'sturehof', name: 'Sturehof', address: 'Stureplan 2', area: 'Östermalm', type: 'bar', lat: 59.3361, lng: 18.0733, closing: '02:00', pace: 'fast' },
      { id: 'pelikan', name: 'Pelikan', address: 'Blekingegatan 40', area: 'Södermalm', type: 'bar', lat: 59.31057, lng: 18.076172, closing: '01:00', pace: 'fast' },
      { id: 'morfar-ginko', name: 'Morfar Ginko', address: 'Swedenborgsgatan 13', area: 'Södermalm', type: 'bar', lat: 59.315791, lng: 18.064245, closing: '01:00', pace: 'fast' },
      { id: 'spy-bar', name: 'Spy Bar', address: 'Birger Jarlsgatan 20', area: 'Östermalm', type: 'bar', lat: 59.336555, lng: 18.072138, closing: '05:00', pace: 'slow' },
      { id: 'fasching', name: 'Fasching', address: 'Kungsgatan 63', area: 'Norrmalm', type: 'bar', lat: 59.333399, lng: 18.055761, closing: '03:00', pace: 'fast' },
      { id: 'berns', name: 'Berns', address: 'Berzelii Park', area: 'Norrmalm', type: 'bar', lat: 59.3322, lng: 18.0739, closing: '03:00', pace: 'slow' },
      { id: 'lounge-bar', name: 'The Lounge Bar', address: 'Sveavägen 45', area: 'Norrmalm', type: 'bar', lat: 59.339235, lng: 18.059438, closing: '01:00', pace: 'fast' },
      { id: 'niva22', name: 'Nivå 22', address: 'Fridhemsgatan 17', area: 'Kungsholmen', type: 'bar', lat: 59.3420, lng: 18.0490, closing: '01:00', pace: 'fast' },
      { id: 'cafe-opera', name: 'Café Opera', address: 'Karl XII:s torg 6', area: 'Kungsträdgården', type: 'klubb', lat: 59.3307, lng: 18.0715, closing: '05:00', pace: 'slow' },
      { id: 'tradgarden', name: 'Trädgården', address: 'Hammarby Slussväg 2', area: 'Södermalm', type: 'klubb', lat: 59.3088, lng: 18.0812, closing: '05:00', pace: 'fast' },
      { id: 'under-bron', name: 'Under Bron', address: 'Skansbron 4', area: 'Södermalm', type: 'klubb', lat: 59.3082, lng: 18.0798, closing: '05:00', pace: 'fast' },
      { id: 'sturecompagniet', name: 'Sturecompagniet', address: 'Sturegatan 4', area: 'Östermalm', type: 'klubb', lat: 59.3365, lng: 18.0735, closing: '05:00', pace: 'slow' },
      { id: 'kristall', name: 'Kristall', address: 'Regeringsgatan 12', area: 'Norrmalm', type: 'klubb', lat: 59.3340, lng: 18.0620, closing: '03:00', pace: 'normal' },
      { id: 'golden-hits', name: 'Golden Hits', address: 'Kungsgatan 26', area: 'Norrmalm', type: 'klubb', lat: 59.335798, lng: 18.066863, closing: '03:00', pace: 'normal' },
      { id: 'neu', name: 'Neu', address: 'Östgötagatan 8', area: 'Södermalm', type: 'klubb', lat: 59.3115, lng: 18.0780, closing: '05:00', pace: 'normal' },
      { id: 'end-nightclub', name: 'END Nightclub', address: 'Jakobsgatan 10', area: 'Norrmalm', type: 'klubb', lat: 59.3320, lng: 18.0640, closing: '05:00', pace: 'normal' },
      { id: 'nalen', name: 'Nalen', address: 'Regeringsgatan 74', area: 'Norrmalm', type: 'klubb', lat: 59.337163, lng: 18.067552, closing: '03:00', pace: 'normal' },
      { id: 'mosebacke', name: 'Mosebacke Etablissement', address: 'Mosebacke Torg 3', area: 'Södermalm', type: 'klubb', lat: 59.3184, lng: 18.0743, closing: '03:00', pace: 'normal' },
      { id: 'patricia', name: 'Patricia', address: 'Stadsgårdskajen 152', area: 'Södermalm', type: 'klubb', lat: 59.3190, lng: 18.0650, closing: '05:00', pace: 'normal' },
      { id: 'solidaritet', name: 'Solidaritet', address: 'Långholmsgatan 3', area: 'Hornstull', type: 'klubb', lat: 59.3162, lng: 18.0370, closing: '05:00', pace: 'normal' },
      { id: 'pharmarium', name: 'Pharmarium', address: 'Stortorget 7', area: 'Gamla Stan', type: 'bar', lat: 59.3252, lng: 18.0716, closing: '01:00', pace: 'fast' },
      { id: 'tak', name: 'TAK Stockholm', address: 'Brunkebergstorg 2', area: 'Norrmalm', type: 'bar', lat: 59.330711, lng: 18.067169, closing: '02:00', pace: 'fast' },
      { id: 'drama', name: 'Drama', address: 'Stureplan 4', area: 'Östermalm', type: 'klubb', lat: 59.3363, lng: 18.0731, closing: '05:00', pace: 'slow' },
      { id: 'hells-kitchen', name: "Hell's Kitchen", address: 'Sturegatan 4', area: 'Östermalm', type: 'klubb', lat: 59.336484, lng: 18.073468, closing: '05:00', pace: 'normal' },
      { id: '20hundra5', name: '20hundra5', address: 'Sankt Eriksgatan 104', area: 'Vasastan', type: 'bar', lat: 59.344145, lng: 18.039707, closing: '00:00', pace: 'fast' },
      { id: '360', name: '360°', address: 'Tegelbacken 6', area: 'Norrmalm', type: 'bar', lat: 59.32881, lng: 18.061346, closing: '14:30', pace: 'fast' },
      { id: 'afterglow', name: 'Afterglow', address: 'Erstagatan 17', area: 'Södermalm', type: 'bar', lat: 59.314304, lng: 18.090381, closing: null, pace: 'fast' },
      { id: 'alphabar', name: 'Alphabar', address: 'Instrumentvägen 4', area: 'Hägersten', type: 'bar', lat: 59.305894, lng: 17.986228, closing: '22:00', pace: 'fast' },
      { id: 'american-bar', name: 'American Bar', address: 'Arenatorget', area: 'Johanneshov', type: 'bar', lat: 59.293237, lng: 18.082146, closing: null, pace: 'fast' },
      { id: 'amici-nostri', name: 'Amici Nostri', address: 'Ringvägen 104', area: 'Södermalm', type: 'bar', lat: 59.307606, lng: 18.077191, closing: null, pace: 'fast' },
      { id: 'backdoor', name: 'Backdoor', address: 'Arenavägen 69', area: 'Johanneshov', type: 'klubb', lat: 59.290819, lng: 18.083944, closing: null, pace: 'normal' },
      { id: 'backstreet', name: 'Backstreet', address: 'Konstgjutarvägen 42', area: 'Johanneshov', type: 'bar', lat: 59.294714, lng: 18.073593, closing: null, pace: 'fast' },
      { id: 'bagpipers-s-inn', name: "Bagpipers's Inn", address: 'Rörstrandsgatan 21', area: 'Vasastan', type: 'bar', lat: 59.340356, lng: 18.031135, closing: '01:00', pace: 'fast' },
      { id: 'balthazar', name: 'Balthazar', address: 'Högbergsgatan 33', area: 'Södermalm', type: 'bar', lat: 59.316572, lng: 18.072775, closing: '01:00', pace: 'fast' },
      { id: 'bar-a-vins', name: 'Bar à Vins', address: 'Narvavägen 34', area: 'Östermalm', type: 'bar', lat: 59.33675, lng: 18.09109, closing: '23:00', pace: 'fast' },
      { id: 'bar-abrovinsch', name: 'Bar Abrovinsch', address: 'Inedalsgatan 15', area: 'Kungsholmen', type: 'bar', lat: 59.335389, lng: 18.036058, closing: null, pace: 'fast' },
      { id: 'bar-agrikultur', name: 'Bar Agrikultur', address: 'Skånegatan 79', area: 'Södermalm', type: 'bar', lat: 59.312865, lng: 18.083234, closing: null, pace: 'fast' },
      { id: 'bar-brooklyn', name: 'Bar Brooklyn', address: 'Hornstulls Strand 11', area: 'Södermalm', type: 'bar', lat: 59.314336, lng: 18.032789, closing: null, pace: 'fast' },
      { id: 'bar-city-central', name: 'Bar City Central', address: 'Vasagatan 46', area: 'Norrmalm', type: 'bar', lat: 59.334049, lng: 18.05657, closing: null, pace: 'fast' },
      { id: 'bar-elisabeth', name: 'Bar Elisabeth', address: 'Tegnérgatan 11', area: 'Norrmalm', type: 'bar', lat: 59.34034, lng: 18.06338, closing: '23:00', pace: 'fast' },
      { id: 'bar-ingrid', name: 'Bar Ingrid', address: 'Olofsgatan 7A', area: 'Norrmalm', type: 'bar', lat: 59.336322, lng: 18.06149, closing: '23:00', pace: 'fast' },
      { id: 'bar-kaja', name: 'Bar Kaja', address: 'Repslagargatan 8', area: 'Södermalm', type: 'bar', lat: 59.317873, lng: 18.07005, closing: '21:45', pace: 'fast' },
      { id: 'bar-libertin', name: 'Bar Libertin', address: 'Vapengatan 2', area: 'Aspudden', type: 'bar', lat: 59.306153, lng: 17.997585, closing: '22:00', pace: 'fast' },
      { id: 'bar-nacka', name: 'Bar Nacka', address: 'Södermannagatan 45', area: 'Södermalm', type: 'bar', lat: 59.309674, lng: 18.082601, closing: '23:00', pace: 'fast' },
      { id: 'bar-nimes', name: 'Bar Nîmes', address: 'Rådmansgatan 25', area: 'Östermalm', type: 'bar', lat: 59.342377, lng: 18.065468, closing: '01:00', pace: 'fast' },
      { id: 'bar-nordic', name: 'Bar Nordic', address: 'Vasagatan 52', area: 'Norrmalm', type: 'bar', lat: 59.334601, lng: 18.056055, closing: '00:00', pace: 'fast' },
      { id: 'bar-oas', name: 'Bar oas', address: 'Drottninggatan 73B', area: 'Norrmalm', type: 'bar', lat: 59.337013, lng: 18.058136, closing: '23:00', pace: 'fast' },
      { id: 'bar-talea', name: 'Bar Talea', address: 'Österlånggatan 18', area: 'Gamla Stan', type: 'bar', lat: 59.324361, lng: 18.07381, closing: '01:00', pace: 'fast' },
      { id: 'bar08', name: 'Bar08', address: 'Fridhemsgatan 18', area: 'Kungsholmen', type: 'bar', lat: 59.331689, lng: 18.028697, closing: '01:00', pace: 'fast' },
      { id: 'bara-2-noll', name: 'Bara 2.Noll', address: 'Götgatan 103', area: 'Södermalm', type: 'bar', lat: 59.307035, lng: 18.077228, closing: null, pace: 'fast' },
      { id: 'baras-backe', name: 'Baras Backe', address: 'Götgatan 33', area: 'Södermalm', type: 'bar', lat: 59.316504, lng: 18.072315, closing: '01:00', pace: 'fast' },
      { id: 'baras-gemenskap', name: 'Baras Gemenskap', address: 'Götgatan 22A', area: 'Södermalm', type: 'bar', lat: 59.318674, lng: 18.070511, closing: '01:00', pace: 'fast' },
      { id: 'baras-stalle', name: 'Baras ställe', address: 'Västgötagatan 2', area: 'Södermalm', type: 'klubb', lat: 59.313323, lng: 18.070565, closing: '03:00', pace: 'normal' },
      { id: 'batard', name: 'Bâtard', address: 'Nybrogatan 7', area: 'Östermalm', type: 'bar', lat: 59.333919, lng: 18.076641, closing: '01:00', pace: 'fast' },
      { id: 'beer-n-play', name: "Beer n' Play", address: 'Hornsgatan 138', area: 'Södermalm', type: 'bar', lat: 59.316448, lng: 18.041519, closing: '01:00', pace: 'fast' },
      { id: 'belgobaren', name: 'Belgobaren', address: 'Bryggargatan 12', area: 'Norrmalm', type: 'bar', lat: 59.332765, lng: 18.058176, closing: '01:00', pace: 'fast' },
      { id: 'biljardpalatset', name: 'Biljardpalatset', address: 'Sankt Eriksgatan 50B', area: 'Kungsholmen', type: 'bar', lat: 59.335748, lng: 18.033854, closing: '03:00', pace: 'fast' },
      { id: 'birka-bowling', name: 'Birka Bowling', address: 'Birkagatan 16', area: 'Vasastan', type: 'bar', lat: 59.340288, lng: 18.03509, closing: '00:00', pace: 'fast' },
      { id: 'bistro-aspen', name: 'Bistro Aspen', address: 'Hägerstensvägen 100A', area: 'Aspudden', type: 'bar', lat: 59.306057, lng: 18.006624, closing: '22:00', pace: 'fast' },
      { id: 'bistro-doma', name: 'Bistro Doma', address: 'Nybrogatan 48', area: 'Östermalm', type: 'bar', lat: 59.339029, lng: 18.080974, closing: '00:00', pace: 'fast' },
      { id: 'black-och-brown-inn', name: 'Black & Brown Inn', address: 'Hornsgatan 50B', area: 'Södermalm', type: 'bar', lat: 59.319099, lng: 18.063226, closing: '01:00', pace: 'fast' },
      { id: 'black-elk', name: 'Black Elk', address: 'Sveavägen 61', area: 'Vasastan', type: 'bar', lat: 59.340916, lng: 18.058078, closing: '01:00', pace: 'fast' },
      { id: 'blues-kok-och-bar', name: 'Blues Kök & Bar', address: 'Arenatorget', area: 'Johanneshov', type: 'bar', lat: 59.293018, lng: 18.081839, closing: null, pace: 'fast' },
      { id: 'boule-bar', name: 'Boule Bar', address: 'Liljeholmsvägen 14', area: 'Liljeholmen', type: 'bar', lat: 59.312739, lng: 18.027437, closing: null, pace: 'fast' },
      { id: 'bron', name: 'Bron', address: 'Sankt Eriksgatan 64', area: 'Vasastan', type: 'bar', lat: 59.337982, lng: 18.035653, closing: '01:00', pace: 'fast' },
      { id: 'brother-tuck', name: 'Brother Tuck', address: 'Götgatan 85', area: 'Södermalm', type: 'bar', lat: 59.309821, lng: 18.075844, closing: '03:00', pace: 'fast' },
      { id: 'brannerian', name: 'Brännerian', address: 'Folkungagatan 136', area: 'Södermalm', type: 'bar', lat: 59.315466, lng: 18.089099, closing: '00:00', pace: 'fast' },
      { id: 'branneriet', name: 'Bränneriet', address: 'Årstavägen 49', area: 'Östberga', type: 'bar', lat: 59.296641, lng: 18.051509, closing: null, pace: 'fast' },
      { id: 'cachette', name: 'Cachette', address: 'Regeringsgatan 111', area: 'Norrmalm', type: 'bar', lat: 59.340534, lng: 18.065365, closing: null, pace: 'fast' },
      { id: 'cadierbaren', name: 'Cadierbaren', address: 'Södra Blasieholmshamnen 8', area: 'Norrmalm', type: 'bar', lat: 59.329552, lng: 18.075611, closing: null, pace: 'fast' },
      { id: 'cafe-caminito', name: 'Café Caminito', address: 'Strandpromenad Årstaviken', area: 'Södermalm', type: 'bar', lat: 59.307254, lng: 18.055846, closing: null, pace: 'fast' },
      { id: 'charles-dickens', name: 'Charles Dickens', address: 'Folkungagatan 55', area: 'Södermalm', type: 'bar', lat: 59.314626, lng: 18.075642, closing: '03:00', pace: 'fast' },
      { id: 'chewie-s-bar', name: "Chewie's Bar", address: 'Norr Mälarstrand 32', area: 'Kungsholmen', type: 'bar', lat: 59.326899, lng: 18.042942, closing: '23:00', pace: 'fast' },
      { id: 'city-biljard', name: 'City Biljard', address: 'Götgatan 101', area: 'Södermalm', type: 'bar', lat: 59.307315, lng: 18.077084, closing: '01:00', pace: 'fast' },
      { id: 'combo-vinbaren', name: 'Combo vinbaren', address: 'Odengatan 52', area: 'Vasastan', type: 'bar', lat: 59.343984, lng: 18.054758, closing: '23:00', pace: 'fast' },
      { id: 'compagniet-bar', name: 'Compagniet Bar', address: 'Katarinavägen 18', area: 'Södermalm', type: 'bar', lat: 59.318891, lng: 18.074193, closing: '00:30', pace: 'fast' },
      { id: 'continental-bar', name: 'Continental Bar', address: 'Nytorgsgatan 33', area: 'Södermalm', type: 'bar', lat: 59.31296, lng: 18.082728, closing: '01:00', pace: 'fast' },
      { id: 'coquetel-social', name: 'Coquetel social', address: 'Birger Jarlsgatan 20', area: 'Norrmalm', type: 'bar', lat: 59.336602, lng: 18.07204, closing: '03:00', pace: 'fast' },
      { id: 'cork', name: 'Cork', address: 'Stora Nygatan 20', area: 'Gamla Stan', type: 'bar', lat: 59.324499, lng: 18.068642, closing: '00:00', pace: 'fast' },
      { id: 'corner-bar', name: 'Corner Bar', address: 'Västerlånggatan 66', area: 'Gamla Stan', type: 'bar', lat: 59.323235, lng: 18.071865, closing: null, pace: 'fast' },
      { id: 'corner-club', name: 'Corner Club', address: 'Lilla Nygatan 16', area: 'Gamla Stan', type: 'bar', lat: 59.323281, lng: 18.069327, closing: '01:00', pace: 'fast' },
      { id: 'corno-strada', name: 'Corno Strada', address: 'Hornsgatan 37', area: 'Södermalm', type: 'bar', lat: 59.318502, lng: 18.060638, closing: '01:00', pace: 'fast' },
      { id: 'corvina', name: 'Corvina', address: 'Stora Nygatan 47', area: 'Gamla Stan', type: 'bar', lat: 59.323142, lng: 18.071065, closing: '00:00', pace: 'fast' },
      { id: 'crazy-horse', name: 'Crazy Horse', address: 'Götgatan 44', area: 'Södermalm', type: 'bar', lat: 59.316103, lng: 18.072198, closing: '01:00', pace: 'fast' },
      { id: 'd-pub-och-bar', name: 'D. Pub & Bar', address: 'Sankt Eriksgatan 53', area: 'Kungsholmen', type: 'bar', lat: 59.335538, lng: 18.033113, closing: '01:00', pace: 'fast' },
      { id: 'debaser', name: 'Debaser', address: 'Hornstulls Strand 9', area: 'Södermalm', type: 'klubb', lat: 59.314459, lng: 18.032438, closing: null, pace: 'normal' },
      { id: 'debaser-pontonen', name: 'Debaser Pontonen', address: 'Hornstulls Strand 9', area: 'Södermalm', type: 'bar', lat: 59.314407, lng: 18.032376, closing: null, pace: 'fast' },
      { id: 'demi', name: 'demi', address: 'Katarina Bangata 21', area: 'Södermalm', type: 'bar', lat: 59.312039, lng: 18.076638, closing: '23:00', pace: 'fast' },
      { id: 'den-grone-jagaren', name: 'Den Gröne Jägaren', address: 'Götgatan 62', area: 'Södermalm', type: 'bar', lat: 59.313467, lng: 18.073486, closing: '01:00', pace: 'fast' },
      { id: 'diset', name: 'Diset', address: 'Örnsbergsvägen 2', area: 'Aspudden', type: 'bar', lat: 59.305546, lng: 17.988657, closing: '01:00', pace: 'fast' },
      { id: 'dovas', name: 'Dovas', address: 'Hornsgatan 90', area: 'Södermalm', type: 'bar', lat: 59.317869, lng: 18.053301, closing: '03:00', pace: 'fast' },
      { id: 'dryck', name: 'Dryck', address: 'Swedenborgsgatan 1', area: 'Södermalm', type: 'bar', lat: 59.317352, lng: 18.06351, closing: '23:00', pace: 'fast' },
      { id: 'eken', name: 'Eken', address: 'Södermalmstorg 4', area: 'Södermalm', type: 'bar', lat: 59.320504, lng: 18.070018, closing: '01:00', pace: 'fast' },
      { id: 'embargo', name: 'Embargo', address: 'Bergsunds Strand 33', area: 'Södermalm', type: 'bar', lat: 59.315597, lng: 18.030258, closing: null, pace: 'fast' },
      { id: 'engelen', name: 'Engelen', address: 'Triewaldsgränd 2', area: 'Gamla Stan', type: 'bar', lat: 59.32244, lng: 18.072279, closing: '00:00', pace: 'fast' },
      { id: 'enoteca-la-mela', name: 'Enoteca La Mela', address: 'Hornsgatan 149', area: 'Södermalm', type: 'bar', lat: 59.315026, lng: 18.032831, closing: null, pace: 'fast' },
      { id: 'erlands', name: 'Erlands', address: 'Gästrikegatan 1', area: 'Vasastan', type: 'bar', lat: 59.340483, lng: 18.040297, closing: '01:00', pace: 'fast' },
      { id: 'fabelbar', name: 'Fabelbar', address: 'Hägerstensvägen 132', area: 'Aspudden', type: 'bar', lat: 59.30569, lng: 18.000587, closing: '22:00', pace: 'fast' },
      { id: 'florabaren', name: 'Florabaren', address: 'Birger Jarlsgatan 35', area: 'Norrmalm', type: 'bar', lat: 59.338118, lng: 18.068649, closing: null, pace: 'fast' },
      { id: 'flygsektionen-t-centralen', name: 'Flygsektionen T-centralen', address: 'Drottning Kristinas Väg 29', area: 'Norra Djurgården', type: 'bar', lat: 59.348117, lng: 18.068723, closing: null, pace: 'fast' },
      { id: 'flying-scotsman-inn', name: 'Flying Scotsman Inn', address: 'Fleminggatan 28', area: 'Kungsholmen', type: 'bar', lat: 59.333999, lng: 18.037233, closing: '01:00', pace: 'fast' },
      { id: 'fou', name: 'Fou', address: 'Hamngatan 2', area: 'Norrmalm', type: 'klubb', lat: 59.333102, lng: 18.07519, closing: null, pace: 'normal' },
      { id: 'fox-and-badger', name: 'Fox and Badger', address: 'Norrbackagatan 56', area: 'Vasastan', type: 'bar', lat: 59.343403, lng: 18.03198, closing: '23:00', pace: 'fast' },
      { id: 'gamestreet-1', name: 'Gamestreet 1', address: 'Magnus Ladulåsgatan 1', area: 'Södermalm', type: 'bar', lat: 59.311703, lng: 18.05859, closing: null, pace: 'fast' },
      { id: 'glada-hornan', name: 'Glada hörnan', address: 'Hövdingagatan 39', area: 'Aspudden', type: 'bar', lat: 59.306813, lng: 17.988593, closing: '22:00', pace: 'fast' },
      { id: 'golf-baren-aspudden', name: 'Golf Baren Aspudden', address: 'Hövdingagatan 14', area: 'Aspudden', type: 'bar', lat: 59.307408, lng: 17.99484, closing: '22:00', pace: 'fast' },
      { id: 'goma', name: 'Goma', address: 'Sturegatan 22', area: 'Östermalm', type: 'bar', lat: 59.338397, lng: 18.07516, closing: null, pace: 'fast' },
      { id: 'grain-cafe', name: 'Grain café', address: 'Hantverkargatan 32', area: 'Kungsholmen', type: 'bar', lat: 59.32926, lng: 18.04195, closing: '15:00', pace: 'fast' },
      { id: 'grus-grus', name: 'Grus Grus', address: 'Karlbergsvägen 14', area: 'Vasastan', type: 'bar', lat: 59.343183, lng: 18.04912, closing: null, pace: 'fast' },
      { id: 'grattan', name: 'Gråttan', address: 'Osquars Backe 8', area: 'Norra Djurgården', type: 'bar', lat: 59.347434, lng: 18.072933, closing: null, pace: 'fast' },
      { id: 'guldapan', name: 'Guldapan', address: 'Mariatorget 1A', area: 'Södermalm', type: 'klubb', lat: 59.318806, lng: 18.063368, closing: '03:00', pace: 'normal' },
      { id: 'gullmarssons', name: 'Gullmarssons', address: 'Gullmarsplan 6A', area: 'Johanneshov', type: 'bar', lat: 59.298286, lng: 18.079681, closing: '01:00', pace: 'fast' },
      { id: 'haket', name: 'Haket', address: 'Folkungagatan 69-71', area: 'Södermalm', type: 'bar', lat: 59.314942, lng: 18.078183, closing: '01:00', pace: 'fast' },
      { id: 'half-way-inn', name: 'Half Way Inn', address: 'Swedenborgsgatan 6', area: 'Södermalm', type: 'bar', lat: 59.316771, lng: 18.063372, closing: '00:00', pace: 'fast' },
      { id: 'hallen-sodermalm', name: 'Hallen Södermalm', address: 'Götgatan 85', area: 'Södermalm', type: 'bar', lat: 59.309925, lng: 18.075786, closing: '01:00', pace: 'fast' },
      { id: 'harvest-home', name: 'Harvest Home', address: 'Bondegatan 50', area: 'Södermalm', type: 'bar', lat: 59.313389, lng: 18.083905, closing: '01:00', pace: 'fast' },
      { id: 'herno-gin-bar', name: 'Hernö Gin Bar', address: 'Hornsgatan 1', area: 'Södermalm', type: 'bar', lat: 59.319736, lng: 18.070381, closing: '01:00', pace: 'fast' },
      { id: 'hilma', name: 'Hilma', address: 'Torsgatan 10', area: 'Norrmalm', type: 'bar', lat: 59.335774, lng: 18.05115, closing: '00:00', pace: 'fast' },
      { id: 'hirschenkeller-gotgatan', name: 'Hirschenkeller, Götgatan', address: 'Götgatan 46', area: 'Södermalm', type: 'bar', lat: 59.316001, lng: 18.072252, closing: '01:00', pace: 'fast' },
      { id: 'hirschenkeller-sankt-eriksgatan', name: 'Hirschenkeller, Sankt Eriksgatan', address: 'Sankt Eriksgatan 22', area: 'Kungsholmen', type: 'bar', lat: 59.331527, lng: 18.031173, closing: '01:00', pace: 'fast' },
      { id: 'hirschenkeller-sveavagen', name: 'Hirschenkeller, Sveavägen', address: 'Sveavägen 61', area: 'Vasastan', type: 'bar', lat: 59.341039, lng: 18.057964, closing: null, pace: 'fast' },
      { id: 'holly-bush-bar-and-restaurant', name: 'Holly Bush Bar and Restaurant', address: 'Götgatan 82', area: 'Södermalm', type: 'bar', lat: 59.311415, lng: 18.07437, closing: '01:00', pace: 'fast' },
      { id: 'hommage', name: 'Hommage', address: 'Krukmakargatan 22', area: 'Södermalm', type: 'bar', lat: 59.317418, lng: 18.055947, closing: '01:00', pace: 'fast' },
      { id: 'honeyhoney', name: 'HoneyHoney', address: 'Folkungagatan 59', area: 'Södermalm', type: 'bar', lat: 59.314711, lng: 18.076306, closing: '01:00', pace: 'fast' },
      { id: 'hop-och-vine', name: 'Hop & Vine', address: 'Sveavägen 14', area: 'Norrmalm', type: 'bar', lat: 59.333964, lng: 18.065233, closing: '23:00', pace: 'fast' },
      { id: 'hosoi', name: 'Hosoi', address: 'Hallgränd 43', area: 'Johanneshov', type: 'bar', lat: 59.292284, lng: 18.078687, closing: null, pace: 'fast' },
      { id: 'house-of-q', name: 'House of Q', address: 'Malmvägen 1', area: 'Gärdet', type: 'klubb', lat: 59.347455, lng: 18.110776, closing: '18:00', pace: 'normal' },
      { id: 'humble-och-frank', name: 'Humble & Frank', address: 'Sankt Eriksgatan 93', area: 'Vasastan', type: 'bar', lat: 59.342898, lng: 18.038316, closing: '20:00', pace: 'fast' },
      { id: 'humlan', name: 'Humlan', address: 'Sturegatan 10', area: 'Östermalm', type: 'bar', lat: 59.337403, lng: 18.073431, closing: null, pace: 'fast' },
      { id: 'hus-7', name: 'Hus 7', address: 'Styckmästargatan 10', area: 'Johanneshov', type: 'klubb', lat: 59.29257, lng: 18.079904, closing: null, pace: 'normal' },
      { id: 'icebar', name: 'IceBar', address: 'Vasaplan 4', area: 'Norrmalm', type: 'bar', lat: 59.332085, lng: 18.05709, closing: '00:00', pace: 'fast' },
      { id: 'indigo', name: 'Indigo', address: 'Götgatan 19', area: 'Södermalm', type: 'bar', lat: 59.317744, lng: 18.071676, closing: '01:00', pace: 'fast' },
      { id: 'international', name: 'International', address: 'Drottninggatan 79', area: 'Norrmalm', type: 'bar', lat: 59.337793, lng: 18.057363, closing: null, pace: 'fast' },
      { id: 'international-bar-hantverkargatan', name: 'International Bar, Hantverkargatan', address: 'Hantverkargatan 36', area: 'Kungsholmen', type: 'bar', lat: 59.329458, lng: 18.040495, closing: '01:00', pace: 'fast' },
      { id: 'international-bar-norrlandsgatan', name: 'International Bar, Norrlandsgatan', address: 'Norrlandsgatan 23', area: 'Norrmalm', type: 'bar', lat: 59.335653, lng: 18.070925, closing: '03:00', pace: 'fast' },
      { id: 'japanese-pub-mix', name: 'Japanese Pub Mix', address: 'Norrlandsgatan 18', area: 'Norrmalm', type: 'bar', lat: 59.335033, lng: 18.07132, closing: null, pace: 'fast' },
      { id: 'john-scott-s-kungsgatan', name: 'John Scott’s Kungsgatan', address: 'Kungsgatan 37', area: 'Norrmalm', type: 'bar', lat: 59.335568, lng: 18.064679, closing: null, pace: 'fast' },
      { id: 'john-scott-s-kungstradgarden', name: 'John Scott’s Kungsträdgården', address: 'Hamngatan 19', area: 'Norrmalm', type: 'bar', lat: 59.332580, lng: 18.071129, closing: null, pace: 'fast' },
      { id: 'jolo', name: 'Jolo', address: 'Västmannagatan 50', area: 'Vasastan', type: 'bar', lat: 59.341165, lng: 18.048428, closing: '01:00', pace: 'fast' },
      { id: 'karamell', name: 'Karamell', address: 'Skeppsbron 36', area: 'Gamla Stan', type: 'bar', lat: 59.323368, lng: 18.075512, closing: '01:00', pace: 'fast' },
      { id: 'katarina-olkafe', name: 'Katarina Ölkafé', address: 'Katarina Bangata 27', area: 'Södermalm', type: 'bar', lat: 59.311691, lng: 18.079458, closing: null, pace: 'fast' },
      { id: 'kelly-s', name: "Kelly's", address: 'Folkungagatan 49', area: 'Södermalm', type: 'bar', lat: 59.314488, lng: 18.074555, closing: '03:00', pace: 'fast' },
      { id: 'klosters-pub', name: 'Klosters pub', address: 'Hornsgatan 84', area: 'Södermalm', type: 'bar', lat: 59.318016, lng: 18.054478, closing: '03:00', pace: 'fast' },
      { id: 'klow', name: 'Klow', address: 'Ringvägen 145', area: 'Södermalm', type: 'bar', lat: 59.308987, lng: 18.082133, closing: '01:00', pace: 'fast' },
      { id: 'kolingen', name: 'Kolingen', address: 'Kornhamnstorg 59', area: 'Gamla Stan', type: 'klubb', lat: 59.322508, lng: 18.072163, closing: '03:00', pace: 'normal' },
      { id: 'kollektivet-livet', name: 'Kollektivet Livet', address: 'Stadsgårdsleden', area: 'Södermalm', type: 'bar', lat: 59.31931, lng: 18.078308, closing: null, pace: 'fast' },
      { id: 'krogen-soldaten-svejk', name: 'Krogen Soldaten Švejk', address: 'Östgötagatan 35', area: 'Södermalm', type: 'bar', lat: 59.31442, lng: 18.076731, closing: '00:00', pace: 'fast' },
      { id: 'krukan', name: 'Krukan', address: 'Rosenlundsgatan 18', area: 'Södermalm', type: 'bar', lat: 59.317119, lng: 18.055328, closing: '01:00', pace: 'fast' },
      { id: 'kallaren-peder-muur', name: 'Källaren Peder Muur', address: 'Surbrunnsgatan 27', area: 'Vasastan', type: 'bar', lat: 59.34587, lng: 18.059722, closing: null, pace: 'fast' },
      { id: 'l-a-bar', name: 'L.A. Bar', address: 'Hjälmarsvägen 2', area: 'Östberga', type: 'bar', lat: 59.299809, lng: 18.056677, closing: '01:00', pace: 'fast' },
      { id: 'la-bottega', name: 'La bottega', address: 'Sibyllegatan 43', area: 'Östermalm', type: 'bar', lat: 59.337767, lng: 18.081137, closing: null, pace: 'fast' },
      { id: 'laika', name: 'Laika', address: 'Långholmsgatan 15', area: 'Södermalm', type: 'bar', lat: 59.316713, lng: 18.033617, closing: '03:00', pace: 'fast' },
      { id: 'le-hibou', name: 'Le Hibou', address: 'Arsenalsgatan 6', area: 'Norrmalm', type: 'bar', lat: 59.331486, lng: 18.074699, closing: null, pace: 'fast' },
      { id: 'legends', name: 'Legends', address: 'Globentorget', area: 'Johanneshov', type: 'bar', lat: 59.294282, lng: 18.083632, closing: null, pace: 'fast' },
      { id: 'lemon', name: 'Lemon', address: 'Scheelegatan 8', area: 'Kungsholmen', type: 'bar', lat: 59.329598, lng: 18.043721, closing: '03:00', pace: 'fast' },
      { id: 'leoparden', name: 'Leoparden', address: 'Tegnérgatan 16', area: 'Vasastan', type: 'bar', lat: 59.339907, lng: 18.060858, closing: '01:00', pace: 'fast' },
      { id: 'liebling-im-park', name: 'Liebling im Park', address: 'Sankt Paulsgatan 37', area: 'Södermalm', type: 'bar', lat: 59.317395, lng: 18.060812, closing: null, pace: 'fast' },
      { id: 'lilla-hotellbaren', name: 'Lilla hotellbaren', address: 'Götgatan 49-51', area: 'Södermalm', type: 'bar', lat: 59.314411, lng: 18.073954, closing: '02:00', pace: 'fast' },
      { id: 'lilla-wien', name: 'Lilla Wien', address: 'Swedenborgsgatan 20', area: 'Södermalm', type: 'bar', lat: 59.314111, lng: 18.064289, closing: '01:00', pace: 'fast' },
      { id: 'lion-bar-hornsgatan', name: 'Lion Bar, Hornsgatan 154', address: 'Hornsgatan 154', area: 'Södermalm', type: 'bar', lat: 59.315877, lng: 18.037475, closing: '01:00', pace: 'fast' },
      { id: 'lion-bar-hornsgatan-55', name: 'Lion Bar, Hornsgatan 55', address: 'Hornsgatan 55', area: 'Södermalm', type: 'bar', lat: 59.31794, lng: 18.056139, closing: '01:00', pace: 'fast' },
      { id: 'lion-bar-roslagsgatan', name: 'Lion Bar, Roslagsgatan', address: 'Roslagsgatan 20', area: 'Vasastan', type: 'bar', lat: 59.346468, lng: 18.060087, closing: '01:00', pace: 'fast' },
      { id: 'lion-bar-sveavagen', name: 'Lion Bar, Sveavägen', address: 'Sveavägen 74', area: 'Vasastan', type: 'bar', lat: 59.339789, lng: 18.059881, closing: '03:00', pace: 'fast' },
      { id: 'local-pub-och-eatery', name: 'Local Pub & Eatery', address: 'Ynglingagatan 24', area: 'Vasastan', type: 'bar', lat: 59.348597, lng: 18.045132, closing: null, pace: 'fast' },
      { id: 'loch-ness-taverna', name: 'Loch Ness Taverna', address: 'Wollmar Yxkullsgatan 5B', area: 'Södermalm', type: 'bar', lat: 59.316871, lng: 18.064201, closing: '00:00', pace: 'fast' },
      { id: 'loulou', name: 'Loulou', address: 'Katarinavägen 3', area: 'Södermalm', type: 'bar', lat: 59.319626, lng: 18.07304, closing: null, pace: 'fast' },
      { id: 'lucy-s-flower-shop', name: 'Lucy’s Flower Shop', address: 'Birger Jarlsgatan 20', area: 'Norrmalm', type: 'bar', lat: 59.336632, lng: 18.071957, closing: null, pace: 'fast' },
      { id: 'mackinlay-s-inn', name: "MacKinlay's Inn", address: 'Fleminggatan 85', area: 'Kungsholmen', type: 'bar', lat: 59.334431, lng: 18.031795, closing: '01:00', pace: 'fast' },
      { id: 'map-petite-maison', name: 'MAP Petite Maison', address: 'Vasagatan 38', area: 'Norrmalm', type: 'bar', lat: 59.33287, lng: 18.057633, closing: '01:00', pace: 'fast' },
      { id: 'medis-kok-och-bar', name: 'Medis kök & bar', address: 'Noe Arksfaret 1', area: 'Södermalm', type: 'bar', lat: 59.315373, lng: 18.071747, closing: '01:30', pace: 'fast' },
      { id: 'meta', name: 'Meta', address: 'Osquars Backe 21', area: 'Norra Djurgården', type: 'bar', lat: 59.348058, lng: 18.071402, closing: null, pace: 'fast' },
      { id: 'mikkeller-sodermalm', name: 'Mikkeller Södermalm', address: 'Östgötagatan 33', area: 'Södermalm', type: 'bar', lat: 59.314913, lng: 18.076487, closing: '01:00', pace: 'fast' },
      { id: 'mira', name: 'Mira', address: 'Östgötagatan 27', area: 'Södermalm', type: 'bar', lat: 59.315673, lng: 18.076093, closing: null, pace: 'fast' },
      { id: 'mister-plankstek', name: 'Mister Plankstek', address: 'Folkungagatan 100', area: 'Södermalm', type: 'bar', lat: 59.315225, lng: 18.082415, closing: '01:00', pace: 'fast' },
      { id: 'moderna-bar', name: 'Moderna bar', address: 'Slupskjulsvägen', area: 'Skeppsholmen', type: 'bar', lat: 59.326139, lng: 18.085084, closing: null, pace: 'fast' },
      { id: 'molly-malone-s', name: "Molly Malone's", address: 'Odengatan 83', area: 'Vasastan', type: 'bar', lat: 59.341932, lng: 18.047822, closing: '01:00', pace: 'fast' },
      { id: 'mondo', name: 'Mondo', address: 'Odengatan 47', area: 'Vasastan', type: 'bar', lat: 59.344101, lng: 18.056627, closing: '23:30', pace: 'fast' },
      { id: 'marthas', name: 'Märthas', address: 'Söder Mälarstrandskajen 16', area: 'Södermalm', type: 'bar', lat: 59.321371, lng: 18.056323, closing: '01:00', pace: 'fast' },
      { id: 'n3rds-video-game-bar', name: 'N3rds Video Game Bar', address: 'Bondegatan 1D', area: 'Södermalm', type: 'bar', lat: 59.312471, lng: 18.075299, closing: '01:00', pace: 'fast' },
      { id: 'noppe-bar', name: 'Noppe Bar', address: 'Nybrogatan 3', area: 'Östermalm', type: 'klubb', lat: 59.333734, lng: 18.076205, closing: null, pace: 'normal' },
      { id: 'norra-brunn', name: 'Norra brunn', address: 'Surbrunnsgatan 33', area: 'Vasastan', type: 'bar', lat: 59.345404, lng: 18.057916, closing: null, pace: 'fast' },
      { id: 'norrport', name: 'Norrport', address: 'Roslagsgatan 38', area: 'Vasastan', type: 'bar', lat: 59.348414, lng: 18.05823, closing: '00:00', pace: 'fast' },
      { id: 'o-connells', name: "O'Connells", address: 'Stora Nygatan 21C', area: 'Gamla Stan', type: 'bar', lat: 59.324415, lng: 18.069055, closing: '01:00', pace: 'fast' },
      { id: 'o-learys-bowling', name: "O'Learys Bowling", address: 'Arenavägen 69', area: 'Johanneshov', type: 'bar', lat: 59.291541, lng: 18.08448, closing: null, pace: 'fast' },
      { id: 'o-learys-tolv', name: "O'Learys Tolv", address: 'Arenavägen 69', area: 'Johanneshov', type: 'bar', lat: 59.291787, lng: 18.083654, closing: '01:00', pace: 'fast' },
      { id: 'o-learys-centralplan', name: "O'Learys, Centralplan", address: 'Centralplan 13', area: 'Norrmalm', type: 'bar', lat: 59.330082, lng: 18.059049, closing: '23:00', pace: 'fast' },
      { id: 'o-learys-slojdgatan', name: "O'Learys, Slöjdgatan", address: 'Slöjdgatan 11', area: 'Norrmalm', type: 'bar', lat: 59.334312, lng: 18.061951, closing: '01:00', pace: 'fast' },
      { id: 'o-learys-sveavagen', name: "O'Learys, Sveavägen", address: 'Sveavägen 143', area: 'Vasastan', type: 'bar', lat: 59.349863, lng: 18.048807, closing: '01:00', pace: 'fast' },
      { id: 'old-beefeater-inn', name: 'Old Beefeater Inn', address: 'Götgatan 11', area: 'Södermalm', type: 'bar', lat: 59.31854, lng: 18.071272, closing: '03:00', pace: 'fast' },
      { id: 'old-george-inn', name: 'Old George Inn', address: 'Scheelegatan 12', area: 'Kungsholmen', type: 'bar', lat: 59.3302, lng: 18.044052, closing: '01:00', pace: 'fast' },
      { id: 'oliver-twist', name: 'Oliver Twist', address: 'Sankt Paulsgatan 7A-B', area: 'Södermalm', type: 'bar', lat: 59.318347, lng: 18.06981, closing: '01:00', pace: 'fast' },
      { id: 'omnipollos-hatt', name: 'Omnipollos hatt', address: 'Hökens Gata 1A', area: 'Södermalm', type: 'bar', lat: 59.318061, lng: 18.072234, closing: '01:00', pace: 'fast' },
      { id: 'one-tap-bar-och-food', name: 'One Tap Bar & Food', address: 'Katarinavägen 19', area: 'Södermalm', type: 'bar', lat: 59.318917, lng: 18.07698, closing: '23:00', pace: 'fast' },
      { id: 'oskar-s-kok-och-bar', name: "Oskar's kök & bar", address: 'Kungstensgatan 27', area: 'Vasastan', type: 'bar', lat: 59.34189, lng: 18.060168, closing: '01:00', pace: 'fast' },
      { id: 'oxid-bar', name: 'Oxid Bar', address: 'Birger Jarlsgatan 33', area: 'Norrmalm', type: 'bar', lat: 59.337816, lng: 18.069137, closing: null, pace: 'fast' },
      { id: 'paradiso', name: 'Paradiso', address: 'Timmermansgatan 24', area: 'Södermalm', type: 'bar', lat: 59.317508, lng: 18.060243, closing: '01:00', pace: 'fast' },
      { id: 'parken-soder', name: 'Parken Söder', address: 'Fatbursgatan 3', area: 'Södermalm', type: 'bar', lat: 59.314531, lng: 18.066601, closing: '01:00', pace: 'fast' },
      { id: 'paulas', name: 'Paulas', address: 'Humlegårdsgatan 3', area: 'Östermalm', type: 'bar', lat: 59.336046, lng: 18.078169, closing: '19:00', pace: 'fast' },
      { id: 'pet-sounds-bar', name: 'Pet Sounds Bar', address: 'Stadsgården 6', area: 'Södermalm', type: 'bar', lat: 59.319572, lng: 18.073467, closing: null, pace: 'fast' },
      { id: 'pinocchio-kok-och-bar', name: 'Pinocchio kök och bar', address: 'Östgötagatan 34', area: 'Södermalm', type: 'bar', lat: 59.312992, lng: 18.077167, closing: '01:00', pace: 'fast' },
      { id: 'pitcher-s', name: "Pitcher's", address: 'Tegnérgatan 1', area: 'Norrmalm', type: 'bar', lat: 59.340792, lng: 18.065108, closing: '01:00', pace: 'fast' },
      { id: 'polhem', name: 'Polhem', address: 'Ringvägen 153', area: 'Södermalm', type: 'bar', lat: 59.309497, lng: 18.083885, closing: '01:00', pace: 'fast' },
      { id: 'printz-olhall', name: 'Printz Ölhall', address: 'Arenavägen 69', area: 'Johanneshov', type: 'bar', lat: 59.291193, lng: 18.083836, closing: null, pace: 'fast' },
      { id: 'pub-anchor', name: 'Pub Anchor', address: 'Sveavägen 90', area: 'Vasastan', type: 'bar', lat: 59.34126, lng: 18.058515, closing: '03:00', pace: 'fast' },
      { id: 'pub-international', name: 'Pub International', address: 'Mälartorget 13', area: 'Gamla Stan', type: 'bar', lat: 59.323304, lng: 18.068619, closing: null, pace: 'fast' },
      { id: 'qbm', name: 'QBM', address: 'Brinellvägen 1', area: 'Norra Djurgården', type: 'bar', lat: 59.350075, lng: 18.069182, closing: null, pace: 'fast' },
      { id: 'queen-s-head', name: "Queen's Head", address: 'Drottninggatan 87', area: 'Vasastan', type: 'bar', lat: 59.338814, lng: 18.056701, closing: '01:00', pace: 'fast' },
      { id: 'racamaca', name: 'Racamaca', address: 'Wollmar Yxkullsgatan 5B', area: 'Södermalm', type: 'bar', lat: 59.316844, lng: 18.063973, closing: '23:00', pace: 'fast' },
      { id: 'replik', name: 'Replik', address: 'Hornsgatan 70', area: 'Södermalm', type: 'bar', lat: 59.318494, lng: 18.058518, closing: '01:00', pace: 'fast' },
      { id: 'restaurang-carmen', name: 'Restaurang Carmen', address: 'Tjärhovsgatan 14', area: 'Södermalm', type: 'bar', lat: 59.315069, lng: 18.076131, closing: null, pace: 'fast' },
      { id: 'restaurang-hjalmaren', name: 'Restaurang Hjälmaren', address: 'Hjälmarsvägen 43', area: 'Östberga', type: 'bar', lat: 59.296566, lng: 18.052602, closing: '01:00', pace: 'fast' },
      { id: 'retro-bar-och-restaurant-sodermalm-hornstull', name: 'Retro Bar & Restaurant Södermalm/Hornstull', address: 'Hornsgatan 136', area: 'Södermalm', type: 'bar', lat: 59.316503, lng: 18.041899, closing: '01:00', pace: 'fast' },
      { id: 'retro-bondegatan', name: 'Retro, Bondegatan', address: 'Bondegatan 25', area: 'Södermalm', type: 'bar', lat: 59.313418, lng: 18.082489, closing: '01:00', pace: 'fast' },
      { id: 'retro-sankt-eriksgatan', name: 'Retro, Sankt Eriksgatan', address: 'Sankt Eriksgatan 22', area: 'Kungsholmen', type: 'bar', lat: 59.33161, lng: 18.031228, closing: '03:00', pace: 'fast' },
      { id: 'retro-sveavagen', name: 'Retro, Sveavägen', address: 'Sveavägen 120', area: 'Vasastan', type: 'bar', lat: 59.344888, lng: 18.055091, closing: '01:00', pace: 'fast' },
      { id: 'riche-fenix', name: 'Riche Fenix', address: 'Götgatan 40', area: 'Södermalm', type: 'bar', lat: 59.316738, lng: 18.071873, closing: '01:00', pace: 'fast' },
      { id: 'rock-och-bowl', name: 'Rock & Bowl', address: 'Hornsgatan 54', area: 'Södermalm', type: 'bar', lat: 59.318994, lng: 18.062409, closing: '00:00', pace: 'fast' },
      { id: 'roq', name: 'RoQ', address: 'Gyldéngatan 2', area: 'Vasastan', type: 'bar', lat: 59.34248, lng: 18.052374, closing: '03:00', pace: 'fast' },
      { id: 'rosa', name: 'Rosa', address: 'Brahegatan 3', area: 'Östermalm', type: 'bar', lat: 59.33717, lng: 18.075379, closing: null, pace: 'fast' },
      { id: 'rose', name: 'Rose', address: 'Hamngatan 2', area: 'Norrmalm', type: 'klubb', lat: 59.3331, lng: 18.074938, closing: '05:00', pace: 'normal' },
      { id: 'rost', name: 'Rost', address: 'Wollmar Yxkullsgatan 52A', area: 'Södermalm', type: 'bar', lat: 59.315647, lng: 18.052746, closing: '23:00', pace: 'fast' },
      { id: 'savant-bar', name: 'savant bar', address: 'Tegnérgatan 4', area: 'Vasastan', type: 'bar', lat: 59.340566, lng: 18.063347, closing: '00:00', pace: 'fast' },
      { id: 'shotluckan', name: 'Shotluckan', address: 'Götgatan 68', area: 'Södermalm', type: 'bar', lat: 59.313227, lng: 18.073608, closing: '03:00', pace: 'fast' },
      { id: 'side-track', name: 'Side Track', address: 'Wollmar Yxkullsgatan 7', area: 'Södermalm', type: 'bar', lat: 59.316758, lng: 18.063267, closing: '01:00', pace: 'fast' },
      { id: 'skeppsbar', name: 'Skeppsbar', address: 'Skeppsbron 44', area: 'Gamla Stan', type: 'bar', lat: 59.322318, lng: 18.074082, closing: '03:00', pace: 'fast' },
      { id: 'skybar', name: 'SkyBar', address: 'Vasagatan 1', area: 'Norrmalm', type: 'bar', lat: 59.331453, lng: 18.057959, closing: '02:00', pace: 'fast' },
      { id: 'slakthuset', name: 'Slakthuset', address: 'Slakthusgatan 6', area: 'Johanneshov', type: 'klubb', lat: 59.291641, lng: 18.079502, closing: null, pace: 'normal' },
      { id: 'slaktkyrkan', name: 'Slaktkyrkan', address: 'Styckmästargatan 10', area: 'Johanneshov', type: 'klubb', lat: 59.292423, lng: 18.080131, closing: null, pace: 'normal' },
      { id: 'slm-stockholm', name: 'SLM Stockholm', address: 'Wollmar Yxkullsgatan 18', area: 'Södermalm', type: 'klubb', lat: 59.316737, lng: 18.061479, closing: null, pace: 'normal' },
      { id: 'snabba-katten', name: 'Snabba Katten', address: 'Tegnérgatan 16', area: 'Vasastan', type: 'bar', lat: 59.339881, lng: 18.060757, closing: '01:00', pace: 'fast' },
      { id: 'snaps', name: 'Snaps', address: 'Götgatan 48', area: 'Södermalm', type: 'bar', lat: 59.315457, lng: 18.072364, closing: '03:15', pace: 'fast' },
      { id: 'snovit', name: 'Snövit', address: 'Ringvägen 147', area: 'Södermalm', type: 'bar', lat: 59.309008, lng: 18.082257, closing: null, pace: 'fast' },
      { id: 'sofia-common', name: 'Sofia common', address: 'Bondegatan 57', area: 'Södermalm', type: 'bar', lat: 59.313783, lng: 18.090643, closing: '23:00', pace: 'fast' },
      { id: 'solidaritet-arema', name: 'Solidaritet Arema', address: 'Arenavägen 69', area: 'Johanneshov', type: 'klubb', lat: 59.290737, lng: 18.084861, closing: null, pace: 'normal' },
      { id: 'sommarbaren', name: 'Sommarbaren', address: 'Långa Gatan 10A', area: 'Djurgården', type: 'bar', lat: 59.323558, lng: 18.098189, closing: null, pace: 'fast' },
      { id: 'southside-pub', name: 'Southside Pub', address: 'Ringvägen 10', area: 'Södermalm', type: 'bar', lat: 59.317447, lng: 18.050052, closing: '01:00', pace: 'fast' },
      { id: 'st-andrews-inn', name: 'St Andrews Inn', address: 'Nybrogatan 46', area: 'Östermalm', type: 'bar', lat: 59.338825, lng: 18.080816, closing: null, pace: 'fast' },
      { id: 'stampen', name: 'Stampen', address: 'Stora Gråmunkegränd 7', area: 'Gamla Stan', type: 'bar', lat: 59.325271, lng: 18.067693, closing: '01:00', pace: 'fast' },
      { id: 'staybar', name: 'Staybar', address: 'Götgatan 101', area: 'Södermalm', type: 'klubb', lat: 59.307346, lng: 18.077068, closing: null, pace: 'normal' },
      { id: 'stigbergets-fot', name: 'Stigbergets Fot', address: 'Götgatan 5', area: 'Södermalm', type: 'bar', lat: 59.319136, lng: 18.070954, closing: '01:00', pace: 'fast' },
      { id: 'stockholm-under-stjarnorna', name: 'Stockholm under Stjärnorna', address: 'Regeringsgatan 19', area: 'Norrmalm', type: 'bar', lat: 59.330753, lng: 18.067958, closing: null, pace: 'fast' },
      { id: 'strandbryggan', name: 'Strandbryggan', address: 'Strandvägskajen 27', area: 'Östermalm', type: 'bar', lat: 59.331384, lng: 18.092824, closing: '00:00', pace: 'fast' },
      { id: 'strandhaxan', name: 'Strandhäxan', address: 'Galärvarvsvägen 2', area: 'Östermalm', type: 'bar', lat: 59.33087, lng: 18.093051, closing: null, pace: 'fast' },
      { id: 'stringfellows', name: 'Stringfellows', address: 'Torsgatan 48B', area: 'Vasastan', type: 'bar', lat: 59.341819, lng: 18.037525, closing: '01:00', pace: 'fast' },
      { id: 'soder-bar', name: 'Söder Bar', address: 'Ringvägen 125', area: 'Södermalm', type: 'bar', lat: 59.308125, lng: 18.077472, closing: '01:00', pace: 'fast' },
      { id: 'soder-biljarden', name: 'Söder Biljarden', address: 'Bondegatan 18', area: 'Södermalm', type: 'bar', lat: 59.312755, lng: 18.078687, closing: '01:00', pace: 'fast' },
      { id: 'soderhallen-biljard', name: 'Söderhallen Biljard', address: 'Hornsgatan 59B', area: 'Södermalm', type: 'bar', lat: 59.317742, lng: 18.05451, closing: '03:00', pace: 'fast' },
      { id: 'soderkallaren', name: 'Söderkällaren', address: 'Tjärhovsgatan 12', area: 'Södermalm', type: 'bar', lat: 59.31503, lng: 18.075783, closing: null, pace: 'fast' },
      { id: 'sodra-bar', name: 'Södra Bar', address: 'Mosebacke Torg 4', area: 'Södermalm', type: 'klubb', lat: 59.318369, lng: 18.07426, closing: null, pace: 'normal' },
      { id: 'sodra-hornan', name: 'Södra hörnan', address: 'Swedenborgsgatan 24', area: 'Södermalm', type: 'bar', lat: 59.313745, lng: 18.064836, closing: '01:00', pace: 'fast' },
      { id: 'sodra-sidan', name: 'Södra sidan', address: 'Folkungagatan 57', area: 'Södermalm', type: 'bar', lat: 59.314645, lng: 18.075791, closing: '18:00', pace: 'fast' },
      { id: 'takpark-by-urban-deli', name: 'Takpark by Urban Deli', address: 'Sveavägen 46', area: 'Norrmalm', type: 'bar', lat: 59.337182, lng: 18.06276, closing: null, pace: 'fast' },
      { id: 'tap-room', name: 'Tap Room', address: 'Kungsholmsgatan 31', area: 'Kungsholmen', type: 'bar', lat: 59.331349, lng: 18.045076, closing: null, pace: 'fast' },
      { id: 'tekniska-hogskolans-studentkar', name: 'Tekniska Högskolans Studentkår', address: 'Drottning Kristinas Väg', area: 'Norra Djurgården', type: 'bar', lat: 59.347227, lng: 18.070974, closing: null, pace: 'fast' },
      { id: 'television-brewing-co', name: 'Television Brewing Co.', address: 'Västmannagatan 69', area: 'Vasastan', type: 'bar', lat: 59.343582, lng: 18.045543, closing: '22:00', pace: 'fast' },
      { id: 'the-auld-dub', name: 'The Auld Dub', address: 'Holländargatan 1', area: 'Norrmalm', type: 'bar', lat: 59.335403, lng: 18.061441, closing: '03:00', pace: 'fast' },
      { id: 'the-big-ben', name: 'The Big Ben', address: 'Renstiernas Gata 16', area: 'Södermalm', type: 'bar', lat: 59.315627, lng: 18.083509, closing: '03:00', pace: 'fast' },
      { id: 'the-bishops-arms-bellmansgatan', name: 'The Bishops Arms, Bellmansgatan', address: 'Bellmansgatan 12', area: 'Södermalm', type: 'bar', lat: 59.320033, lng: 18.064697, closing: '01:00', pace: 'fast' },
      { id: 'the-bishops-arms-odengatan', name: 'The Bishops Arms, Odengatan', address: 'Odengatan 41', area: 'Vasastan', type: 'bar', lat: 59.344492, lng: 18.05821, closing: '01:00', pace: 'fast' },
      { id: 'the-bishops-arms-sankt-eriksgatan', name: 'The Bishops Arms, Sankt Eriksgatan', address: 'Sankt Eriksgatan 115', area: 'Vasastan', type: 'bar', lat: 59.346607, lng: 18.039749, closing: '00:00', pace: 'fast' },
      { id: 'the-bishops-arms-tyska-brinken', name: 'The Bishops Arms, Tyska Brinken', address: 'Tyska Brinken 36', area: 'Gamla Stan', type: 'bar', lat: 59.323164, lng: 18.069063, closing: '01:00', pace: 'fast' },
      { id: 'the-bishops-arms-vasagatan', name: 'The Bishops Arms, Vasagatan', address: 'Vasagatan 7', area: 'Norrmalm', type: 'bar', lat: 59.332146, lng: 18.057523, closing: '03:00', pace: 'fast' },
      { id: 'the-bull-and-bear-inn', name: 'The Bull and Bear Inn', address: 'Grev Turegatan 1', area: 'Östermalm', type: 'bar', lat: 59.335194, lng: 18.074611, closing: '03:00', pace: 'fast' },
      { id: 'the-capital', name: 'The Capital', address: 'Vasagatan 22', area: 'Norrmalm', type: 'bar', lat: 59.330973, lng: 18.059408, closing: '01:00', pace: 'fast' },
      { id: 'the-central-bar-folkungagatan', name: 'The Central Bar, Folkungagatan', address: 'Folkungagatan 59', area: 'Södermalm', type: 'bar', lat: 59.314677, lng: 18.076039, closing: '03:00', pace: 'fast' },
      { id: 'the-central-bar-gotgatan', name: 'The Central Bar, Götgatan', address: 'Götgatan 84', area: 'Södermalm', type: 'bar', lat: 59.311137, lng: 18.074517, closing: '01:00', pace: 'fast' },
      { id: 'the-churchill-arms', name: 'The Churchill Arms', address: 'Rehnsgatan 8', area: 'Vasastan', type: 'bar', lat: 59.343297, lng: 18.060981, closing: '01:00', pace: 'fast' },
      { id: 'the-doors', name: 'The Doors', address: 'Odengatan 35', area: 'Vasastan', type: 'bar', lat: 59.344831, lng: 18.059517, closing: '03:00', pace: 'fast' },
      { id: 'the-flying-dog', name: 'The Flying Dog', address: 'Vasagatan 52', area: 'Norrmalm', type: 'bar', lat: 59.334745, lng: 18.055901, closing: '03:00', pace: 'fast' },
      { id: 'the-flying-horse', name: 'The Flying Horse', address: 'Odengatan 44', area: 'Vasastan', type: 'bar', lat: 59.344574, lng: 18.057114, closing: '03:00', pace: 'fast' },
      { id: 'the-golden-bar', name: 'The Golden Bar', address: 'Norrmalmstorg 4', area: 'Norrmalm', type: 'bar', lat: 59.333519, lng: 18.073967, closing: '01:00', pace: 'fast' },
      { id: 'the-king-s-fox', name: "The King's Fox", address: 'Kungsgatan 24', area: 'Norrmalm', type: 'bar', lat: 59.336065, lng: 18.067184, closing: '03:00', pace: 'fast' },
      { id: 'the-liffey', name: 'The Liffey', address: 'Stora Nygatan 40-42', area: 'Gamla Stan', type: 'bar', lat: 59.323516, lng: 18.070204, closing: '01:00', pace: 'fast' },
      { id: 'the-londoner', name: 'The Londoner', address: 'Karlavägen 52', area: 'Östermalm', type: 'bar', lat: 59.339212, lng: 18.081461, closing: '01:00', pace: 'fast' },
      { id: 'the-mad-hatter', name: 'The Mad Hatter', address: 'Skånegatan 73', area: 'Södermalm', type: 'bar', lat: 59.312668, lng: 18.081739, closing: null, pace: 'fast' },
      { id: 'the-oaken-inn', name: 'The Oaken Inn', address: 'Birger Jarlsgatan 33', area: 'Norrmalm', type: 'bar', lat: 59.337846, lng: 18.069077, closing: '03:00', pace: 'fast' },
      { id: 'the-old-brewer', name: 'The Old Brewer', address: 'Luntmakargatan 98', area: 'Vasastan', type: 'bar', lat: 59.34409, lng: 18.057229, closing: '23:00', pace: 'fast' },
      { id: 'the-picts-bar', name: 'The Picts Bar', address: 'Hammarby Allé 125', area: 'Hammarby Sjöstad', type: 'bar', lat: 59.303502, lng: 18.099435, closing: '01:00', pace: 'fast' },
      { id: 'the-ship', name: 'The Ship', address: 'Sankt Eriksgatan 38', area: 'Kungsholmen', type: 'bar', lat: 59.333869, lng: 18.032518, closing: '00:00', pace: 'fast' },
      { id: 'the-temple-bar', name: 'The Temple Bar', address: 'Kornhamnstorg 55-57', area: 'Gamla Stan', type: 'bar', lat: 59.322704, lng: 18.071814, closing: '03:00', pace: 'fast' },
      { id: 'time', name: 'Time', address: 'Hornsgatan 174', area: 'Södermalm', type: 'bar', lat: 59.315357, lng: 18.033311, closing: '03:00', pace: 'fast' },
      { id: 'tolvan', name: 'Tolvan', address: 'Osquars Backe 12', area: 'Norra Djurgården', type: 'bar', lat: 59.347671, lng: 18.073135, closing: null, pace: 'fast' },
      { id: 'tritonia', name: 'Tritonia', address: 'Stora Nygatan 20', area: 'Gamla Stan', type: 'bar', lat: 59.324591, lng: 18.068481, closing: '00:00', pace: 'fast' },
      { id: 'tudor-arms', name: 'Tudor Arms', address: 'Grevgatan 31', area: 'Östermalm', type: 'bar', lat: 59.334894, lng: 18.085346, closing: '23:00', pace: 'fast' },
      { id: 'tullen', name: 'Tullen', address: 'Sveavägen 64', area: 'Norrmalm', type: 'bar', lat: 59.338961, lng: 18.060657, closing: '03:00', pace: 'fast' },
      { id: 'tweed', name: 'Tweed', address: 'Lilla Nygatan 5', area: 'Gamla Stan', type: 'bar', lat: 59.324393, lng: 18.067999, closing: '01:00', pace: 'fast' },
      { id: 'tyge-och-sessil', name: 'Tyge & Sessil', address: 'Brahegatan 4', area: 'Östermalm', type: 'bar', lat: 59.337084, lng: 18.075603, closing: '01:00', pace: 'fast' },
      { id: 'udda', name: 'Udda', address: 'Kocksgatan 19', area: 'Södermalm', type: 'bar', lat: 59.314073, lng: 18.07759, closing: '23:00', pace: 'fast' },
      { id: 'ugglan-boule-och-bar', name: 'Ugglan Boule & Bar', address: 'Närkesgatan 6', area: 'Södermalm', type: 'bar', lat: 59.311962, lng: 18.082117, closing: '01:00', pace: 'fast' },
      { id: 'viking-bar', name: 'Viking Bar', address: 'Hornsgatan 35', area: 'Södermalm', type: 'bar', lat: 59.31858, lng: 18.061263, closing: '01:00', pace: 'fast' },
      { id: 'vinfolket-drottninggatan', name: 'Vinfolket, Drottninggatan', address: 'Drottninggatan 73A', area: 'Norrmalm', type: 'bar', lat: 59.336789, lng: 18.058347, closing: '23:00', pace: 'fast' },
      { id: 'vinfolket-scheelegatan', name: 'Vinfolket, Scheelegatan', address: 'Scheelegatan 2', area: 'Kungsholmen', type: 'bar', lat: 59.329202, lng: 18.043483, closing: '23:00', pace: 'fast' },
      { id: 'vita-aperitivo', name: 'Vita Aperitivo', address: 'Fleminggatan 91', area: 'Kungsholmen', type: 'bar', lat: 59.33462, lng: 18.030358, closing: '23:00', pace: 'fast' },
      { id: 'voisine', name: 'Voisine', address: 'Erstagatan 21', area: 'Södermalm', type: 'bar', lat: 59.313991, lng: 18.090407, closing: '23:00', pace: 'fast' },
      { id: 'vastra-skogen', name: 'Västra Skogen', address: 'Johan Enbergs väg 12', area: 'Västra skogen', type: 'bar', lat: 59.347807, lng: 18.003948, closing: '22:00', pace: 'fast' },
      { id: 'waku-waku', name: 'Waku waku', address: 'Drottninggatan 108', area: 'Vasastan', type: 'bar', lat: 59.338937, lng: 18.056554, closing: '01:00', pace: 'fast' },
      { id: 'wirstroms', name: 'Wirströms', address: 'Stora Nygatan 13', area: 'Gamla Stan', type: 'bar', lat: 59.32489, lng: 18.0683, closing: '01:00', pace: 'fast' },
      { id: 'wirstroms-pub', name: 'Wirströms Pub', address: 'Kungsgatan 7', area: 'Norrmalm', type: 'bar', lat: 59.335954, lng: 18.070218, closing: '03:00', pace: 'fast' },
      { id: 'yttons', name: 'Yttons', address: 'Skånegatan 90', area: 'Södermalm', type: 'bar', lat: 59.312479, lng: 18.081892, closing: '01:00', pace: 'fast' },
      { id: 'zinkens-krog', name: 'Zinkens Krog', address: 'Ringvägen 14', area: 'Södermalm', type: 'bar', lat: 59.316886, lng: 18.050352, closing: null, pace: 'fast' },
      { id: 'asens-krog', name: 'Åsens krog', address: 'Sedelvägen 11', area: 'Hägerstensåsen', type: 'bar', lat: 59.296126, lng: 17.983847, closing: '23:00', pace: 'fast' },
      { id: 'algen', name: 'Älgen', address: 'Långholmsgatan 42', area: 'Södermalm', type: 'bar', lat: 59.314877, lng: 18.033889, closing: null, pace: 'fast' },
      { id: 'olbaronerna', name: 'Ölbaronerna', address: 'Österlånggatan 28', area: 'Gamla Stan', type: 'bar', lat: 59.32376, lng: 18.073627, closing: '01:00', pace: 'fast' },
      { id: 'olkontainen', name: 'Ölkontainen', address: 'Djurgårdsvägen 38', area: 'Djurgården', type: 'bar', lat: 59.326824, lng: 18.093806, closing: null, pace: 'fast' },
      { id: 'olstugan', name: 'Ölstugan', address: 'Gullmarsplan 8', area: 'Johanneshov', type: 'bar', lat: 59.298145, lng: 18.079215, closing: '01:00', pace: 'fast' },
      { id: 'olstugan-tullen-hantverkargatan', name: 'Ölstugan Tullen, Hantverkargatan', address: 'Hantverkargatan 26', area: 'Kungsholmen', type: 'bar', lat: 59.329139, lng: 18.042826, closing: '03:00', pace: 'fast' },
      { id: 'olstugan-tullen-hornsgatan', name: 'Ölstugan Tullen, Hornsgatan', address: 'Hornsgatan 143', area: 'Södermalm', type: 'bar', lat: 59.31515, lng: 18.034956, closing: '01:00', pace: 'fast' }
    ];

    // Stängda för säsong, ombyggnad eller oklart läge (uppgifter från användaren 2026-11-03). Döljs överallt: karta,
    // lista, sök, rapport. Ta bort raden här när stället öppnar igen. Permanent stängda raderas ur VENUES i stället.
    var HIDDEN_VENUES = {
      'cafe-opera': 'Stänger för Operahusets renovering i slutet av december 2026, i cirka fem år',
      'end-nightclub': 'Stänger för Operahusets renovering; stängt för säsongen',
      'tradgarden': 'Säsongstängt över vintern, planerar att öppna 1 maj 2027',
      'honeyhoney': 'Troligen tillfälligt stängt (ombyggnad enligt egen webbplats)',
      'liebling-im-park': 'Säsongstängt, öppnar till sommaren',
      'n3rds-video-game-bar': 'Stängt på obestämd tid sedan 27 juni 2026',
      'sodra-hornan': 'Troligen stängt (Thatsup, juni 2026)',
      'debaser-pontonen': 'Oklart, möjligen stängt',
      'rost': 'Oklart, möjligen stängt',
      'herno-gin-bar': 'Oklart, möjligen stängt',
      'retro-bar-och-restaurant-sodermalm-hornstull': 'Oklart, ingen aktuell källa',
      'retro-bondegatan': 'Oklart, ingen aktuell källa',
      'riche-fenix': 'Oklart, ingen aktuell källa',
      'southside-pub': 'Oklart, ingen aktuell källa',
      'stigbergets-fot': 'Oklart, ingen aktuell källa',
      'soder-bar': 'Oklart, ingen aktuell källa'
    };
    for (var _hv = VENUES.length - 1; _hv >= 0; _hv--) if (HIDDEN_VENUES[VENUES[_hv].id]) VENUES.splice(_hv, 1);
    // Uppslag per id: getVenueById körs tusentals gånger per omritning, VENUES.find gick igenom ~300 ställen varje gång.
    var VENUE_BY_ID = {};
    VENUES.forEach(function(v) { VENUE_BY_ID[v.id] = v; });

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
        if (r.venue_id !== venueId) return false; // före datumet: de flesta rapporter gäller andra ställen
        var t = new Date(r.created_at).getTime();
        return t >= cutoff && t <= now;
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

    // now/hist kan anges för att räkna om en tidigare tidpunkt (kalibrering); annars just nu. Utan angiven tid tåls två
    // minuters klockskillnad: created_at sätts av servern, och en telefon som går efter ska inte gömma en nyss skickad rapport.
    function estimateWait(venueId, reports, now, hist) {
      var skew = now ? 0 : 2 * 60 * 1000;
      now = now || Date.now();
      if (hist === undefined) hist = _historicalRates[venueId] || null;
      var counted = reports.filter(function(r) {
        if (r.venue_id !== venueId) return false; // före datumet: de flesta rapporter gäller andra ställen
        var age = now - new Date(r.created_at).getTime();
        return isQueueReport(r) && r.people_ahead != null && age >= -skew && age < 45 * 60 * 1000;
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
      est.spread = spread;
      est.low = Math.round(est.mins * (1 - spread) / 5) * 5;
      est.high = Math.max(5, Math.round(est.mins * (1 + spread) / 5) * 5);
      return est;
    }

    // Kö när du är framme: nuvarande kö + kvällens trend + andra som är på väg. Trenden är lutningen över alla rapporter
    // de senaste 30 min (≥3 st över ≥10 min, från minst två personer) — inte första mot sista rapport, där ordningen
    // mellan två oense personer avgjorde allt. Taket ±0,5 personer/min hindrar en enskild avvikare från att fördubbla kön.
    function forecastWait(venueId, minsAhead, othersOnWay) {
      var est = estimateWait(venueId, allReports);
      if (!est || est.full || minsAhead < 5) return null;
      var now = Date.now();
      var recent = allReports.filter(function(r) {
        return r.venue_id === venueId && isQueueReport(r) && r.people_ahead != null &&
          now - new Date(r.created_at).getTime() <= 30 * 60 * 1000;
      });
      if (recent.length < 3) return null;
      var people = {};
      recent.forEach(function(r) { people[r.user_id] = true; });
      if (Object.keys(people).length < 2) return null;
      var ts = recent.map(function(r) { return (new Date(r.created_at).getTime() - now) / 60000; });
      var ys = recent.map(function(r) { return r.people_ahead; });
      if (Math.max.apply(null, ts) - Math.min.apply(null, ts) < 10) return null;
      var tMean = ts.reduce(function(a, b) { return a + b; }, 0) / ts.length;
      var yMean = ys.reduce(function(a, b) { return a + b; }, 0) / ys.length;
      var cov = 0, varT = 0;
      ts.forEach(function(t, i) { cov += (t - tMean) * (ys[i] - yMean); varT += (t - tMean) * (t - tMean); });
      var growth = Math.max(-0.5, Math.min(0.5, cov / varT));
      var ahead = Math.max(0, est.ahead + growth * minsAhead) + othersOnWay / 2;
      var fc = { ahead: Math.round(ahead), rate: est.rate, source: est.source, full: false, mins: ahead / est.rate, low: 0, high: 0 };
      if (fc.ahead === 0) return fc;
      // Samma osäkerhet som siffran ovanför när kön inte väntas ändras — annars såg en oförändrad kö osäkrare ut.
      return setWaitRange(fc, Math.abs(ahead - est.ahead) < 1 && est.spread ? est.spread : 0.35);
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

    // "Ingen kö" betyder att ingen står framför — inte att det går fort. 1–10 personer vid en snabb dörr är "<5 min"
    // och kort kö; annars stod "Ingen kö" bredvid "<5 min" och "1–10 personer i kö".
    function waitToStatus(est) {
      if (est.full) return 'long';
      if (est.ahead === 0) return 'none';
      if (est.mins < 18) return 'short';
      if (est.mins < 30) return 'medium';
      return 'long';
    }

    // Väntetidstext för en venue — samma källa för karta, Utforska, venue-kort, Live och "Bäst nu". Ett stängt ställe
    // har ingen väntetid, hur färsk den sista rapporten än är.
    function venueWaitText(venueId) {
      if (isClosed(getVenueById(venueId))) return '';
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
      if (isClosed(getVenueById(venueId))) return 'unknown';
      var est = estimateWait(venueId, reports);
      if (est) return waitToStatus(est);
      // Rapporter utan antal (äldre klienter): vanligaste status bland dem från de senaste 45 min. Äldre än så är ingen
      // data — samma gräns som estimateWait och listan, annars visade kartan "30+ min" där listan sa "–".
      var freshCutoff = Date.now() - 45 * 60 * 1000;
      var counts = { none: 0, short: 0, medium: 0, long: 0 };
      reports.forEach(function(r) {
        if (r.venue_id !== venueId || !isQueueReport(r) || new Date(r.created_at).getTime() <= freshCutoff) return;
        var s = r.queue_status === 'free' ? 'none' : r.queue_status;
        if (counts[s] !== undefined) counts[s]++;
      });
      var top = Object.entries(counts).sort(function(a, b) { return b[1] - a[1]; })[0];
      return top[1] ? top[0] : 'unknown';
    }

    function getStatusLabel(status) {
      return { none: 'Ingen kö', short: '~15 min', medium: '~25 min', long: '30+ min', unknown: '' }[status] || '';
    }

    // Enda källan till statusfärger i JS. Samma värden som --status-* i style.css.
    function getStatusColor(status) {
      return { none: '#34E07F', free: '#34E07F', short: '#FFD23F', medium: '#FF8A3D', long: '#FF4D5E' }[status] || '#55555B';
    }

    function getStatusClass(status) {
      return { none: 'free', short: 'short', medium: 'medium', long: 'long', unknown: 'unknown' }[status] || 'unknown';
    }

    function getVenueById(id) {
      return VENUE_BY_ID[id];
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
      t.setAttribute('role', 'status'); // skärmläsare läser upp "Rapport skickad", felmeddelanden osv.
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function() { t.remove(); }, 3000);
    }

    // ── Dela (Share) ─────────────────────────────────────────────────────────────
    function shareVenue(venueId) {
      var venue = getVenueById(venueId);
      if (!venue) return;
      var waitText = venueWaitText(venueId);
      // Säg hur gammal siffran är i stället för "just nu" — en delad länk läses ofta långt senare.
      var latest = allReports.filter(function(r) { return r.venue_id === venueId && isQueueReport(r); })
        .sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); })[0];
      var statusText = waitText && latest
        ? venue.name + ': ' + (waitText === 'Ingen kö' || waitText === 'Fullt' ? waitText.toLowerCase() : waitText + ' kö') + ' · rapporterat ' + timeAgo(latest.created_at)
        : venue.name + (isClosed(venue) ? ' har stängt' : ': ingen färsk rapport');

      if (navigator.share) {
        navigator.share({
          title: 'Qbar',
          text: statusText,
          url: window.location.origin
        }).catch(function() {});
      } else {
        var full = statusText + '\n' + window.location.origin;
        navigator.clipboard.writeText(full).then(function() {
          showToast('Kopierat till urklipp');
        }).catch(function() {
          showToast(statusText);
        });
      }
    }

    var favorites = JSON.parse(localStorage.getItem('qb_favorites') || '[]');
    function isFavorite(venueId) { return favorites.indexOf(venueId) > -1; }

    var activeVenue = null;
    var _vcReturnFocus = null; // elementet som hade fokus innan venue-kortet öppnades
    var allReports = [];

    // Minuter kvar till stängning, eller null om tiden saknas. En enda beräkning som både listan och kortet använder,
    // så att "Stänger snart" aldrig kan visa olika saker. Stängning före 06:00 räknas som nästa dygn (02:00 = 26:00).
    function minutesToClose(venue) {
      if (!venue || !venue.closing) return null;
      var p = venue.closing.split(':');
      var h = parseInt(p[0], 10), m = parseInt(p[1] || 0, 10);
      if (isNaN(h)) return null;
      var total = h < 6 ? (h + 24) * 60 + m : h * 60 + m;
      var d = new Date(), nowMin = _testNightMin !== null ? _testNightMin : d.getHours() * 60 + d.getMinutes();
      if (nowMin < 12 * 60) nowMin += 1440;
      return total - nowMin;
    }
    // Testläget föreställer en kväll: testdatan är rapporter från "nu", vid barer som stänger 01:00–05:00. Klockan 10 på
    // förmiddagen var alla stängda och testläget visade ingenting. I testläge räknas stängning därför mot 23:00 (minuter
    // efter midnatt), satt där testläget slås på. null = verklig klocka.
    var _testNightMin = null;

    // Stängt från stängningstiden fram till lunch (öppettider finns inte i VENUES). Ett stängt ställe har ingen kö att
    // visa: ingen väntetid, ingen pill, ingen "gå hit".
    function isClosed(venue) {
      var left = minutesToClose(venue);
      return left !== null && left <= 0;
    }

    // Barer/Klubbar: ett val för hela appen (setVenueType). Kartan, listan och "Bäst nu" visar samma ställen, annars såg man
    // 30 klubbar på kartan och 292 rader i listan. Live-flödet filtreras inte: det är vad som händer just nu, överallt.
    var _venueType = 'all'; // 'all' | 'bar' | 'klubb'
    function venueTypeMatches(v) { return _venueType === 'all' || (!!v && v.type === _venueType); }

    // A — vad som hänt. Den senaste mätningen med antal jämförs med den senaste som är minst 10 min äldre, i det som
    // faktiskt rapporterades (antal framför), med klockslag: "23:02 → 23:14 · 10–25 → 25–50". Två personer som rapporterar
    // samma minut men olika är oenighet, inte en trend. Samma regel i kortet och i listans pil — här, en gång.
    function queueChange(reports) {
      var counted = (reports || []).filter(function(r) { return r.people_ahead != null; });
      if (counted.length < 2) return null;
      var a = counted[0];
      var b = counted.find(function(r) { return new Date(a.created_at) - new Date(r.created_at) >= 10 * 60000; });
      if (!b) return null;
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
      return '<div class="vc-chg ' + cls + '"><span class="vc-chg-dir">' + (ch.dir === 'up' ? '▲ Växer' : '▼ Krymper') + '</span>' +
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
      var label = { none: 'Ingen kö', free: 'Ingen kö', short: 'Kort kö', medium: 'Medellång kö', long: 'Lång kö' };
      var body = rows.map(function(r) {
        var ago = Math.max(0, Math.floor((now - new Date(r.created_at)) / 60000));
        var what = r.people_ahead != null ? (r.people_ahead ? aheadBucket(r.people_ahead).label + ' i kö' : 'Ingen kö') : (label[r.queue_status] || 'Kö') + ' · ej mätt';
        return '<li class="vc-rep"><span class="vc-rep-dot" style="background:' + getStatusColor(r.queue_status) + '"></span>' +
          '<span class="vc-rep-time">' + clockOfIso(r.created_at) + '</span>' +
          '<span class="vc-rep-what">' + what + '</span>' +
          '<span class="vc-rep-ago">' + (ago < 1 ? 'nu' : ago + ' min') + '</span></li>';
      }).join('');
      return '<button class="vc-reps-toggle" aria-expanded="' + _vcListOpen + '" onclick="toggleVcReports()">' +
        '<span>Visa rapporter (' + rows.length + ')</span>' +
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
      vcKeepVisible(); // rapportlistan gör kapseln högre
    }

    // ── Venue-kortet: kapsel på kartan, utfälld rad i Lista och Live ──
    // Ett element (#venue-card), två lägen. På kartan (vc--map) en kapsel i pillens form och färg som växer ur pillen
    // och följer stället när kartan rör sig: namn, väntetid och huvudknappen. Ett tryck på kapseln fäller ut resten, ett
    // tryck på kartan stänger. I Lista och Live (vc--inline) läggs samma element direkt under raden man tryckte på, och
    // ett tryck till på raden fäller ihop den. Förut ett ark nertill över en mörk bakgrund: det kändes som en
    // bibliotekskomponent och dolde det man just hade tryckt på.
    var _vcMode = null; // null (stängt) | 'map' | 'inline'
    var _vcCloseTimer = null;
    var VC_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'; // snabb start, mjuk landning
    var VC_PILL = { w: 90, h: 34 }; // pillens ungefärliga storlek; kapseln växer ur och krymper in i den

    function vcCard() { return document.getElementById('venue-card'); }

    // Pillens ruta i fönstret, eller null om stället inte syns på kartan.
    function vcPillRect(venue) {
      if (!map || !venue) return null;
      var m = document.getElementById('map').getBoundingClientRect(), p = map.project([venue.lng, venue.lat]);
      if (p.x < 0 || p.y < 0 || p.x > m.width || p.y > m.height) return null;
      // Utzoomat är nålen en rund ikon (venues-icons), inte en pill: kapseln växer ur ikonen i stället.
      var w = VC_PILL.w, h = VC_PILL.h, z = map.getZoom();
      if (z < (PILL_MIN + PILL_FULL) / 2) w = h = 36 * iconScale(z);
      return { left: m.left + p.x - w / 2, top: m.top + p.y - h / 2, width: w, height: h };
    }

    // Kortet skalas från ruta r till sin egen plats och storlek (eller tillbaka). Bara transform och opacity: de körs
    // utanför huvudtråden, så kapseln växer jämnt medan kartan flyger. Innehållet tonar in efter halva vägen, så den
    // hoptryckta texten aldrig syns. Kräver transform-origin 0 0 (.vc--map).
    function vcMorph(card, r, reverse, dur) {
      var c = card.getBoundingClientRect();
      var at = 'translate(' + (r.left - c.left) + 'px, ' + (r.top - c.top) + 'px) scale(' + (r.width / c.width) + ', ' + (r.height / c.height) + ')';
      var full = 'translate(0px, 0px) scale(1, 1)';
      var opts = { duration: dur, easing: VC_EASE, fill: reverse ? 'forwards' : 'none' };
      function dir(frames) {
        return reverse ? frames.slice().reverse().map(function(f) {
          var g = Object.assign({}, f);
          if (f.offset !== undefined) g.offset = 1 - f.offset;
          return g;
        }) : frames;
      }
      Array.prototype.forEach.call(card.children, function(el) {
        el.animate(dir([{ opacity: 0 }, { opacity: 0, offset: 0.4 }, { opacity: 1 }]), opts);
      });
      return card.animate(dir([{ transform: at, opacity: 0 }, { opacity: 1, offset: 0.12 }, { transform: full, opacity: 1 }]), opts);
    }

    // Den del av kartan som syns: mellan knapparna under sökfältet och "Bäst nu"-kortet (eller menyn). Kartkoordinater.
    function vcMapBounds() {
      var m = document.getElementById('map').getBoundingClientRect();
      var bar = document.querySelector('.map-type-chips') || document.querySelector('.map-topbar');
      var bn = document.getElementById('best-now-card'), bnRect = bn && bn.getBoundingClientRect();
      var bottom = bnRect && bnRect.height ? bnRect.top - m.top : m.height - 88;
      return { top: (bar ? bar.getBoundingClientRect().bottom - m.top : 0) + 8, bottom: bottom - 8, height: m.height };
    }

    // Kapseln sitter på stället: pillens mitt i höjd med kapselns översta rad, i sidled inom skärmen. Körs när kartan
    // rör sig, när innehållet ändras och när kapseln fälls ut.
    function vcPlace() {
      if (_vcMode !== 'map' || !activeVenue || !map) return;
      var card = vcCard(), head = card.querySelector('.vc-head');
      var p = map.project([activeVenue.lng, activeVenue.lat]), W = document.getElementById('map').clientWidth;
      // Alla mått läses före skrivningarna: annars tvingade varje kartrörelse fram en extra layout.
      var cw = card.offsetWidth, headMid = head.offsetTop + head.offsetHeight / 2;
      card.style.left = Math.max(12, Math.min(W - cw - 12, p.x - cw / 2)) + 'px';
      card.style.top = (p.y - headMid) + 'px';
    }
    window.addEventListener('resize', vcPlace);

    // Kartan flyttas så att hela kapseln syns, efter utfällning eller när rapportlistan öppnas. Layoutmått, inte
    // getBoundingClientRect: en pågående animation skalar kapseln.
    function vcKeepVisible() {
      if (_vcMode !== 'map' || !map) return;
      var card = vcCard(), b = vcMapBounds();
      var top = card.offsetTop, bottom = top + card.offsetHeight;
      var dy = bottom > b.bottom ? bottom - b.bottom : top < b.top ? top - b.top : 0;
      if (dy) map.panBy([0, dy], { duration: _reduceMotion ? 0 : 300 });
    }

    function vcMarkRow(row, open) {
      row.classList.toggle('is-open', open);
      row.setAttribute('aria-expanded', String(open));
    }

    // Ett tryck på kapseln (utanför knapparna) fäller ut eller ihop resten.
    vcCard().addEventListener('click', function(e) {
      if (_vcMode !== 'map' || e.target.closest('button')) return;
      vcCard().classList.toggle('vc--open');
      vcPlace();
      vcKeepVisible();
    });

    // Den utfällda raden rullas fram ovanför menyn längst ned. scrollIntoView räknar inte med menyn (listan går under den)
    // och kortet hamnade bakom den.
    function vcRevealInline(smooth) {
      var card = vcCard(), wrap = card.closest('#explore-list-wrap, #live-list-wrap'), nav = document.getElementById('bottom-nav');
      if (!wrap) return;
      var over = card.getBoundingClientRect().bottom - (nav ? nav.getBoundingClientRect().top : window.innerHeight) + 12;
      if (over > 0) wrap.scrollBy({ top: over, behavior: smooth ? 'smooth' : 'auto' });
    }

    // Öppnar kortet för ett ställe: på kartan som kapsel vid stället, annars under raden (row: den man tryckte på).
    function openVenueCard(venue, source, row) {
      console.log('[QueueBar] openVenueCard:', venue.id, '| källa:', source || 'lista');
      var card = vcCard(), onMap = currentScreen === 'home';
      if (!onMap) row = row || document.querySelector('#screen-' + currentScreen + ' [data-venue="' + venue.id + '"]');
      // Ett tryck till på raden som redan är utfälld fäller ihop den.
      if (!onMap && _vcMode === 'inline' && activeVenue === venue && !_vcCloseTimer && row && row.nextElementSibling === card) {
        closeVenueCard();
        return;
      }
      vcHideNow(); // ett annat öppet kort, eller ett som håller på att stänga, försvinner direkt
      if (!onMap && !row) return;
      activeVenue = venue;
      applyMapFocus();
      _vcListOpen = false; // varje kort börjar hopfällt
      _vcMode = onMap ? 'map' : 'inline';
      card.classList.add(onMap ? 'vc--map' : 'vc--inline');
      card.setAttribute('role', onMap ? 'dialog' : 'region');
      renderVenueCard(venue);
      if (!onMap) {
        row.after(card);
        vcMarkRow(row, true);
        if (_reduceMotion) { vcRevealInline(false); return; }
        // Raden fälls ut: kortet växer från noll höjd under raden.
        var h = card.offsetHeight;
        card.style.overflow = 'hidden';
        var a = card.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], { duration: 260, easing: VC_EASE });
        a.onfinish = function() { card.style.overflow = ''; vcRevealInline(true); };
        a.oncancel = function() { card.style.overflow = ''; };
        return;
      }
      document.getElementById('screen-home').appendChild(card);
      vcPlace();
      // Fokus in i kapseln (skärmläsare och tangentbord hamnar där det händer) och tillbaka dit det kom ifrån.
      if (!card.contains(document.activeElement)) _vcReturnFocus = document.activeElement;
      card.focus({ preventScroll: true });
      var from = !_reduceMotion && vcPillRect(venue);
      var grow = from ? vcMorph(card, from, false, 380)
        : _reduceMotion ? null : card.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: VC_EASE });
      // Kartan flyger först när kapselns animation har börjat: kartans första bild (nya tiles, omplacering) blockerade
      // annars dess första bilder. Stället hamnar en bit ovanför mitten av det som syns, så den utfällda kapseln ryms under.
      (grow ? grow.ready : Promise.resolve()).then(function() {
        if (!map || activeVenue !== venue || _vcMode !== 'map') return;
        var b = vcMapBounds();
        // Zoom 15 och lutning: där syns Standard-kartans 3D-byggnader och landmärken runt stället. Ljus går närmare,
        // brantare och vrider kartan, och färgar ställets hus i statusfärgen när kameran är framme.
        var f3d = mapStyle().focus3d;
        map.flyTo({ center: [venue.lng, venue.lat], zoom: Math.max(f3d ? 16.2 : 15, map.getZoom()), pitch: f3d ? 60 : Math.max(45, map.getPitch()),
          bearing: f3d ? -30 : 0, duration: 800, offset: [0, b.top + (b.bottom - b.top) * 0.35 - b.height / 2] });
        if (f3d) map.once('moveend', function() { if (activeVenue === venue) lightVenueBuilding(venue); });
      }, function() {}); // avbruten animation: ett nytt kort öppnades och flyger själv
    }

    // Ljus: ställets hus i statusfärgen (Standards featureset 'buildings', tillståndet select). Okänd status (ingen data,
    // stängt) färgar inget. Huset hittas under ställets punkt, så kartan måste stå still och husen vara ritade.
    var _litBuildings = [];
    function lightVenueBuilding(venue) {
      unlightBuildings();
      var st = computeStatus(venue.id, allReports);
      if (st === 'unknown') return;
      map.setConfigProperty('basemap', 'colorBuildingSelect', getStatusColor(st));
      var p = map.project([venue.lng, venue.lat]);
      _litBuildings = map.queryRenderedFeatures([[p.x - 6, p.y - 6], [p.x + 6, p.y + 6]], { target: { featuresetId: 'buildings', importId: 'basemap' } });
      _litBuildings.forEach(function(f) { map.setFeatureState(f, { select: true }); });
    }
    function unlightBuildings() {
      // Efter byte av karttyp finns husen inte längre i importen.
      _litBuildings.forEach(function(f) { try { map.setFeatureState(f, { select: false }); } catch (e) {} });
      _litBuildings = [];
    }

    // Ritar om ett öppet kort med aktuell data. Inget om kortet är stängt.
    function refreshVenueCard() {
      if (!activeVenue || !_vcMode) return;
      renderVenueCard(activeVenue);
      vcPlace();
    }

    function renderVenueCard(venue) {
      var status = computeStatus(venue.id, allReports);
      var reports = allReports.filter(function(r) { return r.venue_id === venue.id && isQueueReport(r); })
        .sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      document.getElementById('vc-name').textContent = venue.name;
      var closed = isClosed(venue);
      var est = closed ? null : estimateWait(venue.id, allReports);
      var waitText = venueWaitText(venue.id);
      var minsOld = reports.length ? (Date.now() - new Date(reports[0].created_at)) / 60000 : Infinity;
      var card = document.getElementById('venue-card');
      card.classList.toggle('vc--aging', !closed && minsOld >= 15 && minsOld < 45);
      card.classList.toggle('vc--nodata', !waitText);
      card.style.setProperty('--st', getStatusColor(waitText ? status : 'unknown'));
      var vcStatus = document.getElementById('vc-status');
      vcStatus.innerHTML = waitText ? waitHtml(waitText) : closed ? 'Stängt' : '–';
      vcStatus.style.color = waitText ? getStatusColor(status) : '';
      // Under siffran: vad den bygger på, i vardagsspråk. estimateWait tar medianen av rapporterna senaste 20 min
      // (annars den senaste) — därför står antalet här, annars ser siffran ut att motsäga trendraden under.
      var subParts = [];
      if (est) {
        var nMedian = reports.filter(function(r) {
          return r.people_ahead != null && Date.now() - new Date(r.created_at).getTime() < 20 * 60 * 1000;
        }).length;
        // Antalet bara när det säger något nytt — vid ingen kö står "Ingen kö" redan i siffran ovanför.
        if (est.ahead) subParts.push(aheadBucket(est.ahead).label + ' personer i kö');
        subParts.push(nMedian >= 2 ? nMedian + ' rapporter senaste 20 min' : 'enligt senaste rapporten');
      }
      if (est && !est.full && est.ahead && est.source !== 'live') subParts.push('uppskattning');
      if (minsOld >= 15 && minsOld < 45) subParts.push('kan vara gammal');
      document.getElementById('vc-sub').textContent = closed ? 'Stängde ' + venue.closing
        : waitText ? subParts.join(' · ') : 'Ingen färsk rapport';

      // Resten på en lugn rad: stängning och hur många som är på väg. Klockslaget för senaste rapporten bara när det
      // är den enda — med fler står tiderna redan i ändringsraden och listan under.
      var meta = [];
      var toClose = minutesToClose(venue);
      if (!closed) {
        if (reports.length === 1) meta.push('Rapporterat ' + clockOfIso(reports[0].created_at));
        if (toClose !== null) meta.push('Stänger ' + venue.closing + (toClose <= 90 ? ' (om ' + toClose + ' min)' : ''));
        var omwN = onMyWayCount(venue.id);
        if (omwN) meta.push(omwN + ' på väg');
      }
      document.getElementById('vc-meta').textContent = meta.join(' · ');

      // Om du går nu: när du är framme och kön då. Samma prognos och ordval som "På väg"-bannern. Stänger stället innan
      // du hinner fram säger kortet det i stället — en kö vid en stängd dörr är ingen prognos.
      var km = distanceKmTo(venue), walk = walkMinutesTo(venue);
      var tooLate = !closed && walk !== null && toClose !== null && walk >= toClose;
      var fc = !closed && !tooLate && walk !== null && walk <= 40 ? forecastWait(venue.id, walk, othersOnWay(venue.id)) : null;
      var fcText = fc ? formatWait(fc) : '';
      document.getElementById('vc-go').textContent = tooLate
        ? 'Stänger ' + venue.closing + ', innan du hinner fram (' + walk + ' min)'
        : fc ? 'Går du nu: framme ' + clockOfIso(new Date(Date.now() + walk * 60000).toISOString()) +
          (fcText === 'Ingen kö' ? ' · troligen ingen kö då' : ' · troligen ' + fcText + ' kö då') : '';

      // Huvudknappen följer läget. Vid stället: rapportera kön. Annars: gå dit — öppnar vägbeskrivningen och markerar
      // "på väg" (anonymt, on_my_way_counts). Över 40 min promenad, eller om stället stänger innan du är framme, bara
      // vägbeskrivning: då går man inte dit, och ankomsten i "På väg" vore fel. Stängt: inga knappar alls.
      var primary = document.getElementById('vc-act-primary'), secondary = document.getElementById('vc-act-secondary');
      primary.hidden = closed;
      if (isAtVenue(venue)) {
        primary.textContent = 'Rapportera kön';
        primary.onclick = goToReport;
        secondary.hidden = true;
      } else {
        var directionsOnly = walk !== null && (walk > 40 || tooLate);
        primary.textContent = walk === null ? 'Gå hit' : directionsOnly ? 'Vägbeskrivning · ' + formatDistance(km) : 'Gå hit · ' + walk + ' min';
        primary.onclick = directionsOnly ? openDirections : vcGoThere;
        secondary.textContent = 'Rapportera';
        secondary.onclick = goToReport;
        secondary.hidden = closed;
      }
      // Vägbeskrivning finns alltid i länkraden ("Gå hit" öppnar den också, men säger det inte), utom när huvudknappen
      // redan heter så.
      document.getElementById('vc-dir').hidden = !primary.hidden && primary.onclick === openDirections;

      document.getElementById('vc-timeline').innerHTML = closed ? '' : queueChangeHtml(reports) + queueListHtml(reports);
      document.getElementById('vc-area').textContent = venue.area + ' · ' + venueTypeLabel(venue.type) + (km !== null ? ' · ' + formatDistance(km) : '');
      var favBtn = document.getElementById('vc-fav');
      if (favBtn) favBtn.classList.toggle('fav', isFavorite(venue.id));
    }

    // Kortets knappar — activeVenue är modul-lokal, så inline-onclick går via dessa
    function vcGoThere() { if (!activeVenue) return; openDirections(); goOnMyWay(activeVenue.id); } // goOnMyWay stänger kortet
    function vcShare() { if (activeVenue) shareVenue(activeVenue.id); }
    function vcToggleFavorite(event) {
      if (!activeVenue) return;
      toggleFavorite(event, activeVenue.id);
      event.currentTarget.classList.toggle('fav', isFavorite(activeVenue.id));
    }

    // Stänger: kapseln krymper tillbaka in i pillen (eller tonar ut om stället inte syns), raden fälls ihop.
    function closeVenueCard() {
      if (!_vcMode || _vcCloseTimer) return;
      var card = vcCard(), dur = 0;
      card.getAnimations({ subtree: true }).forEach(function(a) { a.cancel(); });
      if (!_reduceMotion) {
        if (_vcMode === 'map') {
          var to = vcPillRect(activeVenue);
          dur = 260;
          if (to) vcMorph(card, to, true, dur);
          else card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, easing: VC_EASE, fill: 'forwards' });
        } else {
          dur = 220;
          card.style.overflow = 'hidden';
          card.animate([{ height: card.offsetHeight + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: dur, easing: VC_EASE, fill: 'forwards' });
        }
      }
      _vcCloseTimer = setTimeout(vcHideNow, dur);
    }

    // Stänger utan animation: när en stängning är klar, när ett annat kort öppnas och vid skärmbyte. Kortet parkeras
    // utanför listorna, så att en omritning av listan inte tar bort elementet.
    function vcHideNow() {
      var card = vcCard();
      clearTimeout(_vcCloseTimer);
      _vcCloseTimer = null;
      card.getAnimations({ subtree: true }).forEach(function(a) { a.cancel(); });
      card.style.overflow = card.style.left = card.style.top = ''; // kapselns plats får inte följa med till listan
      var row = document.querySelector('.is-open[data-venue]'), hadFocus = card.contains(document.activeElement);
      if (row) vcMarkRow(row, false);
      if (!_vcMode) return;
      var wasMap = _vcMode === 'map';
      _vcMode = null;
      card.classList.remove('vc--map', 'vc--inline', 'vc--open');
      // Ljus vred kartan, och den går inte att vrida tillbaka med fingrarna (dragRotate är av).
      if (wasMap && map) { unlightBuildings(); if (map.getBearing()) map.easeTo({ bearing: 0, duration: 500 }); }
      document.body.appendChild(card);
      // Fokus tillbaka dit det kom ifrån: knappen eller kartan som öppnade kapseln, raden som fälldes ut.
      if (wasMap && _vcReturnFocus && document.contains(_vcReturnFocus)) _vcReturnFocus.focus({ preventScroll: true });
      else if (hadFocus && row) row.focus({ preventScroll: true });
      _vcReturnFocus = null;
      activeVenue = null;
      applyMapFocus();
    }

    // Listorna ritas om med innerHTML. Ett utfällt kort flyttas undan först (annars försvinner det med raden) och läggs
    // tillbaka under samma ställes nya rad när omritningen är klar; finns raden inte längre (bortfiltrerad) stängs det.
    function vcPark() {
      var card = vcCard();
      if (_vcMode !== 'inline' || card.parentNode === document.body) return;
      var focused = card.contains(document.activeElement) ? document.activeElement : null;
      document.body.appendChild(card);
      queueMicrotask(function() {
        if (_vcMode !== 'inline' || !activeVenue) return;
        var row = document.querySelector('#screen-' + currentScreen + ' [data-venue="' + activeVenue.id + '"]');
        if (!row) { vcHideNow(); return; }
        row.after(card);
        vcMarkRow(row, true);
        if (focused) focused.focus({ preventScroll: true });
      });
    }

    function goToReport() {
      var v = activeVenue; // showScreen stänger kortet direkt och nollar activeVenue
      closeVenueCard();
      showScreen('report');
      // Via pickRV, så att kortets "Rapportera" får samma kontroller som listan (stängt, långt bort).
      if (v) pickRV(v.id);
    }

    // Gående vägbeskrivning i Google Maps (appen om den finns, annars webben) till ställets adress. Namnet följer med så
    // att Google hittar rätt ställe även där adressen saknar husnummer ("Arenatorget") eller delas av flera ("Sturegatan 4").
    function openDirections() {
      if (!activeVenue) return;
      var to = activeVenue.name + ', ' + activeVenue.address + ', Stockholm';
      window.open('https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=' + encodeURIComponent(to), '_blank');
    }

    // Kartans enda kort: svaret på "vart går vi nu?". Visar bara färsk data (computeBestNow: ≤30 min). Följer samma
    // inläsningslägen som färskhetsraden — ett serverfel får aldrig se ut som en lugn kväll.
    function renderBestNowCard() {
      var card = document.getElementById('best-now-card');
      if (!card) return;
      var best = computeBestNow();
      if (!best) {
        var text = _loadState === 'error' ? 'Ingen kontakt med servern'
          : _loadState !== 'ok' ? 'Hämtar rapporter…'
          : allReports.some(isQueueReport) ? 'Ingen färsk rapport om kort kö just nu' : 'Inga rapporter senaste 45 min';
        card.innerHTML = '<button class="bn-card" onclick="showScreen(\'explore\')">' +
          '<span class="bn-eyebrow">Bäst nu</span>' +
          '<span class="bn-empty-text">' + text + '</span>' +
          '<span class="bn-cta">Se alla ställen →</span>' +
          '</button>';
        return;
      }
      var v = best.venue;
      var wait = venueWaitText(v.id) || 'Ingen kö';
      var latest = allReports.filter(function(r) { return r.venue_id === v.id && isQueueReport(r); })
        .sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); })[0];
      var meta = [v.area, venueTypeLabel(v.type)];
      if (best.dist != null) meta.push(formatDistance(best.dist));
      if (latest) meta.push(timeAgo(latest.created_at));
      if (_loadState === 'error') meta.push('ingen kontakt, kan vara gammalt');
      // Samma åldrande som listan och kortet: data som är 15–30 min gammal tonas, så "Bäst nu" aldrig ser färskare ut.
      card.innerHTML = '<button class="bn-card' + (best.minsAgo >= 15 ? ' bn-card--aging' : '') + '" style="--st:' + getStatusColor(best.status) + '" onclick="openVenueCard(getVenueById(\'' + v.id + '\'), \'bast-nu\')">' +
        '<span class="bn-eyebrow">Bäst nu</span>' +
        '<span class="bn-row">' +
          '<span class="bn-name">' + v.name + '</span>' +
          '<span class="bn-wait">' + waitRollHtml('best', v.id, wait, getStatusColor(best.status)) + '</span>' +
        '</span>' +
        '<span class="bn-meta">' + meta.filter(Boolean).join(' · ') + '</span>' +
        '</button>';
    }

    renderBestNowCard();

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
      } else if (e.key === 'Enter') {
        // Ett område först i listan (renderMapSearchResults satte _mapAreaHits) vinner: Enter på "söder" visar Södermalm.
        if (_mapAreaHits.length) { selectMapSearchArea(0); return; }
        var first = venueSearch(e.target.value.trim(), VENUES)[0];
        if (first) selectMapSearchVenue(first.id);
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

      var areas = _mapAreaHits = areaHits(query, VENUES).slice(0, 2);
      var hits = venueSearch(query, VENUES).slice(0, 6 - areas.length);

      floatEl.style.borderRadius = '12px 12px 10px 10px';
      resultsEl.style.display = 'block';

      if (!hits.length && !areas.length) {
        var sug = _mapSuggestion = didYouMean(query, VENUES);
        resultsEl.innerHTML = '<div class="msearch-empty">Inga resultat för ”' + escapeHtml(query) + '”' +
          (sug ? '<button class="msearch-suggest" onmousedown="useMapSuggestion()">Menade du ' + escapeHtml(sug.text) + '?</button>' : '') +
          '</div>';
        return;
      }

      resultsEl.innerHTML = areas.map(function(a, i) {
        return '<div class="msearch-row" onmousedown="selectMapSearchArea(' + i + ')">' +
          '<div class="msearch-dot msearch-dot--area"></div>' +
          '<div class="msearch-name">' + escapeHtml(a.area) + '</div>' +
          '<div class="msearch-meta">Område · ' + a.count + ' ställen</div>' +
          '</div>';
      }).join('') + hits.map(function(v) {
        var status = computeStatus(v.id, allReports);
        var dotColor = getStatusColor(status);
        var typeLabel = venueTypeLabel(v.type);
        return '<div class="msearch-row" onmousedown="selectMapSearchVenue(\'' + v.id + '\')">' +
          '<div class="msearch-dot" style="background:' + dotColor + '"></div>' +
          '<div class="msearch-name">' + v.name + '</div>' +
          '<div class="msearch-meta">' + v.area + ' · ' + typeLabel + '</div>' +
          '</div>';
      }).join('');
    }
    var _mapSuggestion = null;
    function useMapSuggestion() {
      var s = _mapSuggestion;
      if (!s) return;
      document.getElementById('map-search-input').value = s.text;
      if (s.area) { _mapAreaHits = [{ area: s.text }]; selectMapSearchArea(0); }
      else selectMapSearchVenue(s.id);
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

      // openVenueCard centrerar kartan själv — en egen flyTo här gav två rörelser efter varandra (zoom 15, sedan 14).
      openVenueCard(v, 'sök');
    }

    // Ett område ur kartans sök: kartan ramar in områdets ställen (de som syns med Barer/Klubbar-valet) i den del av kartan
    // som syns. Inget kort öppnas — man ville se området, inte ett ställe.
    var _mapAreaHits = [];
    function selectMapSearchArea(i) {
      var hit = _mapAreaHits[i];
      _mapSearchActive = false;
      var inp = document.getElementById('map-search-input');
      if (inp) inp.blur();
      document.getElementById('map-search-results').style.display = 'none';
      document.getElementById('map-search-float').style.borderRadius = '12px';
      if (hit) selectArea(hit.area);
    }

    // Kartan ramar in ett områdes ställen (de som syns med Barer/Klubbar-valet) i den del av kartan som syns. Flyttar bara
    // kartan, filtrerar inget: en kortare kö fem minuter bort, i grannområdet, ska fortfarande synas.
    function flyToArea(area) {
      if (!map) return;
      var inArea = VENUES.filter(function(v) { return v.area === area; });
      var shown = inArea.filter(venueTypeMatches);
      if (!inArea.length) return;
      var bounds = new mapboxgl.LngLatBounds();
      (shown.length ? shown : inArea).forEach(function(v) { bounds.extend([v.lng, v.lat]); });
      map.fitBounds(bounds, { padding: mapViewPadding(), maxZoom: 15.5, duration: _reduceMotion ? 0 : 700 });
    }

    // Områdesknappar efter Alla · Barer · Klubbar, i samma rad (den rullar i sidled). Bara områden med minst 10 ställen —
    // en knapp för Västra skogen (1 ställe) är brus. Störst först. Räknas ur VENUES, så nya ställen tar sig in av sig själva.
    var _areaChips = [];
    (function renderAreaChips() {
      var row = document.querySelector('.map-type-chips');
      if (!row) return;
      var count = {};
      VENUES.forEach(function(v) { count[v.area] = (count[v.area] || 0) + 1; });
      _areaChips = Object.keys(count).filter(function(a) { return count[a] >= 10; })
        .sort(function(a, b) { return count[b] - count[a]; });
      row.insertAdjacentHTML('beforeend', '<span class="chip-sep" aria-hidden="true"></span>' + _areaChips.map(function(a, i) {
        return '<button class="fbtn" data-area="' + i + '" aria-pressed="false" onclick="flyToAreaChip(' + i + ')">' + escapeHtml(a) + '</button>';
      }).join(''));
    })();
    // Valt område: vit knapp som Alla · Barer · Klubbar, och båda valen gäller samtidigt (typen avgör vilka ställen i
    // området som ramas in). Ett tryck på det valda området igen tar bort valet; kartan står kvar där den är.
    var _selectedArea = null;
    function selectArea(area) {
      _selectedArea = area;
      document.querySelectorAll('.fbtn[data-area]').forEach(function(b) {
        var on = _areaChips[b.dataset.area] === area;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      if (area) flyToArea(area);
    }
    function flyToAreaChip(i) { if (_areaChips[i]) selectArea(_areaChips[i] === _selectedArea ? null : _areaChips[i]); }

    // Den del av kartan som syns: under raden med Alla · Barer · Klubbar och ovanför "Bäst nu"-kortet.
    function mapViewPadding() {
      var m = document.getElementById('map').getBoundingClientRect();
      var bar = document.querySelector('.map-type-chips') || document.querySelector('.map-topbar');
      var card = document.getElementById('best-now-card');
      var top = bar ? bar.getBoundingClientRect().bottom - m.top : 0;
      var bottom = card && card.offsetHeight ? m.bottom - card.getBoundingClientRect().top : 0;
      return { top: top + 24, bottom: bottom + 24, left: 28, right: 28 };
    }

    // ── Kartans utseende ───────────────────────────────────────────────────
    // Användaren väljer kartans utseende i lagermenyn (knappen under profilknappen), som "Karttyp" i Google Maps. Varje
    // läge är en Mapbox Standard-stil med egen config. Nytt läge = en rad här och en förhandsbild i public/map-styles/.
    // Stilen byts med updateImport på grundkartan ('basemap'), inte setStyle: då ligger våra lager (nålar, pillar, glöd,
    // kapseln) kvar, och bara grundkartan laddas om. Samma stil (natt ↔ ljus) byter bara configen, utan omladdning.
    // Satellitbilderna hämtas först när någon väljer Satellit.
    var MAP_STYLES = [
      // Inga 3D-träd: de var två tredjedelar av allt kartan ritade (760 mot 250 ritanrop per bildruta inzoomat och lutat)
      // och fick kartan att hacka när man panorerade. Husen och landmärkena finns kvar.
      { id: 'night', name: 'Natt', url: 'mapbox://styles/mapbox/standard', light: 'night', config: { show3dTrees: false } },
      // Ljus: dagskarta med vita hus mot grå mark, så att 3D-modellen syns; färgen på skärmen är statusen. focus3d: ett
      // valt ställe visas brantare, vridet och med sitt hus i statusfärgen (openVenueCard).
      { id: 'light', name: 'Ljus', url: 'mapbox://styles/mapbox/standard', light: 'day', focus3d: true,
        config: { show3dTrees: false, colorBuildings: 'hsl(0, 0%, 100%)', colorLand: 'hsl(220, 12%, 86%)' } },
      // Dagsljus: nattljuset lade ett grått filter över flygbilderna, så tak, parker och gator blev grumliga.
      // Inga ritade vägar eller gränser: de lade ljusa streck över flygbilderna. Gatunamnen finns kvar. Satellit kan zooma
      // ett steg längre in (zoom 18): där syns övergångsställen, bilar och folk utanför stället.
      { id: 'satellite', name: 'Satellit', url: 'mapbox://styles/mapbox/standard-satellite', light: 'day', maxZoom: 18,
        config: { showRoadsAndTransit: false, showAdminBoundaries: false, showPedestrianRoads: false } }
    ];
    var MAP_STYLE_KEY = 'qb_map_style';
    function mapStyle() {
      var id;
      // qb_map_light: valet från när det bara fanns natt och skymning. Skymning ('dusk') ersattes av Ljus.
      try { id = localStorage.getItem(MAP_STYLE_KEY) || localStorage.getItem('qb_map_light'); } catch (e) {}
      if (id === 'dusk') id = 'light';
      return MAP_STYLES.find(function(s) { return s.id === id; }) || MAP_STYLES[0];
    }
    // Grundkartans config: ljuset, och inga affärer eller hållplatser (bara det som hjälper valet av ställe).
    function mapStyleConfig(s) {
      return Object.assign({ lightPreset: s.light, showPointOfInterestLabels: false, showTransitLabels: false }, s.config);
    }
    function renderMapStyleMenu() {
      var menu = document.getElementById('map-style-menu');
      if (!menu) return;
      var cur = mapStyle().id;
      menu.innerHTML = '<div class="msm-title" id="msm-title">Karttyp</div><div class="msm-row">' + MAP_STYLES.map(function(s) {
        return '<button class="msm-opt' + (s.id === cur ? ' is-on' : '') + '" aria-pressed="' + (s.id === cur) + '" onclick="setMapStyle(\'' + s.id + '\')">' +
          '<img src="/map-styles/' + s.id + '.jpg" alt="" width="72" height="72"><span>' + s.name + '</span></button>';
      }).join('') + '</div>';
    }
    function toggleMapStyleMenu(open) {
      var menu = document.getElementById('map-style-menu'), btn = document.getElementById('map-style-btn');
      if (!menu || !btn) return;
      open = open === undefined ? menu.hidden : open;
      if (open) renderMapStyleMenu();
      menu.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) { var on = menu.querySelector('.is-on'); if (on) on.focus({ preventScroll: true }); }
    }
    function setMapStyle(id) {
      var prev = mapStyle(), next = MAP_STYLES.find(function(s) { return s.id === id; });
      if (!next) return;
      try { localStorage.setItem(MAP_STYLE_KEY, next.id); } catch (e) {}
      if (map && next.id !== prev.id) {
        unlightBuildings();
        try {
          // Annan stil (satellit ↔ standard): importen tas bort och läggs till på nytt med sin egen config. updateImport
          // bytte bara adressen och behöll förra lägets config, så satelliten fick nattljus och vägar. En import ritas
          // under stilens egna lager, så nålar och pillar ligger kvar ovanpå. Samma stil: bara configen (ljuset).
          var cfg = mapStyleConfig(next);
          if (next.url !== prev.url) {
            map.removeImport('basemap');
            map.addImport({ id: 'basemap', url: next.url, config: cfg });
          } else map.setConfig('basemap', cfg);
          map.setMaxZoom(next.maxZoom || 17);
        } catch (e) { console.warn('[QueueBar] Karttyp:', e.message); }
      }
      renderMapStyleMenu();
      toggleMapStyleMenu(false);
      document.getElementById('map-style-btn').focus({ preventScroll: true });
    }
    // Ett tryck utanför menyn stänger den, som ett tryck utanför kapseln.
    document.addEventListener('click', function(e) {
      var menu = document.getElementById('map-style-menu');
      if (menu && !menu.hidden && !e.target.closest('#map-style-menu, #map-style-btn')) toggleMapStyleMenu(false);
    }, true);

    // ── Karta ────────────────────────────────────────────────────────────────
    var map = null;

    var venueGeoJSON = {
      type: 'FeatureCollection',
      features: VENUES.map(function(v) {
        return {
          type: 'Feature', id: v.id,
          geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
          properties: { id: v.id, name: v.name, type: v.type, status: 'unknown', pill_image: '', urgent: 0, ring_image: '', best: 0 }
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

    // Kartan startar när introts ring har fyllts. Ringen ritas om på huvudtråden i varje bildruta, och kartans start
    // (shaders, stil, första bilden) tog hela huvudtråden samma sekund, så ringen hackade. Resten av introt är bara
    // transform/opacity, som webbläsaren animerar utan huvudtråden. Utan intro, eller om det trycks bort, startar kartan direkt.
    function afterRing(fn) {
      var arc = document.querySelector('#splash .sq-arc');
      var anim = arc && arc.getAnimations ? arc.getAnimations()[0] : null;
      if (anim && anim.playState !== 'finished') anim.finished.then(function() { fn(); }, function() { fn(); });
      else fn();
    }
    Promise.all([_mapboxLoad, new Promise(afterRing)]).then(function() {
      console.log('[QueueBar] Initierar Mapbox-karta');
      try {
        map = new mapboxgl.Map({
          container: 'map',
          // Grundkartan är en import ('basemap'), så att den kan bytas (setMapStyle) utan att våra lager försvinner.
          style: { version: 8, imports: [{ id: 'basemap', url: mapStyle().url, config: mapStyleConfig(mapStyle()) }], sources: {}, layers: [] },
          center: [18.0686, 59.3293],
          zoom: 12.5,
          minZoom: 11,
          maxZoom: mapStyle().maxZoom || 17, // 17, eller lägets egen gräns (Satellit 18)
          pitch: 0,
          maxPitch: 60,
          bearing: 0,
          pitchWithRotate: false,
          dragRotate: false,
          logoPosition: 'bottom-right',
          // Högst 2×: på en iPhone (3×) ritade kartan 2,25 gånger fler pixlar per bildruta än vid 2×, med knappt synlig skillnad.
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          attributionControl: false
        });
        map.touchZoomRotate.disableRotation();

        // Statusfärger för kartnålar (hero-färger från CLAUDE.md)
        var PIN_STATUS_COLORS = {
          none: getStatusColor('free'), short: getStatusColor('short'), medium: getStatusColor('medium'), long: getStatusColor('long'), unknown: getStatusColor('unknown')
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
          var ctx = canvas.getContext('2d', { willReadFrequently: true }); // getImageData utan att läsa tillbaka från grafikkortet
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
            // Ljus kant: den gråa (#55555B) hade samma ton som gatorna i alla karttyper.
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(255,255,255,0.8)';
            ctx.stroke();
          } else {
            ctx.fillStyle = color;
            ctx.fill();
          }

          var glyphColor = hollow ? '#D8D8DC' : '#0B0B0D';
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
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
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
        }

        // Ringen som andas runt en brådskande pill: samma mått som pillen plus 5 px utanför, bara en tunn linje i statusfärgen.
        // Namn: ring|<pillens text>, eftersom bredden följer texten.
        function drawRing(map, name) {
          // ring|text = andningsringen kring lång kö (röd); focus|text = ditt val eller "Bäst nu" (accentblå).
          var focus = name.indexOf('focus|') === 0;
          var text = name.slice(name.indexOf('|') + 1);
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
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.scale(PR, PR);
          roundedPath(ctx, 1.5, 1.5, W - 3, TH - 3, (TH - 3) / 2);
          ctx.lineWidth = focus ? 2.5 : 2; ctx.strokeStyle = focus ? '#5B9BFF' : PIN_STATUS_COLORS.long; ctx.stroke();
          var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          if (map.hasImage(name)) map.removeImage(name);
          map.addImage(name, { width: canvas.width, height: canvas.height, data: imageData.data }, { pixelRatio: PR });
        }

        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

        var _mapStarted = false; // sätts först i load; därefter är inget Mapbox-fel skäl att stänga av kartan
        map.on('load', function() {
          _mapStarted = true;
          console.log('[QueueBar] Mapbox karta laddad — lägger till lager');

          // Pill-bilder ritas på begäran. Satoshi måste vara laddat först, annars mäts texten med reservtypsnittet
          // och pillen blir fel bred. Om typsnittet inte hinner laddas ritas pillen ändå (reservtypsnitt), men bara en gång.
          map.on('styleimagemissing', function(e) {
            if (!e.id) return;
            var isPill = e.id.indexOf('pill|') === 0, isRing = e.id.indexOf('ring|') === 0 || e.id.indexOf('focus|') === 0;
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
          registerTypePins(map);

          // Två källor. "venues": ställen med en pill (färsk väntetid); krockar löser declutterPills, inget kluster — en
          // väntetid ska aldrig gömmas i en bubbla. "venues-empty": ställen utan data, små svaga prickar under zoom 14 och
          // ikoner därifrån — de finns, men vi vet inget, så de ska inte ta plats. updateMapStatuses fördelar ställena.
          map.addSource('venues', {
            type: 'geojson', data: { type: 'FeatureCollection', features: [] },
            promoteId: 'id' // feature-state per ställe (pillarnas intro och intoning, se stepMapMotion)
          });
          map.addSource('venues-empty', { type: 'geojson', data: venueGeoJSON });

          // Statusglöd: ett mjukt sken i statusfärgen under varje ställe med färsk data. Kartan lyser där
          // kvällen händer och är mörk där den inte gör det — det som fångar blicken är data, inte dekoration. Ligger under
          // baskartans etiketter så att gatunamn förblir skarpa, och plant mot marken när kartan lutar.
          var firstLabel = (map.getStyle().layers.filter(function(l) { return l.type === 'symbol'; })[0] || {}).id;
          map.addLayer({
            id: 'venues-glow', type: 'circle', source: 'venues',
            filter: ['all', ['!=', ['get', 'status'], 'unknown'], ['!=', ['get', 'hidden'], 1]],
            paint: {
              'circle-color': ['match', ['get', 'status'],
                'long', getStatusColor('long'), 'medium', getStatusColor('medium'), 'short', getStatusColor('short'), getStatusColor('free')],
              // Lite större än pillen, inte mer: en stor glöd gjorde kartan suddig och flöt ihop till en dimma vid Stureplan.
              'circle-radius': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 22, 13, 32, 16, 64],
              'circle-blur': 1,
              'circle-opacity': 0.3,
              'circle-pitch-alignment': 'map'
            }
          }, firstLabel);

          // Du är här. Accentblått = ditt läge (designsystemet). Tom tills positionen finns, se updateMeOnMap.
          map.addSource('me', { type: 'geojson', data: meGeoJSON() });
          map.addLayer({ id: 'me-halo', type: 'circle', source: 'me',
            paint: { 'circle-color': '#5B9BFF', 'circle-radius': 16, 'circle-opacity': 0.18, 'circle-pitch-alignment': 'map' } });
          map.addLayer({ id: 'me-dot', type: 'circle', source: 'me',
            paint: { 'circle-color': '#5B9BFF', 'circle-radius': 6, 'circle-stroke-width': 2.5, 'circle-stroke-color': '#F5F5F4' } });

          // Våg vid ny rapport: en ring i statusfärgen som växer ut från stället och tonar bort (stepMapMotion).
          map.addSource('ripples', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          map.addLayer({ id: 'venues-ripple', type: 'circle', source: 'ripples',
            paint: {
              'circle-color': 'rgba(0,0,0,0)', 'circle-pitch-alignment': 'map',
              'circle-radius': ['+', 12, ['*', 60, ['get', 'k']]],
              'circle-stroke-width': 3,
              'circle-stroke-color': ['get', 'color'],
              'circle-stroke-opacity': ['*', 0.9, ['-', 1, ['get', 'k']]]
            } });

          // Ställen utan data, utzoomat: en liten prick. Ingen siffra och inget kluster — "21" i en bubbla såg ut som
          // data men sa bara "här vet vi inget". Ljus kärna syns på mörk karta, mörk kant på satellit; neutral, för
          // färg betyder status. Prickarna visar att ställena finns; ikonerna kommer från zoom 14.
          map.addLayer({
            id: 'venues-empty-dots', type: 'circle', source: 'venues-empty', maxzoom: 14,
            paint: {
              'circle-color': '#D8D8DC',
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2, 14, 3.5],
              'circle-stroke-color': '#0B0B0D',
              'circle-stroke-width': 1,
              'circle-opacity': 0.85,
              'circle-pitch-alignment': 'map'
            }
          });

          // Ställen utan data, inzoomat: den tomma ringen (pin-*-unknown), så att "vi vet inget" aldrig ser ut som en status.
          // Under pillarna, så en pill vinner alltid när de krockar.
          map.addLayer({
            id: 'venues-empty-pins', type: 'symbol', source: 'venues-empty', minzoom: 14,
            layout: {
              'icon-image': ['concat', ['match', ['get', 'type'], 'bar', 'pin-bar-', 'pin-club-'], 'unknown'],
              'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.85, 15, 1.05],
              'icon-anchor': 'center',
              'icon-allow-overlap': true,
              'icon-ignore-placement': false
            }
          });

          // Utzoomat (under PILL_MIN–PILL_FULL): en rund ikon i statusfärgen, glas eller not, utan siffra. Över hela stan
          // visar färgen var kvällen händer; siffrorna kommer när man zoomar in på ett område. Ikoner och pillar tonar över i
          // varandra på grafikkortet (pillsIn/iconsOut i applyMapFocus), utan JavaScript per bildruta. Alla ställen syns,
          // även de som en pill skulle dölja (hidden): ikonerna är små nog att ligga omlott, längst kö överst.
          map.addLayer({
            id: 'venues-icon-focus', type: 'circle', source: 'venues', maxzoom: PILL_FULL, filter: ['==', ['get', 'best'], 1],
            paint: {
              'circle-color': 'rgba(0,0,0,0)',
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 17 * ICON_SIZE_MIN + 4, PILL_FULL, 17 * ICON_SIZE_MAX + 4],
              'circle-stroke-width': 2.5,
              'circle-stroke-color': '#5B9BFF'
            }
          });
          map.addLayer({
            id: 'venues-icons', type: 'symbol', source: 'venues', maxzoom: PILL_FULL,
            layout: {
              'icon-image': ['concat', ['match', ['get', 'type'], 'bar', 'pin-bar-', 'pin-club-'], ['get', 'status']],
              'icon-size': ['interpolate', ['linear'], ['zoom'], 11, ICON_SIZE_MIN, PILL_FULL, ICON_SIZE_MAX],
              'icon-anchor': 'center',
              'icon-allow-overlap': true,
              'icon-ignore-placement': false,
              'symbol-sort-key': PIN_SORT_KEY
            }
          });

          // Ställen med färsk data: pill med väntetid. Samma namn skapas i pill_image nedan.
          map.addLayer({
            id: 'venues-pins', type: 'symbol', source: 'venues', filter: ['!=', ['get', 'hidden'], 1], minzoom: PILL_MIN,
            layout: {
              'icon-image': ['get', 'pill_image'],
              'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.85, 15, 1.05],
              'icon-anchor': 'center',
              'icon-allow-overlap': true,
              // false: nålarna går in i kollisionsindexet, så ortnamn som skulle hamna under en pill döljs i stället.
              // Pillar mot pillar avgör declutterPills (hidden), inte Mapbox: då stämmer "+N" med det som döljs.
              'icon-ignore-placement': false
            },
            // icon-opacity sätts av applyMapFocus: ingen data, gammal data och valt ställe
            paint: {}
          });

          // "+3" ovanför en pill som skymmer tre andra (declutterPills). Tryck zoomar in så att de syns.
          map.addLayer({
            id: 'venues-more', type: 'symbol', source: 'venues', minzoom: PILL_MIN,
            filter: ['all', ['!=', ['get', 'hidden'], 1], ['>', ['get', 'more'], 0]],
            layout: {
              'text-field': ['concat', '+', ['to-string', ['get', 'more']]],
              'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
              'text-size': 12, 'text-anchor': 'bottom', 'text-offset': [0, -1.3],
              'text-allow-overlap': true, 'text-ignore-placement': true
            },
            paint: { 'text-color': '#F5F5F4', 'text-halo-color': '#0B0B0D', 'text-halo-width': 2 }
          });

          // Namn under pillen när man zoomat in. Ligger under nålarna, så krockar ett namn döljs namnet, aldrig pillen.
          var nameLayout = {
            'text-field': ['get', 'name'],
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 14, 11, 16, 13],
            'text-anchor': 'top',
            // Pillen är ~34 px hög vid zoom 15 och har 2 px kollisionsmarginal; närmare än så döljer den sitt eget namn.
            'text-offset': [0, 1.9],
            'text-max-width': 9
          };
          var namePaint = {
            'text-color': ['match', ['get', 'status'], 'unknown', '#85858A', '#F5F5F4'],
            'text-halo-color': '#0B0B0D',
            'text-halo-width': 1.4
          };
          map.addLayer({
            id: 'venues-names', type: 'symbol', source: 'venues', minzoom: 13.8, filter: ['!=', ['get', 'hidden'], 1],
            layout: nameLayout, paint: namePaint
          }, 'venues-pins');

          // Blå ram runt stället i "Bäst nu", eller runt det valda stället när ett venue-kort är öppet (applyMapFocus).
          map.addLayer({
            id: 'venues-focus', type: 'symbol', source: 'venues', minzoom: PILL_MIN,
            filter: ['==', ['get', 'best'], 1],
            layout: {
              'icon-image': ['get', 'focus_image'],
              'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.85, 15, 1.05],
              'icon-anchor': 'center',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true
            }
          }, 'venues-pins');

          // Det valda ställets namn: ritas alltid, ovanpå grannarnas pillar. Filtret sätts av applyMapFocus.
          map.addLayer({
            id: 'venues-name-focus', type: 'symbol', source: 'venues', filter: ['has', '__ingen__'],
            layout: Object.assign({}, nameLayout, { 'text-allow-overlap': true, 'text-ignore-placement': true }),
            paint: namePaint
          });
          // Namn under de tomma ringarna, och det valda namnet när kortet gäller ett ställe utan data (applyMapFocus).
          map.addLayer({
            id: 'venues-empty-names', type: 'symbol', source: 'venues-empty', minzoom: 14,
            layout: nameLayout, paint: namePaint
          }, 'venues-empty-pins');
          map.addLayer({
            id: 'venues-empty-name-focus', type: 'symbol', source: 'venues-empty', filter: ['has', '__ingen__'],
            layout: Object.assign({}, nameLayout, { 'text-allow-overlap': true, 'text-ignore-placement': true }),
            paint: namePaint
          });

          // Liv på kartan kommer från data. En ring runt pillen andas bara när kön är lång OCH färsk (< 20 min) — samma regel
          // som den pulserande pricken i listan. Ställen med fri ingång pulserar inte längre: de är inte brådskande, och
          // en rörelse som inte betyder något tar bort värdet av den som gör det.
          // Ringen är en pill-formad bild (pill-ring) under pillen, så den följer pillens bredd i stället för att vara en cirkel.
          map.addLayer({
            id: 'venues-urgent', type: 'symbol', source: 'venues', minzoom: PILL_MIN,
            filter: ['all', ['==', ['get', 'urgent'], 1], ['!=', ['get', 'hidden'], 1]],
            layout: {
              'icon-image': ['get', 'ring_image'],
              'icon-size': ['interpolate', ['linear'], ['zoom'], 11, 0.85, 15, 1.05],
              'icon-anchor': 'center',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true
            },
            // Andningen ligger i feature-state "breath": ett nytt paint-uttryck per bildruta (det beror på feature-state, alltså
            // datadrivet) fick Mapbox att ladda om hela källan "venues" 60 gånger i sekunden, och kartan hackade.
            paint: { 'icon-opacity': pillsIn(['*', APPEAR, ['coalesce', ['feature-state', 'breath'], 0]]) }
          }, 'venues-pins');

          // Andning: opacity 0 → 0,7 → 0 på ~2,2 s, bara när något är brådskande och ringen syns (från PILL_MIN). Varje
          // ändring ritar om hela kartan, så inget skrivs i onödan. Ringen runt din position står still av samma skäl.
          var _breathStart = performance.now();
          function animateMapPulse() {
            // Bara på kartskärmen: annars ritade Mapbox om 60 gånger i sekunden hela natten bakom Lista och Live.
            if (map && !document.hidden && currentScreen === 'home') {
              var now = performance.now() - _breathStart;
              if (_urgentIds.length && map.getZoom() >= PILL_MIN) {
                var t = (now % 2200) / 2200, breath = 0.7 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
                _urgentIds.forEach(function(id) { map.setFeatureState({ source: 'venues', id: id }, { breath: breath }); });
              }
              stepMapMotion(performance.now());
            }
            requestAnimationFrame(animateMapPulse);
          }
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            requestAnimationFrame(animateMapPulse);
          } else {
            // Stillbild i stället för rörelse: ringen syns, den andas inte
            map.setPaintProperty('venues-urgent', 'icon-opacity', pillsIn(['*', APPEAR, 0.55])); // APPEAR: se applyMapFocus
          }

          // En lyssnare för alla: features[0] är den översta. "+N" zoomar in mot pillen; en pill vinner över en tom ring
          // under den. Prickarna (utzoomat) går också att trycka på, de är bara små.
          map.on('click', ['venues-more', 'venues-pins', 'venues-icons', 'venues-empty-pins', 'venues-empty-dots'], function(e) {
            var f = e.features[0];
            if (f.layer.id === 'venues-more') {
              map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(map.getZoom() + 1.5, 18), duration: 500 });
              return;
            }
            var venue = getVenueById(f.properties.id);
            console.log('[QueueBar] Kartmarkörsklick:', f.properties.id);
            if (venue) openVenueCard(venue, 'karta');
          });

          ['venues-more', 'venues-pins', 'venues-icons', 'venues-empty-pins', 'venues-empty-dots'].forEach(function(l) {
            map.on('mouseenter', l, function() { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', l, function() { map.getCanvas().style.cursor = ''; });
          });
          // Kapseln följer stället när kartan rör sig. Ett tryck på kartan utanför ett ställe stänger den, som ett tryck
          // utanför ett ark; ett tryck på ett annat ställe öppnar dess kapsel (klicket ovan).
          map.on('move', vcPlace);
          map.on('click', function(e) {
            if (_vcMode !== 'map') return;
            if (map.queryRenderedFeatures(e.point, { layers: ['venues-more', 'venues-pins', 'venues-icons', 'venues-empty-pins', 'venues-empty-dots'] }).length) return;
            closeVenueCard();
          });
          // Avstånden på skärmen ändras med zoom och lutning: räkna om vilka pillar som krockar när kartan står still.
          map.on('moveend', declutterPills);

          // Standard lyser upp kartan med sitt eget ljus. Våra lager ska inte dämpas av det: nålar, glöd och namn lyser
          // själva, så statusfärgerna ser likadana ut i alla karttyper. Bara våra lager finns i getStyle().layers;
          // Standards egna ligger i en import.
          map.getStyle().layers.forEach(function(l) {
            try {
              if (l.type === 'circle') map.setPaintProperty(l.id, 'circle-emissive-strength', 1);
              if (l.type === 'symbol') { map.setPaintProperty(l.id, 'icon-emissive-strength', 1); map.setPaintProperty(l.id, 'text-emissive-strength', 1); }
            } catch (e) { console.warn('[QueueBar] Lyskraft hoppades över:', l.id, e.message); }
          });

          // Uppdatera markörerna med ev. redan inladdad data
          applyMapFocus();
          if (allReports.length > 0) updateMapStatuses();

          // Startkamera: en gång, när kartan öppnas. Ramar in alla ställen i den del av kartan som syns mellan sökfältet och
          // "Bäst nu"-kortet, zoomar in från lite längre ut och lutar kartan 28° så att staden får djup.
          // Lutningen hålls lågt med flit: högre döljer ställen bakom hus och gör pillerna svåra att träffa. Användaren kan
          // själv luta med två fingrar (touchPitch); dragRotate är fortfarande avstängt. Bara om användaren inte redan rört kartan,
          // och hoppas över med rörelsebegränsning (då startar kartan direkt i sitt slutläge).
          var start = startCamera();
          var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          if (reduceMotion) {
            map.jumpTo({ center: start.center, zoom: start.zoom, pitch: 28 });
          } else {
            map.jumpTo({ center: start.center, zoom: start.zoom - 1, pitch: 0 });
            // Inzoomningen väntar tills introt är borta; annars är den slut innan någon ser den.
            afterSplash(function() {
              setTimeout(function() {
                // Vyn räknas om här, efter introt: vid kartans load har rapporterna ofta inte kommit, och då ramades alla
                // 28 ställen in i stället för de med färsk data.
                if (map && !_userMovedMap) { var s = startCamera(); map.easeTo({ center: s.center, zoom: s.zoom, pitch: 28, duration: 2200, easing: function(t) { return 1 - Math.pow(1 - t, 3); } }); }
              }, 150);
            });
          }
          console.log('[QueueBar] Kartlager klara');
        });

        // Startvyn ramar in ställena med färsk data (annars alla 28) mellan sökfältet och "Bäst nu"-kortet. Zoomen hålls
        // nere vid 12,4, så startvyn visar väntetider och inte en utzoomad karta full av kluster; ett ställe långt ut
        // kan då hamna utanför bild, men det som händer syns.
        function startCamera() {
          var bounds = new mapboxgl.LngLatBounds();
          var live = VENUES.filter(function(v) { return computeStatus(v.id, allReports) !== 'unknown'; });
          (live.length >= 2 ? live : VENUES).forEach(function(v) { bounds.extend([v.lng, v.lat]); });
          var cam = map.cameraForBounds(bounds, { pitch: 28, padding: mapViewPadding() });
          return cam ? { center: cam.center, zoom: Math.min(14, Math.max(12.4, cam.zoom)) } : { center: map.getCenter(), zoom: 12.6 };
        }
        var _userMovedMap = false;
        ['dragstart', 'zoomstart', 'pitchstart'].forEach(function(ev) {
          map.on(ev, function(e) { if (e.originalEvent) _userMovedMap = true; });
        });

        // Bara fel som hindrar kartan från att starta (stil, token) stänger av den. Efter start loggas felen: ett tappat
        // tile-anrop på dålig 4G eller ett fel i ett enskilt lager lämnar resten av kartan fungerande. Tidigare nollades
        // kartan av vilket fel som helst, och var borta resten av kvällen.
        map.on('error', function(e) {
          var msg = e.error ? e.error.message : e;
          if (_mapStarted || e.sourceId || e.tile) { console.warn('[QueueBar] Mapbox-fel, kartan fortsätter:', msg); return; }
          console.error('[QueueBar] Mapbox-fel:', msg);
          map = null;
          showMapError('Kartan kunde inte laddas');
        });

      } catch(err) {
        console.error('[QueueBar] Mapbox init kastade:', err);
        map = null;
        showMapError('Kartan kunde inte startas');
      }
    }, function(err) {
      console.error('[QueueBar] Mapbox laddades inte:', err);
      showMapError('Mapbox GL JS laddades inte');
    });

    // ── Supabase-funktioner ──────────────────────────────────────────────────
    function getUserId() {
      var id = localStorage.getItem('qb_user_id');
      if (!id) {
        id = 'user-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('qb_user_id', id);
      }
      return id;
    }

    function showExploreError() {
      vcPark();
      var el = document.getElementById('explore-list');
      if (!el) return;
      el.innerHTML = '<div class="explore-error-state">' +
        '<div class="explore-err-title">Ingen kontakt med servern</div>' +
        '<div class="explore-err-sub">Vi vet inte hur köerna ser ut just nu.</div>' +
        '<button class="explore-err-btn" onclick="loadReports()">Försök igen</button>' +
        '</div>';
    }

    // Hur det gick med den senaste inläsningen: 'loading' | 'ok' | 'error'.
    // Utan den här kan en tom vy inte skilja "inga rapporter i Stockholm" från "vi nådde
    // inte servern", och ett serverfel visades som en lugn kväll.
    var _loadState = 'loading';
    var _lastLoadAt = 0; // senaste lyckade läsningen, för pollningen

    // Ritar om allt som visar köer ur allReports och _loadState: kartan, "Bäst nu", listan, Live, profilen, bannern och
    // ett öppet venue-kort. Samma väg efter en lyckad läsning, vid fel och när telefonen väcks — så att gammalt ser
    // gammalt ut överallt samtidigt.
    function renderReports() {
      updateMapStatuses();
      renderBestNowCard();
      if (typeof renderExploreVenues === 'function') renderExploreVenues();
      if (typeof renderLiveFeed === 'function') renderLiveFeed();
      if (typeof updateProfileStats === 'function') updateProfileStats();
      updateOnMyWayUI();
      refreshVenueCard();
      updateConnectionToast();
    }

    // Vid fel: behåll rapporterna vi redan har, men märk dem som osäkra. Finns inga alls är felläget allt vi kan visa
    // (renderExploreVenues visar det). En fungerande lista töms aldrig för att en enda pollning missade — raderna ritas
    // om så att de åldras under varningen i stället för att stå kvar som färska.
    function renderLoadFailure() {
      renderReports();
    }

    // Varje läsning får ett löpnummer. Bara den senast startade får skriva — annars kunde en långsam pollning som
    // svarade sist skriva över ett nyare svar, och användarens nyss skickade rapport försvann från skärmen.
    var _loadSeq = 0;
    async function loadReports() {
      if (!supabase) {
        console.warn('[QueueBar] loadReports: supabase är null');
        _loadState = 'error';
        if (testDataEnabled()) injectTestData();
        renderReports();
        return;
      }
      var seq = ++_loadSeq;
      console.log('[QueueBar] loadReports startar');
      var now = new Date().toISOString();
      try {
        // Alla icke-utgångna rapporter (≤45 min). Ett lägre tak tappade kö-sessionernas första mätpunkt en full kväll
        // och tystade takten (B-05). 1000 är PostgREST:s standardtak för max-rows. 15 s tidsgräns: på dåligt nät efter
        // att telefonen väckts hänger annars läsningen, och appen säger varken "ok" eller "ingen kontakt".
        var query = supabase.from('reports').select('*', { count: 'exact' }).gte('expires_at', now).order('created_at', { ascending: false }).limit(1000);
        if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) query = query.abortSignal(AbortSignal.timeout(15000));
        var result = await query;
        if (seq !== _loadSeq) return;
        if (result.data && result.count > result.data.length) {
          console.warn('[QueueBar] loadReports: ' + result.count + ' aktiva rapporter men bara ' + result.data.length + ' lästa — äldsta saknas');
        }
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
          _lastLoadAt = Date.now();
          // Bara kända ställen: venue_id hamnar i onclick-attribut och okända id:n kan inte visas meningsfullt ändå.
          allReports = result.data.filter(function(r) { return getVenueById(r.venue_id); });
          console.log('[QueueBar] loadReports: ' + allReports.length + ' Supabase-rapporter inladdade');
          if (testDataEnabled()) injectTestData();
          renderReports();
          // Kortets "N på väg" och prognos använder antalen — rita om det när de har kommit, inte en pollning senare.
          loadOnMyWayCounts().then(function() { updateOnMyWayUI(); refreshVenueCard(); });
        }
      } catch(err) {
        if (seq !== _loadSeq) return;
        console.error('[QueueBar] loadReports kastade:', err);
        _loadState = 'error';
        renderLoadFailure();
      }
    }

    // Telefonen väcks efter en stund i fickan: rita om direkt ur det vi har (så att 23:10-läget ser gammalt ut klockan
    // 01:30 i stället för färskt), läs sedan in nytt.
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState !== 'visible') return;
      renderReports();
      if (supabase) loadReports();
    });

    // Texten på pillen: samma källa som listan och kortet (venueWaitText), men korta former så pillen håller sig smal.
    // "Ingen kö" blir "Fri", som i listan. Tom text = vi vet inget, och då ritas ingen pill.
    function pillText(venueId) {
      var t = venueWaitText(venueId) || '';
      if (t === 'Ingen kö') return 'Fri';
      return t.replace(/\s*min$/, '');
    }

    // Brådskande = lång kö OCH en kö-rapport yngre än 20 min. Exakt samma regel som den pulserande pricken i listan
    // (showPulseDot i renderExploreVenueRow), så kartan och listan aldrig är oense om vad som är akut.
    var _urgentIds = [];
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
      if (!map.getSource('venues') || !map.getSource('venues-empty')) return;
      _urgentIds = [];
      var best = computeBestNow(), bestId = best ? best.venue.id : null;
      var updated = venueGeoJSON.features.filter(function(f) { return venueTypeMatches(f.properties); }).map(function(f) {
        var id = f.properties.id;
        var status = computeStatus(id, allReports);
        var text = pillText(id);
        // Pillens bildnamn bär allt som ritas: status (färg), typ (ikon) och text. Bilden skapas första gången kartan ber om den.
        var pill = status === 'unknown' || !text ? '' : 'pill|' + status + '|' + (f.properties.type === 'bar' ? 'bar' : 'club') + '|' + text;
        var urgent = pill && isUrgent(id, status);
        if (urgent) _urgentIds.push(id);
        return Object.assign({}, f, {
          properties: Object.assign({}, f.properties, {
            status: pill ? status : 'unknown',
            pill_image: pill,
            urgent: urgent ? 1 : 0,
            ring_image: urgent ? 'ring|' + text : '',
            focus_image: pill ? 'focus|' + text : '',
            best: id === bestId ? 1 : 0,
            closed: isClosed(getVenueById(id)) ? 1 : 0,
            aging: pill && latestQueueAgeMin(id) >= 15 ? 1 : 0
          })
        });
      });
      _livePills = updated.filter(function(f) { return f.properties.pill_image; });
      map.getSource('venues-empty').setData({ type: 'FeatureCollection', features: updated.filter(function(f) { return !f.properties.pill_image; }) });
      trackMapChanges(updated);
      applyMapFocus();
    }

    // Pillar som krockar på skärmen: den viktigaste syns (valt ställe, "Bäst nu", sedan längst kö) och får "+N" för dem den
    // skymmer; de andra döljs tills man zoomat in så långt att de får plats. Räknas här i stället för av Mapbox kollision,
    // så att "+N" och det som döljs alltid är samma sak. Körs efter ny data, nytt val och varje kartrörelse (moveend).
    var _livePills = [], _declutterDone = null, _declutterSel;
    var DECLUTTER_RANK = { long: 4, medium: 3, short: 2, none: 1 };
    function declutterPills() {
      if (!map || !map.getSource('venues')) return;
      var sel = activeVenue ? activeVenue.id : null, z = map.getZoom(), low = z < PILL_MIN;
      // Utzoomat syns bara ikonerna. Pillarna sorteras då som de skulle stå vid PILL_MIN (avstånden skalas ned), så att
      // rätt pillar tonar fram när man zoomar in, och bara när datan eller valet har ändrats. Förut skrevs hela källan om
      // efter varje kartrörelse, även när inget kunde krocka annorlunda.
      if (low && _declutterDone === _livePills && _declutterSel === sel) return;
      var k = low ? Math.pow(2, PILL_MIN - z) : 1, zz = low ? PILL_MIN : z;
      var scale = 0.85 + 0.05 * Math.max(0, Math.min(4, zz - 11)); // samma som pillarnas icon-size
      var items = _livePills.map(function(f) {
        var p = map.project(f.geometry.coordinates), text = f.properties.pill_image.split('|').slice(3).join('|');
        // Bredden som drawPill ritar: kant och marginaler ~40 px, ~8 px per tecken och "min" ~20 px.
        var w = (40 + text.length * 8 + (/\d/.test(text) ? 20 : 0)) * scale;
        return { f: f, x: p.x * k, y: p.y * k, w: w, h: 32 * scale, more: 0, hidden: 0,
          // Samma status: "Fullt" före ett intervall, färsk data före 15–45 min gammal.
          rank: f.properties.id === sel ? 10 : f.properties.best ? 9 : (DECLUTTER_RANK[f.properties.status] || 0) +
            (text === 'Fullt' ? 0.5 : 0) + (f.properties.aging ? 0 : 0.25) };
      }).sort(function(a, b) { return b.rank - a.rank; });
      var shown = [];
      items.forEach(function(it) {
        var hit = shown.find(function(s) { return Math.abs(s.x - it.x) < (s.w + it.w) / 2 + 2 && Math.abs(s.y - it.y) < (s.h + it.h) / 2 + 2; });
        if (hit) { hit.more++; it.hidden = 1; } else shown.push(it);
      });
      map.getSource('venues').setData({ type: 'FeatureCollection', features: items.map(function(it) {
        return Object.assign({}, it.f, { properties: Object.assign({}, it.f.properties, { hidden: it.hidden, more: it.more }) });
      }) });
      _declutterDone = low ? _livePills : null;
      _declutterSel = sel;
    }

    // Minuter sedan senaste kömätningen, som i listan (isAging: 15–45 min). Infinity om ingen finns.
    function latestQueueAgeMin(venueId) {
      var latest = allReports.reduce(function(m, r) {
        return r.venue_id === venueId && isQueueReport(r) ? Math.max(m, new Date(r.created_at).getTime()) : m;
      }, 0);
      return latest ? (Date.now() - latest) / 60000 : Infinity;
    }

    // Kartans fokus. Utan öppet kort: blå ram runt "Bäst nu" (eller klustret det ligger i). Med öppet kort: ramen och
    // namnet flyttar till det valda stället, som ritas överst, och övriga tonas ned. Data som är 15–45 min gammal är
    // blekare, som i listan — gammal data ska se gammal ut.
    var PIN_SORT_KEY = ['match', ['get', 'status'], 'long', 4, 'medium', 3, 'short', 2, 'none', 1, 0]; // längre köer överst
    var _lastFocusSel; // senast satta val i sorteringsnyckeln (undefined = inte satt än)
    function applyMapFocus() {
      if (!map || !map.getLayer('venues-focus')) return;
      var sel = activeVenue ? activeVenue.id : null;
      var isSel = sel ? ['==', ['get', 'id'], sel] : false;
      var dim = sel ? ['!=', ['get', 'id'], sel] : false;
      var none = ['has', '__ingen__']; // alltid falskt; ['==', 1, 0] tolkas som gammalt filter och kraschar kartan
      var focusFilter = ['all', ['!=', ['get', 'focus_image'], ''], sel ? isSel : ['==', ['get', 'best'], 1]];
      map.setFilter('venues-focus', focusFilter);
      map.setFilter('venues-icon-focus', focusFilter);
      map.setFilter('venues-name-focus', sel ? isSel : none);
      map.setFilter('venues-empty-name-focus', sel ? isSel : none);
      // Sorteringsnyckeln är en layoutegenskap: att sätta den tvingar Mapbox att placera om alla symboler. Bara när valet
      // ändras.
      if (sel !== _lastFocusSel) {
        var sortKey = ['case', isSel, 10, PIN_SORT_KEY];
        map.setLayoutProperty('venues-pins', 'symbol-sort-key', sortKey);
        map.setLayoutProperty('venues-icons', 'symbol-sort-key', sortKey);
        _lastFocusSel = sel;
      }
      // Pillar och ikoner tonar över i varandra mellan PILL_MIN och PILL_FULL, med samma tonade val och gamla data.
      var pinOpacity = ['*', APPEAR, ['case', dim, 0.3, ['==', ['get', 'aging'], 1], 0.6, 1]];
      map.setPaintProperty('venues-pins', 'icon-opacity', pillsIn(pinOpacity));
      map.setPaintProperty('venues-icons', 'icon-opacity', iconsOut(pinOpacity));
      // Stängt tonas mer än "ingen rapport än" — annars såg en stängd bar ut som en inbjudan att gå dit och rapportera.
      map.setPaintProperty('venues-empty-pins', 'icon-opacity', ['case', dim, 0.3, ['==', ['get', 'closed'], 1], 0.3, 0.9]);
      var emptyDotOpacity = ['case', dim, 0.2, ['==', ['get', 'closed'], 1], 0.25, 0.85];
      map.setPaintProperty('venues-empty-dots', 'circle-opacity', emptyDotOpacity);
      map.setPaintProperty('venues-empty-dots', 'circle-stroke-opacity', emptyDotOpacity);
      map.setPaintProperty('venues-focus', 'icon-opacity', pillsIn(APPEAR));
      map.setPaintProperty('venues-icon-focus', 'circle-stroke-opacity', iconsOut(APPEAR));
      map.setPaintProperty('venues-more', 'text-opacity', pillsIn(['*', APPEAR, ['case', dim, 0.3, 1]]));
      // Med öppet kort visas bara det valda namnet (eget lager); grannarnas namn skulle krocka med det.
      // Varje symbollager på källan "venues" måste bero på feature-state (APPEAR), även när värdet är fast. Annars
      // kraschar Mapbox (3.33) i updateBuckets när kartans ljus räknas om: lagret har feature-state men inga
      // state-beroende lager, och bucket.update läser layers[0] ur en tom lista ("reading 'paint'"). Det hände när en
      // kapsel öppnades, eftersom namnen då fick opacitet 0 och det valda namnet aldrig berodde på feature-state.
      map.setPaintProperty('venues-names', 'text-opacity', ['*', APPEAR, sel ? 0 : ['case', ['==', ['get', 'aging'], 1], 0.6, 1]]);
      map.setPaintProperty('venues-name-focus', 'text-opacity', APPEAR);
      map.setPaintProperty('venues-empty-names', 'text-opacity', sel ? 0 : 1);
      // Gammal data (15–45 min) glöder svagare.
      map.setPaintProperty('venues-glow', 'circle-opacity',
        ['*', APPEAR, ['case', dim, 0.08, ['==', ['get', 'aging'], 1], 0.15, 0.3]]);
      declutterPills(); // valt ställe och "Bäst nu" får aldrig döljas bakom en annan pill
    }

    // ── Kartans rörelse ──────────────────────────────────────────────────
    // Allt som rör sig betyder något: pillarna kommer fram i ordning (längst kö först) när kartan visas, en pill som byter
    // värde tonar in på nytt, och en ny rapport skickar ut en våg från stället. Inget av det vid reducerad rörelse.
    var APPEAR = ['coalesce', ['feature-state', 'appear'], 1]; // 0 → 1 medan en pill tonar in, annars saknas (= 1)
    // Siffror från zoom PILL_MIN, helt framme vid PILL_FULL; utzoomat runda ikoner (venues-icons) som tonar ut i samma
    // intervall. Över hela stan visar färgen var kvällen händer, inzoomat på ett område jämför man siffrorna.
    var PILL_MIN = 13.25, PILL_FULL = 13.75;
    var ICON_SIZE_MIN = 0.55, ICON_SIZE_MAX = 0.75; // ikonens icon-size vid zoom 11 och vid PILL_FULL
    function iconScale(z) { return ICON_SIZE_MIN + (ICON_SIZE_MAX - ICON_SIZE_MIN) * Math.max(0, Math.min(1, (z - 11) / (PILL_FULL - 11))); }
    function pillsIn(v) { return ['interpolate', ['linear'], ['zoom'], PILL_MIN, 0, PILL_FULL, v]; }
    function iconsOut(v) { return ['interpolate', ['linear'], ['zoom'], PILL_MIN, v, PILL_FULL, 0]; }
    var _reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var _appear = {};         // venueId → { start, dur, from } medan pillen tonar in; start Infinity = väntar dold
    var _ripples = [];        // { lng, lat, color, start }
    var _ripplesShown = false;
    var _prevPill = null;     // venueId → pill_image vid förra uppdateringen; null = kartan har inte visat data än
    var _seenReports = null;  // kö-rapporternas id:n vid förra uppdateringen
    var INTRO_RANK = { long: 3, medium: 2, short: 1 }; // längst kö först

    // Kör fn när introt är borta (index.html skickar qb:splashdone), eller direkt om det inte spelas.
    function afterSplash(fn) {
      if (document.getElementById('splash')) document.addEventListener('qb:splashdone', fn, { once: true });
      else fn();
    }

    function trackMapChanges(features) {
      // Innan första lyckade läsningen finns inget att visa fram — en GPS-position eller ett fel före datan förbrukade
      // annars "första gången", och pillarnas intro (längst kö först) uteblev när datan väl kom.
      if (_prevPill === null && _loadState !== 'ok') return;
      var pills = {}, seen = {};
      features.forEach(function(f) { pills[f.properties.id] = f.properties.pill_image; });
      allReports.forEach(function(r) { if (isQueueReport(r)) seen[r.id] = r; });
      if (!_reduceMotion && _prevPill === null) {
        // Första gången: dölj alla pillar och släpp fram dem längst kö först, 70 ms isär, när introt är borta.
        var order = features.filter(function(f) { return f.properties.pill_image; }).sort(function(a, b) {
          return (INTRO_RANK[b.properties.status] || 0) - (INTRO_RANK[a.properties.status] || 0);
        });
        order.forEach(function(f) {
          _appear[f.properties.id] = { start: Infinity, dur: 420 };
          map.setFeatureState({ source: 'venues', id: f.properties.id }, { appear: 0 }); // nu, inte först nästa bildruta
        });
        afterSplash(function() {
          var t0 = performance.now() + 250;
          order.forEach(function(f, i) { if (_appear[f.properties.id]) _appear[f.properties.id].start = t0 + i * 70; });
        });
      } else if (!_reduceMotion) {
        var now = performance.now();
        features.forEach(function(f) {
          var id = f.properties.id;
          if (pills[id] && pills[id] !== _prevPill[id]) _appear[id] = { start: now, dur: 420, from: 0.25 };
        });
        Object.keys(seen).forEach(function(rid) {
          // Vågen betyder "ny rapport just nu": bara yngre än 2 min och vid öppna ställen. Efter att telefonen väckts
          // gick annars sex vågor samtidigt för rapporter som var 25 min gamla.
          var fresh = Date.now() - new Date(seen[rid].created_at).getTime() < 2 * 60000;
          var v = !_seenReports[rid] && fresh && getVenueById(seen[rid].venue_id);
          if (v && isClosed(v)) v = null;
          if (v && _ripples.length < 6) _ripples.push({ lng: v.lng, lat: v.lat, color: getStatusColor(computeStatus(v.id, allReports)), start: now });
        });
      }
      _prevPill = pills;
      _seenReports = seen;
    }

    // En bildruta: pillar som tonar in (feature-state "appear") och vågor som växer. Anropas från kartans rAF-slinga.
    function stepMapMotion(now) {
      Object.keys(_appear).forEach(function(id) {
        var a = _appear[id];
        if (now < a.start) return; // väntar dold (appear 0 är redan satt); att skriva den igen ritade om kartan under introt
        var k = Math.min(1, (now - a.start) / a.dur), from = a.from || 0;
        map.setFeatureState({ source: 'venues', id: id }, { appear: from + (1 - from) * (1 - Math.pow(1 - k, 3)) });
        if (k >= 1) delete _appear[id];
      });
      if (!_ripples.length && !_ripplesShown) return;
      _ripples = _ripples.filter(function(r) { return now - r.start < 1400; });
      map.getSource('ripples').setData({ type: 'FeatureCollection', features: _ripples.map(function(r) {
        var k = (now - r.start) / 1400;
        return { type: 'Feature', geometry: { type: 'Point', coordinates: [r.lng, r.lat] }, properties: { k: 1 - Math.pow(1 - k, 2), color: r.color } };
      }) });
      _ripplesShown = _ripples.length > 0;
    }

    // Realtime ersätter pollningen när den är uppkopplad. En skur ändringar blir en enda läsning per klient, utspridd
    // över 1–4 s så att inte alla klienter frågar samtidigt. Payloaden används inte: realtime skickar timestamptz
    // orörd i Postgres-format ("2026-10-29 21:00:00+00"), som Date inte tolkar likadant i alla webbläsare.
    var _realtimeLive = false, _reloadTimer = null;
    function subscribeToReports() {
      if (!supabase) return;
      supabase.channel('reports').on('postgres_changes', { event: '*', schema: 'public', table: 'reports' }, function() {
        if (_reloadTimer) return;
        _reloadTimer = setTimeout(function() { _reloadTimer = null; loadReports(); }, 1000 + Math.random() * 3000);
      }).subscribe(function(status) {
        _realtimeLive = status === 'SUBSCRIBED';
        console.log('[QueueBar] Realtime: ' + status);
      });
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

    // Synligt testläge: påhittade köer får aldrig misstas för riktiga (etiketten i style.css, .qb-testdata).
    document.documentElement.classList.toggle('qb-testdata', testDataEnabled());
    if (testDataEnabled()) _testNightMin = 23 * 60; // testdatan är en kväll, se minutesToClose

    // Tangentbord: Escape stänger det som ligger överst (snabbarket, sedan venue-kortet), som en tryckning utanför gör.
    // Enter/mellanslag på en rad med role="button" (Utforska, Live) gör samma sak som ett tryck.
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        var sheet = document.getElementById('qr-sheet');
        if (sheet && sheet.style.display === 'block') { closeQuickReport(); return; }
        var msMenu = document.getElementById('map-style-menu');
        if (msMenu && !msMenu.hidden) { toggleMapStyleMenu(false); document.getElementById('map-style-btn').focus(); return; }
        if (_vcMode) closeVenueCard();
        return;
      }
      var row = e.target;
      if ((e.key === 'Enter' || e.key === ' ') && row && row.getAttribute && row.getAttribute('role') === 'button' && row.tagName !== 'BUTTON') {
        e.preventDefault();
        row.click();
      }
    });

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
        r('kristall', 35, 37), r('kristall', 10, 60), r('kristall', 2, 60, { comment: 'Fri entré t.o.m. 23:30' }),
        r('berns', 28, 17), r('berns', 15, 37), r('berns', 3, 37),
        r('sturecompagniet', 40, 17), r('sturecompagniet', 20, 37), r('sturecompagniet', 5, 37),
        r('sturehof', 30, 5), r('sturehof', 10, 17),
        r('soap-bar', 40, 5), r('soap-bar', 15, 17), r('soap-bar', 3, 17),
        r('pelikan', 35, 17), r('pelikan', 12, 37),
        r('akkurat', 20, 5), r('akkurat', 6, 17),
        r('neu', 35, 5), r('neu', 18, 17), r('neu', 4, 37),
        r('tak', 30, 37), r('tak', 12, 37), r('tak', 4, 17),
        r('pharmarium', 15, 17), r('pharmarium', 1, 5),
        // ingen kö
        r('tjoget', 25, 0), r('tjoget', 8, 0),
        r('morfar-ginko', 30, 0), r('morfar-ginko', 10, 0),
        r('solidaritet', 30, 0), r('solidaritet', 10, 0),
        // gammal data (25 min) — visas som "kan vara gammal"
        r('nalen', 40, 5), r('nalen', 25, 0)
      ];
      // Remove old test entries, then prepend fresh ones
      allReports = allReports.filter(function(r) { return !r.id || !String(r.id).startsWith('test-'); });
      allReports = testReports.concat(allReports);
      console.log('[QueueBar] injectTestData: ' + testReports.length + ' testrap injicerade, totalt ' + allReports.length + ' rapporter för ' + VENUES.length + ' venues');

      // Historical patterns for test mode — simulate typical Friday night data
      // Sturecompagniet under tröskeln (3) — ska inte visas.
      _omwTestCounts = { 'spy-bar': 5, 'berns': 3, 'sturecompagniet': 2 };
      // Kristall: ingen session ikväll men dörrtakt från tidigare fredagar.
      _historicalRatesTest = { 'kristall': { rate: 0.7, n: 6 } };
      _historicalRates = Object.assign({}, _historicalRates, _historicalRatesTest);
      var testDow = new Date().getDay();
      var testHour = new Date().getHours();
      _historicalPatterns = {
        'kristall':        { level: 'long',   count: 8,  dow: testDow, hour: testHour },
        'spy-bar':         { level: 'long',   count: 6,  dow: testDow, hour: testHour },
        'sturecompagniet': { level: 'medium', count: 5,  dow: testDow, hour: testHour },
        'berns':           { level: 'short',  count: 4,  dow: testDow, hour: testHour },
        'under-bron':      { level: 'none',   count: 3,  dow: testDow, hour: testHour }
      };
    }

    // Fel som användaren ska läsa som de står (spärrar, testläge, stängt). Allt annat blir en allmän text.
    function userError(text) { var e = new Error(text); e.userText = text; return e; }

    // Testläget (?testdata=true / Alt + 2) visar påhittade köer. Inget därifrån får nå de riktiga tabellerna: en
    // provrapport syntes annars hos alla, räknad med testdatans påhittade takter.
    function assertNotTestMode() {
      if (testDataEnabled()) throw userError('Testläge: inget skickas. Stäng av med Alt + 2.');
    }

    // Långt från stället: över 300 m, med GPS:ens osäkerhet (högst 100 m) till din fördel. Utan position antar vi att
    // du är där — vi vet inte bättre, och de flesta rapporterar kön de står i.
    function isFarFrom(venue) {
      var km = distanceKmTo(venue);
      return km !== null && km - Math.min(window._userPos.acc || 0, 100) / 1000 > 0.3;
    }

    async function submitReport(venueId, venueName, peopleAhead, comment) {
      if (!supabase) throw new Error('Supabase är inte tillgänglig');
      assertNotTestMode();
      var venue = getVenueById(venueId);
      if (isClosed(venue)) throw userError(venueName + ' har stängt');
      // Står du redan i kön här blir rapporten en del av samma session — med samma regler som bannern: ett sent "inne"
      // frågar först, uppföljningar kräver ≥4 min mellanrum och högst fyra stycken, och kommentaren följer med. Långt
      // ifrån, för tätt eller efter fyra uppföljningar blir det en vanlig ny rapport (med 20-minutersspärren).
      var s = getQueueSession();
      if (s && s.venueId === venueId && !isFarFrom(venue)) {
        var since = Date.now() - s.lastAt;
        if (peopleAhead === 0) {
          if (since > QS_STALE_GAP) {
            _qsAskWhen = true;
            updateOnMyWayUI();
            throw userError('Kom du in nyss? Svara i rutan högst upp.');
          }
          await recordEntered(s);
          return true;
        }
        if (since >= QS_MIN_GAP && s.followups < QS_MAX_FOLLOWUPS) {
          await recordFollowup(peopleAhead, comment);
          return true;
        }
      }
      var userId = getUserId();
      var now = new Date();
      var recent = allReports.filter(function(r) { return r.user_id === userId && isQueueReport(r) && (now - new Date(r.created_at)) < 20 * 60 * 1000; });
      if (recent.length > 0) {
        var wait = Math.ceil(20 - (now - new Date(recent[0].created_at)) / 60000);
        throw userError('Vänta ' + wait + (wait === 1 ? ' minut' : ' minuter') + ' innan du rapporterar igen (gäller alla ställen)');
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
        // Bara när kolumnen saknas (PostgREST PGRST204 / Postgres 42703) — ett annat fel som nämner "comment" ska inte
        // tyst kasta bort kommentaren.
        if (comment && result.error && (result.error.code === 'PGRST204' || result.error.code === '42703')) {
          delete insertObj.comment;
          result = await supabase.from('reports').insert(insertObj);
        }
      } catch(e) { result = { error: e }; }
      if (result.error) throw result.error;
      // Den som rapporterar vid stället är framme: "På väg" är över, och en kö-session startar om det finns en kö att stå
      // i. Långt ifrån (vidarebefordrat sms, gissning) räknas rapporten, men ingen "I kön" och ingen ändring av "På väg"
      // — annars blev någon hemma en mätpunkt för dörrens takt.
      if (!isFarFrom(venue)) {
        if (_onMyWay) cancelOnMyWay();
        if (peopleAhead > 0) startQueueSession({ id: insertObj.queue_session, venueId: venueId, venueName: venueName, ahead: peopleAhead, at: now.getTime() });
        else endQueueSession(); // en gammal kö på ett annat ställe står man inte längre i
      }
      loadReports(); // i bakgrunden — tacket ska synas direkt
      return true;
    }

    function newQueueSessionId() {
      return 'qs-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    function reportErrorText(err) {
      if (err && err.userText) return err.userText;
      var msg = (err && err.message) || '';
      if (msg.indexOf('rate_limited') >= 0) return 'Du har redan rapporterat nyss. Vänta en stund.';
      if (msg.indexOf('too_soon') >= 0) return 'Vänta några minuter innan du uppdaterar igen';
      if (msg.indexOf('session_') >= 0) return 'Din kö-rapport har gått ut. Rapportera på nytt.';
      return 'Något gick fel. Försök igen.';
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
      _qsAskWhen = false; // en obesvarad fråga om förra kön gäller inte den nya
      var s = { id: r.id, venueId: r.venueId, venueName: r.venueName, startedAt: r.at, lastAhead: r.ahead, lastAt: r.at, followups: 0 };
      try { localStorage.setItem(QS_KEY, JSON.stringify(s)); } catch(e) {}
      updateOnMyWayUI();
    }

    function endQueueSession() {
      try { localStorage.removeItem(QS_KEY); } catch(e) {}
      _qsAskWhen = false;
      updateOnMyWayUI();
    }

    async function submitSessionReport(type, peopleAhead, comment) {
      var s = getQueueSession();
      if (!s) throw new Error('session_expired');
      if (!supabase) throw new Error('Supabase är inte tillgänglig');
      assertNotTestMode();
      var now = new Date();
      var draft = { venue_id: s.venueId, people_ahead: peopleAhead, report_type: 'initial', created_at: now.toISOString() };
      var rateContext = allReports.filter(function(r) { return r.venue_id !== s.venueId || !isQueueReport(r); });
      var row = {
        venue_id: s.venueId, venue_name: s.venueName, user_id: getUserId(),
        queue_status: waitToStatus(estimateWait(s.venueId, [draft].concat(rateContext))),
        people_ahead: peopleAhead, report_type: type, queue_session: s.id,
        expires_at: new Date(now.getTime() + 45 * 60 * 1000).toISOString()
      };
      if (comment) row.comment = comment;
      var result = await supabase.from('reports').insert(row);
      if (result.error) throw result.error;
      return { session: s, at: now.getTime() };
    }

    function queueSessionUpdate() {
      var s = getQueueSession();
      if (!s) return;
      if (Date.now() - s.lastAt < QS_MIN_GAP) {
        var m = Math.ceil((QS_MIN_GAP - (Date.now() - s.lastAt)) / 60000);
        showToast('Vänta ' + m + (m === 1 ? ' minut' : ' minuter') + ' innan du uppdaterar');
        return;
      }
      openQuickReport(s.venueId, 'followup');
    }

    // En mätpunkt till i samma kö. Kastar vid fel — anroparen visar texten.
    async function recordFollowup(peopleAhead, comment) {
      var res = await submitSessionReport('followup', peopleAhead, comment);
      var s = res.session;
      s.lastAhead = peopleAhead; s.lastAt = res.at; s.followups++;
      try { localStorage.setItem(QS_KEY, JSON.stringify(s)); } catch(e) {}
      updateOnMyWayUI();
      loadReports();
    }

    async function submitQueueFollowup(peopleAhead) {
      try {
        await recordFollowup(peopleAhead);
        showToast('Uppdaterat. Nu syns hur snabbt kön rör sig.');
      } catch(err) { showToast(reportErrorText(err)); }
    }

    // Sista punkten: inne. Kastar vid fel.
    async function recordEntered(s) {
      var res = await submitSessionReport('entered', 0);
      endQueueSession();
      loadReports();
      return Math.max(1, Math.round((res.at - s.startedAt) / 60000));
    }

    // "Jag är inne". Har det gått mer än 20 min sedan förra mätpunkten vet vi inte om du kom in nyss eller för en timme
    // sedan — ett sent tryck gav en påhittat långsam dörr (37 personer på 70 min i stället för 15) för alla andra,
    // och 52 minuters fel i kalibreringen. Då frågar bannern först; "Tidigare" avslutar utan att skicka något.
    var QS_STALE_GAP = 20 * 60 * 1000;
    var _qsAskWhen = false;
    async function queueSessionEntered(when) {
      var s = getQueueSession();
      if (!s || _reportSending) return; // ett tryck i taget — annars två "inne" på dåligt nät
      if (!when && Date.now() - s.lastAt > QS_STALE_GAP) { _qsAskWhen = true; updateOnMyWayUI(); return; }
      _qsAskWhen = false;
      if (when === 'earlier') {
        endQueueSession();
        showToast('Inget skickades. Utan tidpunkt går kön inte att mäta.');
        return;
      }
      _reportSending = true;
      try {
        var mins = await recordEntered(s);
        showToast('Inne efter ' + mins + ' min.');
      } catch(err) { showToast(reportErrorText(err)); updateOnMyWayUI(); }
      finally { _reportSending = false; }
    }

    function dismissQueueSession() {
      endQueueSession();
    }

    // Position som följer med när man går (watchPosition). Avstånd, "Gå hit", "Rapportera kön", "Bäst nu" och prognosen
    // bygger på den — med en position hämtad hemma klockan 22 visade kortet "3,8 km" för den som stod vid dörren.
    // Ritar bara om efter ≥25 m förflyttning, annars skakar GPS:en om allt hela tiden.
    window._userPos = null;
    var _posRendered = null;
    function onPosition(pos) {
      window._userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy || 0 };
      updateMeOnMap();
      // Ny omritning efter ≥25 m förflyttning, eller när noggrannheten ändrats lika mycket — samma plats med 10 m i
      // stället för 100 m osäkerhet kan flytta dig från "vid stället" till "Gå hit".
      var acc = Math.min(window._userPos.acc, 100);
      if (_posRendered && distanceKmTo(_posRendered) < 0.025 && Math.abs(acc - Math.min(_posRendered.acc, 100)) < 25) return;
      _posRendered = window._userPos;
      renderBestNowCard();
      updateMapStatuses();
      refreshVenueCard();
      updateOnMyWayUI();
      // Bara listan som syns, och inte medan raderna glider in — annars byttes listan ut mitt i introt och under fingret
      // var 25:e meter. Övriga skärmar ritas när man går dit (showScreen).
      if (currentScreen === 'explore' && Date.now() - _listIntroAt > 3000) renderExploreVenues();
      if (currentScreen === 'report' && document.getElementById('rs1').style.display !== 'none') filterReportList();
    }
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(onPosition, function() {}, { timeout: 20000, maximumAge: 60000 });
    }

    function meGeoJSON() {
      var p = window._userPos;
      return { type: 'FeatureCollection', features: p ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: {} }] : [] };
    }
    function updateMeOnMap() {
      if (map && map.getSource('me')) map.getSource('me').setData(meGeoJSON());
    }

    // Avstånd fågelvägen i km, eller null utan position.
    function distanceKmTo(venue) {
      var p = window._userPos;
      if (!p || !venue) return null;
      var dy = (venue.lat - p.lat) * 111, dx = (venue.lng - p.lng) * 111 * Math.cos(venue.lat * Math.PI / 180);
      return Math.sqrt(dx * dx + dy * dy);
    }
    // Gångtid i minuter (5 km/h fågelvägen), eller null utan position. Samma siffra i venue-kortet och i "På väg".
    function walkMinutesTo(venue) {
      var km = distanceKmTo(venue);
      return km === null ? null : Math.max(2, Math.round(km / (5 / 60)));
    }
    // Vid stället: inom 150 m, med GPS:ens osäkerhet (högst 100 m) till din fördel. Inomhus vid Stureplan hamnar
    // positionen ofta 50–100 m fel, och då ska knappen säga "Rapportera kön", inte "Gå hit · 2 min".
    function isAtVenue(venue) {
      var km = distanceKmTo(venue);
      if (km === null) return false;
      return km - Math.min(window._userPos.acc || 0, 100) / 1000 <= 0.15;
    }
    // Andra som är på väg — du själv räknas inte in i din egen prognos. Samma siffra i kortet och i "På väg"-bannern.
    function othersOnWay(venueId) {
      var mine = _onMyWay && _onMyWay.venueId === venueId ? 1 : 0;
      return Math.max(0, onMyWayCount(venueId) - mine);
    }
    // "650 m" under 950 m, annars "1,4 km". Samma format i "Bäst nu" och venue-kortet.
    function formatDistance(km) {
      return km < 0.95 ? Math.round(km * 10) * 100 + ' m' : km.toFixed(1).replace('.', ',') + ' km';
    }

    // ── Historiska mönster ───────────────────────────────────────────────────
    var _historicalPatterns = {};

    // "Brukar vara …" (listan och På väg, bara när färsk data saknas): vanligaste köstatusen samma veckodag ±1 h
    // tidigare kvällar — samma regel som historicalRateFor, via nightKey så att 00:30 hör till kvällen innan. Kvällen
    // just nu räknas inte; den har egen data. "Ingen kö" räknas med, annars överdrivs köerna.
    // shortcut: de 1000 senaste initial-rapporterna på 8 veckor (PostgREST-taket); flytta till en RPC när det inte räcker.
    async function loadHistoricalPatterns() {
      if (!supabase) return;
      try {
        var now = Date.now();
        var key = nightKey(now);
        var result = await supabase
          .from('reports')
          .select('venue_id, queue_status, created_at')
          .gte('created_at', new Date(now - 8 * 7 * 24 * 3600 * 1000).toISOString())
          .eq('report_type', 'initial')
          .order('created_at', { ascending: false })
          .limit(1000);
        if (result.error || !result.data) return;
        var byVenue = {};
        result.data.forEach(function(r) {
          var t = new Date(r.created_at).getTime();
          if (now - t < 12 * 3600 * 1000) return;
          var k = nightKey(t), dh = Math.abs(k.hour - key.hour);
          if (k.dow !== key.dow || Math.min(dh, 24 - dh) > 1) return;
          var s = r.queue_status === 'free' ? 'none' : r.queue_status; // äldre rader skrev 'free'
          var c = byVenue[r.venue_id] = byVenue[r.venue_id] || {};
          c[s] = (c[s] || 0) + 1;
        });
        _historicalPatterns = {};
        Object.keys(byVenue).forEach(function(vid) {
          var counts = byVenue[vid];
          var total = Object.values(counts).reduce(function(a, b) { return a + b; }, 0);
          if (total < 3) return;
          var modal = Object.keys(counts).reduce(function(a, b) { return counts[a] >= counts[b] ? a : b; });
          _historicalPatterns[vid] = { level: modal, count: total };
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
    // Historiken gäller samma veckodag ±1 h, så den följer klockan — inte varje ny rapport.
    setInterval(function() { loadHistoricalPatterns(); loadHistoricalRates(); }, 30 * 60 * 1000);
    subscribeToReports();
    if (supabase) {
      // Reserv: var 30 s utan realtime, annars varannan minut så att utgångna rapporter försvinner och missade händelser
      // fångas upp.
      setInterval(function() {
        if (!_realtimeLive || Date.now() - _lastLoadAt >= 2 * 60 * 1000) loadReports();
      }, 30000);
    } else {
      updateConnectionToast();
    }

    // ── Favoriter ────────────────────────────────────────────────────────────
    // Bara på enheten. Tabellen favorites lästes aldrig tillbaka, så en serverkopia lovade något appen inte gjorde.
    function toggleFavorite(event, venueId) {
      event.stopPropagation();
      var btn = event.currentTarget;
      btn.style.animation = 'none';
      setTimeout(function() { btn.style.animation = 'heartBounce 0.4s ease'; }, 10);
      var idx = favorites.indexOf(venueId);
      if (idx > -1) favorites.splice(idx, 1);
      else favorites.push(venueId);
      try { localStorage.setItem('qb_favorites', JSON.stringify(favorites)); } catch(e) {}
      showToast(idx > -1 ? 'Borttagen från favoriter' : 'Sparad som favorit');
      if (typeof renderExploreVenues === 'function') renderExploreVenues();
    }

    // ── Consent ──────────────────────────────────────────────────────────────
    function checkConsent() {
      if (!localStorage.getItem('qb_consent')) {
        document.getElementById('consent-modal').style.display = 'flex';
        document.querySelector('#consent-modal .consent-accept').focus({ preventScroll: true });
      }
    }
    function acceptConsent() {
      localStorage.setItem('qb_consent', 'true');
      document.getElementById('consent-modal').style.display = 'none';
    }

    // ── Dataradering ─────────────────────────────────────────────────────────
    // Rensar localStorage (och därmed qb_user_id) bara när servern bevisligen är tom — annars kan användaren aldrig
    // försöka igen. En delete som RLS nekar ger inget fel, bara noll rader, så det som finns kvar räknas efteråt.
    async function deleteAllUserData() {
      if (!supabase) { localStorage.clear(); location.reload(); return; }
      var userId = getUserId();
      // favorites skrevs av äldre versioner och kan ha rader kvar; user_profiles finns kanske inte alls. En tabell som
      // inte finns (PGRST205 / 42P01) har inget att radera — den får inte göra raderingen omöjlig.
      var tables = ['reports', 'favorites', 'user_profiles'];
      function missing(res) { return res.error && (res.error.code === 'PGRST205' || res.error.code === '42P01'); }
      try {
        // "På väg" ligger på servern med ditt ID (start_on_my_way) — stoppa det först.
        var stop = await supabase.rpc('stop_on_my_way', { p_user_id: userId });
        if (stop.error) throw stop.error;
        var deleted = await Promise.all(tables.map(function(t) { return supabase.from(t).delete().eq('user_id', userId); }));
        var left = await Promise.all(tables.map(function(t) {
          return supabase.from(t).select('user_id', { count: 'exact', head: true }).eq('user_id', userId);
        }));
        var failed = tables.filter(function(t, i) {
          if (missing(deleted[i]) || missing(left[i])) return false;
          return deleted[i].error || left[i].error || left[i].count !== 0;
        });
        if (failed.length) throw new Error('kvar i ' + failed.join(', '));
      } catch (err) {
        console.error('[QueueBar] deleteAllUserData misslyckades:', err);
        showToast('Kunde inte radera all data. Försök igen.');
        return;
      }
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

    // Svenska tecken: utan å/ä/ö i sökningen vikas de bort ("tradgarden" hittar Trädgården — alla har inte svenskt
    // tangentbord). Med å/ä/ö i sökningen gäller de: "öl" ska inte hitta "Old Beefeater".
    function _searchNorm(s, keepSwedish) {
      s = s.toLowerCase();
      if (!keepSwedish) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
      // Apostrofer: iPhone skriver ’, datorn ', och namnen har båda ("Kelly's", "John Scott’s").
      return s.replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
    }
    function _searchCompact(s, keepSwedish) { return _searchNorm(s, keepSwedish).replace(/\s/g, ''); }
    // Typord man skriver i en sökning: "nattklubb" ska hitta klubbarna, "berns bar" ska hitta Berns.
    var TYPE_WORDS = { bar: ['bar', 'barer'], klubb: ['klubb', 'klubbar', 'nattklubb', 'nattklubbar', 'club'] };

    function venueScore(query, v) {
      var sw = /[åäö]/i.test(query);
      var q  = _searchNorm(query, sw);
      var qc = _searchCompact(query, sw);
      var ql = qc.length;

      var name  = _searchNorm(v.name, sw).replace(/,/g, '');
      var namec = _searchCompact(v.name, sw).replace(/,/g, '');
      var area  = _searchNorm(v.area, sw);
      var addr  = _searchNorm(v.address, sw);

      if (name === q)              return 100;
      if (name.startsWith(q))     return 90;

      var words = name.split(' ');
      if (words.some(function(w) { return w.startsWith(q); })) return 70;

      if (ql >= 2 && namec.startsWith(qc))  return 85;
      if (ql >= 3 && namec.includes(qc))    return 60;
      if (ql >= 2 && name.includes(q))      return 50;

      // Flera ord: varje ord ska hitta något — namn, område, gata eller typ ("berns bar", "tjoget hornstull").
      var qw = q.split(' ').filter(Boolean);
      if (qw.length > 1) {
        var hay = words.concat(area.split(' '), addr.split(' '), TYPE_WORDS[v.type] || []);
        if (qw.every(function(w) { return hay.some(function(h) { return h.startsWith(w); }); })) return 65;
      }

      if (ql >= 2 && area.startsWith(q))    return 40;
      if (ql >= 3 && area.includes(q))      return 30;
      if (ql >= 3 && (TYPE_WORDS[v.type] || []).indexOf(q) >= 0) return 25;
      if (ql >= 3 && addr.includes(q))      return 20;

      // Felstavning: sökordets tecken i ordning i namnet, men bara om första tecknet inleder ett ord och träffen ligger
      // samlat. Förut räckte tre lösa bokstäver var som helst: "lol" gav sex ställen och "aaa" 43.
      if (ql >= 4 && words.some(function(w) { return w[0] === qc[0]; })) {
        var ni = namec.indexOf(qc[0]), start = ni;
        for (var ci = 1; ci < qc.length && ni !== -1; ci++) ni = namec.indexOf(qc[ci], ni + 1);
        if (ni !== -1 && ni - start < ql * 2) return 10;
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

    // Områden vars namn börjar med det man skrivit ("söder" → Södermalm), med antal ställen. Minst 3 tecken: "so" ska
    // inte flytta kartan. Används av kartans sök, som flyger till området i stället för att lista 111 ställen.
    function areaHits(query, venues) {
      var q = _searchNorm(query || '');
      if (q.length < 3) return [];
      var count = {};
      venues.forEach(function(v) { count[v.area] = (count[v.area] || 0) + 1; });
      return Object.keys(count)
        .filter(function(a) { return _searchNorm(a).indexOf(q) === 0; })
        .sort(function(a, b) { return count[b] - count[a]; })
        .map(function(a) { return { area: a, count: count[a] }; });
    }

    // "Menade du …?" när sökningen inte hittar något: närmaste namn eller område med högst ett fel per fyra tecken
    // (Levenshtein). Appen gissar inte tyst — den frågar. null när inget ligger tillräckligt nära.
    function didYouMean(query, venues) {
      var q = _searchNorm(query || '');
      if (q.length < 4) return null;
      function dist(a, b) {
        var prev = [], cur;
        for (var j = 0; j <= b.length; j++) prev[j] = j;
        for (var i = 1; i <= a.length; i++) {
          cur = [i];
          for (var k = 1; k <= b.length; k++) cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
          prev = cur;
        }
        return prev[b.length];
      }
      var best = null, max = Math.max(1, Math.floor(q.length / 4));
      var seen = {};
      venues.forEach(function(v) {
        [{ text: v.area, area: true }, { text: v.name, id: v.id }].forEach(function(c) {
          if (seen[c.text]) return;
          seen[c.text] = true;
          var d = dist(q, _searchNorm(c.text));
          if (d <= max && (!best || d < best.d)) best = { d: d, text: c.text, area: !!c.area, id: c.id };
        });
      });
      return best && { text: best.text, area: best.area, id: best.id };
    }

    // ── Utforska ─────────────────────────────────────────────────────────────
    var _exploreFilter = 'all'; // 'all' | 'free' | 'short' | 'long'
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

    function venueTypeLabel(type) {
      if (!type) return '';
      var t = type.toLowerCase();
      if (t === 'bar') return 'Bar';
      if (t === 'club' || t === 'nightclub' || t === 'klubb') return 'Klubb';
      return type.charAt(0).toUpperCase() + type.slice(1);
    }

    function setExploreFilter(f) {
      _exploreFilter = f;
      document.querySelectorAll('.fbtn[data-filter]').forEach(function(b) {
        b.classList.toggle('active', b.dataset.filter === f);
      });
      renderExploreVenues();
    }

    // Samma knappar på kartan (Alla · Barer · Klubbar) och i listan (Barer, Klubbar bredvid statusknapparna). Ett tryck på
    // den valda typen igen tar bort valet — listan har ingen egen "Alla" för typ. Allt ritas om: karta, lista, "Bäst nu".
    function setVenueType(t) {
      _venueType = t !== 'all' && t === _venueType ? 'all' : t;
      document.querySelectorAll('.fbtn[data-type]').forEach(function(b) {
        var on = b.dataset.type === _venueType;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      renderReports();
      if (_selectedArea) flyToArea(_selectedArea); // samma område, inramat för den nya typen
    }

    function useListSuggestion(text) {
      var inp = document.getElementById('explore-search');
      if (!inp || !text) return;
      inp.value = text;
      renderExploreVenues();
    }

    function debouncedFilterExplore() {
      // ~300 venues — fuzzy sort is synchronous; 60 ms debounce only coalesces keystrokes
      clearTimeout(exploreDebounceTimer);
      exploreDebounceTimer = setTimeout(renderExploreVenues, 60);
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
      // Bara öppna ställen: klockan 01:30 är nio barer stängda, och "0 av 28 · senast 3 min sedan" (rapporten kom från
      // ett ställe som just stängt) sa emot sig själv.
      var open = VENUES.filter(function(v) { return !isClosed(v) && venueTypeMatches(v); });
      var fresh = open.filter(function(v) { return venueFreshStatus(v.id) !== 'unknown'; }).length;
      var lastTs = null;
      allReports.forEach(function(r) {
        var rv = getVenueById(r.venue_id);
        if (!isQueueReport(r) || isClosed(rv) || !venueTypeMatches(rv)) return;
        var t = new Date(r.created_at).getTime();
        if (!lastTs || t > lastTs) lastTs = t;
      });
      return { fresh: fresh, venueTotal: open.length, closed: VENUES.length - open.length, lastTs: lastTs, total: allReports.length };
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
      if (d.total === 0) return 'Inga rapporter än de senaste 45 minuterna.';
      var since = exsumTimeSince(d.lastTs);
      return d.fresh + ' av ' + d.venueTotal + (d.closed ? ' öppna' : '') + ' ställen har färsk rapport' + (since ? ' · senast ' + since : '');
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

    // Favoritens stjärna — samma form i listan som på kortets knapp (#vc-fav).
    var STAR_PATH = 'M12 3.5 14.6 9l5.9.7-4.4 4 1.2 5.8L12 16.6 6.7 19.5l1.2-5.8-4.4-4L9.4 9z';

    function renderExploreVenueRow(venue, index, bestData) {
      var isBest = !!bestData;
      var bastReason = '';
      if (bestData) {
        if (bestData.status === 'none') bastReason = 'Ingen kö';
        else if (bestData.status === 'short') bastReason = 'Kortast kö';
      }
      // Bara kömätningar från de senaste 45 min — samma fönster som estimateWait och färskhetsraden.
      var nowMs = Date.now();
      var venueReports = allReports.filter(function(r) {
        return r.venue_id === venue.id && isQueueReport(r) && nowMs - new Date(r.created_at).getTime() < 45 * 60000;
      }).sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      var latestReport = venueReports[0] || null;
      var status = computeStatus(venue.id, allReports);
      var est = estimateWait(venue.id, allReports);
      var closed = isClosed(venue);
      var hasData = !closed && venueReports.length > 0;
      var minsOld = hasData ? (nowMs - new Date(latestReport.created_at)) / 60000 : Infinity;
      var isAging = hasData && minsOld >= 15;

      // Nivå för siffrans färg och den röda pulsen
      var level; // 'long' | 'medium' | 'free' | 'empty'
      if (!hasData) level = 'empty';
      else if (status === 'long') level = 'long';
      else if (status === 'none') level = 'free';
      else level = 'medium'; // short or medium

      // Stängt: tonad som en rad utan data, och hjälten krymper — stängda ställen ska inte dra blicken klockan 01:30.
      var stateClass = !hasData ? ' erow--empty' + (closed ? ' erow--closed' : '') : (isAging ? ' erow--stale' : '');

      // Hero number. "Fri" är den korta formen av "Ingen kö" — samma ord som pillen på kartan.
      var heroText, heroColor;
      if (!hasData) {
        heroText = closed ? 'Stängt' : '–'; heroColor = '#85858A';
      } else {
        heroText = (est ? est.ahead === 0 : status === 'none') ? 'Fri' : venueWaitText(venue.id);
        // Kort och medel får exakt statusfärg; fri och lång har fasta färger
        var heroColors = { free: '#34E07F', medium: getStatusColor(status), long: '#FF4D5E' };
        heroColor = heroColors[level] || '#85858A';
      }

      // Freshness check for pulse dot: only show if long AND report < 20 min old
      var showPulseDot = level === 'long' && minsOld < 20;
      var pulseHtml = showPulseDot ? '<span class="erow-pulse-dot"></span>' : '';

      // Trend: samma regel som kortets ändringsrad (queueChange). På data som är 15 min eller äldre visas ingen pil.
      var trendHtml = '';
      var change = isAging ? null : queueChange(venueReports);
      if (change) {
        trendHtml = change.dir === 'up'
          ? '<span class="erow-trend erow-trend--up">↑ Ökar</span>'
          : '<span class="erow-trend erow-trend--down">↓ Minskar</span>';
      }

      var reportCount = venueReports.length;
      var typeLabel = venueTypeLabel(venue.type);
      var dist = distanceKmTo(venue);
      var metaText = venue.area + (typeLabel ? ' · ' + typeLabel : '') + (dist !== null ? ' · ' + formatDistance(dist) : '');

      // Taket: med 300 ställen kom rad 300 annars fram först efter 22 s; raderna under skärmkanten får vänta in de synliga.
      var delay = _listIntro ? (Math.min(index, 15) * 75 + 340) + 'ms' : '0ms';

      var pat = _historicalPatterns[venue.id];
      var patLabels = { long: 'Brukar vara lång kö nu', medium: 'Brukar vara medellång kö nu', short: 'Brukar vara kort kö nu', none: 'Brukar inte vara kö nu' };
      // Historiskt mönster visas bara när färsk data saknas — annars konkurrerar det med verkligheten
      var patHtml = (!hasData && pat && patLabels[pat.level]) ? '<span class="hist-chip hist-chip--' + pat.level + '">' + patLabels[pat.level] + '</span>' : '';
      var recentWithComment = venueReports.filter(function(r) {
        return r.comment && nowMs - new Date(r.created_at).getTime() < 30 * 60 * 1000;
      })[0];
      var commentHtml = recentWithComment ? '<div class="erow-comment">"' + escapeHtml(recentWithComment.comment) + '"</div>' : '';
      var minsLeft = minutesToClose(venue);
      var closingSoonHtml = minsLeft !== null && minsLeft > 0 && minsLeft <= 90
        ? '<span class="erow-tertiary-sep">·</span><span class="erow-closing">Stänger ' + venue.closing + '</span>' : '';
      var estHtml = est && est.ahead && !est.full && est.source !== 'live' ? '<span class="erow-tertiary-sep">·</span><span class="erow-est-label">≈ uppskattning</span>' : '';
      var tertiaryHtml = hasData
        ? '<div class="erow-tertiary">' +
            '<span>' + reportCount + ' rapport' + (reportCount === 1 ? '' : 'er') + '</span>' +
            '<span class="erow-tertiary-sep">·</span>' +
            '<span' + (isAging ? ' class="erow-stale-label"' : '') + '>' + timeAgo(latestReport.created_at) + (isAging ? ' · äldre' : '') + '</span>' +
            estHtml +
            closingSoonHtml +
          '</div>'
        : '<div class="erow-tertiary">' +
            // Utan data: strecket till höger och rubriken "Utan färsk rapport" säger det. "Ingen rapport senaste 45 min"
            // på varje rad blev en vägg av samma mening. Ett historiskt mönster ("Brukar vara …") får stå kvar.
            (closed ? '<span class="erow-empty-cta">Stängde ' + venue.closing + '</span>' : patHtml) +
            closingSoonHtml +
          '</div>';

      // Raden är neutral: statusen står i den färgade siffran till höger. Färgad kant och tonad bakgrund sa samma sak två
      // gånger till.
      return '<div class="erow' + stateClass + (isBest ? ' erow--best' : '') + (_listIntro ? ' erow--intro' : '') + '" data-venue="' + venue.id + '" role="button" tabindex="0" aria-expanded="false" style="--row-delay:' + delay + ';" onclick="openVenueCard(getVenueById(\'' + venue.id + '\'),\'explore\',this)">' +
        '<div class="erow-inner">' +
          '<div class="erow-body">' +
            (isBest ? '<div class="bast-chip">Bäst nu' + (bastReason ? ' · ' + bastReason : '') + '</div>' : '') +
            '<div class="erow-name-row">' +
              pulseHtml +
              '<div class="erow-name">' + venue.name + '</div>' +
              (isFavorite(venue.id) ? '<svg class="erow-fav" viewBox="0 0 24 24" aria-label="Favorit"><path d="' + STAR_PATH + '"/></svg>' : '') +
            '</div>' +
            '<div class="erow-meta">' + metaText + '</div>' +
            tertiaryHtml + commentHtml +
          '</div>' +
          '<div class="erow-right">' +
            '<span class="erow-hero' + (_listIntro ? ' erow-hero--animate' : '') + '" style="color:' + heroColor + '">' + waitRollHtml('list', venue.id, heroText, heroColor) + '</span>' +
            trendHtml +
          '</div>' +
        '</div>' +
        '</div>';
    }

    // "Vart går vi nu?": ställen utan kö eller med kort kö, med en kömätning från de senaste 30 min, som har minst 45 min
    // kvar när du kommer fram. Rangordnas efter tid tills du är inne — promenad plus kö — så att ingen kö 4 km bort inte
    // vinner över fem minuters kö runt hörnet. Över 40 min promenad räknas inte: dit går man inte. Data som är 15–30 min
    // gammal kostar 5 min i rangordningen, så att en färsk rapport vinner när resten är lika.
    function computeBestNow() {
      var now = Date.now();
      var best = null;
      VENUES.forEach(function(v) {
        if (!venueTypeMatches(v)) return;
        var status = computeStatus(v.id, allReports);
        if (status !== 'none' && status !== 'short') return;
        var latest = 0;
        allReports.forEach(function(r) {
          if (r.venue_id !== v.id || !isQueueReport(r)) return;
          var t = new Date(r.created_at).getTime();
          if (t > latest) latest = t;
        });
        var minsAgo = (now - latest) / 60000;
        if (minsAgo > 30) return;
        var walk = walkMinutesTo(v);
        if (walk !== null && walk > 40) return;
        var left = minutesToClose(v);
        if (left !== null && left < 45 + (walk || 0)) return;
        var est = estimateWait(v.id, allReports);
        var cost = (walk || 0) + (est ? est.mins : 0) + (minsAgo >= 15 ? 5 : 0);
        if (!best || cost < best.cost) best = { venue: v, status: status, dist: distanceKmTo(v), minsAgo: minsAgo, cost: cost };
      });
      return best;
    }

    // Raderna glider in en gång — första gången listan visas med riktig data. All omritning efter det
    // (filter, sökning, ny rapport var 30:e sekund) byter innehåll utan att animera om, enligt /anti-ai-design.
    var _listIntro = true;
    var _listIntroAt = 0; // när introt spelades — GPS-omritning väntar tills raderna glidit in

        function renderExploreVenues() {
      // Dold lista ritas inte: ~300 rader in i en skärm ingen ser, vid varje ny data. showScreen('explore') ritar den.
      if (currentScreen !== 'explore') return;
      vcPark(); // ett utfällt kort under en rad får inte försvinna med raden när listan ritas om
      renderExploreSummary();
      var q = (document.getElementById('explore-search') || {}).value || '';
      q = q.toLowerCase();
      var el = document.getElementById('explore-list');
      if (!el) return;
      // Serverfel utan data: felläget står kvar. Annars skrev varje omritning (skärmbyte, sökning, filter) över det med
      // 28 tomma rader, och felet såg ut som en lugn kväll (e2e "Serverfel … utan data").
      if (_loadState === 'error' && !allReports.length) { showExploreError(); return; }
      // Första laddningen pågår: skelettrader. Förut ritades 292 rader med "Ingen rapport senaste 45 min" innan svaret
      // kommit — appen påstod att det var tomt innan den visste.
      if (_loadState === 'loading') {
        el.innerHTML = '<div class="venue-group">' + [1,2,3,4,5].map(function() { return '<div class="skeleton-erow"></div>'; }).join('') + '</div>';
        updateFilterCounts();
        return;
      }

      // Base list: fuzzy search, preserves relevance order when query present
      var list = q ? venueSearch(q, VENUES) : VENUES.slice();

      // Status-based filter (new chip logic)
      if (_exploreFilter === 'free') {
        list = list.filter(function(v) { return computeStatus(v.id, allReports) === 'none'; });
      } else if (_exploreFilter === 'short') {
        list = list.filter(function(v) { return computeStatus(v.id, allReports) === 'short'; });
      } else if (_exploreFilter === 'long') {
        list = list.filter(function(v) { return computeStatus(v.id, allReports) === 'long'; });
      }
      list = list.filter(venueTypeMatches);
      // 'all' — no additional filter

      if (!list.length) {
        var rawQ = document.getElementById('explore-search') ? document.getElementById('explore-search').value : '';
        var filterLabels = { free: 'ingen kö', short: 'kort kö', long: 'lång kö' };
        var emptyTitle, emptySub;
        if (_exploreFilter !== 'all' && !rawQ) {
          emptyTitle = 'Inga ställen med ' + (filterLabels[_exploreFilter] || _exploreFilter) + ' just nu';
          emptySub = 'Ingen har rapporterat en sådan kö de senaste 45 minuterna.';
        } else {
          var term = rawQ ? '”' + escapeHtml(rawQ) + '”' : '';
          emptyTitle = 'Inga resultat' + (term ? ' för ' + term : '');
          var sug = rawQ ? didYouMean(rawQ, VENUES) : null;
          // Menade du …? som knapp: ett tryck byter sökordet. Annars ett konkret tips i stället för en allmän fras.
          emptySub = sug
            ? '<button class="explore-suggest" onclick="useListSuggestion(this.dataset.q)" data-q="' + escapeHtml(sug.text) + '">Menade du ' + escapeHtml(sug.text) + '?</button>'
            : 'Sök på ett namn, en gata eller ett område';
        }
        el.innerHTML = '<div class="explore-empty">' +
          '<div class="explore-empty-title">' + emptyTitle + '</div>' +
          '<div class="explore-empty-sub">' + emptySub + '</div>' +
          '</div>';
        updateFilterCounts();
        return;
      }

      // Sort strategy:
      //   No query  → färska först, kortast kö överst (frågan är "vart går vi?"), sedan nyast rapport; utan färsk data
      //               sist i bokstavsordning
      //   Query set → relevance score first; within same score bucket: fresh, then shortest queue
      var QUEUE_RANK = { none: 0, short: 1, medium: 2, long: 3 };
      function queueRank(v) {
        var r = QUEUE_RANK[computeStatus(v.id, allReports)];
        return r === undefined ? 4 : r;
      }
      var activeQuery = (document.getElementById('explore-search') || {}).value || '';
      // Nycklarna räknas en gång per ställe. Förut gick jämförelsen igenom alla rapporter två gånger per par (~2 400 par).
      var now45 = Date.now() - 45 * 60 * 1000, latestById = {}, key = {};
      allReports.forEach(function(r) {
        if (!isQueueReport(r)) return;
        var t = new Date(r.created_at).getTime();
        if (!(latestById[r.venue_id] >= t)) latestById[r.venue_id] = t;
      });
      list.forEach(function(v) {
        var latest = latestById[v.id] || 0, closed = isClosed(v);
        // Ett stängt ställe har ingen färsk data, hur nyligen det än rapporterades — det hamnar sist.
        key[v.id] = { latest: latest, closed: closed, fresh: latest > now45 && !closed, rank: queueRank(v),
          score: activeQuery.trim() ? venueScore(activeQuery, v) : 0 };
      });
      list = list.slice().sort(function(a, b) {
        var ka = key[a.id], kb = key[b.id];

        // When searching: relevance score is primary sort key
        if (activeQuery.trim()) {
          if (kb.score !== ka.score) return kb.score - ka.score;
          if (!ka.fresh && kb.fresh) return 1;
          if (ka.fresh && !kb.fresh) return -1;
          return ka.rank - kb.rank;
        }

        if (!ka.fresh && kb.fresh) return 1;
        if (ka.fresh && !kb.fresh) return -1;
        if (!ka.fresh && !kb.fresh) {
          if (ka.closed !== kb.closed) return ka.closed ? 1 : -1; // stängda allra sist, efter öppna utan data
          return a.name.localeCompare(b.name, 'sv');
        }
        var rankDiff = ka.rank - kb.rank;
        if (rankDiff) return rankDiff;
        return kb.latest - ka.latest;
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

      // De med färsk rapport först, resten (inga eller inaktuella rapporter) samlade sist under en enda rubrik. Den färska
      // gruppen har ingen rubrik: färskhetsraden ovanför säger redan "17 av 28 ställen har färsk rapport".
      function hasFreshReport(v) { return venueFreshStatus(v.id) !== 'unknown'; }
      var freshList = [], staleList = [];
      list.forEach(function(v) { (hasFreshReport(v) ? freshList : staleList).push(v); });
      var listIndex = {};
      list.forEach(function(v, i) { if (!(v.id in listIndex)) listIndex[v.id] = i; }); // som indexOf: första träffen
      function rowsHtml(items) {
        return items.map(function(v) {
          return renderExploreVenueRow(v, listIndex[v.id], v.id === bestVenueId ? best : null);
        }).join('');
      }
      // Rubrik bara när båda grupperna finns och listan inte är filtrerad eller sökt; annars är en rubrik brus.
      var showSections = freshList.length && staleList.length && _exploreFilter === 'all' && !activeQuery.trim();
      el.innerHTML = showSections
        ? '<div class="venue-group">' + rowsHtml(freshList) + '</div>' +
          '<div class="list-section">Utan färsk rapport</div><div class="venue-group">' + rowsHtml(staleList) + '</div>'
        : '<div class="venue-group">' + rowsHtml(list) + '</div>';

      // Intro förbrukas när listan har ritats färdigt, alltså så fort laddningen inte längre pågår. Det gäller även en
      // lista utan data: raderna har då redan visat sig, och den första rapporten fyller en rad som redan står still.
      if (_listIntro && _loadState !== 'loading' && currentScreen === 'explore') { _listIntro = false; _listIntroAt = Date.now(); }

      updateFilterCounts();
    }

    function updateFilterCounts() {
      var counts = { all: 0, free: 0, short: 0, long: 0 };
      VENUES.filter(venueTypeMatches).forEach(function(v) {
        var s = computeStatus(v.id, allReports);
        counts.all++;
        if (s === 'none') counts.free++;
        if (s === 'short') counts.short++;
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
      var liveDescriptors = { none: 'Ingen kö', free: 'Ingen kö', short: 'Kort kö', medium: 'Medellång kö', long: 'Lång kö' };
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
      return '<div class="lv-row" data-venue="' + r.venue_id + '" role="button" tabindex="0" aria-expanded="false" onclick="openVenueCard(getVenueById(\'' + r.venue_id + '\'), \'live\', this)">' +
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
      // Tiden räknas från sessionens första rapport. Har den gått ut (45 min) är den äldsta kvarvarande en uppföljning,
      // och då blev en 50 min lång kö "Inne efter 30 min · uppmätt". Utan startrapport: ingen rad.
      var first = allReports.filter(function(r) { return r.queue_session === entered.queue_session && isQueueReport(r); })[0];
      if (!first) return '';
      var start = new Date(first.created_at).getTime();
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
      // Prickarna (fliken och rubriken) säger "live" bara när det finns en färsk rapport (< 10 min) och kontakt med
      // servern — en pulserande prick bredvid "Ingen kontakt" säger emot texten.
      var freshCut = Date.now() - 10 * 60 * 1000;
      // Stängda ställen räknas inte: deras sista rapporter beskriver en kö som inte längre finns.
      function openNow(r) { return !isClosed(getVenueById(r.venue_id)); }
      var isLive = _loadState !== 'error' && allReports.some(function(r) { return isQueueReport(r) && openNow(r) && new Date(r.created_at).getTime() > freshCut; });
      var navDot = document.querySelector('.live-dot');
      if (navDot) navDot.classList.toggle('on', isLive);
      // Pricken i menyn syns överallt; resten av flödet bara på Live, som ritas när den visas (showScreen).
      if (currentScreen !== 'live') return;
      vcPark();
      var headDot = document.getElementById('live-dot');
      if (headDot) headDot.hidden = !isLive;
      var subText = document.getElementById('live-sub-text');
      if (!supabase) {
        // Samma ord som alla andra fel: "Ingen kontakt med servern". Ingen ikon — rubriken säger det.
        if (subText) subText.textContent = 'Ingen kontakt';
        el.innerHTML = '<div class="lv-empty">' +
          '<div class="lv-empty-title">Ingen kontakt med servern</div><p class="lv-empty-sub">Vi vet inte hur köerna ser ut just nu.</p>' +
          '<button class="empty-btn" onclick="retrySupabase()">Försök igen</button></div>';
        return;
      }
      var now = new Date();
      var cutoff = now - 45 * 60 * 1000;
      var recent = allReports.filter(function(r) { return isQueueReport(r) && openNow(r) && new Date(r.created_at).getTime() > cutoff; });
      // Nådde vi inte servern vet vi ingenting om kvällen. Säg det, i stället för att
      // visa samma tomma läge som när Stockholm faktiskt är tyst.
      if (_loadState === 'error' && !recent.length) {
        if (subText) subText.textContent = 'Ingen kontakt';
        el.innerHTML = '<div class="lv-empty">' +
          '<div class="lv-empty-title">Ingen kontakt med servern</div><p class="lv-empty-sub">Vi vet inte hur köerna ser ut just nu.</p>' +
          '<button class="empty-btn" onclick="loadReports()">Försök igen</button></div>';
        return;
      }
      if (!recent.length) {
        if (subText) subText.textContent = 'Inga rapporter senaste 45 min';
        // Rubriken ovanför säger redan "Inga rapporter senaste 45 min"; här bara vad som händer sen.
        el.innerHTML = '<div class="lv-empty"><p class="lv-empty-sub">När någon rapporterar en kö syns den här.</p></div>';
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
      // Utan position finns ingen gångtid att räkna med — en gissad siffra skulle visas som data och hamna i andras
      // "N på väg". Vägbeskrivningen har redan öppnats; mer gör vi inte.
      var walkMins = walkMinutesTo(venue);
      if (walkMins === null) { closeVenueCard(); return; }
      if (_onMyWay && _onMyWay.timerId) clearTimeout(_onMyWay.timerId);
      // Den som går till ett annat ställe står inte längre i sin gamla kö.
      if (getQueueSession()) endQueueSession();

      _onMyWay = { venueId: venueId, arrivalTime: Date.now() + walkMins * 60 * 1000, walkMins: walkMins, timerId: null };
      scheduleArrival();
      saveOnMyWay();
      // Testläget räknas inte in i andras "N på väg".
      if (supabase && !testDataEnabled()) supabase.rpc('start_on_my_way', { p_user_id: getUserId(), p_venue_id: venueId, p_minutes: walkMins })
        .then(function(res) { if (res.error) console.warn('[QueueBar] start_on_my_way:', res.error.message); });

      showToast('På väg till ' + venue.name + ', ca ' + walkMins + ' min');
      updateOnMyWayUI();
      closeVenueCard();
    }

    function cancelOnMyWay() {
      if (_onMyWay && _onMyWay.timerId) clearTimeout(_onMyWay.timerId);
      if (_onMyWay && supabase && !testDataEnabled()) supabase.rpc('stop_on_my_way', { p_user_id: getUserId() })
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
        var hintMap = { none: 'brukar inte vara kö nu', short: 'brukar vara kort kö nu', medium: 'brukar vara medellång kö nu', long: 'brukar vara lång kö nu' };
        var fc = forecastWait(_onMyWay.venueId, minsLeft, othersOnWay(_onMyWay.venueId));
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
      var since = timeAgo(new Date(qs.lastAt).toISOString());
      // Efter sista uppdateringen kommer knappen inte tillbaka — säg det, annars väntar man på den.
      var sub = _qsAskWhen ? 'Kom du in nyss? Annars kan vi inte mäta kön.'
        : canUpdate ? ahead + ' · ' + since + ' · hur många nu?'
        : qs.followups >= QS_MAX_FOLLOWUPS ? ahead + ' · ' + since + ' · tryck "Jag är inne" när du kommer in'
        : ahead + ' · ' + since;
      var actions = _qsAskWhen
        ? '<button class="qs-btn" onclick="queueSessionEntered(\'earlier\')">Tidigare</button>'
          + '<button class="qs-btn qs-btn--primary" onclick="queueSessionEntered(\'now\')">Ja, nyss</button>'
        : (canUpdate ? '<button class="qs-btn" onclick="queueSessionUpdate()">Uppdatera</button>' : '')
          + '<button class="qs-btn qs-btn--primary" onclick="queueSessionEntered()">Jag är inne</button>';
      banner.style.display = 'block';
      banner.innerHTML = '<div class="qs-row"><div class="qs-text">'
        + '<div class="qs-kicker"><span class="qs-live"></span>I kön · ' + qs.venueName + '</div>'
        + '<div class="qs-title"><span class="qs-num">' + inQueue + ' min</span> <span class="qs-unit">i kön</span></div>'
        + '<div class="qs-sub">' + sub + '</div></div>'
        + '<button class="qs-close" onclick="dismissQueueSession()" aria-label="Avsluta">×</button></div>'
        + '<div class="qs-actions">' + actions + '</div>';
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
      // Senaste kömätning per ställe. Appen ser bara 45 min bakåt (rapporter som inte gått ut), så det är den gränsen
      // texten ska säga — inte "ikväll".
      var latestTs = {};
      allReports.forEach(function(r) {
        if (!isQueueReport(r)) return;
        var t = new Date(r.created_at).getTime();
        if (!latestTs[r.venue_id] || t > latestTs[r.venue_id]) latestTs[r.venue_id] = t;
      });
      var list = q ? venueSearch(q, VENUES) : VENUES.slice();
      // Utan sökord: närmast först om platsen är känd, annars senast rapporterat. Stängda sist. Med sökord: relevans.
      if (!q) {
        list.sort(function(a, b) {
          var ac = isClosed(a), bc = isClosed(b);
          if (ac !== bc) return ac ? 1 : -1;
          if (window._userPos) return distanceKmTo(a) - distanceKmTo(b);
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
        var closed = isClosed(v);
        var fresh = !closed && latestTs[v.id] && latestTs[v.id] > freshCut;
        var dotColor = fresh ? getStatusColor(computeStatus(v.id, allReports)) : 'transparent';
        var km = distanceKmTo(v);
        var metaParts = [v.area + (rsTypeLbl ? ' · ' + rsTypeLbl : '')];
        if (km !== null) metaParts.push(formatDistance(km));
        // Utan rapport: ingen text. Den ihåliga pricken säger det redan, och samma mening på 292 rader var en textvägg.
        var ago = closed ? 'stängt' : fresh ? timeAgo(new Date(latestTs[v.id]).toISOString()) : '';
        return '<button class="rs-item' + (closed ? ' rs-item--closed' : '') + '" onclick="pickRV(\'' + v.id + '\')">' +
          '<span class="rs-dot' + (fresh ? '' : ' rs-dot--none') + '" style="background:' + dotColor + '"></span>' +
          '<span class="rs-text"><span class="rs-name">' + v.name + '</span><span class="rs-area">' + metaParts.join(' · ') + '</span></span>' +
          '<span class="rs-ago">' + ago + '</span></button>';
      }).join('');
    }

    // Visar ett av de tre stegen. Kommentaren börjar hopfälld i varje ny rapport: frågan och svarsknapparna först.
    function rsStep(n) {
      document.getElementById('rs1').style.display = n === 1 ? 'block' : 'none';
      document.getElementById('rs2').style.display = n === 2 ? 'flex' : 'none';
      document.getElementById('rs3').style.display = n === 3 ? 'flex' : 'none';
      var comment = document.getElementById('rs-comment');
      if (n === 2 && comment && !comment.value) {
        comment.hidden = true;
        document.getElementById('rs-add-comment').hidden = false;
      }
      // Bekräftelsen ritas om varje gång steg 3 visas: klassen tas bort, layouten tvingas, och sätts på igen
      var icon = document.getElementById('rs-success-icon');
      if (icon) {
        icon.classList.remove('rs-success-on');
        if (n === 3) { void icon.offsetWidth; icon.classList.add('rs-success-on'); }
      }
    }

    function pickRV(id) {
      var v = getVenueById(id);
      if (isClosed(v)) { showToast(v.name + ' har stängt'); return; }
      selectedRV = v;
      document.getElementById('rs-vname').textContent = v.name;
      // Långt från stället: säg det innan någon rapporterar en kö den inte ser. Rapporten tas emot, men utan "I kön".
      var far = document.getElementById('rs-far');
      if (far) {
        far.hidden = !isFarFrom(v);
        if (!far.hidden) far.textContent = 'Du är ' + formatDistance(distanceKmTo(v)) + ' från ' + v.name + '. Rapportera bara en kö du ser.';
      }
      rsStep(2);
    }

    function backToRs1() {
      rsStep(1);
    }

    function showCommentField() {
      document.getElementById('rs-add-comment').hidden = true;
      var input = document.getElementById('rs-comment');
      input.hidden = false;
      input.focus();
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

    // Ett tryck i taget: medan en rapport skickas finns den inte i allReports än, så klientspärren släpper igenom ett
    // andra tryck. Gäller båda vägarna in (rapportskärmen och snabbarket).
    var _reportSending = false;
    async function pickAhead(peopleAhead) {
      if (!selectedRV || _reportSending) return;
      _reportSending = true;
      var commentEl = document.getElementById('rs-comment');
      var comment = commentEl ? commentEl.value.trim().slice(0, 80) : '';
      try {
        await submitReport(selectedRV.id, selectedRV.name, peopleAhead, comment);
        if (commentEl) commentEl.value = '';
        maybeShowInstallPrompt();
        rsStep(3);
        var nextEl = document.querySelector('#rs3 .rs-next');
        // "Står du kvar?" bara när en kö-session faktiskt pågår — inte vid "Ingen kö", inte långt ifrån stället.
        if (nextEl) nextEl.hidden = !getQueueSession();
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
      finally { _reportSending = false; }
    }

    // ── Snabbrapport (ark från "På väg"-bannern och kö-sessionens "Uppdatera") ──
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
      if (!qrVenue || _reportSending) return;
      var v = qrVenue;
      var mode = qrMode;
      closeQuickReport();
      _reportSending = true;
      try {
        if (mode === 'followup') { await submitQueueFollowup(peopleAhead); return; }
        await submitReport(v.id, v.name, peopleAhead);
        maybeShowInstallPrompt();
        flashVenueRow(v.id);
        showToast('Rapport skickad.');
      } catch(e) {
        showToast(reportErrorText(e));
      } finally { _reportSending = false; }
    }

    filterReportList();

    // ── Profil ────────────────────────────────────────────────────────────────
    // Köer du rapporterat: unika kö-sessioner, så en kö du stod i och uppdaterade räknas en gång. Bara ur historiken —
    // tills den är hämtad, eller om den inte gick att hämta, visas "–" i stället för de senaste 45 minuterna (då såg
    // någon med 40 rapporter "1 kö").
    var _historyState = 'loading'; // 'loading' | 'ok' | 'error'
    function updateProfileStats() {
      var sr = document.getElementById('stat-r');
      var text = document.getElementById('pf-reports-text');
      if (!sr || !text) return;
      if (_historyState !== 'ok') {
        sr.textContent = '–';
        text.textContent = _historyState === 'error' ? 'Kunde inte hämta din historik' : 'Hämtar din historik…';
        return;
      }
      var queues = {};
      userHistory.filter(isQueueReport).forEach(function(r) { queues[r.queue_session || r.id || r.created_at] = true; });
      var n = Object.keys(queues).length;
      sr.textContent = n;
      text.textContent = n === 0 ? 'Du har inte rapporterat någon kö än.' : n === 1 ? 'kö du har hjälpt andra med' : 'köer du har hjälpt andra med';
    }

    async function loadUserHistory() {
      try {
        if (!supabase) throw new Error('Supabase är inte tillgänglig');
        var result = await supabase.from('reports').select('id, queue_session, report_type, created_at')
          .eq('user_id', getUserId()).order('created_at', { ascending: false });
        if (result.error) throw result.error;
        userHistory = result.data || [];
        _historyState = 'ok';
      } catch(err) {
        console.error('[QueueBar] loadUserHistory:', err);
        // En siffra vi redan hämtat står kvar vid ett tillfälligt nätfel; "-" bara om vi aldrig fått någon.
        if (_historyState !== 'ok') _historyState = 'error';
      }
      updateProfileStats();
    }

    function showPrivacyPolicy() {
      alert('Integritetspolicy\n\nQbar sparar ett anonymt ID och dina kö-rapporter (ställe, antal i kö, tid, ev. kommentar).\nNär du trycker "Gå hit" sparas vart du är på väg och när du beräknas vara framme, tills du kommit fram eller avbryter.\nFavoriter och din position stannar på din enhet.\nVi säljer aldrig din data.\nSupabase (EU) används som databas.\nMapbox används för kartan.\n\nKontakt: support@queuebar.se');
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
  closeQuickReport,
  closeVenueCard,
  confirmDelete,
  debouncedFilterExplore,
  dismissInstall,
  dismissQueueSession,
  filterReportList,
  flyToAreaChip,
  getVenueById,
  loadReports,
  onMyWayArrived,
  onMyWayReport,
  onMapSearchBlur,
  onMapSearchFocus,
  onMapSearchInput,
  onMapSearchKey,
  openDirections,
  openVenueCard,
  pickAhead,
  pickRV,
  qbCalibration,
  queueSessionEntered,
  queueSessionUpdate,
  quickPickAhead,
  retrySupabase,
  selectMapSearchArea,
  selectMapSearchVenue,
  setExploreFilter,
  setVenueType,
  shareVenue,
  showCommentField,
  showPrivacyPolicy,
  showScreen,
  toggleLiveVenue,
  setMapStyle,
  toggleMapStyleMenu,
  toggleVcReports,
  useListSuggestion,
  useMapSuggestion,
  vcShare,
  vcToggleFavorite,
});
