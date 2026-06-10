// Web Worker: runs the engraving compute off the main thread and returns packed
// stroke geometry via Transferable buffers (so the UI stays responsive).

import { engrave, EngraveInput } from './engrave'
import { StructureParams } from '../types'

interface RequestMsg {
  id: number
  img: EngraveInput
  params: StructureParams
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<RequestMsg>) => void) | null
  postMessage: (msg: unknown, transfer?: Transferable[]) => void
}

ctx.onmessage = (e) => {
  const { id, img, params } = e.data
  const result = engrave(img, params)

  // Pack all strokes into flat buffers: coords (x,y interleaved), widths, and lengths.
  let total = 0
  for (const s of result.strokes) total += s.x.length
  const coords = new Float32Array(total * 2)
  const widths = new Float32Array(total)
  const lengths = new Uint32Array(result.strokes.length)
  let o = 0
  for (let si = 0; si < result.strokes.length; si++) {
    const s = result.strokes[si]
    lengths[si] = s.x.length
    for (let i = 0; i < s.x.length; i++) {
      coords[o * 2] = s.x[i]
      coords[o * 2 + 1] = s.y[i]
      widths[o] = s.w[i]
      o++
    }
  }

  ctx.postMessage(
    { id, w: result.w, h: result.h, coords, widths, lengths },
    [coords.buffer, widths.buffer, lengths.buffer],
  )
}
