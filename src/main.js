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
      { id: 'soap-bar', name: 'Soap Bar', address: 'Nybrogatan 1', area: 'Östermalm', type: 'bar', lat: 59.3349, lng: 18.0735, closing: '03:00' },
      { id: 'akkurat', name: 'Akkurat Bar & Restaurang', address: 'Hornsgatan 18', area: 'Slussen', type: 'bar', lat: 59.3190, lng: 18.0640, closing: '01:00' },
      { id: 'tjoget', name: 'Tjoget', address: 'Hornsbruksgatan 24', area: 'Hornstull', type: 'bar', lat: 59.3157, lng: 18.0348, closing: '01:00' },
      { id: 'sturehof', name: 'Sturehof', address: 'Stureplan 2', area: 'Östermalm', type: 'bar', lat: 59.3361, lng: 18.0733, closing: '02:00' },
      { id: 'pelikan', name: 'Pelikan', address: 'Blekingegatan 40', area: 'Södermalm', type: 'bar', lat: 59.3121, lng: 18.0760, closing: '01:00' },
      { id: 'morfar-ginko', name: 'Morfar Ginko', address: 'Swedenborgsgatan 13', area: 'Södermalm', type: 'bar', lat: 59.3150, lng: 18.0645, closing: '01:00' },
      { id: 'spy-bar', name: 'Spy Bar', address: 'Birger Jarlsgatan 20', area: 'Östermalm', type: 'bar', lat: 59.3360, lng: 18.0730, closing: '05:00' },
      { id: 'fasching', name: 'Fasching', address: 'Kungsgatan 63', area: 'Norrmalm', type: 'bar', lat: 59.3350, lng: 18.0620, closing: '03:00' },
      { id: 'berns', name: 'Berns', address: 'Berzelii Park', area: 'Norrmalm', type: 'bar', lat: 59.3322, lng: 18.0739, closing: '03:00' },
      { id: 'lounge-bar', name: 'The Lounge Bar', address: 'Sveavägen 45', area: 'Norrmalm', type: 'bar', lat: 59.3360, lng: 18.0620, closing: '01:00' },
      { id: 'niva22', name: 'Nivå 22', address: 'Fridhemsgatan 17', area: 'Kungsholmen', type: 'bar', lat: 59.3420, lng: 18.0490, closing: '01:00' },
      { id: 'cafe-opera', name: 'Café Opera', address: 'Karl XII:s torg 6', area: 'Kungsträdgården', type: 'klubb', lat: 59.3307, lng: 18.0715, closing: '05:00' },
      { id: 'tradgarden', name: 'Trädgården', address: 'Hammarby Slussväg 2', area: 'Södermalm', type: 'klubb', lat: 59.3088, lng: 18.0812, closing: '05:00' },
      { id: 'under-bron', name: 'Under Bron', address: 'Skansbron 4', area: 'Södermalm', type: 'klubb', lat: 59.3082, lng: 18.0798, closing: '05:00' },
      { id: 'sturecompagniet', name: 'Sturecompagniet', address: 'Sturegatan 4', area: 'Östermalm', type: 'klubb', lat: 59.3365, lng: 18.0735, closing: '05:00' },
      { id: 'kristall', name: 'Kristall', address: 'Regeringsgatan 12', area: 'Norrmalm', type: 'klubb', lat: 59.3340, lng: 18.0620, closing: '03:00' },
      { id: 'golden-hits', name: 'Golden Hits', address: 'Kungsgatan 26', area: 'Norrmalm', type: 'klubb', lat: 59.3340, lng: 18.0630, closing: '03:00' },
      { id: 'neu', name: 'Neu', address: 'Östgötagatan 8', area: 'Södermalm', type: 'klubb', lat: 59.3115, lng: 18.0780, closing: '05:00' },
      { id: 'end-nightclub', name: 'END Nightclub', address: 'Jakobsgatan 10', area: 'Norrmalm', type: 'klubb', lat: 59.3320, lng: 18.0640, closing: '05:00' },
      { id: 'nalen', name: 'Nalen', address: 'Regeringsgatan 74', area: 'Norrmalm', type: 'klubb', lat: 59.3360, lng: 18.0640, closing: '03:00' },
      { id: 'mosebacke', name: 'Mosebacke Etablissement', address: 'Mosebacke Torg 3', area: 'Södermalm', type: 'klubb', lat: 59.3184, lng: 18.0743, closing: '03:00' },
      { id: 'patricia', name: 'Patricia', address: 'Stadsgårdskajen 152', area: 'Södermalm', type: 'klubb', lat: 59.3190, lng: 18.0650, closing: '05:00' },
      { id: 'solidaritet', name: 'Solidaritet', address: 'Långholmsgatan 3', area: 'Hornstull', type: 'klubb', lat: 59.3162, lng: 18.0370, closing: '05:00' },
      { id: 'gro', name: 'Gro', address: 'Folkungagatan 84', area: 'Södermalm', type: 'bar', lat: 59.3135, lng: 18.0760, closing: '01:00' },
      { id: 'pharmarium', name: 'Pharmarium', address: 'Stortorget 7', area: 'Gamla Stan', type: 'bar', lat: 59.3252, lng: 18.0716, closing: '01:00' },
      { id: 'tak', name: 'TAK Stockholm', address: 'Brunkebergstorg 2', area: 'Norrmalm', type: 'bar', lat: 59.3342, lng: 18.0656, closing: '02:00' },
      { id: 'drama', name: 'Drama', address: 'Stureplan 4', area: 'Östermalm', type: 'klubb', lat: 59.3363, lng: 18.0731, closing: '05:00' },
      { id: 'hells-kitchen', name: "Hell's Kitchen", address: 'Sturegatan 4', area: 'Östermalm', type: 'klubb', lat: 59.336484, lng: 18.073468, closing: '05:00' }
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

    function computeStatus(venueId, reports) {
      var venueReports = reports.filter(function(r) { return r.venue_id === venueId; });
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
      return { none: '#00E676', free: '#00E676', short: '#FFB300', medium: '#FF7043', long: '#FF3B3B', unknown: '#9CA3AF' }[status] || '#9CA3AF';
    }

    function getStatusClass(status) {
      return { none: 'free', short: 'short', medium: 'medium', long: 'long', unknown: 'unknown' }[status] || 'unknown';
    }

    function getVenueById(id) {
      return VENUES.find(function(v) { return v.id === id; });
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
      var status = computeStatus(venueId, allReports);
      var statusText = {
        long:   venue.name + ' — 30+ min kö just nu 🔴',
        medium: venue.name + ' — ca 25 min kö just nu 🟠',
        short:  venue.name + ' — ca 15 min kö just nu 🟡',
        free:   venue.name + ' — fri ingång just nu 🟢'
      }[status] || (venue.name + ' — ingen data just nu ⚪');

      if (navigator.share) {
        navigator.share({
          title: 'QueueBar',
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
            new Notification('QueueBar — ' + name, {
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

    function openVenueCard(venue, source) {
      console.log('[QueueBar] openVenueCard:', venue.id, '| källa:', source || 'lista');
      if (map && venue.lat && venue.lng) {
        map.flyTo({ center: [venue.lng, venue.lat], zoom: 14, duration: 800 });
      }
      activeVenue = venue;
      var status = computeStatus(venue.id, allReports);
      var reports = allReports.filter(function(r) { return r.venue_id === venue.id; })
        .sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      document.getElementById('vc-name').textContent = venue.name;
      var vcStatus = document.getElementById('vc-status');
      vcStatus.textContent = getStatusLabel(status) || 'Ingen rapport';
      vcStatus.style.color = getStatusColor(status);
      document.getElementById('vc-info').textContent = reports.length > 0
        ? reports.length + ' rapport' + (reports.length > 1 ? 'er' : '') + (reports[0] ? ' · ' + timeAgo(reports[0].created_at) : '')
        : 'Ingen rapport ännu';
      document.getElementById('vc-closing').textContent = 'Stänger ' + venue.closing;
      document.getElementById('vc-area').textContent = venue.area;
      document.getElementById('vc-overlay').style.display = 'block';
      var card = document.getElementById('venue-card');
      card.style.display = 'block';
      card.style.animation = 'slideUp 0.25s cubic-bezier(0.16,1,0.3,1)';
    }

    function closeVenueCard() {
      var card = document.getElementById('venue-card');
      card.style.animation = 'slideDown 0.2s cubic-bezier(0.36,0,0.66,0) forwards';
      document.getElementById('vc-overlay').style.display = 'none';
      setTimeout(function() {
        card.style.display = 'none';
        card.style.animation = '';
        activeVenue = null;
      }, 200);
    }

    function goToReport() {
      closeVenueCard();
      showScreen('report');
      if (activeVenue) {
        selectedRV = activeVenue;
        document.getElementById('rs-vname').textContent = activeVenue.name;
        document.getElementById('rs1').style.display = 'none';
        document.getElementById('rs2').style.display = 'flex';
        document.getElementById('rp-step-counter').style.display = 'none';
      }
    }

    function openDirections() {
      if (!activeVenue) return;
      window.open('https://www.google.com/maps/dir/?api=1&destination=' + activeVenue.lat + ',' + activeVenue.lng, '_blank');
    }

    function renderVenueCard(venue) {
      var status = computeStatus(venue.id, allReports);
      var label = getStatusLabel(status);
      var cls = getStatusClass(status);
      var reports = allReports.filter(function(r) { return r.venue_id === venue.id; });
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
      var label = getStatusLabel(status);
      var cls = getStatusClass(status);
      var dotColor = { free: '#22C55E', short: '#F59E0B', medium: '#EA7300', long: '#EF4444', unknown: '#D1D5DB' }[cls] || '#D1D5DB';
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
          properties: { id: v.id, name: v.name, type: v.type, status: 'unknown' }
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

    if (window.mapboxgl) {
      console.log('[QueueBar] Initierar Mapbox-karta');
      try {
        map = new mapboxgl.Map({
          container: 'map',
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [18.0686, 59.3293],
          zoom: 12.5,
          minZoom: 11,
          maxZoom: 17,
          pitch: 0,
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

        function addSdfPin(map, name, iconFn) {
          var W = 32, H = 48;
          var canvas = document.createElement('canvas');
          canvas.width = W; canvas.height = H;
          var ctx = canvas.getContext('2d');
          var cx = W / 2, r = W / 2 - 2, cy = r + 2, tipY = H - 2;
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.55, cy + r * 0.6);
          ctx.bezierCurveTo(cx - r * 0.25, tipY - 5, cx - 2, tipY - 2, cx, tipY);
          ctx.bezierCurveTo(cx + 2, tipY - 2, cx + r * 0.25, tipY - 5, cx + r * 0.55, cy + r * 0.6);
          ctx.closePath();
          ctx.fill();
          ctx.globalCompositeOperation = 'destination-out';
          iconFn(ctx, cx, cy, r);
          ctx.globalCompositeOperation = 'source-over';
          var imageData = ctx.getImageData(0, 0, W, H);
          map.addImage(name, { width: W, height: H, data: imageData.data }, { sdf: true });
        }

        function drawMartiniCutout(ctx, cx, cy, r) {
          var s = r * 0.6;
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(cx - s, cy - s * 0.6);
          ctx.lineTo(cx, cy + s * 0.2);
          ctx.lineTo(cx + s, cy - s * 0.6);
          ctx.moveTo(cx - s, cy - s * 0.6);
          ctx.lineTo(cx + s, cy - s * 0.6);
          ctx.moveTo(cx, cy + s * 0.2);
          ctx.lineTo(cx, cy + s * 0.75);
          ctx.moveTo(cx - s * 0.5, cy + s * 0.75);
          ctx.lineTo(cx + s * 0.5, cy + s * 0.75);
          ctx.stroke();
        }

        function drawDiscoCutout(ctx, cx, cy, r) {
          var br = r * 0.56;
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, br, 0, Math.PI * 2);
          ctx.stroke();
          ctx.lineWidth = 1.5;
          var g = br * 0.55;
          for (var i = -1; i <= 1; i++) {
            var dy = i * g, hw = Math.sqrt(Math.max(0, br * br - dy * dy));
            if (hw > 2) { ctx.beginPath(); ctx.moveTo(cx - hw, cy + dy); ctx.lineTo(cx + hw, cy + dy); ctx.stroke(); }
            var dx = i * g, hh = Math.sqrt(Math.max(0, br * br - dx * dx));
            if (hh > 2) { ctx.beginPath(); ctx.moveTo(cx + dx, cy - hh); ctx.lineTo(cx + dx, cy + hh); ctx.stroke(); }
          }
        }

        map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

        map.on('load', function() {
          console.log('[QueueBar] Mapbox karta laddad — lägger till lager');

          addSdfPin(map, 'pin-bar',  drawMartiniCutout);
          addSdfPin(map, 'pin-club', drawDiscoCutout);

          map.addSource('venues', {
            type: 'geojson', data: venueGeoJSON,
            cluster: true, clusterMaxZoom: 13, clusterRadius: 40
          });

          map.addLayer({
            id: 'clusters', type: 'circle', source: 'venues',
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': '#FFFFFF',
              'circle-radius': ['step', ['get', 'point_count'], 18, 6, 21, 16, 24],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#E5E7EB'
            }
          });

          map.addLayer({
            id: 'cluster-count', type: 'symbol', source: 'venues',
            filter: ['has', 'point_count'],
            layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 14, 'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'] },
            paint: { 'text-color': '#1A1F36', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1 }
          });

          map.addLayer({
            id: 'venues-pins', type: 'symbol', source: 'venues',
            filter: ['!', ['has', 'point_count']],
            layout: {
              'icon-image': ['match', ['get', 'type'], 'bar', 'pin-bar', 'pin-club'],
              'icon-size': 1,
              'icon-anchor': 'bottom',
              'icon-allow-overlap': true,
              'icon-ignore-placement': true
            },
            paint: {
              'icon-color': [
                'match', ['get', 'status'],
                'none',   '#22C55E',
                'short',  '#F59E0B',
                'medium', '#EA7300',
                'long',   '#EF4444',
                '#9CA3AF'
              ],
              'icon-halo-color': 'rgba(255,255,255,0.9)',
              'icon-halo-width': 1.5
            }
          });

          // venue-label layer removed — markers are pure status circles

          // Pulse ring for free (ingen kö) venues — driven by Mapbox animation frame
          map.addLayer({
            id: 'venues-pulse', type: 'circle', source: 'venues',
            filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'status'], 'none']],
            paint: {
              'circle-color': 'rgba(34,197,94,0)',
              'circle-radius': 8,
              'circle-stroke-width': 2,
              'circle-stroke-color': 'rgba(34,197,94,0.4)'
            }
          });

          // animate pulse ring
          var pulseSize = 11, pulseDir = 1;
          function animatePulse() {
            pulseSize += pulseDir * 0.2;
            if (pulseSize >= 18) pulseDir = -1;
            if (pulseSize <= 11) pulseDir = 1;
            var opacity = (18 - pulseSize) / 7 * 0.4;
            if (map.getLayer('venues-pulse')) {
              map.setPaintProperty('venues-pulse', 'circle-radius', pulseSize);
              map.setPaintProperty('venues-pulse', 'circle-stroke-color', 'rgba(34,197,94,' + opacity + ')');
            }
            requestAnimationFrame(animatePulse);
          }
          requestAnimationFrame(animatePulse);

          map.addLayer({
            id: 'venues-status', type: 'symbol', source: 'venues',
            filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'status'], 'unknown']],
            layout: {
              'text-field': ['match', ['get', 'status'], 'none', 'Ingen kö', 'short', '~15 min', 'medium', '~25 min', 'long', '30+ min', ''],
              'text-size': 10, 'text-offset': ['literal', [0, 0.5]], 'text-anchor': 'top', 'text-allow-overlap': true,
              'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular']
            },
            paint: {
              'text-color': ['match', ['get', 'status'], 'none', '#10B981', 'short', '#F59E0B', 'medium', '#EA7300', 'long', '#EF4444', '#9B91B0'],
              'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.5
            }
          });


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
          console.log('[QueueBar] Kartlager klara');
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

    function showFloatingPoints(pts) {
      var app = document.getElementById('app');
      var ar = app ? app.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      var el = document.createElement('div');
      el.className = 'fp-float';
      el.textContent = '+' + (pts || 10) + ' poäng';
      el.style.left = (ar.left + ar.width / 2 - 50) + 'px';
      el.style.top = (ar.top + ar.height * 0.6) + 'px';
      document.body.appendChild(el);
      setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 1500);
    }

    var STATUS_COLORS = {
      free: '#00E676', short: '#FFB300', medium: '#FF7043', long: '#FF3B3B', unknown: 'rgba(255,255,255,0.18)'
    };

    async function loadReports() {
      if (!supabase) {
        console.warn('[QueueBar] loadReports: supabase är null — kör testdata-only');
        injectTestData();
        updateMapStatuses();
        renderHomeVenues();
        if (typeof renderExploreVenues === 'function') renderExploreVenues();
        if (typeof renderLiveFeed === 'function') renderLiveFeed();
        if (typeof updateProfileStats === 'function') updateProfileStats();
        checkWatchedVenueAlerts();
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
          showExploreError();
        }
        if (result.data) {
          allReports = result.data;
          console.log('[QueueBar] loadReports: ' + allReports.length + ' Supabase-rapporter inladdade');
          injectTestData();
          updateMapStatuses();
          renderHomeVenues();
          if (typeof renderExploreVenues === 'function') renderExploreVenues();
          if (typeof renderLiveFeed === 'function') renderLiveFeed();
          if (typeof updateProfileStats === 'function') updateProfileStats();
          checkWatchedVenueAlerts();
        }
      } catch(err) {
        console.error('[QueueBar] loadReports kastade:', err);
        showExploreError();
      }
    }

    function updateMapStatuses() {
      if (!map || !venueGeoJSON) return;
      if (!map.getSource('venues')) return;
      var updated = venueGeoJSON.features.map(function(f) {
        return Object.assign({}, f, {
          properties: Object.assign({}, f.properties, { status: computeStatus(f.properties.id, allReports) })
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

    function injectTestData() {
      var now = Date.now();
      var _testUsers = ['usr-a1b2', 'usr-c3d4', 'usr-e5f6', 'usr-g7h8', 'usr-i9j0', 'usr-k1l2', 'usr-m3n4', 'usr-o5p6'];
      var _tIdx = 0;
      function ago(mins) { return new Date(now - mins * 60 * 1000).toISOString(); }
      function r(venueId, minsAgo, status) {
        return { id: 'test-' + venueId + '-' + minsAgo, venue_id: venueId, queue_status: status,
                 created_at: ago(minsAgo), expires_at: ago(-45), user_id: _testUsers[_tIdx++ % _testUsers.length] };
      }
      var testReports = [
        // spy-bar
        r('spy-bar', 45, 'short'), r('spy-bar', 20, 'medium'), Object.assign(r('spy-bar', 5, 'long'), { comment: 'VIP-kö öppen' }),
        // sturehof
        r('sturehof', 50, 'free'), r('sturehof', 30, 'short'), r('sturehof', 10, 'medium'),
        // soap-bar
        r('soap-bar', 40, 'short'), r('soap-bar', 15, 'short'), r('soap-bar', 3, 'medium'),
        // tjoget
        r('tjoget', 55, 'free'), r('tjoget', 25, 'free'), r('tjoget', 8, 'short'),
        // pelikan
        r('pelikan', 60, 'medium'), r('pelikan', 35, 'long'), r('pelikan', 12, 'long'),
        // morfar-ginko
        r('morfar-ginko', 30, 'free'), r('morfar-ginko', 10, 'free'),
        // akkurat
        r('akkurat', 45, 'short'), r('akkurat', 20, 'medium'), r('akkurat', 6, 'long'),
        // berns
        r('berns', 50, 'short'), r('berns', 30, 'medium'), r('berns', 15, 'long'), r('berns', 3, 'long'),
        // sturecompagniet
        r('sturecompagniet', 40, 'medium'), r('sturecompagniet', 20, 'long'), r('sturecompagniet', 5, 'long'),
        // tradgarden
        r('tradgarden', 55, 'free'), r('tradgarden', 35, 'short'), r('tradgarden', 18, 'medium'), r('tradgarden', 4, 'medium'),
        // under-bron
        r('under-bron', 45, 'free'), r('under-bron', 25, 'free'), r('under-bron', 8, 'short'),
        // cafe-opera
        r('cafe-opera', 60, 'medium'), r('cafe-opera', 35, 'long'), r('cafe-opera', 10, 'long'), Object.assign(r('cafe-opera', 2, 'long'), { comment: 'Fri entré t.o.m. 23:30' }),
        // solidaritet
        r('solidaritet', 30, 'free'), r('solidaritet', 10, 'free'),
        // gro
        r('gro', 50, 'short'), r('gro', 28, 'short'), r('gro', 7, 'free'),
        // pharmarium
        r('pharmarium', 40, 'short'), r('pharmarium', 15, 'medium'), r('pharmarium', 1, 'short'),
        // tak
        r('tak', 55, 'medium'), r('tak', 30, 'long'), r('tak', 12, 'long'), r('tak', 4, 'medium'),
        // drama
        r('drama', 35, 'long'), r('drama', 18, 'long'), r('drama', 6, 'long')
      ];
      // Remove old test entries, then prepend fresh ones
      allReports = allReports.filter(function(r) { return !r.id || !String(r.id).startsWith('test-'); });
      allReports = testReports.concat(allReports);
      console.log('[QueueBar] injectTestData: ' + testReports.length + ' testrap injicerade, totalt ' + allReports.length + ' rapporter för ' + VENUES.length + ' venues');

      // Historical patterns for test mode — simulate typical Friday night data
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

    async function submitReport(venueId, venueName, queueStatus, comment) {
      if (!supabase) throw new Error('Supabase är inte tillgänglig');
      var userId = getUserId();
      var now = new Date();
      var recent = allReports.filter(function(r) { return r.user_id === userId && (now - new Date(r.created_at)) < 20 * 60 * 1000; });
      if (recent.length > 0) {
        var wait = Math.ceil(20 - (now - new Date(recent[0].created_at)) / 60000);
        throw new Error('Vänta ' + wait + ' minuter innan nästa rapport');
      }
      var insertObj = { venue_id: venueId, venue_name: venueName, queue_status: queueStatus, user_id: userId, expires_at: new Date(now.getTime() + 45 * 60 * 1000).toISOString() };
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
      await supabase.rpc('increment_points', { p_user_id: userId, p_points: 10 });
      await loadReports();
      return true;
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
          .select('venue_id, level, created_at')
          .gte('created_at', eightWeeksAgo)
          .not('level', 'eq', 'none');
        if (result.error || !result.data) return;
        var byVenue = {};
        result.data.forEach(function(r) {
          var d = new Date(r.created_at);
          var rdow = d.getDay();
          var rhour = d.getHours();
          if (rdow !== dow) return;
          if (Math.abs(rhour - hour) > 1) return;
          if (!byVenue[r.venue_id]) byVenue[r.venue_id] = {};
          byVenue[r.venue_id][r.level] = (byVenue[r.venue_id][r.level] || 0) + 1;
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

    // Fix 4 — loadReports alltid, oavsett karta
    console.log('[QueueBar] Startar initial datainläsning');
    loadReports().then(loadHistoricalPatterns);
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
        screen: 'profile',
        title: 'Din profil',
        subtitle: 'Håll koll på dina krogar',
        pos: { bottom: 'calc(72px + env(safe-area-inset-bottom))', right: '8px' },
        arrow: 'arr-d', arrowX: '75%'
      }
    ];
    var obStep = 0;

    function obGetTarget(screen) {
      if (screen === 'explore') {
        return document.querySelector('#explore-list .erow:not(.erow--empty)') ||
               document.querySelector('#explore-list .erow');
      } else if (screen === 'live') {
        return document.querySelector('#live-feed > *');
      } else if (screen === 'profile') {
        return document.querySelector('.pf-head');
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

      if (s.screen === 'home' && map && typeof map.project === 'function') {
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
        var target = obGetTarget(s.screen);
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
    var _exsumPrevCounts = null;

    function computeExploreSummary() {
      var now = Date.now();
      var cutoff30  = now - 30  * 60 * 1000;
      var cutoff2h  = now - 120 * 60 * 1000;
      // Latest report per venue within 2h
      var venueLatest = {};
      allReports.forEach(function(r) {
        var t = new Date(r.created_at).getTime();
        if (t < cutoff2h) return;
        if (!venueLatest[r.venue_id] || t > new Date(venueLatest[r.venue_id].created_at).getTime()) {
          venueLatest[r.venue_id] = r;
        }
      });
      var freeCount = 0, medCount = 0, longCount = 0;
      Object.keys(venueLatest).forEach(function(vid) {
        var r = venueLatest[vid];
        if (new Date(r.created_at).getTime() < cutoff30) return; // stale
        var s = r.queue_status;
        if (s === 'free' || s === 'none') freeCount++;
        else if (s === 'short' || s === 'medium') medCount++;
        else if (s === 'long') longCount++;
      });
      // Open venues (closing hour after current time)
      var d = new Date();
      var nowMins = d.getHours() * 60 + d.getMinutes();
      var openCount = VENUES.filter(function(v) {
        if (!v.closing) return true;
        var parts = v.closing.split(':');
        var close = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        if (close < 360) close += 1440; // e.g. 02:00 → 1560 next-day
        var open = 17 * 60; // assume bars open ~17:00
        var cur = nowMins < 12 * 60 ? nowMins + 1440 : nowMins;
        return cur >= open && cur < close;
      }).length;
      // Reports since 18:00 tonight
      var today18 = new Date(d); today18.setHours(18, 0, 0, 0);
      if (d.getHours() < 18) today18.setDate(today18.getDate() - 1);
      var since18 = allReports.filter(function(r) {
        return new Date(r.created_at).getTime() >= today18.getTime();
      }).length;
      // Last report time
      var lastTs = null;
      allReports.forEach(function(r) {
        var t = new Date(r.created_at).getTime();
        if (!lastTs || t > lastTs) lastTs = t;
      });
      return { freeCount: freeCount, medCount: medCount, longCount: longCount,
               openCount: openCount, since18: since18, lastTs: lastTs, total: allReports.length };
    }

    function exsumTimeSince(ms) {
      if (!ms) return null;
      var mins = Math.round((Date.now() - ms) / 60000);
      if (mins < 1) return 'just nu';
      return mins + ' min sedan';
    }

    function exsumCountUp(el, target) {
      if (!el || target === 0) { if (el) el.textContent = '0'; return; }
      var start = performance.now();
      var dur = 500;
      function step(now) {
        var p = Math.min((now - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * eased);
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = target;
      }
      el.textContent = '0';
      requestAnimationFrame(step);
    }

    function pulseSummaryNum(index) {
      var el = document.getElementById('exsum-n' + index);
      if (!el) return;
      el.classList.remove('exsum-num--pulse');
      void el.offsetWidth; // reflow
      el.classList.add('exsum-num--pulse');
      el.addEventListener('animationend', function() { el.classList.remove('exsum-num--pulse'); }, { once: true });
    }

    function renderExploreSummary(animate) {
      var el = document.getElementById('explore-summary');
      if (!el) return;
      var data = computeExploreSummary();
      var noData = data.total === 0;
      var freeShortCount = data.freeCount + data.medCount;
      var footerText = noData
        ? 'Inga rapporter än — bli först att rapportera'
        : freeShortCount + ' ställen med kort eller ingen kö nu';

      el.innerHTML =
        '<div class="exsum">' +
          '<div class="exsum-stats">' +
            '<div class="exsum-stat">' +
              '<span class="exsum-num" id="exsum-n0" style="color:#00E676">0</span>' +
              '<span class="exsum-label">KORT KÖ</span>' +
            '</div>' +
            '<div class="exsum-sep"></div>' +
            '<div class="exsum-stat">' +
              '<span class="exsum-num" id="exsum-n1" style="color:#FFB300">0</span>' +
              '<span class="exsum-label">MEDEL KÖ</span>' +
            '</div>' +
            '<div class="exsum-sep"></div>' +
            '<div class="exsum-stat">' +
              '<span class="exsum-num" id="exsum-n2" style="color:#FF3B3B">0</span>' +
              '<span class="exsum-label">LÅNG KÖ</span>' +
            '</div>' +
          '</div>' +
          '<div class="exsum-footer" id="exsum-footer">' + footerText + '</div>' +
        '</div>';

      var targets = [data.freeCount, data.medCount, data.longCount];
      targets.forEach(function(t, i) {
        var numEl = document.getElementById('exsum-n' + i);
        if (animate) {
          exsumCountUp(numEl, t);
        } else {
          if (numEl) numEl.textContent = t;
          // Pulse changed bucket if re-render after new data
          if (_exsumPrevCounts && _exsumPrevCounts[i] !== t) pulseSummaryNum(i);
        }
      });
      _exsumPrevCounts = targets;

      // 30s footer refresh
      clearInterval(_exsumInterval);
      _exsumInterval = setInterval(function() {
        var footer = document.getElementById('exsum-footer');
        if (!footer) { clearInterval(_exsumInterval); return; }
        var d2 = computeExploreSummary();
        var fs2 = d2.freeCount + d2.medCount;
        footer.textContent = d2.total === 0
          ? 'Inga rapporter än — bli först att rapportera'
          : fs2 + ' ställen med kort eller ingen kö nu';
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
      var venueReports = allReports.filter(function(r) { return r.venue_id === venue.id; })
        .sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); });
      var latestReport = venueReports[0] || null;
      var status = computeStatus(venue.id, allReports);
      var cls = getStatusClass(status);
      var color = STATUS_COLORS[cls] || '#D1D5DB';
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

      var levelBg = { long: 'rgba(255,59,59,0.06)', medium: 'rgba(255,112,67,0.04)', free: 'rgba(0,230,118,0.04)', empty: 'rgba(255,255,255,0.02)' }[level];
      var stateClass = isEmpty ? ' erow--empty' : (isAging ? ' erow--stale' : '');
      var agingStyle = '';
      var barColor = isEmpty ? 'rgba(255,255,255,0.08)' : color;

      // Hero number
      var heroText, heroColor;
      if (!hasData) {
        heroText = '–'; heroColor = '#D1D5DB';
      } else {
        var mins = { none: 0, free: 0, short: 15, medium: 25, long: 30 }[status];
        heroText = (status === 'free' || status === 'none') ? 'Fri' : (mins === 30 ? '30+ min' : '~' + mins + ' min');
        // Per-level hero color for better contrast
        var heroColors = { free: '#00E676', short: '#FFB300', medium: '#FF7043', long: '#FF3B3B' };
        heroColor = heroColors[level] || 'rgba(255,255,255,0.18)';
      }

      // Freshness check for pulse dot: only show if long AND report < 20 min old
      var minutesSince = latestReport ? (Date.now() - new Date(latestReport.created_at)) / 60000 : Infinity;
      var showPulseDot = level === 'long' && minutesSince < 20;
      var pulseHtml = showPulseDot ? '<span class="erow-pulse-dot"></span>' : '';

      // Trend (replaces badge — new information, not redundant with hero)
      var trendHtml = '';
      var STATUS_RANK = { free: 0, none: 0, short: 1, medium: 2, long: 3 };
      if (hasData && venueReports.length === 1) {
        trendHtml = '<span class="erow-trend erow-trend--single">· 1 rapport</span>';
      } else if (hasData && venueReports.length >= 2) {
        var r1 = venueReports[0].queue_status; // newest
        var r2 = venueReports[1].queue_status; // previous
        var rank1 = STATUS_RANK[r1] !== undefined ? STATUS_RANK[r1] : 1;
        var rank2 = STATUS_RANK[r2] !== undefined ? STATUS_RANK[r2] : 1;
        if (rank1 > rank2) {
          trendHtml = '<span class="erow-trend erow-trend--up" style="color:' + color + '">↑ Ökar</span>';
        } else if (rank1 < rank2) {
          trendHtml = '<span class="erow-trend erow-trend--down">↓ Minskar</span>';
        } else {
          trendHtml = '<span class="erow-trend erow-trend--stable">→ Stabil</span>';
        }
      }

      // Tertiary row
      var reportCount = venueReports.length;
      var uniqueReporters = new Set(venueReports.map(function(r) { return r.user_id; })).size;
      var lastTime = latestReport ? formatAbsTime(latestReport.created_at) : '–';
      var confLevel = hasData ? computeConfidence(venueReports) : 0;
      var confHtml = '';
      if (hasData) {
        var bars = '';
        for (var i = 1; i <= 3; i++) {
          bars += '<span class="conf-bar' + (i <= confLevel ? ' active' : '') + '"></span>';
        }
        confHtml = '<span class="conf-bars" style="color:' + heroColor + '">' + bars + '</span>';
      }

      // Distance (if available)
      var typeLabel = venueTypeLabel(venue.type);
      var metaText = venue.area + (typeLabel ? ' · ' + typeLabel : '');
      if (window._userPos && venue.lat && venue.lng) {
        var dlat = (venue.lat - window._userPos.lat) * 111000;
        var dlng = (venue.lng - window._userPos.lng) * 111000 * Math.cos(venue.lat * Math.PI / 180);
        var dist = Math.round(Math.sqrt(dlat * dlat + dlng * dlng) / 100) * 100;
        metaText = venue.area + (typeLabel ? ' · ' + typeLabel : '') + ' · ' + (dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : dist + 'm');
      }

      var delay = (index * 75 + 340) + 'ms';
      var levelClass = level === 'long' ? ' erow--long' : level === 'medium' ? ' erow--medium' : level === 'free' ? ' erow--free' : '';

      // Planning mode
      var planIdx = _planVenues.indexOf(venue.id);
      var planBadge = (_planningMode && planIdx >= 0)
        ? '<div class="plan-badge" style="margin-right:8px">' + (planIdx + 1) + '</div>'
        : (_planningMode ? '<div class="plan-badge plan-badge--empty" style="margin-right:8px"></div>' : '');
      var rowOnClick = _planningMode
        ? 'togglePlanVenue(\'' + venue.id + '\')'
        : 'openVenueCard(getVenueById(\'' + venue.id + '\'),\'explore\')';

      return '<div class="erow' + stateClass + levelClass + '" style="--row-delay:' + delay + ';background-color:' + levelBg + ';" onclick="' + rowOnClick + '">' +
        '<div class="erow-left-bar" style="background:' + barColor + '"></div>' +
        '<div class="erow-inner">' +
          planBadge +
          '<div class="erow-body">' +
            '<div class="erow-name-row">' +
              (isBest ? '<span class="bast-chip"><span class="bast-chip-dot"></span>Bäst nu' + (bastReason ? ' · ' + bastReason : '') + '</span>' : '') +
              pulseHtml +
              '<div class="erow-name">' + venue.name + (isWatching(venue.id) ? '<svg viewBox="0 0 24 24" width="10" height="10" fill="rgba(255,255,255,0.5)" style="vertical-align:middle;margin-left:4px;flex-shrink:0"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>' : '') + '</div>' +
            '</div>' +
            '<div class="erow-meta">' + metaText + '</div>' +
            (function() {
              var pat = _historicalPatterns[venue.id];
              var patLabels = { long: 'Vanligtvis lång kö nu', medium: 'Vanligtvis medel kö nu', short: 'Vanligtvis kort kö nu', free: 'Vanligtvis fri ingång nu' };
              var patHtml = pat && patLabels[pat.level] ? '<span class="hist-chip hist-chip--' + pat.level + '">' + patLabels[pat.level] + '</span>' : '';
              var recentWithComment = venueReports.filter(function(r) {
                return r.comment && (Date.now() - new Date(r.created_at).getTime()) < 30 * 60 * 1000;
              }).sort(function(a, b) { return new Date(b.created_at) - new Date(a.created_at); })[0];
              var commentHtml = recentWithComment ? '<div class="erow-comment">"' + recentWithComment.comment + '"</div>' : '';
              var closingSoonHtml = '';
              if (venue.closing) {
                var cParts = venue.closing.split(':');
                var cH = parseInt(cParts[0]), cM = parseInt(cParts[1] || 0);
                var cTotal = cH < 6 ? (cH + 24) * 60 + cM : cH * 60 + cM;
                var nowD = new Date(); var nowAdj = nowD.getHours() * 60 + nowD.getMinutes();
                if (nowAdj < 12 * 60) nowAdj += 1440;
                var minsLeft = cTotal - nowAdj;
                if (minsLeft > 0 && minsLeft <= 90) {
                  closingSoonHtml = '<span class="erow-tertiary-sep">·</span><span style="color:#FF7043;font-weight:600">Stänger ' + venue.closing + '</span>';
                }
              }
              var tertiaryHtml = hasData
                ? '<div class="erow-tertiary">' +
                    confHtml +
                    '<span>' + uniqueReporters + ' pers bekräftade</span>' +
                    '<span class="erow-tertiary-sep">·</span>' +
                    '<span>senast ' + lastTime + '</span>' +
                    (patHtml ? '<span class="erow-tertiary-sep">·</span>' + patHtml : '') +
                    closingSoonHtml +
                    (isAging ? '<span class="erow-tertiary-sep">·</span><span class="erow-stale-label">Kan vara gammal</span>' : '') +
                  '</div>'
                : (patHtml
                    ? '<div class="erow-tertiary">' + patHtml + closingSoonHtml + '</div>'
                    : '<div class="erow-tertiary"><span class="erow-empty-cta">Ingen data — var den första att rapportera</span>' + closingSoonHtml + '</div>');
              return tertiaryHtml + commentHtml;
            })() +
          '</div>' +
          '<div class="erow-right">' +
            '<span class="erow-hero erow-hero--animate" style="color:' + heroColor + '">' + heroText + '</span>' +
            trendHtml +
            (function() {
              if (venueReports.length < 2) return '';
              var STATUS_H = { free: 'free', short: 'short', medium: 'medium', long: 'long', none: 'free' };
              var recent = venueReports.slice(0, 4).reverse();
              return '<div class="erow-spark">' + recent.map(function(r) {
                var cls = STATUS_H[r.queue_status] || 'free';
                return '<span class="spark-blk spark-blk--' + cls + '"></span>';
              }).join('') + '</div>';
            })() +
          '</div>' +
          '<button class="erow-report-btn" onclick="event.stopPropagation();openQuickReport(\'' + venue.id + '\')" aria-label="Rapportera"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' +
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
      if (planChip) planChip.textContent = _planningMode ? 'Avbryt' : 'Planera';
      // Legacy btn (no longer in DOM, guard kept)
      var btn = document.getElementById('plan-mode-btn');
      if (btn) btn.textContent = _planningMode ? 'Avbryt' : 'Planera kväll';
      var bar = document.getElementById('plan-bar');
      if (bar) bar.style.display = _planningMode ? 'flex' : 'none';
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
      var STATUS_LABEL = { free: 'Fri ingång', short: '~15 min', medium: '~25 min', long: '30+ min', none: 'Okänd kö' };
      var STATUS_COLOR = { free: '#00E676', short: '#FFB300', medium: '#FF7043', long: '#FF3B3B', none: 'rgba(255,255,255,0.3)' };

      var items = scored.map(function(s, i) {
        var color = STATUS_COLOR[s.status] || 'rgba(255,255,255,0.3)';
        var label = STATUS_LABEL[s.status] || 'Okänd kö';
        var closing = s.venue && s.venue.closing ? ' · Stänger ' + s.venue.closing : '';
        return '<div style="display:flex;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.07)">'
          + '<div style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:rgba(255,255,255,0.7);flex-shrink:0">' + (i+1) + '</div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:15px;font-weight:600;color:#fff">' + (s.venue ? s.venue.name : s.id) + '</div>'
          + '<div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:2px">' + label + closing + '</div>'
          + '</div>'
          + '<div style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0"></div>'
          + '</div>';
      }).join('');

      var modal = document.createElement('div');
      modal.id = 'plan-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:900;display:flex;flex-direction:column;justify-content:flex-end';
      modal.innerHTML = '<div onclick="closePlanModal()" style="flex:1;background:rgba(0,0,0,0.6)"></div>'
        + '<div style="background:#0D0F1A;border-radius:20px 20px 0 0;border-top:1px solid rgba(255,255,255,0.1);padding:24px 20px 40px;font-family:\'Plus Jakarta Sans\',system-ui,sans-serif">'
        + '<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:rgba(255,255,255,0.4);margin-bottom:16px">DIN KVÄLLSPLAN</div>'
        + items
        + '<button onclick="closePlanModal()" style="margin-top:20px;width:100%;height:48px;border-radius:12px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.7);font-size:15px;font-weight:600;cursor:pointer;font-family:inherit">Stäng</button>'
        + '</div>';
      document.body.appendChild(modal);

      _planningMode = false;
      _planVenues = [];
      renderExploreVenues();
      var planChip = document.querySelector('.fbtn--plan');
      if (planChip) planChip.textContent = 'Planera';
      var planBtn = document.getElementById('plan-mode-btn');
      if (planBtn) planBtn.textContent = 'Planera kväll';
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

    var _exsumFirstRender = true;
    function renderExploreVenues() {
      renderExploreSummary(_exsumFirstRender);
      _exsumFirstRender = false;
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
          emptyTitle = 'Inga venues med ' + (filterLabels[_exploreFilter] || _exploreFilter) + ' just nu';
          emptySub = 'Kolla tillbaka lite senare';
        } else {
          var term = rawQ ? '”' + rawQ + '”' : '';
          emptyTitle = 'Inga resultat' + (term ? ' för ' + term : '');
          emptySub = 'Prova ett annat namn eller område';
        }
        el.innerHTML = '<div class=”explore-empty”>' +
          '<div class=”explore-empty-title”>' + emptyTitle + '</div>' +
          '<div class=”explore-empty-sub”>' + emptySub + '</div>' +
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

      el.innerHTML = '<div class=”venue-group”>' + list.map(function(v, i) {
        return renderExploreVenueRow(v, i, v.id === bestVenueId ? best : null);
      }).join('') + '</div>';

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

    function _liveRowHtml(r, isSub) {
      var liveDescriptors = { none: 'Ingen kö', free: 'Ingen kö', short: 'Kort kö', medium: 'Medel kö', long: 'Lång kö' };
      var liveTimes  = { short: '~15 min', medium: '~25 min', long: '30+ min' };
      var liveColors = { none: '#00E676', free: '#00E676', short: '#FFB300', medium: '#FF7043', long: '#FF3B3B' };
      var qs = r.queue_status;
      var descriptor = liveDescriptors[qs];
      if (!descriptor) return '';
      var waitTime = liveTimes[qs] || '';
      var color = liveColors[qs] || '#9CA3AF';
      var venue = getVenueById(r.venue_id);
      var name = venue ? venue.name : (r.venue_name || r.venue_id);
      var area = venue ? venue.area : '';
      if (isSub) {
        var subLabel = waitTime || descriptor;
        return '<div class="live-sub-row">' +
          '<div class="live-sub-wait" style="color:' + color + '">' + subLabel + '</div>' +
          '<div class="live-sub-meta">' + timeAgo(r.created_at) + '</div></div>';
      }
      var liveBg = { long: 'rgba(255,59,59,0.06)', medium: 'rgba(255,112,67,0.04)', free: 'rgba(0,230,118,0.04)', none: 'rgba(0,230,118,0.04)' }[qs] || '';
      var heroHtml = waitTime
        ? '<div class="live-wait">' + waitTime + '</div><div class="live-cat">' + descriptor + '</div>'
        : '<div class="live-wait">' + descriptor + '</div>';
      var venueLiveType = venue ? venueTypeLabel(venue.type) : '';
      var typeBadgeHtml = venueLiveType ? '<span class="type-badge">' + venueLiveType.toUpperCase() + '</span>' : '';
      return '<div class="live-row"' + (liveBg ? ' style="background:' + liveBg + '"' : '') + '>' +
        '<div class="live-status" style="color:' + color + '">' + heroHtml + '</div>' +
        '<div class="live-right"><div class="live-name">' + name + typeBadgeHtml + '</div>' +
        '<div class="live-meta">' + (area ? area + ' · ' : '') + timeAgo(r.created_at) + '</div></div></div>';
    }

    function toggleLiveVenue(venueId) {
      if (_liveExpanded.has(venueId)) { _liveExpanded.delete(venueId); } else { _liveExpanded.add(venueId); }
      renderLiveFeed();
    }

    function renderLiveFeed() {
      var el = document.getElementById('live-feed');
      if (!el) return;
      if (!supabase) {
        el.innerHTML = '<div class="empty"><p>Livedata är inte tillgänglig</p><button class="empty-btn" onclick="retrySupabase()">Försök igen</button></div>';
        return;
      }
      var now = new Date();
      var cutoff = now - 45 * 60 * 1000;
      var recent = allReports.filter(function(r) { return new Date(r.created_at).getTime() > cutoff; });
      if (!recent.length) {
        el.innerHTML = '<div class="empty"><svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a15 15 0 0 1 20 0"/><path d="M5 12.5a10.5 10.5 0 0 1 14 0"/><path d="M8.5 16a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/></svg><p>Inga rapporter ännu.<br>Gå ut och rapportera!</p></div>';
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
      el.innerHTML = venueIds.map(function(vid) {
        var reports = groups[vid];
        var latest = reports[0];
        var older = reports.slice(1);
        var mainRow = _liveRowHtml(latest, false);
        if (!mainRow) return '';
        var html = mainRow;
        if (older.length) {
          var expanded = _liveExpanded.has(vid);
          if (expanded) {
            html += older.map(function(r) { return _liveRowHtml(r, true); }).filter(Boolean).join('');
            html += '<button class="live-expand-btn" onclick="toggleLiveVenue(\'' + vid + '\')">↑ Dölj tidigare rapporter</button>';
          } else {
            html += '<button class="live-expand-btn" onclick="toggleLiveVenue(\'' + vid + '\')">+' + older.length + ' tidigare ' + (older.length === 1 ? 'rapport' : 'rapporter') + ' · visa</button>';
          }
        }
        return html;
      }).filter(Boolean).join('');
    }

    renderLiveFeed();
    setInterval(function() { if (typeof renderLiveFeed === 'function') renderLiveFeed(); }, 30000);

    // ── På väg ────────────────────────────────────────────────────────────────
    var _onMyWay = null; // { venueId, arrivalTime, walkMins, timerId }

    function goOnMyWay(venueId) {
      var venue = getVenueById(venueId);
      if (!venue) return;

      if (_onMyWay && _onMyWay.timerId) clearTimeout(_onMyWay.timerId);

      var walkMins = 15;
      if (window._userPos) {
        var dlat = venue.lat - window._userPos.lat;
        var dlng = venue.lng - window._userPos.lng;
        var distKm = Math.sqrt(dlat * dlat + dlng * dlng) * 111;
        walkMins = Math.max(2, Math.round(distKm / (5 / 60)));
      }

      var arrivalTime = new Date(Date.now() + walkMins * 60 * 1000);
      var timerId = setTimeout(function() {
        showToast('Dags! Du borde vara framme vid ' + venue.name + ' nu 👟');
        _onMyWay = null;
        updateOnMyWayUI();
      }, walkMins * 60 * 1000);

      _onMyWay = { venueId: venueId, arrivalTime: arrivalTime, walkMins: walkMins, timerId: timerId };

      showToast('På väg till ' + venue.name + ' — ca ' + walkMins + ' min');
      updateOnMyWayUI();
      closeVenueCard();
    }

    function cancelOnMyWay() {
      if (_onMyWay && _onMyWay.timerId) clearTimeout(_onMyWay.timerId);
      _onMyWay = null;
      updateOnMyWayUI();
    }

    function updateOnMyWayUI() {
      var banner = document.getElementById('omw-banner');
      if (!banner) return;
      if (!_onMyWay) {
        banner.style.display = 'none';
        return;
      }
      var venue = getVenueById(_onMyWay.venueId);
      var name = venue ? venue.name : _onMyWay.venueId;
      var minsLeft = Math.max(0, Math.round((_onMyWay.arrivalTime - Date.now()) / 60000));

      var pat = _historicalPatterns[_onMyWay.venueId];
      var hint = '';
      if (pat) {
        var hintMap = { free: 'Brukar vara fri ingång vid den här tiden', short: 'Brukar vara kort kö vid den här tiden', medium: 'Brukar vara medel kö vid den här tiden', long: 'Brukar vara lång kö vid den här tiden' };
        hint = hintMap[pat.level] || '';
      }

      banner.style.display = 'flex';
      banner.innerHTML = '<div style="flex:1;min-width:0">'
        + '<div style="font-size:13px;font-weight:600;color:#fff">På väg till ' + name + '</div>'
        + '<div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:2px">'
        + (minsLeft <= 0 ? 'Du borde vara framme nu' : 'Anländer om ca ' + minsLeft + ' min')
        + (hint ? ' · ' + hint : '')
        + '</div></div>'
        + '<button onclick="cancelOnMyWay()" style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:18px;cursor:pointer;padding:4px 0 4px 12px;line-height:1">×</button>';
    }

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
      // When no query: sort by recency; when searching: preserve relevance order
      if (!q) {
        list.sort(function(a, b) {
          var at = latestTs[a.id] || 0;
          var bt = latestTs[b.id] || 0;
          if (at && !bt) return -1;
          if (!at && bt) return 1;
          if (!at && !bt) return a.name.localeCompare(b.name, 'sv');
          return bt - at;
        });
      }
      el.innerHTML = list.map(function(v) {
        var rsTypeLbl = venueTypeLabel(v.type);
        var rsAreaText = v.area + (rsTypeLbl ? ' · ' + rsTypeLbl : '');
        return '<div class="rs-item" onclick="pickRV(\'' + v.id + '\')">' +
          '<div><div class="rs-name">' + v.name + '</div><div class="rs-area">' + rsAreaText + '</div></div>' +
          '<span class="rs-arrow">→</span></div>';
      }).join('');
    }

    function pickRV(id) {
      selectedRV = getVenueById(id);
      document.getElementById('rs-vname').textContent = selectedRV.name;
      document.getElementById('rs1').style.display = 'none';
      document.getElementById('rs2').style.display = 'flex';
    }

    function backToRs1() {
      document.getElementById('rs1').style.display = 'block';
      document.getElementById('rs2').style.display = 'none';
    }

    async function pickQueue(status) {
      if (!selectedRV) return;
      var commentEl = document.getElementById('rs-comment');
      var comment = commentEl ? commentEl.value.trim().slice(0, 80) : '';
      try {
        await submitReport(selectedRV.id, selectedRV.name, status, comment);
        if (commentEl) commentEl.value = '';
        maybeShowInstallPrompt();
        showFloatingPoints(10);
        document.getElementById('rs2').style.display = 'none';
        document.getElementById('rs3').style.display = 'flex';
        var dest = (prevScreen && prevScreen !== 'report') ? prevScreen : null;
        selectedRV = null;
        setTimeout(function() {
          document.getElementById('rs3').style.display = 'none';
          document.getElementById('rs1').style.display = 'block';
          document.getElementById('rs-search').value = '';
          filterReportList();
          if (dest) showScreen(dest);
        }, 1500);
      } catch(err) { showToast('Fel — försök igen'); }
    }

    // ── Snabbrapport (bottom sheet från Utforska) ────────────────────────────
    var qrVenue = null;

    function openQuickReport(venueId) {
      qrVenue = getVenueById(venueId);
      if (!qrVenue) return;
      document.getElementById('qr-vname').textContent = qrVenue.name;
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

    async function quickPickQueue(status) {
      if (!qrVenue) return;
      var v = qrVenue;
      closeQuickReport();
      try {
        await submitReport(v.id, v.name, status);
        maybeShowInstallPrompt();
        showFloatingPoints(10);
        showToast('Rapport skickad — tack!');
        loadReports();
      } catch(e) {
        showToast('Fel — försök igen');
      }
    }

    filterReportList();

    // ── Profil ────────────────────────────────────────────────────────────────
    function computeStreak(reports) {
      if (!reports.length) return 0;
      var dates = new Set(reports.map(function(r) { return r.created_at.slice(0, 10); }));
      var today = new Date();
      var todayStr = today.toISOString().slice(0, 10);
      var yestStr = new Date(today - 86400000).toISOString().slice(0, 10);
      if (!dates.has(todayStr) && !dates.has(yestStr)) return 0;
      var cursor = dates.has(todayStr) ? today : new Date(today - 86400000);
      var count = 0;
      while (dates.has(cursor.toISOString().slice(0, 10))) {
        count++;
        cursor = new Date(cursor - 86400000);
      }
      return count;
    }

    function updateProfileStats() {
      var userId = getUserId();
      var mine = userHistory.length > 0
        ? userHistory
        : allReports.filter(function(r) { return r.user_id === userId; });
      var pts = mine.length * 10;

      var sr = document.getElementById('stat-r');
      var sp = document.getElementById('stat-p');
      if (sr) sr.textContent = mine.length;
      if (sp) sp.textContent = pts;

      var levels = [
        { name: 'Ny', min: 0, next: 50 },
        { name: 'Aktiv', min: 50, next: 150 },
        { name: 'Stamgäst', min: 150, next: 400 },
        { name: 'Insider', min: 400, next: 1000 },
        { name: 'Legend', min: 1000, next: 9999 }
      ];
      var lvl = levels[0];
      for (var i = 0; i < levels.length; i++) { if (pts >= levels[i].min) lvl = levels[i]; }

      var badge = document.querySelector('#screen-profile .level-badge');
      if (badge) badge.textContent = lvl.name;

      var pct = Math.min(100, ((pts - lvl.min) / (lvl.next - lvl.min)) * 100);
      var pl = document.getElementById('plabel');
      var pb = document.getElementById('pbar');
      if (pl) pl.textContent = pts + ' / ' + lvl.next + ' poäng till nästa nivå';
      if (pb) pb.style.width = pct + '%';

      var daysEl = document.querySelector('#screen-profile .days-count');
      if (daysEl) {
        var streak = computeStreak(mine);
        daysEl.textContent = streak;
        daysEl.classList.remove('streak-warm', 'streak-fire');
        if (streak >= 7) daysEl.classList.add('streak-fire');
        else if (streak >= 3) daysEl.classList.add('streak-warm');
      }

      var badgeRow = document.querySelector('#screen-profile .badges-row');
      if (badgeRow) {
        var BADGE_ICONS = [
          '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>',
          '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
          '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
          '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>'
        ];
        var defs = [
          { icon: BADGE_ICONS[0], name: 'Första rapport', req: 1 },
          { icon: BADGE_ICONS[1], name: '10 rapporter', req: 10 },
          { icon: BADGE_ICONS[2], name: 'Stamgäst', req: 25 },
          { icon: BADGE_ICONS[3], name: 'Legend', req: 100 }
        ];
        badgeRow.innerHTML = defs.map(function(b) {
          var on = mine.length >= b.req;
          return '<div class="badge-item' + (on ? ' badge-item--on' : ' badge-item--locked') + '">' +
            '<div class="badge-item-icon">' + b.icon + '</div>' +
            '<div class="badge-item-label">' + b.name + '</div>' +
            '</div>';
        }).join('');
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
      alert('Integritetspolicy\n\nQueueBar sparar ett anonymt ID, körapporter och favoriter.\nVi säljer aldrig din data.\nSupabase (EU) används som databas.\nMapbox används för kartan.\n\nKontakt: support@queuebar.se');
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
  filterReportList,
  getVenueById,
  goOnMyWay,
  goToReport,
  loadReports,
  obNext,
  obSkip,
  onMapSearchBlur,
  onMapSearchFocus,
  onMapSearchInput,
  onMapSearchKey,
  openDirections,
  openQuickReport,
  openVenueCard,
  pickQueue,
  pickRV,
  quickPickQueue,
  retrySupabase,
  selectMapSearchVenue,
  setExploreFilter,
  shareVenue,
  showPrivacyPolicy,
  showScreen,
  toggleFavorite,
  toggleLiveVenue,
  togglePlanningMode,
});
