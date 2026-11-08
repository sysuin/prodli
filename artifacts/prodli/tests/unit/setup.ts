// IndexedDB for meeting storage tests; a fresh localStorage for every test.
import "fake-indexeddb/auto";
import { beforeEach } from "vitest";

beforeEach(() => {
  localStorage.clear();
});
