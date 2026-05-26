const WASI_ERRNO = {
  success: 0,
  badf: 8,
  inval: 28,
  noent: 44,
  nosys: 52,
  notsup: 58,
};

const WASI_FILETYPE = {
  unknown: 0,
  characterDevice: 2,
  directory: 3,
};

const WASI_RIGHTS_STDIO = 0x40n | 0x80n | 0x10000000000000n;
const WASI_RIGHTS_PREOPEN = 0x1fffffffn;

class WASIExit extends Error {
  constructor(code) {
    super(`WASI process exited with code ${code}`);
    this.name = "WASIExit";
    this.code = code;
  }
}

function normalizeEnvironment(env = {}) {
  if (Array.isArray(env)) return env.map(String).sort();
  if (typeof env === "string") {
    return env.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).sort();
  }
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .sort();
}

function normalizeEnvironmentRecord(env = {}) {
  const record = {};
  for (const item of normalizeEnvironment(env)) {
    const index = item.indexOf("=");
    if (index <= 0) continue;
    record[item.slice(0, index)] = item.slice(index + 1);
  }
  return record;
}

function encodedSize(values, encoder) {
  return values.reduce((size, value) => size + encoder.encode(value).length + 1, 0);
}

function createWASIImportObject(imports, envImports = {}) {
  return {
    wasi_snapshot_preview1: imports,
    wasi_unstable: imports,
    env: envImports,
  };
}

function wasmerRunOptions(service = {}, args = [], env = {}) {
  return {
    program: service.name || "pocketstack-wasi",
    args,
    env: normalizeEnvironmentRecord(env),
  };
}

function createWASIPreviewImports(options) {
  const service = options.service || {};
  const argv = [service.name || "pocketstack-wasi", ...(options.args || [])];
  const environ = normalizeEnvironment(options.env);
  const preopens = normalizePreopens(options.preopens);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const log = options.log || (() => {});
  const now = options.now || (() => Date.now());
  const randomBytes = options.randomBytes || ((target) => crypto.getRandomValues(target));
  const stdioBuffers = new Map();

  function memory() {
    const instance = options.getInstance();
    return instance?.exports?.memory;
  }

  function view() {
    const current = memory();
    if (!current) throw new Error("WASI module does not export memory");
    return new DataView(current.buffer);
  }

  function bytes() {
    const current = memory();
    if (!current) throw new Error("WASI module does not export memory");
    return new Uint8Array(current.buffer);
  }

  function writeCString(offset, value) {
    bytes().set(encoder.encode(`${value}\0`), offset);
  }

  function writeStringArray(values, pointers, buffer) {
    const currentView = view();
    let offset = buffer;
    values.forEach((value, index) => {
      currentView.setUint32(pointers + index * 4, offset, true);
      writeCString(offset, value);
      offset += encoder.encode(value).length + 1;
    });
  }

  function isStdio(fd) {
    return fd === 0 || fd === 1 || fd === 2;
  }

  function preopenFor(fd) {
    return preopens.find((preopen) => preopen.fd === fd) || null;
  }

  function fdExists(fd) {
    return isStdio(fd) || Boolean(preopenFor(fd));
  }

  function fdNoop(fd) {
    return fdExists(fd) ? WASI_ERRNO.success : WASI_ERRNO.badf;
  }

  function fdUnsupported(fd) {
    return fdExists(fd) ? WASI_ERRNO.notsup : WASI_ERRNO.badf;
  }

  function preopenUnsupported(fd) {
    return preopenFor(fd) ? WASI_ERRNO.notsup : WASI_ERRNO.badf;
  }

  function emitOutput(fd, chunk, flush = false) {
    const previous = stdioBuffers.get(fd) || "";
    const combined = previous + chunk;
    const lines = combined.split(/\n/);
    const pending = lines.pop() || "";
    for (const line of lines) {
      if (line !== "") log(line, fd === 2 ? "stderr" : "");
    }
    if (flush && pending !== "") {
      log(pending, fd === 2 ? "stderr" : "");
    }
    stdioBuffers.set(fd, flush ? "" : pending);
  }

  function flushOutput() {
    for (const [fd, pending] of stdioBuffers) {
      if (pending) log(pending, fd === 2 ? "stderr" : "");
      stdioBuffers.set(fd, "");
    }
  }

  function writeFdStat(fd, pointer) {
    const currentView = view();
    const preopen = preopenFor(fd);
    if (!isStdio(fd) && !preopen) return WASI_ERRNO.badf;
    currentView.setUint8(pointer, preopen ? WASI_FILETYPE.directory : WASI_FILETYPE.characterDevice);
    currentView.setUint16(pointer + 2, 0, true);
    currentView.setBigUint64(pointer + 8, preopen ? WASI_RIGHTS_PREOPEN : WASI_RIGHTS_STDIO, true);
    currentView.setBigUint64(pointer + 16, preopen ? WASI_RIGHTS_PREOPEN : WASI_RIGHTS_STDIO, true);
    return WASI_ERRNO.success;
  }

  function writeFileStat(pointer, filetype) {
    const currentView = view();
    currentView.setBigUint64(pointer, 0n, true);
    currentView.setBigUint64(pointer + 8, 0n, true);
    currentView.setUint8(pointer + 16, filetype);
    currentView.setBigUint64(pointer + 24, 0n, true);
    currentView.setBigUint64(pointer + 32, BigInt(now()) * 1000000n, true);
    currentView.setBigUint64(pointer + 40, BigInt(now()) * 1000000n, true);
    currentView.setBigUint64(pointer + 48, BigInt(now()) * 1000000n, true);
  }

  function readPath(pointer, length) {
    return decoder.decode(bytes().slice(pointer, pointer + length));
  }

  function isRootPath(path) {
    return path === "" || path === "." || path === "/";
  }

  return {
    __pocketstack_flush: flushOutput,
    args_sizes_get(argc, argvBufSize) {
      const currentView = view();
      currentView.setUint32(argc, argv.length, true);
      currentView.setUint32(argvBufSize, encodedSize(argv, encoder), true);
      return WASI_ERRNO.success;
    },
    args_get(argvPointer, argvBuffer) {
      writeStringArray(argv, argvPointer, argvBuffer);
      return WASI_ERRNO.success;
    },
    environ_sizes_get(environCount, environBufSize) {
      const currentView = view();
      currentView.setUint32(environCount, environ.length, true);
      currentView.setUint32(environBufSize, encodedSize(environ, encoder), true);
      return WASI_ERRNO.success;
    },
    environ_get(environPointer, environBuffer) {
      writeStringArray(environ, environPointer, environBuffer);
      return WASI_ERRNO.success;
    },
    fd_write(fd, iovs, iovsLen, nwritten) {
      try {
        if (fd !== 1 && fd !== 2) return WASI_ERRNO.badf;
        const currentView = view();
        const currentBytes = bytes();
        let written = 0;
        let output = "";
        for (let index = 0; index < iovsLen; index += 1) {
          const pointer = currentView.getUint32(iovs + index * 8, true);
          const length = currentView.getUint32(iovs + index * 8 + 4, true);
          output += decoder.decode(currentBytes.slice(pointer, pointer + length));
          written += length;
        }
        currentView.setUint32(nwritten, written, true);
        emitOutput(fd, output);
        return WASI_ERRNO.success;
      } catch (error) {
        log(error.message, "wasi");
        return WASI_ERRNO.inval;
      }
    },
    fd_read(fd, _iovs, _iovsLen, nread) {
      if (fd !== 0) return WASI_ERRNO.badf;
      view().setUint32(nread, 0, true);
      return WASI_ERRNO.success;
    },
    fd_close(fd) {
      return fdNoop(fd);
    },
    fd_advise: fdNoop,
    fd_allocate: fdUnsupported,
    fd_datasync: fdNoop,
    fd_sync: fdNoop,
    fd_fdstat_set_rights: fdNoop,
    fd_filestat_set_size: fdUnsupported,
    fd_filestat_set_times: fdUnsupported,
    fd_pread(fd, _iovs, _iovsLen, _offset, nread) {
      if (!fdExists(fd)) return WASI_ERRNO.badf;
      view().setUint32(nread, 0, true);
      return WASI_ERRNO.notsup;
    },
    fd_pwrite(fd, _iovs, _iovsLen, _offset, nwritten) {
      if (!fdExists(fd)) return WASI_ERRNO.badf;
      view().setUint32(nwritten, 0, true);
      return WASI_ERRNO.notsup;
    },
    fd_renumber(fromFd, toFd) {
      if (!fdExists(fromFd) || !fdExists(toFd)) return WASI_ERRNO.badf;
      return WASI_ERRNO.notsup;
    },
    fd_fdstat_get: writeFdStat,
    fd_fdstat_set_flags(fd) {
      return fdNoop(fd);
    },
    fd_filestat_get(fd, pointer) {
      const preopen = preopenFor(fd);
      if (!isStdio(fd) && !preopen) return WASI_ERRNO.badf;
      writeFileStat(pointer, preopen ? WASI_FILETYPE.directory : WASI_FILETYPE.characterDevice);
      return WASI_ERRNO.success;
    },
    fd_prestat_get(fd, pointer) {
      const preopen = preopenFor(fd);
      if (!preopen) return WASI_ERRNO.badf;
      const currentView = view();
      currentView.setUint8(pointer, 0);
      currentView.setUint32(pointer + 4, encoder.encode(preopen.path).length, true);
      return WASI_ERRNO.success;
    },
    fd_prestat_dir_name(fd, pointer, length) {
      const preopen = preopenFor(fd);
      if (!preopen) return WASI_ERRNO.badf;
      const encoded = encoder.encode(preopen.path);
      bytes().set(encoded.slice(0, length), pointer);
      return WASI_ERRNO.success;
    },
    fd_seek(fd, _offset, _whence, newOffset) {
      if (!isStdio(fd)) return WASI_ERRNO.badf;
      view().setBigUint64(newOffset, 0n, true);
      return WASI_ERRNO.success;
    },
    fd_tell(fd, offset) {
      if (!isStdio(fd)) return WASI_ERRNO.badf;
      view().setBigUint64(offset, 0n, true);
      return WASI_ERRNO.success;
    },
    path_create_directory: preopenUnsupported,
    path_open(fd) {
      if (!preopenFor(fd)) return WASI_ERRNO.badf;
      return WASI_ERRNO.noent;
    },
    path_filestat_get(fd, _flags, pathPointer, pathLength, resultPointer) {
      if (!preopenFor(fd)) return WASI_ERRNO.badf;
      if (!isRootPath(readPath(pathPointer, pathLength))) return WASI_ERRNO.noent;
      writeFileStat(resultPointer, WASI_FILETYPE.directory);
      return WASI_ERRNO.success;
    },
    path_filestat_set_times: preopenUnsupported,
    path_link(oldFd, _oldFlags, _oldPath, _oldPathLength, newFd) {
      if (!preopenFor(oldFd) || !preopenFor(newFd)) return WASI_ERRNO.badf;
      return WASI_ERRNO.notsup;
    },
    fd_readdir(fd, _buffer, _bufferLength, _cookie, bufferUsed) {
      if (!preopenFor(fd)) return WASI_ERRNO.badf;
      view().setUint32(bufferUsed, 0, true);
      return WASI_ERRNO.success;
    },
    path_readlink(fd) {
      if (!preopenFor(fd)) return WASI_ERRNO.badf;
      return WASI_ERRNO.noent;
    },
    path_remove_directory: preopenUnsupported,
    path_rename(oldFd, _oldPath, _oldPathLength, newFd) {
      if (!preopenFor(oldFd) || !preopenFor(newFd)) return WASI_ERRNO.badf;
      return WASI_ERRNO.notsup;
    },
    path_symlink(_oldPath, _oldPathLength, fd) {
      return preopenUnsupported(fd);
    },
    path_unlink_file: preopenUnsupported,
    random_get(pointer, length) {
      randomBytes(bytes().subarray(pointer, pointer + length));
      return WASI_ERRNO.success;
    },
    clock_res_get(_clockId, resolution) {
      view().setBigUint64(resolution, 1000000n, true);
      return WASI_ERRNO.success;
    },
    clock_time_get(_clockId, _precision, timestamp) {
      view().setBigUint64(timestamp, BigInt(now()) * 1000000n, true);
      return WASI_ERRNO.success;
    },
    poll_oneoff(_in, _out, _nsubscriptions, nevents) {
      view().setUint32(nevents, 0, true);
      return WASI_ERRNO.success;
    },
    sched_yield() {
      return WASI_ERRNO.success;
    },
    sock_accept() {
      return WASI_ERRNO.notsup;
    },
    sock_recv() {
      return WASI_ERRNO.notsup;
    },
    sock_send() {
      return WASI_ERRNO.notsup;
    },
    sock_shutdown() {
      return WASI_ERRNO.notsup;
    },
    proc_exit(code) {
      flushOutput();
      throw new WASIExit(code);
    },
  };
}

function normalizePreopens(preopens = [{ fd: 3, path: "/" }]) {
  if (!Array.isArray(preopens)) return [];
  return preopens
    .map((preopen, index) => ({
      fd: Number.isInteger(preopen?.fd) ? preopen.fd : index + 3,
      path: String(preopen?.path || "/"),
    }))
    .filter((preopen) => preopen.fd >= 3 && preopen.path);
}

export {
  WASI_ERRNO,
  WASIExit,
  createWASIImportObject,
  createWASIPreviewImports,
  normalizeEnvironment,
  normalizeEnvironmentRecord,
  normalizePreopens,
  wasmerRunOptions,
};
