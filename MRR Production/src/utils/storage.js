// src/utils/storage.js

export const storage = typeof window !== 'undefined' && window.storage ? window.storage : {
  get: async (key) => {
    try {
      const item = window.localStorage.getItem(key);
      return { value: item };
    } catch (err) {
      console.error(`Storage engine read failure for key "${key}":`, err);
      return { value: null };
    }
  },
  set: async (key, value) => {
    try {
      window.localStorage.setItem(key, value);
      return { ok: true };
    } catch (err) {
      console.error(`Storage engine write failure for key "${key}":`, err);
      return { ok: false };
    }
  }
};
