import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const CONSENT_KEY = 'qb_consent';

// Shows on first launch only. onDone(choice) fires with 'accepted' | 'declined',
// also immediately when a choice was already stored.
export default function ConsentModal({ onDone }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(CONSENT_KEY)
      .then(v => (v ? onDone && onDone(v) : setVisible(true)))
      .catch(() => setVisible(true));
  }, []);

  async function choose(choice) {
    try {
      await AsyncStorage.setItem(CONSENT_KEY, choice);
    } catch (e) {}
    setVisible(false);
    onDone && onDone(choice);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Din data på QueueBar</Text>
          <Text style={styles.intro}>Vi sparar så lite som möjligt, och inget som kan knytas till dig personligen:</Text>
          <Text style={styles.item}>🔑  Ett anonymt ID som skapas på din enhet</Text>
          <Text style={styles.item}>📢  Dina körapporter (försvinner efter 45 min)</Text>
          <Text style={styles.item}>📍  Din position, bara för att visa venues nära dig</Text>
          <Text style={styles.note}>Du kan när som helst radera all din data i Profil.</Text>

          <TouchableOpacity style={styles.primary} onPress={() => choose('accepted')}>
            <Text style={styles.primaryText}>Jag förstår och godkänner</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => choose('declined')}>
            <Text style={styles.secondaryText}>Använd utan att spara data</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: 'white', borderRadius: 20, padding: 24 },
  title: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 22, color: '#111111', marginBottom: 8 },
  intro: { fontSize: 14, color: '#4B5563', marginBottom: 14 },
  item: { fontSize: 14, color: '#111111', marginBottom: 8 },
  note: { fontSize: 12, color: '#9CA3AF', marginTop: 6, marginBottom: 20 },
  primary: { backgroundColor: '#111111', borderRadius: 12, padding: 14, alignItems: 'center' },
  primaryText: { color: 'white', fontSize: 15, fontWeight: '700' },
  secondary: { padding: 14, alignItems: 'center' },
  secondaryText: { color: '#9CA3AF', fontSize: 14 },
});
