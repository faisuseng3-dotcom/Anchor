import Mapbox from '@rnmapbox/maps';

export function initMapbox() {
  Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN);
}

export default Mapbox;
