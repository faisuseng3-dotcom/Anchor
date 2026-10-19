--- a/src/main.js
+++ b/src/main.js
@@
-import mapboxgl from 'mapbox-gl';
-import 'mapbox-gl/dist/mapbox-gl.css';
-import { createClient } from '@supabase/supabase-js';
-import './style.css';
+import mapboxgl from 'mapbox-gl';
+import 'mapbox-gl/dist/mapbox-gl.css';
+import { createClient } from '@supabase/supabase-js';
+import './style.css';
+import { median, setWaitRange, formatWait, waitToStatus } from './lib/waitModel.js';
@@
-function median(values) {
-  var s = values.slice().sort(function(a, b) { return a - b; });
-  var mid = Math.floor(s.length / 2);
-  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
-}
+
@@
-function setWaitRange(est, spread) {
-  est.low = Math.round(est.mins * (1 - spread) / 5) * 5;
-  est.high = Math.max(5, Math.round(est.mins * (1 + spread) / 5) * 5);
-  return est;
-}
+
@@
-function formatWait(est) {
-  if (!est) return '';
-  if (est.full) return 'Fullt';
-  if (est.ahead === 0) return 'Ingen kö';
-  if (est.high <= 5) return '<5 min';
-  if (est.high > 60) return est.low + '+ min';
-  if (est.low < 5) return '<' + est.high + ' min';
-  if (est.low === est.high) return '~' + est.low + ' min';
-  return est.low + '–' + est.high + ' min';
-}
+
@@
-function waitToStatus(est) {
-  if (est.full) return 'long';
-  if (est.ahead === 0 || est.mins < 3) return 'none';
-  if (est.mins < 18) return 'short';
-  if (est.mins < 30) return 'medium';
-  return 'long';
-}
+
