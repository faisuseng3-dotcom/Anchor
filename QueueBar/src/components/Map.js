import React, { useMemo, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Mapbox from '@rnmapbox/maps';
import VENUES, { computeStatus, getStatusColor, getStatusLabel } from '../lib/venues';

// Stureplan, Norrmalm
const STOCKHOLM_CENTER = [18.0733, 59.3361];
const DEFAULT_ZOOM = 13;

export default function QueueBarMap({ reports = [], onVenuePress }) {
  const cameraRef = useRef(null);
  const sourceRef = useRef(null);

  const venueGeoJSON = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: VENUES.map(venue => {
        const status = computeStatus(venue.id, reports);
        return {
          type: 'Feature',
          id: venue.id,
          geometry: { type: 'Point', coordinates: [venue.lng, venue.lat] },
          properties: {
            id: venue.id,
            name: venue.name,
            type: venue.type,
            area: venue.area,
            closing: venue.closing,
            status,
            statusColor: getStatusColor(status),
            statusLabel: getStatusLabel(status),
          },
        };
      }),
    }),
    [reports]
  );

  function handleVenuePress(feature) {
    const venue = VENUES.find(v => v.id === feature.properties.id);
    if (venue && onVenuePress) onVenuePress(venue);
  }

  async function handleClusterPress(feature) {
    let zoomLevel = 14;
    try {
      zoomLevel = await sourceRef.current?.getClusterExpansionZoom(feature);
    } catch (e) {
      // fall back to a fixed zoom
    }
    cameraRef.current?.setCamera({
      centerCoordinate: feature.geometry.coordinates,
      zoomLevel: Math.min(zoomLevel ?? 14, 17),
      animationDuration: 500,
    });
  }

  function handlePress(e) {
    const feature = e.features?.[0];
    if (!feature) return;
    if (feature.properties?.cluster) handleClusterPress(feature);
    else handleVenuePress(feature);
  }

  return (
    <View style={styles.container}>
      <Mapbox.MapView
        style={styles.map}
        styleURL={Mapbox.StyleURL.Street}
        pitchEnabled={false}
        rotateEnabled={false}
        compassEnabled={false}
        scaleBarEnabled={false}
        attributionPosition={{ bottom: 8, left: 8 }}
        logoPosition={{ bottom: 8, right: 8 }}
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: STOCKHOLM_CENTER,
            zoomLevel: DEFAULT_ZOOM,
            pitch: 0,
            heading: 0,
          }}
          minZoomLevel={10}
          maxZoomLevel={18}
          maxPitch={0}
        />

        <Mapbox.ShapeSource
          id="venues"
          ref={sourceRef}
          shape={venueGeoJSON}
          cluster
          clusterRadius={50}
          clusterMaxZoomLevel={14}
          onPress={handlePress}
          hitbox={{ width: 32, height: 32 }}
        >
          {/* Clusters */}
          <Mapbox.CircleLayer
            id="clusters"
            filter={['has', 'point_count']}
            style={{
              circleColor: '#111827',
              circleRadius: ['step', ['get', 'point_count'], 18, 5, 22, 10, 26],
              circleStrokeColor: '#FFFFFF',
              circleStrokeWidth: 2,
            }}
          />
          <Mapbox.SymbolLayer
            id="cluster-count"
            filter={['has', 'point_count']}
            style={{
              textField: ['get', 'point_count_abbreviated'],
              textSize: 13,
              textColor: '#FFFFFF',
              textAllowOverlap: true,
              textIgnorePlacement: true,
            }}
          />

          {/* Single venues, coloured by queue status */}
          <Mapbox.CircleLayer
            id="venue-points"
            filter={['!', ['has', 'point_count']]}
            style={{
              circleColor: ['get', 'statusColor'],
              circleRadius: 11,
              circleStrokeColor: '#FFFFFF',
              circleStrokeWidth: 2.5,
            }}
          />
        </Mapbox.ShapeSource>
      </Mapbox.MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
});
