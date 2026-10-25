import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Small key-value storage: the encrypted keychain/keystore on phones, localStorage on the
 * web. Used for the session token and the theme choice; never for timetable data, which
 * lives on the server.
 */
export const storage = {
  async get(key: string): Promise<string | null> {
    try {
      if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string | null) {
    try {
      if (Platform.OS === 'web') {
        if (value === null) globalThis.localStorage?.removeItem(key);
        else globalThis.localStorage?.setItem(key, value);
        return;
      }
      if (value === null) await SecureStore.deleteItemAsync(key);
      else await SecureStore.setItemAsync(key, value);
    } catch {
      // Storage can be unavailable (private mode); the app still works for this session.
    }
  },
};
