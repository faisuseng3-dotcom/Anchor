import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import PrivacyPolicyScreen from './PrivacyPolicyScreen';
import { getUserId } from '../lib/userId';
import { loadProfile, loadUserReports, deleteAllUserData } from '../lib/supabase';
import { getVenueById, getStatusLabel, getStatusColor } from '../lib/venues';

const LEVELS = [
  { name: 'Nybörjare', min: 0 },
  { name: 'Stamgäst', min: 50 },
  { name: 'Insider', min: 150 },
  { name: 'Legend', min: 400 },
];

const BADGES = [
  { id: 'first', emoji: '🎯', title: 'Första rapporten', unlocked: s => s.reports >= 1 },
  { id: 'ten', emoji: '📢', title: '10 rapporter', unlocked: s => s.reports >= 10 },
  { id: 'twentyfive', emoji: '🔥', title: '25 rapporter', unlocked: s => s.reports >= 25 },
  { id: 'legend', emoji: '👑', title: 'Legend', unlocked: s => s.points >= 400 },
];

function getLevel(points) {
  let idx = 0;
  LEVELS.forEach((l, i) => points >= l.min && (idx = i));
  const current = LEVELS[idx];
  const next = LEVELS[idx + 1] ?? null;
  const progress = next ? (points - current.min) / (next.min - current.min) : 1;
  return { current, next, progress };
}

function getTimeAgo(dateString) {
  const mins = Math.floor((Date.now() - new Date(dateString).getTime()) / 60000);
  if (mins < 1) return 'nyss';
  if (mins < 60) return mins + ' min sedan';
  if (mins < 1440) return Math.floor(mins / 60) + ' tim sedan';
  return Math.floor(mins / 1440) + ' dagar sedan';
}

// onDataDeleted: called after all data is removed so the host can remount/reload the app.
export default function ProfileScreen({ onDataDeleted }) {
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [reports, setReports] = useState([]);
  const [points, setPoints] = useState(0);
  const [daysActive, setDaysActive] = useState(1);

  const load = useCallback(async () => {
    const userId = await getUserId();
    const [profile, mine] = await Promise.all([loadProfile(userId), loadUserReports(userId)]);
    setReports(mine);
    setPoints(profile?.points ?? mine.length * 10);
    const start = profile?.created_at ?? mine[mine.length - 1]?.created_at;
    setDaysActive(start ? Math.max(1, Math.ceil((Date.now() - new Date(start).getTime()) / 86400000)) : 1);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function confirmDelete() {
    Alert.alert(
      'Radera min data?',
      'Alla dina rapporter, favoriter och din profil raderas permanent. Det går inte att ångra.',
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Radera',
          style: 'destructive',
          onPress: async () => {
            try {
              const userId = await getUserId();
              await deleteAllUserData(userId);
              await AsyncStorage.clear();
              onDataDeleted && onDataDeleted();
            } catch (e) {
              Alert.alert('Något gick fel', 'Din data kunde inte raderas. Försök igen.');
            }
          },
        },
      ]
    );
  }

  if (showPrivacy) return <PrivacyPolicyScreen onBack={() => setShowPrivacy(false)} />;

  const stats = { reports: reports.length, points };
  const { current, next, progress } = getLevel(points);

  const settings = [
    { label: 'Notifikationer', onPress: () => Linking.openSettings() },
    { label: 'Plats-inställningar', onPress: () => Linking.openSettings() },
    { label: 'Kontakta oss', onPress: () => Linking.openURL('mailto:support@queuebar.se') },
    { label: 'Integritetspolicy', onPress: () => setShowPrivacy(true) },
  ];

  return (
    <LinearGradient colors={['#F8C8C8', '#C84040', '#180404']} style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.avatar}>
            <Svg width={44} height={44} viewBox="0 0 24 24" fill="none">
              <Circle cx={12} cy={8} r={4} fill="#FFFFFF" />
              <Path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" fill="#FFFFFF" />
            </Svg>
          </View>
          <Text style={styles.name}>Anonym Användare</Text>
          <View style={styles.levelBadge}>
            <Text style={styles.levelBadgeText}>{current.name}</Text>
          </View>

          <View style={styles.stats}>
            <Stat value={reports.length} label="Rapporter" />
            <Stat value={points} label="Poäng" />
            <Stat value={daysActive} label="Dagar aktiv" />
          </View>

          <View style={styles.card}>
            <View style={styles.progressTop}>
              <Text style={styles.cardLabel}>{current.name}</Text>
              <Text style={styles.cardLabel}>{next ? `${next.min - points} p till ${next.name}` : 'Högsta nivån!'}</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
          </View>

          <Text style={styles.sectionTitle}>BADGES</Text>
          <View style={styles.badges}>
            {BADGES.map(b => {
              const unlocked = b.unlocked(stats);
              return (
                <View key={b.id} style={[styles.badge, !unlocked && styles.badgeLocked]}>
                  <Text style={styles.badgeEmoji}>{unlocked ? b.emoji : '🔒'}</Text>
                  <Text style={styles.badgeTitle}>{b.title}</Text>
                </View>
              );
            })}
          </View>

          <Text style={styles.sectionTitle}>SENASTE AKTIVITET</Text>
          {reports.length === 0 ? (
            <Text style={styles.empty}>Du har inte rapporterat något än.</Text>
          ) : (
            reports.slice(0, 5).map(r => (
              <View key={r.id ?? r.created_at} style={styles.activityRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityName}>{r.venue_name || getVenueById(r.venue_id)?.name}</Text>
                  <Text style={[styles.activityStatus, { color: getStatusColor(r.queue_status) }]}>
                    {getStatusLabel(r.queue_status)}
                  </Text>
                </View>
                <Text style={styles.activityTime}>{getTimeAgo(r.created_at)}</Text>
              </View>
            ))
          )}

          <Text style={styles.sectionTitle}>INSTÄLLNINGAR</Text>
          <View style={styles.card}>
            {settings.map(s => (
              <TouchableOpacity key={s.label} style={styles.settingRow} onPress={s.onPress}>
                <Text style={styles.settingText}>{s.label}</Text>
                <Text style={styles.chevron}>→</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.settingRow, styles.lastRow]} onPress={confirmDelete}>
              <Text style={styles.deleteText}>Radera min data</Text>
            </TouchableOpacity>
          </View>
          <View style={{ height: 110 }} />
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const glass = { backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' };

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  avatar: { alignSelf: 'center', width: 88, height: 88, borderRadius: 44, backgroundColor: '#9CA3AF', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  name: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 22, color: 'white', textAlign: 'center' },
  levelBadge: { alignSelf: 'center', backgroundColor: '#000000', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4, marginTop: 8 },
  levelBadgeText: { color: 'white', fontSize: 12, fontWeight: '700' },
  stats: { flexDirection: 'row', gap: 8, marginTop: 20, marginBottom: 12 },
  stat: { flex: 1, borderRadius: 16, padding: 14, alignItems: 'center', ...glass },
  statValue: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 24, color: 'white' },
  statLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 },
  card: { borderRadius: 16, padding: 16, marginBottom: 8, ...glass },
  progressTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  cardLabel: { fontSize: 12, color: 'rgba(255,255,255,0.7)' },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: 'white' },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.5)', letterSpacing: 1.5, marginTop: 16, marginBottom: 10 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  badge: { width: '48%', borderRadius: 16, padding: 14, alignItems: 'center', ...glass },
  badgeLocked: { opacity: 0.45 },
  badgeEmoji: { fontSize: 28, marginBottom: 4 },
  badgeTitle: { fontSize: 12, color: 'white', fontWeight: '600', textAlign: 'center' },
  empty: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  activityRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, padding: 14, marginBottom: 8, ...glass },
  activityName: { fontSize: 14, fontWeight: '500', color: 'white' },
  activityStatus: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  activityTime: { fontSize: 11, color: '#9CA3AF' },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  lastRow: { borderBottomWidth: 0 },
  settingText: { fontSize: 15, color: 'white' },
  chevron: { fontSize: 15, color: 'rgba(255,255,255,0.5)' },
  deleteText: { fontSize: 15, color: '#FF5A5A', fontWeight: '600' },
});
