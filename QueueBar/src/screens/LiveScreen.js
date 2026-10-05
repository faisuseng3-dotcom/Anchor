import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { loadReports, subscribeToReports } from '../lib/supabase';
import { getVenueById, getStatusLabel, getStatusColor } from '../lib/venues';

const MAX_AGE_MS = 45 * 60 * 1000;
const FEED_LIMIT = 20;

function getTimeAgo(dateString, now) {
  const mins = Math.floor((now - new Date(dateString).getTime()) / 60000);
  if (mins < 1) return 'nyss';
  if (mins < 60) return mins + ' min sedan';
  return Math.floor(mins / 60) + ' tim sedan';
}

function PulsingDot() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.dotWrap}>
      <Animated.View
        style={[
          styles.dotRing,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
          },
        ]}
      />
      <View style={styles.dot} />
    </View>
  );
}

export default function LiveScreen() {
  const [reports, setReports] = useState([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const refresh = () => loadReports().then(setReports);
    refresh();
    const sub = subscribeToReports(refresh);
    // Re-evaluate ages so rows expire and "x min sedan" stays current
    const tick = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      sub.unsubscribe();
      clearInterval(tick);
    };
  }, []);

  const feed = reports
    .filter(r => now - new Date(r.created_at).getTime() < MAX_AGE_MS)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, FEED_LIMIT);

  return (
    <LinearGradient colors={['#B8F0D0', '#28A060', '#021008']} style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.title}>Live</Text>
          <PulsingDot />
        </View>

        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          {feed.length === 0 ? (
            <Text style={styles.empty}>Inga rapporter ännu. Gå ut och rapportera!</Text>
          ) : (
            feed.map(r => {
              const name = r.venue_name || getVenueById(r.venue_id)?.name || 'Okänd plats';
              const label = getStatusLabel(r.queue_status);
              return (
                <View key={r.id ?? `${r.venue_id}-${r.created_at}`} style={styles.row}>
                  <View style={styles.rowMain}>
                    <Text style={styles.venueName}>{name}</Text>
                    <Text style={[styles.status, { color: getStatusColor(r.queue_status) }]}>{label}</Text>
                  </View>
                  <Text style={styles.time}>{getTimeAgo(r.created_at, now)}</Text>
                </View>
              );
            })
          )}
          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, paddingTop: 8 },
  title: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, color: 'white', letterSpacing: -0.5 },
  dotWrap: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22C55E' },
  dotRing: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#22C55E' },
  list: { flex: 1, paddingHorizontal: 16 },
  empty: { color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 48, fontSize: 15, paddingHorizontal: 24 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 16, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  rowMain: { flex: 1, marginRight: 12 },
  venueName: { fontSize: 15, fontWeight: '500', color: 'white', marginBottom: 2 },
  status: { fontSize: 14, fontWeight: '700' },
  time: { fontSize: 11, color: '#9CA3AF' },
});
