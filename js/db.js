// js/db.js
// High-performance asynchronous IndexedDB persistence layer for conversations and generated image assets.

const DB_NAME = 'ZenMuxChatDB';
const DB_VERSION = 2;
const STORE_CONV = 'conversations';
const STORE_IMAGES = 'images';

export const ZenMuxDB = {
  _db: null,

  init() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        return reject(new Error('当前浏览器不支持 IndexedDB'));
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_CONV)) {
          const store = db.createObjectStore(STORE_CONV, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_IMAGES)) {
          const imgStore = db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
          imgStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        this._db = e.target.result;
        resolve(this._db);
      };
      req.onerror = (e) => {
        reject(e.target.error || new Error('打开 IndexedDB 数据库失败'));
      };
    });
  },

  getAllConversations() {
    return this.init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_CONV], 'readonly');
        const store = tx.objectStore(STORE_CONV);
        const req = store.getAll();
        req.onsuccess = () => {
          const list = req.result || [];
          list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
          resolve(list);
        };
        req.onerror = (e) => reject(e.target.error);
      });
    });
  },

  getConversation(id) {
    return this.init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_CONV], 'readonly');
        const store = tx.objectStore(STORE_CONV);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
      });
    });
  },

  putConversation(conv) {
    return this.init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_CONV], 'readwrite');
        const store = tx.objectStore(STORE_CONV);
        const req = store.put(conv);
        req.onsuccess = () => resolve(conv);
        req.onerror = (e) => reject(e.target.error);
      });
    });
  },

  deleteConversation(id) {
    return this.init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_CONV], 'readwrite');
        const store = tx.objectStore(STORE_CONV);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
      });
    });
  },

  // Binary Image asset storage in IndexedDB (zero remote server footprint)
  putImage(id, blob, meta = {}) {
    return this.init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES], 'readwrite');
        const store = tx.objectStore(STORE_IMAGES);
        const record = {
          id,
          blob,
          prompt: meta.prompt || '',
          revisedPrompt: meta.revisedPrompt || '',
          model: meta.model || '',
          size: meta.size || '',
          quality: meta.quality || '',
          createdAt: meta.createdAt || Date.now()
        };
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = (e) => reject(e.target.error);
      });
    });
  },

  getImage(id) {
    return this.init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES], 'readonly');
        const store = tx.objectStore(STORE_IMAGES);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = (e) => reject(e.target.error);
      });
    });
  },

  deleteImage(id) {
    return this.init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_IMAGES], 'readwrite');
        const store = tx.objectStore(STORE_IMAGES);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = (e) => reject(e.target.error);
      });
    });
  }
};

