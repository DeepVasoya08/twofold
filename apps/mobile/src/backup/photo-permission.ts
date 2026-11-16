import { PermissionsAndroid, Platform } from 'react-native';

/** The permission automatic backup needs to see the phone's photos. */
function photoPermission() {
  return Platform.OS === 'android' && Platform.Version >= 33
    ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
    : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
}

/**
 * Asks to see all the phone's photos. Allowing only some (Android 14's "Select photos")
 * counts as no: backup would miss every new one.
 */
export async function askForPhotos(): Promise<boolean> {
  const permission = photoPermission();
  if (await PermissionsAndroid.check(permission)) return true;
  const answer = await PermissionsAndroid.request(permission).catch(() => null);
  return answer === PermissionsAndroid.RESULTS.GRANTED;
}

/** Whether the app may still see all the phone's photos (it can be taken back in settings). */
export function canSeePhotos(): Promise<boolean> {
  return PermissionsAndroid.check(photoPermission()).catch(() => false);
}
