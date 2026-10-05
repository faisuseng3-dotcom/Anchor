import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line } from 'react-native-svg';

const ACTIVE = '#FFFFFF';
const INACTIVE = 'rgba(255,255,255,0.4)';

function Icon({ name, color }) {
  const p = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  switch (name) {
    case 'Karta':
      return (
        <Svg {...p}>
          <Path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
          <Line x1={9} y1={4} x2={9} y2={20} />
          <Line x1={15} y1={6} x2={15} y2={22} />
        </Svg>
      );
    case 'Utforska':
      return (
        <Svg {...p}>
          <Circle cx={11} cy={11} r={6.5} />
          <Line x1={16} y1={16} x2={21} y2={21} />
        </Svg>
      );
    case 'Live':
      return (
        <Svg {...p}>
          <Path d="M2 9a15 15 0 0 1 20 0" />
          <Path d="M5 12.5a10.5 10.5 0 0 1 14 0" />
          <Path d="M8.5 16a5.5 5.5 0 0 1 7 0" />
          <Circle cx={12} cy={19.5} r={1} fill={color} />
        </Svg>
      );
    case 'Rapportera':
      return (
        <Svg {...p}>
          <Path d="M3 10v4h3l8 4V6L6 10z" />
          <Path d="M17.5 9.5a4 4 0 0 1 0 5" />
          <Path d="M6 14l1.5 5h2.5l-1.2-4.5" />
        </Svg>
      );
    default:
      return (
        <Svg {...p}>
          <Circle cx={12} cy={8} r={4} />
          <Path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
        </Svg>
      );
  }
}

// Transparent tab bar: sits over the screen's own gradient (position: absolute).
export default function BottomNav({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { height: 60 + insets.bottom, paddingBottom: insets.bottom }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const color = focused ? ACTIVE : INACTIVE;
        const label = descriptors[route.key].options.title ?? route.name;

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };

        return (
          <TouchableOpacity
            key={route.key}
            style={styles.tab}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityState={focused ? { selected: true } : {}}
            accessibilityLabel={label}
          >
            <View>
              <Icon name={route.name} color={color} />
              {route.name === 'Live' && <View style={styles.liveDot} />}
            </View>
            <Text style={[styles.label, { color }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    elevation: 0,
    shadowOpacity: 0,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  label: { fontSize: 10, fontWeight: '600' },
  liveDot: { position: 'absolute', top: -1, right: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: '#E8001C' },
});
