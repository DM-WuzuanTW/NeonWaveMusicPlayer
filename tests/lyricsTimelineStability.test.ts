import assert from 'node:assert/strict'
import test from 'node:test'
import { stabilizeInterludeGaps } from '../src/utils/lyricsTimelineStability.ts'

const lines = (times: number[]) => times.map(time => ({ time }))

test('leaves ordinary calibrated line spacing unchanged', () => {
    const result = stabilizeInterludeGaps(lines([0, 3, 6, 9]), [0.2, 3.1, 6.3, 9.2])
    assert.deepEqual(result.times, [0.2, 3.1, 6.3, 9.2])
    assert.equal(result.protectedGaps, 0)
})

test('allows a moderately shortened instrumental break', () => {
    const result = stabilizeInterludeGaps(lines([0, 3, 6, 21, 24]), [0, 3, 6, 18, 21])
    assert.deepEqual(result.times, [0, 3, 6, 18, 21])
    assert.equal(result.protectedGaps, 0)
})

test('prevents an instrumental break from collapsing and shifts the suffix together', () => {
    const result = stabilizeInterludeGaps(lines([0, 3, 6, 21, 24]), [0, 3, 6, 8, 11])
    assert.equal(result.protectedGaps, 1)
    assert.ok(Math.abs(result.times[3] - 16.8) < 0.001)
    assert.ok(Math.abs(result.times[4] - 19.8) < 0.001)
})

test('keeps the calibrated timeline monotonic when recognition regresses', () => {
    const result = stabilizeInterludeGaps(lines([0, 3, 6, 9]), [0, 3, 2.5, 5.5])
    assert.ok(result.times[2] > result.times[1])
    assert.ok(result.times[3] > result.times[2])
})
