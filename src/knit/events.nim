## Host → page event channel (docs/03 §3.3).
##
## Hard thread-safety rule under `--mm:refc --threads:on`:
## Worker threads MUST NOT store GC-managed strings/seqs in global variables or
## call `postMain` (which mutates a GC-managed Deque in nimi's loop.nim).
## Instead, worker threads append raw UTF-8 bytes into an `allocShared`-backed
## ring buffer protected by a lock; the UI main thread drains and materializes
## fresh Nim strings on its own GC heap.

import std/[json, locks]

import nimi

type
  EventSink* = proc(name, payload: string) {.closure, gcsafe.}

  SharedEvent = object
    namePtr: ptr UncheckedArray[char]
    nameLen: int
    payloadPtr: ptr UncheckedArray[char]
    payloadLen: int

const MaxQueuedEvents = 2048

var
  eventLock: Lock
  sinkLock: Lock
  sink: EventSink
  sinkReady = false
  ring: array[MaxQueuedEvents, SharedEvent]
  ringHead = 0
  ringCount = 0

initLock(eventLock)
initLock(sinkLock)

proc freeSharedEvent(ev: var SharedEvent) =
  if ev.namePtr != nil:
    deallocShared(ev.namePtr)
    ev.namePtr = nil
  ev.nameLen = 0
  if ev.payloadPtr != nil:
    deallocShared(ev.payloadPtr)
    ev.payloadPtr = nil
  ev.payloadLen = 0

proc copyToShared(s: string): (ptr UncheckedArray[char], int) =
  if s.len == 0:
    return (nil, 0)
  let buf = cast[ptr UncheckedArray[char]](allocShared(s.len))
  copyMem(buf, unsafeAddr s[0], s.len)
  (buf, s.len)

proc copyFromShared(p: ptr UncheckedArray[char], n: int): string =
  if p == nil or n <= 0:
    return ""
  result = newString(n)
  copyMem(addr result[0], p, n)

proc setEventSink*(fn: EventSink) =
  ## Called once on the UI thread before the window opens.
  acquire(sinkLock)
  sink = fn
  sinkReady = true
  release(sinkLock)

proc takeQueuedEvents*(): seq[(string, string)] =
  ## Main thread only. Materializes all queued shared-memory events onto the
  ## caller's GC heap and frees the shared buffers.
  acquire(eventLock)
  let count = ringCount
  result = newSeqOfCap[(string, string)](count)
  for i in 0 ..< count:
    let idx = (ringHead + i) mod MaxQueuedEvents
    result.add (
      copyFromShared(ring[idx].namePtr, ring[idx].nameLen),
      copyFromShared(ring[idx].payloadPtr, ring[idx].payloadLen),
    )
    freeSharedEvent(ring[idx])
  ringHead = 0
  ringCount = 0
  release(eventLock)

proc drainEvents*() =
  ## Main thread only. Delivers any queued events through the registered sink.
  let items = takeQueuedEvents()
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

proc drainEventsJson*(): string =
  ## Main thread only. Returns queued events as a JSON array string for Shell.pollEvents.
  let items = takeQueuedEvents()
  if items.len == 0:
    return "[]"
  var arr = newJArray()
  for (name, payload) in items:
    arr.add %*{"name": name, "payload": payload}
  $arr

proc emitEvent*(name: string, payload: JsonNode) =
  let encoded = $payload
  # Fast path on the UI main thread (e.g. file watcher `repo:changed`): deliver
  # immediately without queuing.
  var deliveredDirect = false
  {.cast(gcsafe).}:
    if isMainThread():
      acquire(sinkLock)
      let fn = sink
      let ready = sinkReady
      release(sinkLock)
      if ready and fn != nil:
        try:
          fn(name, encoded)
          deliveredDirect = true
        except CatchableError:
          discard
  if deliveredDirect:
    return

  # Worker threads: only touch `allocShared` memory, never main-thread GC.
  let (np, nl) = copyToShared(name)
  let (pp, pl) = copyToShared(encoded)
  acquire(eventLock)
  if ringCount == MaxQueuedEvents:
    freeSharedEvent(ring[ringHead])
    ringHead = (ringHead + 1) mod MaxQueuedEvents
    dec ringCount
  let idx = (ringHead + ringCount) mod MaxQueuedEvents
  ring[idx] = SharedEvent(namePtr: np, nameLen: nl, payloadPtr: pp, payloadLen: pl)
  inc ringCount
  release(eventLock)
