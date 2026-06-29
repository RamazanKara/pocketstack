const BOOTSTRAP_TABLE = "__pocketstack_bootstrap";

function pglitePersistMode(service) {
  return service?.config?.persist === "memory" ? "memory" : "indexeddb";
}

function pglitePersists(service) {
  return pglitePersistMode(service) === "indexeddb";
}

function pgliteIndexedDBName(service) {
  const namespace = service?.config?.storageNamespace;
  const serviceName = storageToken(service?.name || "service");
  if (!namespace) return `pocketstack-${serviceName}`;
  return `pocketstack-${storageToken(namespace)}-${serviceName}`;
}

function pgliteDataDir(service) {
  return pglitePersists(service) ? `idb://${pgliteIndexedDBName(service)}` : "memory://";
}

async function ensurePGliteBootstrapped(db, executeAssets, log = () => {}) {
  await db.exec(`
    create table if not exists ${BOOTSTRAP_TABLE} (
      key text primary key,
      value text not null
    );
  `);
  const result = await db.query(`select value from ${BOOTSTRAP_TABLE} where key = 'assets'`);
  const rows = result.rows || result;
  if (rows.length > 0) {
    log("PGlite bootstrap assets already applied.");
    return false;
  }
  await executeAssets();
  await db.exec(`
    insert into ${BOOTSTRAP_TABLE} (key, value)
    values ('assets', '1')
    on conflict (key) do update set value = excluded.value;
  `);
  return true;
}

function deleteIndexedDBDatabase(name) {
  if (!("indexedDB" in globalThis)) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`IndexedDB database ${name} is blocked by an open connection`));
  });
}

async function deletePGliteStorage(service) {
  if (!pglitePersists(service)) return false;
  return deleteIndexedDBDatabase(pgliteIndexedDBName(service));
}

function storageToken(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "demo";
}

export {
  BOOTSTRAP_TABLE,
  deletePGliteStorage,
  ensurePGliteBootstrapped,
  pgliteDataDir,
  pgliteIndexedDBName,
  pglitePersistMode,
  pglitePersists,
  storageToken,
};
