/**
 * @format
 */

import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

import {PluginManager} from 'sn-plugin-lib';
import {loadSettings} from './src/settings';
import {start} from './src/snapper';

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

// No toolbar button: only a settings entry in the plugin manager.
PluginManager.registerConfigButton();
PluginManager.registerConfigButtonListener({
  onClick() {
    PluginManager.showPluginView();
  },
});

loadSettings();
start();
