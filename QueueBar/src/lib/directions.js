import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';

function urlsFor({ lat, lng, name }) {
  return {
    'Google Maps': `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    'Apple Maps': `http://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}`,
    Waze: `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
  };
}

export function openDirections(venue) {
  const urls = urlsFor(venue);
  // Apple Maps is only offered on iOS.
  const options = Platform.OS === 'ios' ? ['Google Maps', 'Apple Maps', 'Waze'] : ['Google Maps', 'Waze'];
  const open = label => Linking.openURL(urls[label]).catch(() => Alert.alert('Kunde inte öppna ' + label));

  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title: `Vägbeskrivning till ${venue.name}`, options: [...options, 'Avbryt'], cancelButtonIndex: options.length },
      i => i < options.length && open(options[i])
    );
  } else {
    Alert.alert(`Vägbeskrivning till ${venue.name}`, undefined, [
      ...options.map(label => ({ text: label, onPress: () => open(label) })),
      { text: 'Avbryt', style: 'cancel' },
    ]);
  }
}
