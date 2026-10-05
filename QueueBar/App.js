import { registerRootComponent } from 'expo';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import HomeScreen from './src/screens/HomeScreen';
import ConsentModal from './src/components/ConsentModal';
import Onboarding from './src/components/Onboarding';
import { initMapbox } from './src/lib/mapbox';

initMapbox();

export default function App() {
  const [fontsLoaded] = useFonts({ SpaceGrotesk_700Bold });
  const [consentDone, setConsentDone] = useState(false);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <HomeScreen />
      {/* Onboarding is shown only after the consent choice is made */}
      <ConsentModal onDone={() => setConsentDone(true)} />
      {consentDone && <Onboarding />}
    </GestureHandlerRootView>
  );
}

registerRootComponent(App);
