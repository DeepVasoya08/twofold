// Sets up the shared core for this phone before anything else uses it.
import './src/platform';

import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
