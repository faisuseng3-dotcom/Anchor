import React, { useRef } from 'react';
import { Animated, TouchableOpacity } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const HEART =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

export default function FavoriteButton({ isFavorite = false, onPress, size = 24 }) {
  const scale = useRef(new Animated.Value(1)).current;

  function handlePress() {
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.35, duration: 120, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
    onPress && onPress();
  }

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.8}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={isFavorite ? 'Ta bort favorit' : 'Lägg till favorit'}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path
            d={HEART}
            fill={isFavorite ? '#E8001C' : 'none'}
            stroke={isFavorite ? '#E8001C' : '#9CA3AF'}
            strokeWidth={1.8}
            strokeLinejoin="round"
          />
        </Svg>
      </Animated.View>
    </TouchableOpacity>
  );
}
