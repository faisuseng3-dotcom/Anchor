import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const ONBOARDING_KEY = 'qb_onboarding_done';

const STEPS = [
  { emoji: '🗺️', title: 'Se kön i realtid', text: 'Kolla köläget på barer och klubbar direkt på kartan innan du går hemifrån.' },
  { emoji: '📢', title: 'Rapportera på 5 sek', text: 'Står du i kö? Berätta hur lång den är med ett par tryck och hjälp andra.' },
  { emoji: '📡', title: 'Vad händer just nu', text: 'Se färska rapporter från andra i staden och hitta stället med kortast kö.' },
  { emoji: '❤️', title: 'Följ dina favoriter', text: 'Spara ställen du gillar och ha koll på deras kö med ett ögonkast.' },
];

// Shows once. onDone fires when finished, or immediately if already completed.
export default function Onboarding({ onDone }) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then(v => (v ? onDone && onDone() : setVisible(true)))
      .catch(() => setVisible(true));
  }, []);

  async function next() {
    if (step < STEPS.length - 1) return setStep(step + 1);
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    } catch (e) {}
    setVisible(false);
    onDone && onDone();
  }

  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent>
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.emoji}>{s.emoji}</Text>
          <Text style={styles.title}>{s.title}</Text>
          <Text style={styles.text}>{s.text}</Text>
        </View>

        <View style={styles.dots}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>

        <TouchableOpacity style={styles.button} onPress={next}>
          <Text style={styles.buttonText}>{last ? '🚀 Börja!' : 'Nästa →'}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000', padding: 32, paddingBottom: 56 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 72, marginBottom: 24 },
  title: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 30, color: 'white', textAlign: 'center', marginBottom: 12 },
  text: { fontSize: 16, color: 'rgba(255,255,255,0.65)', textAlign: 'center', lineHeight: 24 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.25)' },
  dotActive: { width: 24, backgroundColor: 'white' },
  button: { backgroundColor: 'white', borderRadius: 14, padding: 16, alignItems: 'center' },
  buttonText: { color: '#000000', fontSize: 16, fontWeight: '700' },
});
