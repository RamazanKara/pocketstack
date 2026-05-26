import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";

test("WASI example writes hello output through fd_write", async () => {
  const bytes = await readFile(new URL("../../examples/wasi/hello.wasm", import.meta.url));
  let instance;
  let output = "";
  const decoder = new TextDecoder();
  const imports = {
    wasi_snapshot_preview1: {
      fd_write(_fd, iovs, iovsLen, nwritten) {
        const view = new DataView(instance.exports.memory.buffer);
        const memory = new Uint8Array(instance.exports.memory.buffer);
        let written = 0;
        for (let index = 0; index < iovsLen; index += 1) {
          const pointer = view.getUint32(iovs + index * 8, true);
          const length = view.getUint32(iovs + index * 8 + 4, true);
          output += decoder.decode(memory.slice(pointer, pointer + length));
          written += length;
        }
        view.setUint32(nwritten, written, true);
        return 0;
      },
    },
  };
  const result = await WebAssembly.instantiate(bytes, imports);
  instance = result.instance;
  instance.exports._start();
  assert.equal(output, "Hello from PocketStack WASI\n");
});
