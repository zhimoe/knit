## Minimal repro for docs/03 §7.1.
##
##   nim c -r --path:../nimi/src --threads:on --mm:refc     scripts/repro-nimi-ipc.nim  # stable
##   nim c -r --path:../nimi/src --threads:on --mm:atomicArc scripts/repro-nimi-ipc.nim  # SIGSEGV in minutes
##
## A single background method is called every 300 ms. Under ARC/ORC/atomicArc
## the heap is corrupted in Nimi's IPC completion path; under refc it is stable.
## This file is a probe only; it is not part of knit.

import nimi

proc pingWork(args: string, context: IpcCallContext): string =
  {.cast(gcsafe).}:
    result = "{\"ok\":true,\"data\":{\"n\":1}}"

when isMainModule:
  bindBackgroundService("Repro", [
    backgroundMethod("ping", pingWork,
      params = [ParamDef(name: "args", typ: "string")],
      resultType = "string", timeoutMs = 5_000)])
  app.whenReady(proc() =
    discard newWindow(WindowOptions(
      title: "nimi ipc repro",
      width: 520, height: 360,
      html: """<html><body><script>
        let n = 0;
        setInterval(async () => {
          n += 1;
          try { await window.nimi.call('Repro.ping', '{}'); }
          catch (e) { console.log('error', e); }
        }, 300);
      </script></body></html>"""))
  )
  app.run()
