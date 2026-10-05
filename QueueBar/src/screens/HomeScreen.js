import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import QueueBarMap from '../components/Map';
import MapVenueCard from '../components/MapVenueCard';
import { loadReports, subscribeToReports } from '../lib/supabase';
import VENUES, { computeStatus, getStatusLabel, getStatusColor } from '../lib/venues';

export default function HomeScreen() {
  const [reports, setReports] = useState([]);
  const [selectedVenue, setSelectedVenue] = useState(null);

  useEffect(() => {
    const refresh = () => loadReports().then(setReports);
    refresh();
    const sub = subscribeToReports(refresh);
    return () => sub.unsubscribe();
  }, []);

  return (
    <LinearGradient colors={['#4F9CF9', '#1E5FD8', '#0B2F7A']} style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.logo}>QueueBar</Text>
        </View>

        <View style={styles.mapContainer}>
          <QueueBarMap reports={reports} onVenuePress={setSelectedVenue} />
          <MapVenueCard
            venue={selectedVenue}
            reports={reports}
            onClose={() => setSelectedVenue(null)}
            onReport={() => {}}
            onDetails={() => {}}
          />
        </View>

        <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionTitle}>NÄRA DIG</Text>
          {VENUES.slice(0, 10).map(venue => {
            const status = computeStatus(venue.id, reports);
            const statusColor = getStatusColor(status);
            const statusLabel = getStatusLabel(status);
            const count = reports.filter(r => r.venue_id === venue.id).length;
            return (
              <TouchableOpacity key={venue.id} style={styles.card} onPress={() => setSelectedVenue(venue)}>
                <Text style={styles.venueName}>{venue.name}</Text>
                {statusLabel ? (
                  <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
                ) : (
                  <Text style={styles.noReport}>Ingen rapport ännu</Text>
                )}
                {count > 0 && (
                  <Text style={styles.reportInfo}>
                    {count} rapport{count > 1 ? 'er' : ''}
                  </Text>
                )}
                <View style={styles.separator} />
                <View style={styles.infoRow}>
                  <Text style={styles.infoText}>Stänger {venue.closing}</Text>
                  <Text style={styles.infoText}>{venue.area}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  header: { padding: 16, paddingTop: 8 },
  logo: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, color: 'white', letterSpacing: -0.5 },
  mapContainer: { height: 280, marginHorizontal: 16, borderRadius: 16, overflow: 'hidden', position: 'relative' },
  list: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, marginBottom: 12 },
  card: { backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 16, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  venueName: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.6)', marginBottom: 2 },
  statusText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 28, letterSpacing: -1, lineHeight: 32, marginBottom: 4 },
  noReport: { fontSize: 16, color: 'rgba(255,255,255,0.2)', marginBottom: 4 },
  reportInfo: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 12 },
  separator: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 10 },
  infoRow: { flexDirection: 'row', gap: 12 },
  infoText: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
});
