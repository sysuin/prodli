// iOS Keychain / Android Keystore. Readable only by ProdLi, only on this device
// (not restored to a new phone from a backup: the user signs in again there).
import * as SecureStore from "expo-secure-store";

const opts: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const secret = {
  get: (k: string): string | null => SecureStore.getItem(k, opts),
  set: (k: string, v: string): void => SecureStore.setItem(k, v, opts),
  remove: (k: string): void => void SecureStore.deleteItemAsync(k, opts),
};
