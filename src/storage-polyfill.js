// Zamiennik window.storage z artefaktów Claude — używa localStorage w przeglądarce,
// żeby aplikacja zapisywała dane lokalnie na telefonie (offline, bez konta, za darmo).

const PREFIX = "pilkarz-app:";

function readAll() {
  try {
    const raw = localStorage.getItem(PREFIX + "data");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function writeAll(obj) {
  localStorage.setItem(PREFIX + "data", JSON.stringify(obj));
}

window.storage = {
  async get(key) {
    const all = readAll();
    if (!(key in all)) return null;
    return { key, value: all[key], shared: false };
  },
  async set(key, value) {
    const all = readAll();
    all[key] = value;
    writeAll(all);
    return { key, value, shared: false };
  },
  async delete(key) {
    const all = readAll();
    const existed = key in all;
    delete all[key];
    writeAll(all);
    return { key, deleted: existed, shared: false };
  },
  async list(prefix) {
    const all = readAll();
    const keys = Object.keys(all).filter((k) => !prefix || k.startsWith(prefix));
    return { keys, prefix, shared: false };
  },
};
