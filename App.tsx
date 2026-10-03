/**
 * Settings screen, opened from the plugin menu or Settings → Apps → Plugins.
 * Compact: one row per shape — its icon (tap to turn it on or off) and, next to
 * it, its settings, Straighten first — then the three detection settings on one
 * row and, on one line, what happened to the last stroke. − / + buttons rather
 * than sliders: more precise with a pen on e-ink.
 *
 * @format
 */

import React, {useEffect, useReducer} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {
  DEFAULTS,
  LIMITS,
  Settings,
  getSettings,
  subscribe,
  updateSettings,
} from './src/settings';
import {blinking, lastMeasure, subscribeMeasures} from './src/snapper';

type NumKey = keyof typeof LIMITS;

/** A small labelled − value + control. */
function Chip({label, k, unit}: {label: string; k: NumKey; unit: string}) {
  const value = getSettings()[k];
  const {min, max, step} = LIMITS[k];
  const set = (v: number) =>
    updateSettings({[k]: Math.min(max, Math.max(min, v))} as Partial<Settings>);
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          style={styles.step}
          hitSlop={6}
          onPress={() => set(value - step)}>
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.chipValue}>
          {value}
          {unit}
        </Text>
        <Pressable
          style={styles.step}
          hitSlop={6}
          onPress={() => set(value + step)}>
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A small labelled switch (On / Off) or cycling choice. */
function Switch({
  label,
  value,
  on,
  onPress,
}: {
  label: string;
  value: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Pressable
        style={[styles.switch, on && styles.switchOn]}
        onPress={onPress}>
        <Text style={[styles.switchText, on && styles.switchTextOn]}>
          {value}
        </Text>
      </Pressable>
    </View>
  );
}

type ShapeKey = 'rect' | 'circle' | 'arrow' | 'brace' | 'sqrt' | 'axes';

/**
 * Shape icons drawn with plain views and ASCII / common glyphs, so they render
 * whatever fonts the device has. `c` is the ink colour (inverted when on).
 */
function ShapeIcon({k, c}: {k: ShapeKey; c: string}) {
  switch (k) {
    case 'rect':
      return <View style={[styles.iconRect, {borderColor: c}]} />;
    case 'circle':
      return <View style={[styles.iconCircle, {borderColor: c}]} />;
    case 'axes':
      // An "L" with an arrow head at the end of each axis.
      return (
        <View style={styles.iconAxesBox}>
          <View style={[styles.axesUp, {borderBottomColor: c}]} />
          <View style={[styles.iconAxes, {borderColor: c}]} />
          <View style={[styles.axesRight, {borderLeftColor: c}]} />
        </View>
      );
    case 'arrow':
      // Drawn, not a glyph: a font's arrow sits off-centre.
      return (
        <View style={styles.iconArrow}>
          <View style={[styles.arrowShaft, {backgroundColor: c}]} />
          <View style={[styles.arrowHead, {borderLeftColor: c}]} />
        </View>
      );
    default:
      return (
        <Text style={[styles.iconGlyph, {color: c}]}>
          {{brace: '{', sqrt: '√'}[k]}
        </Text>
      );
  }
}

/** The settings shown next to each shape. */
type ChipSpec = {label: string; k: NumKey; unit: string};

const SHAPE_SETTINGS: {k: ShapeKey; chips: ChipSpec[]}[] = [
  {k: 'circle', chips: []},
  {k: 'rect', chips: [{label: 'Straighten', k: 'rectSnapDegrees', unit: '°'}]},
  {
    k: 'arrow',
    chips: [
      {label: 'Straighten', k: 'arrowSnapDegrees', unit: '°'},
      {label: 'Head', k: 'arrowHeadPct', unit: '%'},
    ],
  },
  {
    k: 'axes',
    chips: [
      {label: 'Straighten', k: 'axesSnapDegrees', unit: '°'},
      {label: 'Head', k: 'axesHeadPct', unit: '%'},
      {label: 'Tick width', k: 'axesTickWidthPct', unit: '%'},
      {label: 'Tick every', k: 'axesTickMm', unit: ' mm'},
    ],
  },
  {k: 'brace', chips: []},
  {k: 'sqrt', chips: []},
];

function ShapeRow({k, chips}: {k: ShapeKey; chips: ChipSpec[]}) {
  const s = getSettings();
  const on = s[k];
  // Axes: the tick settings only matter when ticks are drawn.
  const tickChip = (c: ChipSpec) =>
    c.k === 'axesTickWidthPct' || c.k === 'axesTickMm';
  return (
    <View style={styles.shapeRow}>
      <Pressable
        style={[styles.shape, on && styles.shapeOn]}
        onPress={() => updateSettings({[k]: !on})}>
        <ShapeIcon k={k} c={on ? '#ffffff' : '#9d9d9d'} />
      </Pressable>
      <View style={[styles.chips, !on && styles.dim]}>
        {chips
          .filter(c => !tickChip(c))
          .map(c => (
            <Chip key={c.k} {...c} />
          ))}
        {k === 'axes' ? (
          <Switch
            label="Ticks"
            value={s.axesTicks ? 'On' : 'Off'}
            on={s.axesTicks}
            onPress={() => updateSettings({axesTicks: !s.axesTicks})}
          />
        ) : null}
        {chips.filter(tickChip).map(c => (
          <View key={c.k} style={!s.axesTicks && styles.dim}>
            <Chip {...c} />
          </View>
        ))}
      </View>
    </View>
  );
}

function App(): React.JSX.Element {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const a = subscribe(refresh);
    const b = subscribeMeasures(refresh);
    return () => {
      a();
      b();
    };
  }, []);
  if (blinking) {
    // Opened only to make the host redraw the page under it (PDFs).
    return <View style={styles.blink} />;
  }
  const s = getSettings();
  const m = lastMeasure;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Snap</Text>
        <View style={styles.headerRight}>
          <Pressable
            style={[styles.switch, s.enabled && styles.switchOn]}
            onPress={() => updateSettings({enabled: !s.enabled})}>
            <Text style={[styles.switchText, s.enabled && styles.switchTextOn]}>
              {s.enabled ? 'On' : 'Off'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => PluginManager.closePluginView()}
            style={styles.close}
            hitSlop={16}>
            <Text style={styles.title}>✕</Text>
          </Pressable>
        </View>
      </View>

      <Text style={styles.section}>Symbols</Text>
      <View style={[styles.card, !s.enabled && styles.dim]}>
        {SHAPE_SETTINGS.map(r => (
          <ShapeRow key={r.k} {...r} />
        ))}
      </View>

      <Text style={styles.section}>Detection</Text>
      <View style={[styles.detection, !s.enabled && styles.dim]}>
        <Chip label="Hold" k="holdMs" unit=" ms" />
        <Chip label="Stillness" k="stillRadius" unit=" px" />
        <Chip label="Tolerance" k="tolerance" unit=" / 5" />
      </View>
      <Text style={styles.explain}>
        Hold: pause at the end of the stroke (0 = on lift) · Stillness: jitter
        allowed during it · Tolerance: 1 neat, 5 lenient. Shapes under 5 mm
        always need the pause.
      </Text>

      <View style={styles.footer}>
        <Text style={styles.measure} numberOfLines={1}>
          {m ? `Last stroke: ${m.result}` : 'Last stroke: none yet'}
        </Text>
        <Pressable
          style={styles.reset}
          onPress={() => updateSettings(DEFAULTS)}>
          <Text style={styles.resetText}>Reset to defaults</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  blink: {flex: 1, backgroundColor: 'transparent'},
  container: {flex: 1, backgroundColor: '#ffffff'},
  content: {paddingHorizontal: 32, paddingTop: 22, paddingBottom: 24},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  headerRight: {flexDirection: 'row', alignItems: 'center'},
  title: {fontSize: 30, fontWeight: '700', color: '#000000'},
  close: {paddingHorizontal: 6, marginLeft: 22},
  section: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000000',
    marginTop: 12,
    marginBottom: 4,
  },
  card: {borderTopWidth: 1, borderColor: '#c9c9c9'},
  shapeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderColor: '#c9c9c9',
    minHeight: 72,
  },
  shape: {
    width: 62,
    height: 62,
    borderWidth: 2,
    borderColor: '#9d9d9d',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shapeOn: {backgroundColor: '#000000', borderColor: '#000000'},
  iconRect: {width: 40, height: 28, borderWidth: 3},
  iconCircle: {width: 36, height: 36, borderRadius: 18, borderWidth: 3},
  iconAxesBox: {width: 40, height: 40},
  iconAxes: {
    position: 'absolute',
    left: 4,
    top: 6,
    width: 30,
    height: 30,
    borderLeftWidth: 3,
    borderBottomWidth: 3,
  },
  axesUp: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 5.5,
    borderRightWidth: 5.5,
    borderBottomWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  axesRight: {
    position: 'absolute',
    left: 31,
    top: 28.5,
    width: 0,
    height: 0,
    borderTopWidth: 5.5,
    borderBottomWidth: 5.5,
    borderLeftWidth: 9,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  iconArrow: {flexDirection: 'row', alignItems: 'center'},
  arrowShaft: {width: 26, height: 4},
  arrowHead: {
    width: 0,
    height: 0,
    borderLeftWidth: 14,
    borderTopWidth: 9,
    borderBottomWidth: 9,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  iconGlyph: {
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '700',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  chips: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginLeft: 18,
  },
  chip: {marginRight: 22, marginVertical: 2},
  chipLabel: {fontSize: 17, color: '#444444', marginBottom: 4},
  stepper: {flexDirection: 'row', alignItems: 'center'},
  step: {
    width: 40,
    height: 38,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {fontSize: 24, lineHeight: 26, color: '#000000'},
  chipValue: {
    minWidth: 76,
    fontSize: 21,
    color: '#000000',
    textAlign: 'center',
  },
  switch: {
    minWidth: 100,
    height: 38,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchOn: {backgroundColor: '#000000'},
  switchText: {fontSize: 19, color: '#000000'},
  switchTextOn: {color: '#ffffff'},
  dim: {opacity: 0.4},
  detection: {flexDirection: 'row', flexWrap: 'wrap'},
  explain: {fontSize: 16, lineHeight: 22, color: '#444444', marginTop: 4},
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
  },
  reset: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: '#9d9d9d',
    borderRadius: 8,
  },
  resetText: {fontSize: 16, color: '#444444'},
  measure: {flex: 1, fontSize: 18, color: '#000000', marginRight: 16},
});

export default App;
