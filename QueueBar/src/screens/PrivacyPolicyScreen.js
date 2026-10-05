import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

const SECTIONS = [
  {
    title: 'Vad vi samlar in',
    body:
      '• Ett anonymt ID som slumpas fram på din enhet. Det är inte kopplat till ditt namn, din e-post eller ditt telefonnummer.\n' +
      '• Dina körapporter: vilken plats, hur lång kö och när du rapporterade.\n' +
      '• Din position, endast när du ger tillstånd, för att visa platser nära dig.',
  },
  {
    title: 'Hur vi använder datan',
    body:
      'Rapporterna visas för andra användare i realtid och försvinner från flödet efter 45 minuter. ' +
      'Ditt anonyma ID används för att förhindra spam, räkna poäng och spara dina favoriter. ' +
      'Vi säljer aldrig data och använder den inte för reklam.',
  },
  {
    title: 'Tjänster vi använder',
    body:
      'Supabase lagrar rapporter, favoriter och poäng. Mapbox visar kartan och kan ta emot kartförfrågningar och teknisk information från din enhet. ' +
      'Båda behandlar data enligt sina egna integritetspolicyer.',
  },
  {
    title: 'Dina rättigheter (GDPR)',
    body:
      'Du har rätt att få veta vilken data vi har om dig, att få den rättad och att få den raderad. ' +
      'Du kan när som helst radera all din data under Profil → Radera min data. ' +
      'Kontakta oss om du har frågor eller vill göra en begäran.',
  },
  { title: 'Kontakt', body: null },
];

export default function PrivacyPolicyScreen({ onBack }) {
  return (
    <LinearGradient colors={['#F8C8C8', '#C84040', '#180404']} style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <TouchableOpacity onPress={onBack} style={styles.back} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.backText}>← Tillbaka</Text>
        </TouchableOpacity>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Integritetspolicy</Text>
          {SECTIONS.map(s => (
            <View key={s.title} style={styles.card}>
              <Text style={styles.heading}>{s.title}</Text>
              {s.body ? (
                <Text style={styles.body}>{s.body}</Text>
              ) : (
                <Text style={styles.link} onPress={() => Linking.openURL('mailto:support@queuebar.se')}>
                  support@queuebar.se
                </Text>
              )}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  back: { padding: 16, paddingTop: 8 },
  backText: { color: 'rgba(255,255,255,0.85)', fontSize: 14 },
  content: { paddingHorizontal: 16, paddingBottom: 110 },
  title: { fontFamily: 'SpaceGrotesk_700Bold', fontSize: 26, color: 'white', letterSpacing: -0.5, marginBottom: 16 },
  card: { backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  heading: { fontSize: 14, fontWeight: '700', color: 'white', marginBottom: 6 },
  body: { fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 20 },
  link: { fontSize: 14, color: 'white', textDecorationLine: 'underline' },
});
