import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as esbuild from "esbuild";

async function loadWASIHelpers() {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/wasi-preview.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("WASI example writes hello output through fd_write", async () => {
  const { createWASIPreviewImports } = await loadWASIHelpers();
  const bytes = await readFile(new URL("../../examples/wasi/hello.wasm", import.meta.url));
  let instance;
  const output = [];
  const imports = createWASIPreviewImports({
    service: { name: "hello" },
    args: ["--name", "PocketStack"],
    getInstance: () => instance,
    log(message, tone) {
      output.push({ message, tone });
    },
  });
  const result = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: imports });
  instance = result.instance;
  instance.exports._start();
  assert.deepEqual(output, [{ message: "Hello from PocketStack WASI", tone: "" }]);
});

test("WASI fd_write decodes UTF-8 split across iovec boundaries", async () => {
  const { createWASIPreviewImports } = await loadWASIHelpers();
  const memory = new WebAssembly.Memory({ initial: 1 });
  const instance = { exports: { memory } };
  const lines = [];
  const imports = createWASIPreviewImports({
    service: { name: "u" },
    getInstance: () => instance,
    log: (message) => lines.push(message),
  });
  const bytes = new Uint8Array(memory.buffer);
  const view = new DataView(memory.buffer);
  // "héllo\n" with the two bytes of "é" (0xC3 0xA9) split across two iovecs.
  bytes.set([0x68, 0xc3], 200);
  bytes.set([0xa9, 0x6c, 0x6c, 0x6f, 0x0a], 300);
  view.setUint32(0, 200, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, 300, true);
  view.setUint32(12, 5, true);
  assert.equal(imports.fd_write(1, 0, 2, 64), 0);
  assert.equal(view.getUint32(64, true), 7);
  assert.deepEqual(lines, ["héllo"]);
});

test("WASI preview exposes argv and environment memory", async () => {
  const { WASI_ERRNO, createWASIPreviewImports, normalizeEnvironmentRecord, wasmerRunOptions } = await loadWASIHelpers();
  const memory = new WebAssembly.Memory({ initial: 1 });
  const instance = { exports: { memory } };
  const imports = createWASIPreviewImports({
    service: { name: "worker" },
    args: ["--port", "8080"],
    env: { NODE_ENV: "test", API_URL: "https://example.test" },
    getInstance: () => instance,
  });
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  const decoder = new TextDecoder();

  assert.equal(imports.args_sizes_get(0, 4), WASI_ERRNO.success);
  assert.equal(view.getUint32(0, true), 3);
  assert.equal(view.getUint32(4, true), ["worker", "--port", "8080"].join("\0").length + 1);
  assert.equal(imports.args_get(16, 64), WASI_ERRNO.success);

  const argv = [0, 1, 2].map((index) => {
    const pointer = view.getUint32(16 + index * 4, true);
    const end = bytes.indexOf(0, pointer);
    return decoder.decode(bytes.slice(pointer, end));
  });
  assert.deepEqual(argv, ["worker", "--port", "8080"]);

  assert.equal(imports.environ_sizes_get(128, 132), WASI_ERRNO.success);
  assert.equal(view.getUint32(128, true), 2);
  assert.equal(imports.environ_get(136, 160), WASI_ERRNO.success);
  const environ = [0, 1].map((index) => {
    const pointer = view.getUint32(136 + index * 4, true);
    const end = bytes.indexOf(0, pointer);
    return decoder.decode(bytes.slice(pointer, end));
  });
  assert.deepEqual(environ, ["API_URL=https://example.test", "NODE_ENV=test"]);
  assert.deepEqual(normalizeEnvironmentRecord("B=2\nA=1"), { A: "1", B: "2" });
  assert.deepEqual(wasmerRunOptions({ name: "worker" }, ["--port", "8080"], "MODE=demo"), {
    program: "worker",
    args: ["--port", "8080"],
    env: { MODE: "demo" },
  });
});

test("WASI preview import object supports preview1 and legacy namespaces", async () => {
  const { createWASIImportObject } = await loadWASIHelpers();
  const imports = { fd_write() {} };
  const env = { memory: new WebAssembly.Memory({ initial: 1 }) };
  assert.deepEqual(createWASIImportObject(imports, env), {
    wasi_snapshot_preview1: imports,
    wasi_unstable: imports,
    env,
  });
});

test("WASI preview reports stdio metadata, random bytes, and proc_exit", async () => {
  const { WASI_ERRNO, WASIExit, createWASIPreviewImports } = await loadWASIHelpers();
  const memory = new WebAssembly.Memory({ initial: 1 });
  const instance = { exports: { memory } };
  const imports = createWASIPreviewImports({
    service: { name: "worker" },
    getInstance: () => instance,
    now: () => 1000,
    randomBytes(target) {
      target.fill(7);
    },
  });
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);

  assert.equal(imports.fd_fdstat_get(1, 0), WASI_ERRNO.success);
  assert.equal(view.getUint8(0), 2);
  assert.equal(imports.fd_fdstat_get(9, 0), WASI_ERRNO.badf);
  assert.equal(imports.fd_read(0, 0, 0, 64), WASI_ERRNO.success);
  assert.equal(view.getUint32(64, true), 0);
  assert.equal(imports.random_get(80, 4), WASI_ERRNO.success);
  assert.deepEqual([...bytes.slice(80, 84)], [7, 7, 7, 7]);
  assert.equal(imports.clock_time_get(0, 0n, 96), WASI_ERRNO.success);
  assert.equal(view.getBigUint64(96, true), 1000000000n);
  assert.throws(() => imports.proc_exit(5), (error) => {
    assert.equal(error instanceof WASIExit, true);
    assert.equal(error.code, 5);
    return true;
  });
});

test("WASI preview exposes an empty root preopen", async () => {
  const { WASI_ERRNO, createWASIPreviewImports, normalizePreopens } = await loadWASIHelpers();
  const memory = new WebAssembly.Memory({ initial: 1 });
  const instance = { exports: { memory } };
  const imports = createWASIPreviewImports({
    service: { name: "worker" },
    getInstance: () => instance,
    now: () => 1000,
  });
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  const decoder = new TextDecoder();

  assert.deepEqual(normalizePreopens([{ path: "/workspace" }, { fd: 9, path: "/data" }]), [
    { fd: 3, path: "/workspace" },
    { fd: 9, path: "/data" },
  ]);
  assert.equal(imports.fd_prestat_get(3, 0), WASI_ERRNO.success);
  assert.equal(view.getUint8(0), 0);
  assert.equal(view.getUint32(4, true), 1);
  assert.equal(imports.fd_prestat_dir_name(3, 16, 1), WASI_ERRNO.success);
  assert.equal(decoder.decode(bytes.slice(16, 17)), "/");
  assert.equal(imports.fd_prestat_get(4, 0), WASI_ERRNO.badf);

  assert.equal(imports.fd_fdstat_get(3, 32), WASI_ERRNO.success);
  assert.equal(view.getUint8(32), 3);
  assert.equal(imports.fd_filestat_get(3, 64), WASI_ERRNO.success);
  assert.equal(view.getUint8(80), 3);

  bytes.set(new TextEncoder().encode("."), 128);
  assert.equal(imports.path_filestat_get(3, 0, 128, 1, 160), WASI_ERRNO.success);
  assert.equal(view.getUint8(176), 3);
  bytes.set(new TextEncoder().encode("missing.txt"), 192);
  assert.equal(imports.path_filestat_get(3, 0, 192, 11, 224), WASI_ERRNO.noent);
  assert.equal(imports.fd_readdir(3, 256, 64, 0n, 320), WASI_ERRNO.success);
  assert.equal(view.getUint32(320, true), 0);
});

test("WASI preview provides conservative stubs for common unused imports", async () => {
  const { WASI_ERRNO, createWASIPreviewImports } = await loadWASIHelpers();
  const memory = new WebAssembly.Memory({ initial: 1 });
  const instance = { exports: { memory } };
  const imports = createWASIPreviewImports({
    service: { name: "worker" },
    getInstance: () => instance,
  });
  const view = new DataView(memory.buffer);
  const expectedStubs = [
    "fd_advise",
    "fd_allocate",
    "fd_datasync",
    "fd_fdstat_set_rights",
    "fd_filestat_set_size",
    "fd_filestat_set_times",
    "fd_pread",
    "fd_pwrite",
    "fd_renumber",
    "fd_sync",
    "path_create_directory",
    "path_filestat_set_times",
    "path_link",
    "path_remove_directory",
    "path_rename",
    "path_symlink",
    "path_unlink_file",
    "sock_accept",
    "sock_recv",
    "sock_send",
    "sock_shutdown",
  ];

  for (const name of expectedStubs) {
    assert.equal(typeof imports[name], "function", `${name} should be present`);
  }
  assert.equal(imports.fd_advise(1), WASI_ERRNO.success);
  assert.equal(imports.fd_allocate(1), WASI_ERRNO.notsup);
  assert.equal(imports.fd_allocate(99), WASI_ERRNO.badf);
  assert.equal(imports.fd_pread(3, 0, 0, 0n, 32), WASI_ERRNO.notsup);
  assert.equal(view.getUint32(32, true), 0);
  assert.equal(imports.path_open(3), WASI_ERRNO.noent);
  assert.equal(imports.path_open(99), WASI_ERRNO.badf);
  assert.equal(imports.path_create_directory(3), WASI_ERRNO.notsup);
  assert.equal(imports.path_link(3, 0, 0, 0, 3), WASI_ERRNO.notsup);
  assert.equal(imports.path_link(3, 0, 0, 0, 99), WASI_ERRNO.badf);
  assert.equal(imports.sock_recv(), WASI_ERRNO.notsup);
});

test("WASI preview flushes partial stdio lines", async () => {
  const { WASI_ERRNO, createWASIPreviewImports } = await loadWASIHelpers();
  const memory = new WebAssembly.Memory({ initial: 1 });
  const instance = { exports: { memory } };
  const output = [];
  const imports = createWASIPreviewImports({
    service: { name: "worker" },
    getInstance: () => instance,
    log(message, tone) {
      output.push({ message, tone });
    },
  });
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  bytes.set(new TextEncoder().encode("partial"), 32);
  view.setUint32(0, 32, true);
  view.setUint32(4, 7, true);

  assert.equal(imports.fd_write(1, 0, 1, 16), WASI_ERRNO.success);
  assert.deepEqual(output, []);
  imports.__pocketstack_flush();
  assert.deepEqual(output, [{ message: "partial", tone: "" }]);
});
