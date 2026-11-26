## Host → page event channel (docs/03 §3.3).
##
## nimi has no streaming IPC yet, so every event becomes one
## `window.knitEvent(name, payloadJson)` eval. Workers must not hand a closure
## carrying GC-managed strings to another thread (Nim's RC is not designed for
## that); instead they append plain strings to a locked queue and wake the UI
## thread with a *non-capturing* drain proc. The eval itself runs on main.

import std/[json, locks]

import nimi

type EventSink* = proc(name, payload: string) {.closure, gcsafe.}

var
  eventLock: Lock
  sinkLock: Lock
  sink: EventSink
  sinkReady = false
  queue: seq[(string, string)]

initLock(eventLock)
initLock(sinkLock)

proc setEventSink*(fn: EventSink) =
  ## Called once on the UI thread before the window opens.
  acquire(sinkLock)
  sink = fn
  sinkReady = true
  release(sinkLock)

proc drainEvents() =
  var items: seq[(string, string)]
  acquire(eventLock)
  items = queue
  queue.setLen(0)
  release(eventLock)
  if items.len == 0:
    return
  acquire(sinkLock)
  let fn = sink
  let ready = sinkReady
  release(sinkLock)
  if not ready or fn == nil:
    return
  {.cast(gcsafe).}:
    for (name, payload) in items:
      try:
        fn(name, payload)
      except CatchableError:
        discard

proc emitEvent*(name: string, payload: JsonNode) =
  let encoded = $payload
  acquire(eventLock)
  queue.add (name, encoded)
  if queue.len > 2000:
    # A page that never drains must not grow the host without bound.
    queue = queue[^2000 .. ^1]
  release(eventLock)
  {.cast(gcsafe).}:
    discard postMain(drainEvents)
