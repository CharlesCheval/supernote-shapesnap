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

function Toggle({label, hint, k}: {label: string; hint?: string; k: 'enabled' | 'rect' | 'circle' | 'lassoAfter'}) {
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
        Draw a rectangle or a circle and lift the pen: it snaps into a perfect shape. Set a hold duration to require a short pause first.
      </Text>

      <Toggle label="Enabled" k="enabled" />
      <Stepper label="Hold duration" hint="0 = snap as soon as the pen lifts · higher = pause required at the end" k="holdMs" unit="ms" />
      <Stepper label="Stillness" hint="Small jitter allowed during the hold" k="stillRadius" unit="px" />
      <Stepper label="Tolerance" hint="1 = neat drawing required · 5 = very lenient" k="tolerance" unit="/ 5" />
      <Toggle label="Rectangles" k="rect" />
      <Toggle label="Circles" hint="Always perfect, even from a slightly oval stroke" k="circle" />
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
  toggleOnText: {color: '#ffffff'},
  measure: {marginTop: 28, padding: 16, borderWidth: 2, borderColor: '#000000', borderRadius: 8},
  detail: {fontSize: 15, lineHeight: 22, color: '#000000', marginTop: 8, fontFamily: 'monospace'},
  reset: {alignSelf: 'flex-start', marginTop: 24},
});

export default App;
