/**
 * Settings screen, opened from Settings → Apps → Plugins → ShapeSnap.
 * Compact: one row per shape — its icon (tap to turn it on or off) and, next to
 * it, the settings of that shape — then the general settings and the last
 * stroke's diagnostics. − / + buttons rather than sliders: more precise with a
 * pen on e-ink. Everything fits on one page.
 *
 * @format
 */

import React, {useEffect, useReducer} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {DEFAULTS, LIMITS, REPLACE_MODES, Settings, getSettings, subscribe, updateSettings} from './src/settings';
import {lastMeasure, subscribeMeasures} from './src/snapper';

type NumKey = keyof typeof LIMITS;

/** A small labelled − value + control. */
function Chip({label, k, unit}: {label: string; k: NumKey; unit: string}) {
  const value = getSettings()[k];
  const {min, max, step} = LIMITS[k];
  const set = (v: number) => updateSettings({[k]: Math.min(max, Math.max(min, v))} as Partial<Settings>);
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable style={styles.step} hitSlop={6} onPress={() => set(value - step)}>
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.chipValue}>
          {value}
          {unit}
        </Text>
        <Pressable style={styles.step} hitSlop={6} onPress={() => set(value + step)}>
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A small labelled switch (On / Off) or cycling choice. */
function Switch({label, value, on, onPress}: {label: string; value: string; on: boolean; onPress: () => void}) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipLabel}>{label}</Text>
      <Pressable style={[styles.switch, on && styles.switchOn]} onPress={onPress}>
        <Text style={[styles.switchText, on && styles.switchTextOn]}>{value}</Text>
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
      return <View style={[styles.iconAxes, {borderColor: c}]} />;
    default:
      return <Text style={[styles.iconGlyph, {color: c}]}>{{arrow: '→', brace: '{', sqrt: '√'}[k]}</Text>;
  }
}

/** The settings shown next to each shape. */
const SHAPE_SETTINGS: {k: ShapeKey; chips: {label: string; k: NumKey; unit: string}[]}[] = [
  {k: 'rect', chips: [{label: 'Straighten', k: 'rectSnapDegrees', unit: '°'}]},
  {k: 'circle', chips: []},
  {
    k: 'arrow',
    chips: [
      {label: 'Head', k: 'arrowHeadPct', unit: '%'},
      {label: 'Straighten', k: 'arrowSnapDegrees', unit: '°'},
    ],
  },
  {k: 'brace', chips: []},
  {k: 'sqrt', chips: []},
  {
    k: 'axes',
    chips: [
      {label: 'Head', k: 'axesHeadPct', unit: '%'},
      {label: 'Tick width', k: 'axesTickWidthPct', unit: '%'},
      {label: 'Tick every', k: 'axesTickMm', unit: ' mm'},
    ],
  },
];

function ShapeRow({k, chips}: {k: ShapeKey; chips: {label: string; k: NumKey; unit: string}[]}) {
  const on = getSettings()[k];
  return (
    <View style={styles.shapeRow}>
      <Pressable style={[styles.shape, on && styles.shapeOn]} onPress={() => updateSettings({[k]: !on})}>
        <ShapeIcon k={k} c={on ? '#ffffff' : '#9d9d9d'} />
      </Pressable>
      <View style={[styles.chips, !on && styles.dim]}>
        {chips.map(c => (
          <Chip key={c.k} {...c} />
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
  const s = getSettings();
  const m = lastMeasure;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>ShapeSnap</Text>
        <View style={styles.headerRight}>
          <Pressable
            style={[styles.switch, s.enabled && styles.switchOn]}
            onPress={() => updateSettings({enabled: !s.enabled})}>
            <Text style={[styles.switchText, s.enabled && styles.switchTextOn]}>{s.enabled ? 'On' : 'Off'}</Text>
          </Pressable>
          <Pressable onPress={() => PluginManager.closePluginView()} style={styles.close} hitSlop={16}>
            <Text style={styles.title}>✕</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.card, !s.enabled && styles.dim]}>
        {SHAPE_SETTINGS.map(r => (
          <ShapeRow key={r.k} {...r} />
        ))}
      </View>

      <Text style={styles.section}>General</Text>
      <View style={[styles.chips, styles.general]}>
        <Chip label="Hold" k="holdMs" unit=" ms" />
        <Chip label="Stillness" k="stillRadius" unit=" px" />
        <Chip label="Tolerance" k="tolerance" unit="/5" />
        <Switch
          label="Select after"
          value={s.lassoAfter ? 'On' : 'Off'}
          on={s.lassoAfter}
          onPress={() => updateSettings({lassoAfter: !s.lassoAfter})}
        />
        <Switch
          label="Hand stroke"
          value={s.replaceMode === 'number' ? 'Removed' : 'Kept'}
          on={false}
          onPress={() => {
            const i = REPLACE_MODES.indexOf(s.replaceMode);
            updateSettings({replaceMode: REPLACE_MODES[(i + 1) % REPLACE_MODES.length]});
          }}
        />
      </View>
      <Text style={styles.hint}>
        Hold: pause required at the end of the stroke (0 = snap as soon as the pen lifts) · Tolerance: 1 = neat drawing
        required, 5 = lenient · Removed: the hand stroke is deleted, even over writing, but the undo history is cleared.
      </Text>

      <View style={styles.footer}>
        <Text style={styles.section}>Last stroke</Text>
        <Pressable style={styles.reset} onPress={() => updateSettings(DEFAULTS)}>
          <Text style={styles.resetText}>Reset to defaults</Text>
        </Pressable>
      </View>
      <Text style={styles.measure}>
        {m
          ? `${m.result} · hold ${m.stillMs} ms${m.holdSource === 'points' ? ' (estimated)' : ''}`
          : 'No stroke analysed yet. Draw in a note, then come back here.'}
      </Text>
      {m?.details.map((d, i) => (
        <Text key={i} style={styles.detail} numberOfLines={2}>
          {d}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#ffffff'},
  content: {paddingHorizontal: 28, paddingTop: 18, paddingBottom: 18},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14},
  headerRight: {flexDirection: 'row', alignItems: 'center'},
  title: {fontSize: 26, fontWeight: '700', color: '#000000'},
  close: {paddingHorizontal: 6, marginLeft: 18},
  card: {borderTopWidth: 1, borderColor: '#c9c9c9'},
  shapeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#c9c9c9',
    minHeight: 76,
  },
  shape: {
    width: 60,
    height: 60,
    borderWidth: 2,
    borderColor: '#9d9d9d',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shapeOn: {backgroundColor: '#000000', borderColor: '#000000'},
  iconRect: {width: 34, height: 24, borderWidth: 3},
  iconCircle: {width: 30, height: 30, borderRadius: 15, borderWidth: 3},
  iconAxes: {width: 30, height: 30, borderLeftWidth: 3, borderBottomWidth: 3},
  iconGlyph: {fontSize: 32, lineHeight: 38, fontWeight: '700'},
  chips: {flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginLeft: 12},
  chip: {marginRight: 22, marginVertical: 4},
  chipLabel: {fontSize: 13, color: '#555555', marginBottom: 3},
  stepper: {flexDirection: 'row', alignItems: 'center'},
  step: {
    width: 34,
    height: 32,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {fontSize: 20, lineHeight: 22, color: '#000000'},
  chipValue: {minWidth: 64, fontSize: 17, color: '#000000', textAlign: 'center'},
  switch: {
    minWidth: 84,
    height: 32,
    paddingHorizontal: 10,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchOn: {backgroundColor: '#000000'},
  switchText: {fontSize: 16, color: '#000000'},
  switchTextOn: {color: '#ffffff'},
  dim: {opacity: 0.4},
  section: {fontSize: 17, fontWeight: '700', color: '#000000', marginTop: 16, marginBottom: 4},
  general: {marginLeft: 0},
  hint: {fontSize: 13, lineHeight: 19, color: '#555555', marginTop: 4},
  footer: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end'},
  reset: {paddingVertical: 4, paddingHorizontal: 10, borderWidth: 1, borderColor: '#9d9d9d', borderRadius: 6},
  resetText: {fontSize: 13, color: '#555555'},
  measure: {fontSize: 15, color: '#000000', marginTop: 2},
  detail: {fontSize: 12, lineHeight: 17, color: '#444444', marginTop: 3, fontFamily: 'monospace'},
});

export default App;
