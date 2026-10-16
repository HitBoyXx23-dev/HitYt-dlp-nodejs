import { readFile, writeFile } from 'node:fs/promises';

export function pcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    out[i] = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
  }
  return out;
}

export async function convertToMp3(source, destination, bitrate = 192) {
  if (!Number.isInteger(bitrate) || bitrate < 32 || bitrate > 320) throw new Error('MP3 bitrate must be between 32 and 320');
  const [{ default: decode }, lameModule] = await Promise.all([
    import('@audio/decode-aac'), import('lamejs')
  ]);
  const lame = lameModule.default || lameModule;
  const { channelData, sampleRate } = await decode(new Uint8Array(await readFile(source)));
  if (!channelData?.length || !channelData[0]?.length) throw new Error('M4A contained no decoded audio');
  if (channelData.length > 2) throw new Error('Only mono and stereo audio supported');
  const left = pcm16(channelData[0]);
  const right = channelData.length === 2 ? pcm16(channelData[1]) : null;
  const encoder = new lame.Mp3Encoder(right ? 2 : 1, sampleRate, bitrate);
  const chunks = [];
  for (let i = 0; i < left.length; i += 1152) {
    const part = right ? encoder.encodeBuffer(left.subarray(i, i + 1152), right.subarray(i, i + 1152)) : encoder.encodeBuffer(left.subarray(i, i + 1152));
    if (part.length) chunks.push(Buffer.from(part));
  }
  const last = encoder.flush();
  if (last.length) chunks.push(Buffer.from(last));
  if (!chunks.length) throw new Error('MP3 encoder returned no output');
  await writeFile(destination, Buffer.concat(chunks));
  return destination;
}
