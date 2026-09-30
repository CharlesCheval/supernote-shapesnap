jest.mock('sn-plugin-lib', () => ({
  Element: {TYPE_STROKE: 0},
  FileUtils: {},
  PluginCommAPI: {},
  PluginFileAPI: {},
  PluginManager: {closePluginView: jest.fn()},
  PluginNoteAPI: {},
  PointUtils: {},
}));
import React from 'react';
import {Pressable, Text} from 'react-native';
import renderer, {act} from 'react-test-renderer';
import App from '../App';
import {getSettings} from '../src/settings';

test('settings screen renders, shape icons toggle their shape', () => {
  let tree: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<App />);
  });
  const before = getSettings().brace;
  // Icon buttons follow the SHAPES order: rect, circle, arrow, brace, sqrt, axes.
  const buttons = tree!.root.findAllByType(Pressable).filter(n => n.props.style?.[0]?.width === 72);
  expect(buttons).toHaveLength(6);
  act(() => buttons[3].props.onPress());
  expect(getSettings().brace).toBe(!before);
});

test('each shape row carries its own settings: arrow head size steps by 10 %', () => {
  let tree: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<App />);
  });
  const before = getSettings().arrowHeadPct;
  // First chip of the arrow row: its "−" button.
  const heads = tree!.root.findAll(n => n.props.children === 'Head' && n.type === Text);
  expect(heads.length).toBe(2); // arrow and axes
  const minus = tree!.root.findAllByType(Pressable).filter(p => p.findAllByType(Text).some(t => t.props.children === '−'));
  act(() => minus[1].props.onPress()); // [0] = rectangle straighten, [1] = arrow head
  expect(getSettings().arrowHeadPct).toBe(before - 10);
});

test('axes ticks can be turned off', () => {
  let tree: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(<App />);
  });
  const before = getSettings().axesTicks;
  const ticks = tree!.root.findAll(n => n.type === Text && n.props.children === 'Ticks')[0];
  const button = ticks.parent!.findAllByType(Pressable)[0];
  act(() => button.props.onPress());
  expect(getSettings().axesTicks).toBe(!before);
});
