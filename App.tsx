/**
 * Settings screen, opened from Settings → Apps → Plugins → ShapeSnap.
 * − / + buttons rather than sliders: more precise with a pen on e-ink.
 *
 * @format
 */

import React, {useEffect, useReducer} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {PluginManager} from 'sn-plugin-lib';
import {DEFAULTS, LIMITS, REPLACE_MODES, Settings, getSettings, subscribe, updateSettings} from './src/settings';
import {lastMeasure, subscribeMeasures} from './src/snapper';

type NumKey = keyof typeof LIMITS;

function Stepper({label, hint, k, unit}: {label: string; hint: string; k: NumKey; unit: string}) {
  const value = getSettings()[k];
  const {min, max, step} = LIMITS[k];
  const set = (v: number) => updateSettings({[k]: Math.min(max, Math.max(min, v))} as Partial<Settings>);
  return (
    <View style={styles.row}>
      <View style={styles.labelBox}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Pressable style={styles.btn} onPress={() => set(value - step)}>
        <Text style={styles.btnText}>−</Text>
      </Pressable>
      <Text style={styles.value}>
        {value} {unit}
      </Text>
      <Pressable style={styles.btn} onPress={() => set(value + step)}>
        <Text style={styles.btnText}>+</Text>
      </Pressable>
    </View>
  );
}

function Toggle({label, hint, k}: {label: string; hint?: string; k: 'enabled' | 'lassoAfter'}) {
  const on = getSettings()[k];
  return (
    <View style={styles.row}>
      <View style={styles.labelBox}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Pressable style={[styles.toggle, on && styles.toggleOn]} onPress={() => updateSettings({[k]: !on})}>
        <Text style={[styles.btnText, on && styles.toggleOnText]}>{on ? 'On' : 'Off'}</Text>
      </Pressable>
    </View>
  );
}

type ShapeKey = 'rect' | 'circle' | 'arrow' | 'brace' | 'sqrt' | 'axes';

/**
 * Shape icons drawn with plain views and ASCII / common glyphs, so they render
 * whatever fonts the device has. `c` is the ink colour (inverted when selected).
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

const SHAPES: ShapeKey[] = ['rect', 'circle', 'arrow', 'brace', 'sqrt', 'axes'];

/** One compact row: tap an icon to turn that shape on (black) or off (outlined, grey). */
function ShapePicker() {
  const s = getSettings();
  return (
    <View style={styles.shapes}>
      {SHAPES.map(k => (
        <Pressable key={k} style={[styles.shape, s[k] && styles.shapeOn]} onPress={() => updateSettings({[k]: !s[k]})}>
          <ShapeIcon k={k} c={s[k] ? '#ffffff' : '#9d9d9d'} />
        </Pressable>
      ))}
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
  const m = lastMeasure;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>ShapeSnap settings</Text>
        <Pressable onPress={() => PluginManager.closePluginView()} style={styles.close}>
          <Text style={styles.title}>✕</Text>
        </Pressable>
      </View>
      <Text style={styles.intro}>
        Draw a shape and lift the pen: it snaps into a clean one. Tap the icons to choose which shapes are recognized.
      </Text>

      <Toggle label="Enabled" k="enabled" />
      <ShapePicker />
      <Stepper label="Hold duration" hint="0 = snap as soon as the pen lifts · higher = pause required at the end" k="holdMs" unit="ms" />
      <Stepper label="Stillness" hint="Small jitter allowed during the hold" k="stillRadius" unit="px" />
      <Stepper label="Tolerance" hint="1 = neat drawing required · 5 = very lenient" k="tolerance" unit="/ 5" />
      <Stepper
        label="Arrow snapping"
        hint="Arrows this close to horizontal or vertical are straightened · 0 = never · lower = more precise"
        k="arrowSnapDegrees"
        unit="°"
      />
      <Toggle label="Select after snapping" hint="The shape appears lasso-selected, ready to resize" k="lassoAfter" />

      <View style={styles.row}>
        <View style={styles.labelBox}>
          <Text style={styles.label}>Stroke removal</Text>
          <Text style={styles.hint}>
            number = stroke removed, even over writing, but clears the undo history · keep = stroke left under the shape
          </Text>
        </View>
        <Pressable
          style={styles.toggle}
          onPress={() => {
            const i = REPLACE_MODES.indexOf(getSettings().replaceMode);
            updateSettings({replaceMode: REPLACE_MODES[(i + 1) % REPLACE_MODES.length]});
          }}>
          <Text style={styles.btnText}>{getSettings().replaceMode}</Text>
        </Pressable>
      </View>

      <View style={styles.measure}>
        <Text style={styles.label}>Last stroke</Text>
        <Text style={styles.hint}>
          {m
            ? `Hold measured: ${m.stillMs} ms${m.holdSource === 'points' ? ' (estimated from points)' : ''}\n${m.result}`
            : 'No stroke analysed yet. Draw in a note, then come back here.'}
        </Text>
        {m?.details.map((d, i) => (
          <Text key={i} style={styles.detail}>
            {d}
          </Text>
        ))}
      </View>

      <Pressable style={[styles.btn, styles.reset]} onPress={() => updateSettings(DEFAULTS)}>
        <Text style={styles.btnText}>Reset to defaults</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#ffffff'},
  content: {padding: 36},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  title: {fontSize: 30, fontWeight: '700', color: '#000000'},
  close: {padding: 8},
  intro: {fontSize: 20, lineHeight: 30, color: '#000000', marginVertical: 20},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderColor: '#c9c9c9'},
  labelBox: {flex: 1, paddingRight: 16},
  label: {fontSize: 22, fontWeight: '600', color: '#000000'},
  hint: {fontSize: 17, lineHeight: 26, color: '#444444', marginTop: 4},
  btn: {borderWidth: 2, borderColor: '#000000', borderRadius: 8, minWidth: 56, paddingVertical: 8, paddingHorizontal: 14, alignItems: 'center'},
  btnText: {fontSize: 24, color: '#000000'},
  value: {fontSize: 22, color: '#000000', minWidth: 110, textAlign: 'center'},
  toggle: {borderWidth: 2, borderColor: '#000000', borderRadius: 8, minWidth: 110, paddingVertical: 8, alignItems: 'center'},
  toggleOn: {backgroundColor: '#000000'},
  shapes: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 20, borderBottomWidth: 1, borderColor: '#c9c9c9'},
  shape: {
    width: 84,
    height: 84,
    borderWidth: 2,
    borderColor: '#9d9d9d',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shapeOn: {backgroundColor: '#000000', borderColor: '#000000'},
  iconRect: {width: 46, height: 32, borderWidth: 4},
  iconCircle: {width: 42, height: 42, borderRadius: 21, borderWidth: 4},
  iconAxes: {width: 40, height: 40, borderLeftWidth: 4, borderBottomWidth: 4},
  iconGlyph: {fontSize: 44, lineHeight: 52, fontWeight: '700'},
  toggleOnText: {color: '#ffffff'},
  measure: {marginTop: 28, padding: 16, borderWidth: 2, borderColor: '#000000', borderRadius: 8},
  detail: {fontSize: 15, lineHeight: 22, color: '#000000', marginTop: 8, fontFamily: 'monospace'},
  reset: {alignSelf: 'flex-start', marginTop: 24},
});

export default App;
