import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { computeStatus, getStatusLabel, getStatusColor } from '../lib/venues';

const HIDDEN_Y = 260;

export default function MapVenueCard({ venue, reports = [], onClose, onReport, onDetails }) {
  const slideAnim = useRef(new Animated.Value(HIDDEN_Y)).current;
  // Keep the last venue mounted while the card slides out.
  const [shown, setShown] = useState(venue);

  useEffect(() => {
    if (venue) {
      setShown(venue);
      Animated.spring(slideAnim, { toValue: 0, tension: 65, friction: 11, useNativeDriver: true }).start();
    } else {
      Animated.timing(slideAnim, { toValue: HIDDEN_Y, duration: 250, useNativeDriver: true }).start(
        ({ finished }) => finished && setShown(null)
      );
    }
  }, [venue, slideAnim]);

  if (!shown) return null;

  const venueReports = reports.filter(r => r.venue_id === shown.id);
  const status = computeStatus(shown.id, reports);
  const statusColor = getStatusColor(status);
  const statusLabel = getStatusLabel(status);
  const latest = venueReports.reduce(
    (a, r) => (!a || new Date(r.created_at) > new Date(a.created_at) ? r : a),
    null
  );
  const timeAgo = latest ? getTimeAgo(latest.created_at) : null;

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.header}>
        <Text style={styles.venueName}>{shown.name}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.close}>×</Text>
        </TouchableOpacity>
      </View>

      {statusLabel ? (
        <Text style={[styles.status, { color: statusColor }]}>{statusLabel}</Text>
      ) : (
        <Text style={styles.noReport}>Ingen rapport ännu</Text>
      )}

      {venueReports.length > 0 && (
        <Text style={styles.reportInfo}>
          {venueReports.length} rapport{venueReports.length > 1 ? 'er' : ''}
          {timeAgo ? ` • ${timeAgo}` : ''}
        </Text>
      )}

      <View style={styles.separator} />

      <View style={styles.infoRow}>
        <Text style={styles.infoText}>Stänger {shown.closing}</Text>
        <Text style={styles.infoText}>{shown.area}</Text>
      </View>

      <View style={styles.buttons}>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => onReport && onReport(shown)}>
          <Text style={styles.primaryText}>Rapportera köläge</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => onDetails && onDetails(shown)}>
          <Text style={styles.secondaryText}>Se mer →</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

function getTimeAgo(dateString) {
  const mins = Math.floor((new Date() - new Date(dateString)) / 60000);
  if (mins < 1) return 'nyss';
  if (mins < 60) return mins + ' min sedan';
  return Math.floor(mins / 60) + ' tim sedan';
}

const styles = StyleSheet.create({
  container: { position: 'absolute', bottom: 0, left: 8, right: 8, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 16, padding: 16, marginBottom: 8, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  venueName: { fontSize: 12, fontWeight: '500', color: '#6B7280' },
  close: { fontSize: 22, color: '#9CA3AF' },
  status: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 28, letterSpacing: -1, lineHeight: 32, marginBottom: 4 },
  noReport: { fontSize: 16, color: '#D1D5DB', marginBottom: 4 },
  reportInfo: { fontSize: 11, color: '#9CA3AF', marginBottom: 12 },
  separator: { height: 1, backgroundColor: '#F0F2F5', marginBottom: 10 },
  infoRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  infoText: { fontSize: 11, color: '#9CA3AF' },
  buttons: { flexDirection: 'row', gap: 8 },
  primaryBtn: { flex: 1, backgroundColor: '#111111', borderRadius: 10, padding: 12, alignItems: 'center' },
  primaryText: { color: 'white', fontSize: 13, fontWeight: '700' },
  secondaryBtn: { flex: 1, backgroundColor: '#F0F2F5', borderRadius: 10, padding: 12, alignItems: 'center' },
  secondaryText: { color: '#111111', fontSize: 13, fontWeight: '600' },
});
