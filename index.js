/**
 * @format
 */

import {AppRegistry, Image} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

import {PluginManager} from 'sn-plugin-lib';
import {loadSettings} from './src/settings';
import {start} from './src/snapper';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

// Settings: from the plugin manager, and from a shortcut in the plugin menu
// (sidebar button, type 1) that opens the same settings view.
PluginManager.registerConfigButton();
PluginManager.registerConfigButtonListener({
  onClick() {
    PluginManager.showPluginView();
  },
});

const SETTINGS_BUTTON = 401;
PluginManager.registerButton(1, ['NOTE', 'DOC'], {
  id: SETTINGS_BUTTON,
  name: 'ShapeSnap',
  icon: Image.resolveAssetSource(require('./assets/icon_shapes.png')).uri,
  showType: 1,
}).catch(e => console.warn('[ShapeSnap] menu button', e));
PluginManager.registerButtonListener({
  onButtonPress(event) {
    if (event?.id === SETTINGS_BUTTON) {
      PluginManager.showPluginView();
    }
  },
});

loadSettings();
start();
