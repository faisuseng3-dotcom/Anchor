import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { VenueIconBadge } from '../components/VenueIcon';
import { loadReports, subscribeToReports } from '../lib/supabase';
import VENUES, { computeStatus, getStatusLabel, getStatusColor } from '../lib/venues';

const FILTERS = [
  { key: 'all', label: 'Alla' },
  { key: 'bar', label: 'Barer' },
  { key: 'klubb', label: 'Klubbar' },
  { key: 'happy', label: 'Happy Hour' },
];

export default function ExploreScreen({ onVenuePress }) {
  const [reports, setReports] = useState([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const refresh = () => loadReports().then(setReports);
    refresh();
    const sub = subscribeToReports(refresh);
    return () => sub.unsubscribe();
  }, []);

  const venues = useMemo(() => {
    const q = query.trim().toLowerCase();
    return VENUES.filter(v => {
      if (q && !v.name.toLowerCase().includes(q) && !v.area.toLowerCase().includes(q)) return false;
      if (filter === 'bar' || filter === 'klubb') return v.type === filter;
      return true; // 'all' and 'happy' (Happy Hour shows everything for now)
    });
  }, [query, filter]);

  return (
    <LinearGradient colors={['#D4C4F8', '#7848C8', '#0D0428']} style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.title}>Utforska</Text>
        </View>

        <View style={styles.searchBox}>
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Sök bar, klubb eller område"
            placeholderTextColor="rgba(255,255,255,0.55)"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>

        <View style={styles.filters}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
              onPress={() => setFilter(f.key)}
            >
              <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView
          style={styles.list}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {venues.length === 0 && <Text style={styles.empty}>Inga venues hittades</Text>}
          {venues.map(venue => {
            const status = computeStatus(venue.id, reports);
            const statusLabel = getStatusLabel(status);
            const count = reports.filter(r => r.venue_id === venue.id).length;
            return (
              <TouchableOpacity
                key={venue.id}
                style={styles.card}
                onPress={() => onVenuePress && onVenuePress(venue)}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.venueName}>{venue.name}</Text>
                  <VenueIconBadge type={venue.type} size={28} />
                </View>
                {statusLabel ? (
                  <Text style={[styles.statusText, { color: getStatusColor(status) }]}>{statusLabel}</Text>
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
  title: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, color: 'white', letterSpacing: -0.5 },
  searchBox: { marginHorizontal: 16, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  searchInput: { color: 'white', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 },
  filterBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  filterBtnActive: { backgroundColor: '#000000', borderColor: '#000000' },
  filterText: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  filterTextActive: { color: 'white' },
  list: { flex: 1, paddingHorizontal: 16 },
  empty: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: 32 },
  card: { backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 16, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  venueName: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.6)' },
  statusText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 28, letterSpacing: -1, lineHeight: 32, marginBottom: 4 },
  noReport: { fontSize: 16, color: 'rgba(255,255,255,0.2)', marginBottom: 4 },
  reportInfo: { fontSize: 11, color: 'rgba(255,255,255,0.4)', marginBottom: 12 },
  separator: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 10 },
  infoRow: { flexDirection: 'row', gap: 12 },
  infoText: { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
});
