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
import {
  DEFAULTS,
  LIMITS,
  REPLACE_MODES,
  Settings,
  getSettings,
  subscribe,
  updateSettings,
} from './src/settings';
import {lastMeasure, subscribeMeasures} from './src/snapper';

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
      return <View style={[styles.iconAxes, {borderColor: c}]} />;
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

/** A framed group of general settings, each with a line of explanation. */
function Block({title, children}: {title: string; children: React.ReactNode}) {
  return (
    <View style={styles.block}>
      <Text style={styles.blockTitle}>{title}</Text>
      {children}
    </View>
  );
}

/** One general setting: its control, then what it does. */
function Explained({
  children,
  text,
}: {
  children: React.ReactNode;
  text: string;
}) {
  return (
    <View style={styles.explained}>
      {children}
      <Text style={styles.explain}>{text}</Text>
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

      <Text style={styles.section}>General</Text>
      <View style={styles.blocks}>
        <Block title="Detection">
          <Explained text="Pause at the end · 0 = snap on lift">
            <Chip label="Hold" k="holdMs" unit=" ms" />
          </Explained>
          <Explained text="Jitter allowed during the pause">
            <Chip label="Stillness" k="stillRadius" unit=" px" />
          </Explained>
          <Explained text="1 = neat drawing · 5 = lenient">
            <Chip label="Tolerance" k="tolerance" unit=" / 5" />
          </Explained>
          <Explained text="Down to 1 mm · hold the pen at the end">
            <Switch
              label="Tiny shapes"
              value={s.tinyShapes ? 'On' : 'Off'}
              on={s.tinyShapes}
              onPress={() => updateSettings({tinyShapes: !s.tinyShapes})}
            />
          </Explained>
        </Block>
        <Block title="After snapping">
          <Explained text="Shape comes lasso-selected">
            <Switch
              label="Select the shape"
              value={s.lassoAfter ? 'On' : 'Off'}
              on={s.lassoAfter}
              onPress={() => updateSettings({lassoAfter: !s.lassoAfter})}
            />
          </Explained>
          <Explained
            text={
              s.replaceMode === 'number'
                ? 'Deleted · clears the undo history'
                : 'Left under · keeps the undo history'
            }>
            <Switch
              label="Hand-drawn stroke"
              value={s.replaceMode === 'number' ? 'Removed' : 'Kept'}
              on={false}
              onPress={() => {
                const i = REPLACE_MODES.indexOf(s.replaceMode);
                updateSettings({
                  replaceMode: REPLACE_MODES[(i + 1) % REPLACE_MODES.length],
                });
              }}
            />
          </Explained>
        </Block>
      </View>

      <View style={styles.footer}>
        <Text style={styles.section}>Last stroke</Text>
        <Pressable
          style={styles.reset}
          onPress={() => updateSettings(DEFAULTS)}>
          <Text style={styles.resetText}>Reset to defaults</Text>
        </Pressable>
      </View>
      <Text style={styles.measure}>
        {m
          ? `${m.result} · hold ${m.stillMs} ms${
              m.holdSource === 'points' ? ' (estimated)' : ''
            }`
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
    marginTop: 18,
    marginBottom: 8,
  },
  card: {borderTopWidth: 1, borderColor: '#c9c9c9'},
  shapeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#c9c9c9',
    minHeight: 88,
  },
  shape: {
    width: 72,
    height: 72,
    borderWidth: 2,
    borderColor: '#9d9d9d',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shapeOn: {backgroundColor: '#000000', borderColor: '#000000'},
  iconRect: {width: 40, height: 28, borderWidth: 3},
  iconCircle: {width: 36, height: 36, borderRadius: 18, borderWidth: 3},
  iconAxes: {width: 34, height: 34, borderLeftWidth: 3, borderBottomWidth: 3},
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
  chip: {marginRight: 26, marginVertical: 4},
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
  blocks: {flexDirection: 'row', justifyContent: 'space-between'},
  block: {
    width: '48.5%',
    padding: 16,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 12,
  },
  blockTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#000000',
    marginBottom: 6,
  },
  explained: {marginTop: 6},
  explain: {fontSize: 16, lineHeight: 22, color: '#444444', marginTop: 2},
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  reset: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: '#9d9d9d',
    borderRadius: 8,
  },
  resetText: {fontSize: 16, color: '#444444'},
  measure: {fontSize: 18, color: '#000000', marginTop: 2},
  detail: {
    fontSize: 15,
    lineHeight: 21,
    color: '#444444',
    marginTop: 4,
    fontFamily: 'monospace',
  },
});

export default App;
