import { registerRootComponent } from 'expo';
import { useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useFonts, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import HomeScreen from './src/screens/HomeScreen';
import ExploreScreen from './src/screens/ExploreScreen';
import LiveScreen from './src/screens/LiveScreen';
import ReportScreen from './src/screens/ReportScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import BottomNav from './src/components/BottomNav';
import ConsentModal from './src/components/ConsentModal';
import Onboarding from './src/components/Onboarding';
import { initMapbox } from './src/lib/mapbox';

initMapbox();

const Tab = createBottomTabNavigator();
const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: '#000000' } };

export default function App() {
  const [fontsLoaded] = useFonts({ SpaceGrotesk_700Bold });
  const [consentDone, setConsentDone] = useState(false);
  // Bumped after "Radera min data": remounts everything so consent/onboarding run again.
  const [resetKey, setResetKey] = useState(0);

  if (!fontsLoaded) return null;

  function handleDataDeleted() {
    setConsentDone(false);
    setResetKey(k => k + 1);
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider key={resetKey}>
        <NavigationContainer theme={theme}>
          <Tab.Navigator
            tabBar={props => <BottomNav {...props} />}
            screenOptions={{ headerShown: false }}
          >
            <Tab.Screen name="Karta" component={HomeScreen} />
            <Tab.Screen name="Utforska" component={ExploreScreen} />
            <Tab.Screen name="Live" component={LiveScreen} />
            <Tab.Screen name="Rapportera" component={ReportScreen} />
            <Tab.Screen name="Profil">
              {() => <ProfileScreen onDataDeleted={handleDataDeleted} />}
            </Tab.Screen>
          </Tab.Navigator>
        </NavigationContainer>

        {/* Consent first (qb_consent), then onboarding (qb_onboarding_done) */}
        <ConsentModal onDone={() => setConsentDone(true)} />
        {consentDone && <Onboarding />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

registerRootComponent(App);
