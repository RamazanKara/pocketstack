function configList(value = "") {
  return String(value || "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function databaseSQLAssetPaths(service) {
  const config = service.config || {};
  return [
    ...configList(config.initPath),
    ...configList(config.initScripts),
    ...configList(config.seedPath),
    ...configList(config.seedScripts),
  ];
}

function sqliteSQLAssetPaths(service, isDatabasePath = () => false) {
  const config = service.config || {};
  const seedPath = String(config.seedPath || "");
  return [
    ...configList(config.initPath),
    ...configList(config.initScripts),
    ...(seedPath && !isDatabasePath(seedPath) ? [seedPath] : []),
    ...configList(config.seedScripts),
  ];
}

export { configList, databaseSQLAssetPaths, sqliteSQLAssetPaths };
