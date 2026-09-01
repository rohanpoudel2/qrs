import { createQR, renderSVG } from './index.js'
import type { QRCode, QROptions, SVGOptions } from './index.js'
import { renderPNG } from './png.js'
import type { PNGOptions } from './png.js'

export interface RotationWindow {
  step: number
  validFrom: number
  expiresAt: number
}

export interface TokenContext extends RotationWindow {
  signal?: AbortSignal
}

export type TokenProvider = (context: TokenContext) => string | Promise<string>

export interface RotationOptions {
  /** Rotation period in milliseconds. Defaults to 30 seconds. */
  period?: number
  /** Epoch used to align time steps. Defaults to Unix epoch. */
  epoch?: number
  token: TokenProvider
  output?: 'svg' | 'png'
  qr?: QROptions
  svg?: SVGOptions
  png?: PNGOptions
  signal?: AbortSignal
  /** Injectable wall clock for deterministic tests and specialized runtimes. */
  clock?: () => number
  /** Injectable boundary wait. Production code normally uses the default abortable timer. */
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  /** Include nondeterministic millisecond measurements on frames. */
  timings?: boolean
}

interface FrameBase extends RotationWindow {
  token: string
  qr: QRCode
  tokenMs?: number
  renderMs?: number
}

export type RotatingFrame =
  | FrameBase & { output: 'svg', artifact: string }
  | FrameBase & { output: 'png', artifact: Uint8Array }

function positivePeriod(period: number): number {
  if (!Number.isSafeInteger(period) || period < 1_000 || period > 86_400_000)
    throw new RangeError('period must be an integer from 1000 to 86400000 milliseconds')
  return period
}

function timestamp(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative integer timestamp`)
  return value
}

/** Calculate the exact time step containing a timestamp. */
export function rotationWindow(time: number, options: { period?: number, epoch?: number } = {}): RotationWindow {
  const period = positivePeriod(options.period ?? 30_000)
  const epoch = timestamp('epoch', options.epoch ?? 0)
  time = timestamp('time', time)
  if (time < epoch) throw new RangeError('time must not be before epoch')
  const step = Math.floor((time - epoch) / period)
  if (!Number.isSafeInteger(step)) throw new RangeError('rotation step exceeds safe integer range')
  const validFrom = epoch + step * period
  return { step, validFrom, expiresAt: validFrom + period }
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now()
}

function elapsed(started: number): number {
  return Math.round((now() - started) * 1000) / 1000
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
}

function defaultWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    const abort = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function wasAborted(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Fetch the server token and render one frame for an exact timestamp. */
export async function frameAt(options: RotationOptions, time = (options.clock ?? Date.now)()): Promise<RotatingFrame> {
  const window = rotationWindow(time, options)
  if (options.signal?.aborted) throw abortError()
  const output = options.output ?? 'svg'
  if (output !== 'svg' && output !== 'png') throw new RangeError('output must be svg or png')

  const tokenStarted = now()
  const token = await options.token({ ...window, signal: options.signal })
  const tokenMs = elapsed(tokenStarted)
  if (options.signal?.aborted) throw abortError()
  if (typeof token !== 'string' || token.length === 0)
    throw new TypeError('token provider must return a non-empty string')

  const renderStarted = now()
  const qr = createQR(token, options.qr)
  if (output === 'svg') {
    const frame: RotatingFrame = {
      ...window,
      token,
      qr,
      output,
      artifact: renderSVG(qr, options.svg),
      ...(options.timings ? { tokenMs, renderMs: elapsed(renderStarted) } : {}),
    }
    return frame
  }
  if (output === 'png') {
    const frame: RotatingFrame = {
      ...window,
      token,
      qr,
      output,
      artifact: renderPNG(qr, options.png),
      ...(options.timings ? { tokenMs, renderMs: elapsed(renderStarted) } : {}),
    }
    return frame
  }
  throw new Error('Unreachable output')
}

/** Yield one frame per exact time boundary without accumulating interval drift. */
export async function* rotateQR(options: RotationOptions): AsyncGenerator<RotatingFrame, void, void> {
  const period = positivePeriod(options.period ?? 30_000)
  const epoch = timestamp('epoch', options.epoch ?? 0)
  const clock = options.clock ?? Date.now
  const wait = options.wait ?? defaultWait
  let lastStep = -1

  while (!options.signal?.aborted) {
    const current = rotationWindow(clock(), { period, epoch })
    if (current.step <= lastStep) {
      const nextBoundary = epoch + (lastStep + 1) * period
      try {
        await wait(Math.max(0, nextBoundary - clock()), options.signal)
      }
      catch (error) {
        if (wasAborted(error) || options.signal?.aborted) return
        throw error
      }
      continue
    }

    const frame = await frameAt({ ...options, period, epoch, clock }, current.validFrom)
    if (options.signal?.aborted) return
    // A slow token provider must not flash a credential whose window already ended.
    if (clock() >= frame.expiresAt) continue
    lastStep = frame.step
    yield frame

    if (options.signal?.aborted) return
    try {
      await wait(Math.max(0, frame.expiresAt - clock()), options.signal)
    }
    catch (error) {
      if (wasAborted(error) || options.signal?.aborted) return
      throw error
    }
  }
}
