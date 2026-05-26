(module
  (type $fd_write_t (func (param i32 i32 i32 i32) (result i32)))
  (import "wasi_snapshot_preview1" "fd_write" (func $fd_write (type $fd_write_t)))
  (memory (export "memory") 1)
  (data (i32.const 0) "\08\00\00\00\1c\00\00\00")
  (data (i32.const 8) "Hello from PocketStack WASI\0a")
  (func (export "_start")
    (drop (call $fd_write
      (i32.const 1)
      (i32.const 0)
      (i32.const 1)
      (i32.const 4)))))
