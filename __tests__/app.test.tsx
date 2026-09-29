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
import {Pressable} from 'react-native';
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
  const buttons = tree!.root.findAllByType(Pressable).filter(n => n.props.style?.[0]?.width === 84);
  expect(buttons).toHaveLength(6);
  act(() => buttons[3].props.onPress());
  expect(getSettings().brace).toBe(!before);
});
