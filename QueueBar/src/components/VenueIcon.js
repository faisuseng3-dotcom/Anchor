import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Line, Circle, Ellipse } from 'react-native-svg';

// Martini glass with an olive on a pick
export function BarIcon({ size = 24, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 5h16l-8 9z" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />
      <Line x1={12} y1={14} x2={12} y2={20} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={8} y1={20} x2={16} y2={20} stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1={9} y1={3} x2={14.5} y2={9} stroke={color} strokeWidth={1.2} strokeLinecap="round" />
      <Circle cx={13} cy={7.5} r={1.7} fill="#7CB342" />
    </Svg>
  );
}

// Disco ball with horizontal bands and a sparkle
export function ClubIcon({ size = 24, color = '#FFFFFF' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={11} y1={2} x2={11} y2={5} stroke={color} strokeWidth={1.5} strokeLinecap="round" />
      <Circle cx={11} cy={13} r={8} stroke={color} strokeWidth={1.8} />
      <Line x1={4.1} y1={9} x2={17.9} y2={9} stroke={color} strokeWidth={1.2} />
      <Line x1={3} y1={13} x2={19} y2={13} stroke={color} strokeWidth={1.2} />
      <Line x1={4.1} y1={17} x2={17.9} y2={17} stroke={color} strokeWidth={1.2} />
      <Ellipse cx={11} cy={13} rx={3.5} ry={8} stroke={color} strokeWidth={1.2} />
      {/* sparkle */}
      <Path d="M20 2l.9 2.1L23 5l-2.1.9L20 8l-.9-2.1L17 5l2.1-.9z" fill={color} />
    </Svg>
  );
}

// Icon inside a black rounded badge. type: 'bar' | 'klubb'
export function VenueIconBadge({ type, size = 36 }) {
  const Icon = type === 'klubb' ? ClubIcon : BarIcon;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        backgroundColor: '#000000',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon size={size * 0.6} />
    </View>
  );
}

export default VenueIconBadge;
