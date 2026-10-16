#!/usr/bin/env node
import { resolve, chooseFormat, downloadStream, chooseAudio, isCombined, mergeMp4 } from '../src/index.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { convertToMp3 } from '../src/mp3.js';
const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('Usage: hityt VIDEO_ID_OR_URL [--mp4|--m4a|--mp3|--list] [--resolver auto|native|api] [--bitrate 320] [--output filename]');
  process.exit(args.length ? 0 : 1);
}
const get = (flag, fallback) => { const i = args.indexOf(flag); return i < 0 ? fallback : args[i+1]; };
const input = args[0], type = args.includes('--mp3') ? 'mp3' : args.includes('--m4a') ? 'm4a' : 'mp4';
let temp;
try {
  const media = await resolve(input, { resolver: get('--resolver', 'auto') });
  if (args.includes('--list')) { console.table(media.formats.map(({ itag, mimeType, bitrate, qualityLabel, audioQuality, hasAudio, fileSize }) => ({ itag, mimeType, bitrate, qualityLabel, audioQuality, hasAudio, fileSize }))); process.exit(0); }
  const selected = chooseFormat(media.formats, type);
  if (!selected) throw new Error(`No compatible ${type} stream returned by resolver.`);
  const output = get('--output', `${media.id}.${type}`);
  if (type === 'mp3') {
    const audio = media.formats.filter(f => f.mimeType?.startsWith('audio/mp4')).sort((a,b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    const source = audio || media.formats.find(f => isCombined(f) && f.mimeType?.startsWith('video/mp4'));
    if (!source) throw new Error('No AAC/M4A audio stream found for MP3 conversion');
    temp = await mkdtemp(join(tmpdir(), 'hityt-'));
    const audioFile = join(temp, 'input.m4a');
    console.log('Downloading audio...');
    await downloadStream(source.url, audioFile);
    console.log('Converting to MP3 locally...');
    await convertToMp3(audioFile, output, Number(get('--bitrate', '192')));
  } else if (type === 'mp4' && !isCombined(selected)) {
    const audio = chooseAudio(media.formats);
    if (!audio) throw new Error('Selected MP4 is video-only and API returned no audio stream.');
    temp = await mkdtemp(join(tmpdir(), 'hityt-'));
    const videoFile = join(temp, 'video.mp4');
    const audioFile = join(temp, 'audio');
    await downloadStream(selected.url, videoFile);
    await downloadStream(audio.url, audioFile);
    await mergeMp4(videoFile, audioFile, output);
  } else await downloadStream(selected.url, output);
  console.log(`Saved: ${output}`);
} catch (error) { console.error(error.message); if (error.errors) for (const e of error.errors) console.error(' -', e.message); process.exitCode = 1; }
finally { if (temp) await rm(temp, { recursive: true, force: true }); }
