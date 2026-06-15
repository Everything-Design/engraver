// Web Worker: runs the engraving compute off the main thread and returns packed stroke
// geometry via Transferable buffers (so the UI stays responsive).
//
// The source pixels are sent ONCE (transferred) and cached here with their structure-tensor
// field (Q17). Subsequent 'params' messages re-place streamlines against the cache. Jobs are
// processed in an async loop that yields between passes; a superseding message updates
// `latestId`, so the in-flight job's cancel check abandons it cooperatively — no
// terminate/respawn, so the cache survives (Q18).

import { CancelledError, WorkerRequest, WorkerResponse } from '../types'
import type { EngraveTimings } from '../types'
import { engrave, makeCache, EngraveCache } from './engrave'
import type { Stroke } from './streamlines'

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null
  postMessage: (msg: WorkerResponse, transfer?: Transferable[]) => void
}

let cache: EngraveCache | null = null
let latestId = 0
let pending: { id: number; params: WorkerRequest['params'] } | null = null
let running = false

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

ctx.onmessage = (e) => {
  const msg = e.data
  latestId = msg.id
  if (msg.kind === 'source') {
    cache = makeCache(msg.img) // takes ownership of the transferred buffer
  }
  pending = { id: msg.id, params: msg.params }
  if (!running) void run()
}

async function run() {
  running = true
  try {
    while (pending) {
      const job = pending
      pending = null
      const c = cache
      if (!c) {
        post({ kind: 'error', id: job.id, message: 'No image loaded in worker.' })
        continue
      }
      try {
        const result = await engrave(c, job.params, {
          cancel: () => job.id !== latestId,
          yieldPass: tick,
        })
        if (job.id !== latestId) continue // superseded while finishing
        post(packResult(job.id, result.w, result.h, result.strokes, result.timings), true)
      } catch (err) {
        if (err instanceof CancelledError) continue
        post({
          kind: 'error',
          id: job.id,
          message: err instanceof Error ? err.message : 'Engrave failed.',
        })
      }
    }
  } finally {
    running = false
  }
}

function post(msg: WorkerResponse, transfer = false) {
  if (transfer && msg.kind === 'result') {
    ctx.postMessage(msg, [msg.coords.buffer, msg.widths.buffer, msg.lengths.buffer])
  } else {
    ctx.postMessage(msg)
  }
}

// Pack all strokes into flat buffers: coords (x,y interleaved), widths, and lengths.
function packResult(
  id: number,
  w: number,
  h: number,
  strokes: Stroke[],
  timings: EngraveTimings,
): Extract<WorkerResponse, { kind: 'result' }> {
  let total = 0
  for (const s of strokes) total += s.x.length
  const coords = new Float32Array(total * 2)
  const widths = new Float32Array(total)
  const lengths = new Uint32Array(strokes.length)
  let o = 0
  for (let si = 0; si < strokes.length; si++) {
    const s = strokes[si]
    lengths[si] = s.x.length
    for (let i = 0; i < s.x.length; i++) {
      coords[o * 2] = s.x[i]
      coords[o * 2 + 1] = s.y[i]
      widths[o] = s.w[i]
      o++
    }
  }
  return { kind: 'result', id, w, h, coords, widths, lengths, timings }
}
