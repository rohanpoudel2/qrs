import assert from 'node:assert/strict'
import { test } from 'node:test'
import { frameAt, rotateQR, rotationWindow } from '../dist/rotate.js'
import { scanPNG } from '../dist/scan.js'

test('rotation windows align exactly without 32-bit time truncation', () => {
  assert.deepEqual(rotationWindow(59_999, { period: 30_000 }), {
    step: 1,
    validFrom: 30_000,
    expiresAt: 60_000,
  })
  assert.deepEqual(rotationWindow(60_000, { period: 30_000 }), {
    step: 2,
    validFrom: 60_000,
    expiresAt: 90_000,
  })
  assert.equal(rotationWindow(Date.UTC(2040, 0, 1), { period: 30_000 }).validFrom > 2 ** 31, true)
  assert.throws(() => rotationWindow(999, { epoch: 1_000 }), /before epoch/)
  assert.throws(() => rotationWindow(1_000, { period: 500 }), /period/)
})

test('frameAt renders a server-provided token without owning signing keys', async () => {
  let context
  const frame = await frameAt({
    period: 30_000,
    output: 'png',
    token(input) {
      context = input
      return `server-signed:${input.step}`
    },
  }, 60_001)

  assert.equal(context.step, 2)
  assert.equal(frame.token, 'server-signed:2')
  assert.equal(frame.validFrom, 60_000)
  assert.equal(frame.expiresAt, 90_000)
  assert.equal(frame.output, 'png')
  assert.ok(frame.artifact instanceof Uint8Array)
  assert.equal((await scanPNG(frame.artifact, { expected: frame.token })).ok, true)
})

test('rotateQR corrects timer drift and clock rollback without duplicate steps', async () => {
  let time = 59_900
  const waits = []
  const iterator = rotateQR({
    period: 1_000,
    clock: () => time,
    wait: async (milliseconds) => {
      waits.push(milliseconds)
      time += milliseconds
    },
    token: ({ step }) => `token:${step}`,
  })

  const first = await iterator.next()
  assert.equal(first.value.step, 59)
  assert.match(first.value.artifact, /^<svg/)
  const second = await iterator.next()
  assert.equal(second.value.step, 60)
  assert.deepEqual(waits, [100])

  time = 59_000 // Simulate a wall-clock rollback after step 60 was shown.
  const third = await iterator.next()
  assert.equal(third.value.step, 61)
  assert.deepEqual(waits, [100, 2_000])
  await iterator.return()
})

test('rotateQR discards a token that arrives after its boundary', async () => {
  let time = 10_100
  let calls = 0
  const iterator = rotateQR({
    period: 1_000,
    clock: () => time,
    wait: async milliseconds => time += milliseconds,
    async token({ step }) {
      calls++
      if (calls === 1) time += 1_000
      return `token:${step}`
    },
  })

  const frame = await iterator.next()
  assert.equal(calls, 2)
  assert.equal(frame.value.step, 11)
  assert.equal(frame.value.token, 'token:11')
  await iterator.return()
})

test('rotateQR stops cleanly when aborted', async () => {
  const controller = new AbortController()
  const iterator = rotateQR({
    period: 86_400_000,
    signal: controller.signal,
    token: ({ step }) => `token:${step}`,
  })
  const first = await iterator.next()
  assert.equal(first.done, false)
  const pending = iterator.next()
  setTimeout(() => controller.abort(), 0)
  const stopped = await pending
  assert.equal(stopped.done, true)
})
