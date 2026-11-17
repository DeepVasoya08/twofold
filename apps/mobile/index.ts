// Sets up the shared core for this phone before anything else uses it.
import './src/platform';

import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';

import App from './App';
import { backgroundBackup, keepBackupScheduled } from './src/backup/background';

registerRootComponent(App);

// Automatic backup, run by Android's job with Arcafold open, locked or closed.
AppRegistry.registerHeadlessTask('ArcafoldBackup', () => backgroundBackup);
void keepBackupScheduled().catch(() => undefined);
