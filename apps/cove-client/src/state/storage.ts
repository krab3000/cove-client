import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules } from 'react-native';

// What the app keeps across launches, in AsyncStorage (Android; Windows on its legacy store). Reads and writes never
// throw: a storage that fails leaves the app as on a first launch.

export async function readItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeItem(key: string, value: string) {
  AsyncStorage.setItem(key, value).catch(() => {});
}

// Builds before AsyncStorage kept the sign-in in the app's own KeyValueStore module (Android): read once, to carry it
// over. The module goes away once every device has moved.
const legacy = NativeModules.KeyValueStore as
  { get(key: string): string | null } | undefined;

export function readLegacy(key: string): string | null {
  try {
    return legacy?.get(key) ?? null;
  } catch {
    return null;
  }
}
