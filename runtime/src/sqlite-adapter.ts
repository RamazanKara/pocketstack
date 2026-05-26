function sqlitePersistMode(service) {
  return service?.config?.persist === "memory" ? "memory" : "indexeddb";
}

function sqlitePersists(service) {
  return sqlitePersistMode(service) === "indexeddb";
}

function sqliteStorageKey(service) {
  const namespace = service?.config?.storageNamespace;
  const serviceName = storageToken(service?.name || "service");
  if (!namespace) return `pocketstack:sqlite:${serviceName}`;
  return `pocketstack:sqlite:${storageToken(namespace)}:${serviceName}`;
}

function isSQLiteDatabasePath(path = "") {
  return /\.(db|sqlite|sqlite3)$/i.test(path);
}

function storageToken(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "demo";
}

export { isSQLiteDatabasePath, sqlitePersistMode, sqlitePersists, sqliteStorageKey, storageToken };
