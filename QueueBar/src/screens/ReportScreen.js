import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import VENUES, { getStatusLabel, getStatusColor } from '../lib/venues';
import { submitReport } from '../lib/supabase';
import { getUserId } from '../lib/userId';

const OPTIONS = ['none', 'short', 'medium', 'long'];
const RESET_MS = 2000;

export default function ReportScreen({ initialVenue = null, route }) {
  const [step, setStep] = useState(initialVenue ? 2 : 1);
  const [venue, setVenue] = useState(initialVenue);
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const resetTimer = useRef(null);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  // Venue sent from the map card jumps straight to step 2
  const routeVenue = route?.params?.venue;
  useEffect(() => {
    if (routeVenue) {
      clearTimeout(resetTimer.current);
      setVenue(routeVenue);
      setError(null);
      setStep(2);
    }
  }, [routeVenue]);

  const venues = VENUES.filter(v => {
    const q = query.trim().toLowerCase();
    return !q || v.name.toLowerCase().includes(q) || v.area.toLowerCase().includes(q);
  });

  function reset() {
    setStep(1);
    setVenue(null);
    setQuery('');
    setError(null);
  }

  async function send(queueStatus) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const userId = await getUserId();
      await submitReport({ venueId: venue.id, venueName: venue.name, queueStatus, userId });
      setStep(3);
      resetTimer.current = setTimeout(reset, RESET_MS);
    } catch (e) {
      setError(e.code === 'SPAM' ? e.message : 'Något gick fel. Försök igen.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <LinearGradient colors={['#FFF0B8', '#D09010', '#180C00']} style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.progress}>
          {[1, 2, 3].map(n => (
            <View key={n} style={[styles.circle, step >= n ? styles.circleActive : styles.circleInactive]}>
              <Text style={[styles.circleText, step >= n && styles.circleTextActive]}>{n}</Text>
            </View>
          ))}
        </View>

        {step === 1 && (
          <View style={styles.flex}>
            <Text style={styles.title}>Var står du?</Text>
            <View style={styles.searchBox}>
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Sök bar eller klubb"
                placeholderTextColor="rgba(255,255,255,0.55)"
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
            </View>
            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {venues.length === 0 && <Text style={styles.empty}>Inga venues hittades</Text>}
              {venues.map(v => (
                <TouchableOpacity
                  key={v.id}
                  style={styles.card}
                  onPress={() => {
                    setVenue(v);
                    setError(null);
                    setStep(2);
                  }}
                >
                  <Text style={styles.cardName}>{v.name}</Text>
                  <Text style={styles.cardArea}>{v.area}</Text>
                </TouchableOpacity>
              ))}
              <View style={{ height: 110 }} />
            </ScrollView>
          </View>
        )}

        {step === 2 && venue && (
          <View style={[styles.flex, styles.padded]}>
            <TouchableOpacity onPress={reset} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.back}>← Byt ställe</Text>
            </TouchableOpacity>
            <Text style={styles.venueLabel}>{venue.name}</Text>
            <Text style={styles.title}>Hur lång är kön?</Text>

            {OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt}
                disabled={submitting}
                style={[styles.option, { backgroundColor: getStatusColor(opt), opacity: submitting ? 0.6 : 1 }]}
                onPress={() => send(opt)}
              >
                <Text style={styles.optionText}>{getStatusLabel(opt)}</Text>
              </TouchableOpacity>
            ))}

            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        )}

        {step === 3 && (
          <View style={[styles.flex, styles.center]}>
            <View style={styles.check}>
              <Text style={styles.checkMark}>✓</Text>
            </View>
            <Text style={styles.points}>+10 poäng</Text>
            <Text style={styles.thanks}>Tack för din rapport!</Text>
          </View>
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  flex: { flex: 1 },
  padded: { paddingHorizontal: 16 },
  center: { alignItems: 'center', justifyContent: 'center' },
  progress: { flexDirection: 'row', justifyContent: 'center', gap: 12, padding: 16, paddingTop: 8 },
  circle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  circleActive: { backgroundColor: '#000000' },
  circleInactive: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.45)' },
  circleText: { fontSize: 14, fontWeight: '700', color: 'rgba(0,0,0,0.55)' },
  circleTextActive: { color: 'white' },
  title: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 26, color: 'white', letterSpacing: -0.5, marginHorizontal: 16, marginVertical: 12 },
  searchBox: { marginHorizontal: 16, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  searchInput: { color: 'white', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  list: { flex: 1, paddingHorizontal: 16 },
  empty: { color: 'rgba(255,255,255,0.6)', textAlign: 'center', marginTop: 32 },
  card: { backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 16, padding: 16, marginBottom: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  cardName: { fontSize: 15, fontWeight: '600', color: 'white' },
  cardArea: { fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  back: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 4 },
  venueLabel: { fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 16, marginHorizontal: 16 },
  option: { borderRadius: 16, paddingVertical: 20, alignItems: 'center', marginBottom: 10 },
  optionText: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 22, color: 'white' },
  error: { color: '#FECACA', textAlign: 'center', marginTop: 8, fontSize: 14 },
  check: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#00875A', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  checkMark: { fontSize: 52, color: 'white', fontWeight: '700' },
  points: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 34, color: '#FACC15', marginBottom: 6 },
  thanks: { fontSize: 16, color: 'rgba(255,255,255,0.85)' },
});
