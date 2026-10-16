import test from 'node:test';
import assert from 'node:assert/strict';
import { pcm16 } from '../src/mp3.js';
test('PCM samples are clamped to signed 16 bit', () => {
  assert.deepEqual(Array.from(pcm16(new Float32Array([-2,-1,0,1,2]))), [-32768,-32768,0,32767,32767]);
});
