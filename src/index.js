import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';

export function videoId(input) {
  if (/^[\w-]{11}$/.test(input)) return input;
  const url = new URL(input);
  const id = url.hostname === 'youtu.be' ? url.pathname.slice(1).split('/')[0] : url.searchParams.get('v') || (url.pathname.match(/\/(?:shorts|live|embed)\/([\w-]{11})/) || [])[1];
  if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Invalid YouTube video ID or URL');
  return id;
}
function extractPlayerResponse(html) {
  const marker = /ytInitialPlayerResponse\s*=\s*/g;
  let match;
  while ((match = marker.exec(html))) {
    const start = html.indexOf('{', marker.lastIndex);
    if (start < 0) continue;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error('Player response not found');
}
function normalize(format) {
  let url = format.url;
  if (!url && format.signatureCipher) {
    const params = new URLSearchParams(format.signatureCipher);
    url = params.get('url');
    if (url && params.get('sig')) { const u = new URL(url); u.searchParams.set(params.get('sp') || 'signature', params.get('sig')); url = u.toString(); }
    else if (params.get('s')) url = null; // Requires signature deciphering.
  }
  return url ? { itag: format.itag, url, mimeType: format.mimeType || '', bitrate: format.bitrate || 0, qualityLabel: format.qualityLabel || '', audioQuality: format.audioQuality || '', contentLength: format.contentLength || null } : null;
}
export async function resolveNative(input) {
  const id = videoId(input);
  const response = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.9' } });
  if (!response.ok) throw new Error(`YouTube HTTP ${response.status}`);
  const player = extractPlayerResponse(await response.text());
  const formats = [...(player.streamingData?.formats || []), ...(player.streamingData?.adaptiveFormats || [])].map(normalize).filter(Boolean);
  if (!formats.length) throw new Error(player.playabilityStatus?.reason || 'No directly usable streams');
  return { id, title: player.videoDetails?.title || id, formats, engine: 'native' };
}
export async function resolveApi(input) {
  const id = videoId(input);
  const response = await fetch('https://api.ytultra.com/ikool/youtube/download', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${id}` }) });
  if (!response.ok) throw new Error(`Fallback API HTTP ${response.status}`);
  const data = await response.json();
  if (data.code != null && String(data.code) !== '0000') throw new Error(`YtUltra: ${data.msg || data.code}`);
  const root = data.data || data;
  const raw = root.medias || root.formats || root.streams || root.links || [];
  const entries = (Array.isArray(raw) ? raw : Object.values(raw)).flatMap(v => Array.isArray(v) ? v : [v]);
  const formats = entries.map(f => {
    if (!f || typeof f !== 'object') return null;
    const label = String(f.format || f.qualityLabel || '');
    const ext = label.match(/\[\.(\w+)\]/)?.[1]?.toLowerCase() || f.ext || '';
    const height = Number(label.match(/(\d+)p/i)?.[1] || f.height || 0);
    const itag = Number(f.itag || (() => { try { return new URL(f.url).searchParams.get('itag'); } catch { return 0; } })());
    const mimeType = f.mimeType || (ext === 'mp4' ? `video/mp4` : ext === 'm4a' ? 'audio/mp4' : ext === 'webm' ? (height ? 'video/webm' : 'audio/webm') : ext === 'mp3' ? 'audio/mpeg' : '');
    const audioOnly = mimeType.startsWith('audio/') || [139, 140, 141, 249, 250, 251, 256, 258].includes(itag);
    const combined = [18, 22].includes(itag) || f.hasAudio === true;
    return f.url ? { ...f, url: f.url, itag, mimeType, qualityLabel: label, height, audioOnly, hasAudio: audioOnly || combined, fileSize: Number(f.fileSize || 0), bitrate: Number(f.bitrate || 0), audioQuality: f.audioQuality || '' } : null;
  }).filter(Boolean);
  if (!formats.length) throw new Error('YtUltra returned no usable media URLs');
  return { id, title: root.title || id, formats, engine: 'ytultra' };

}
export async function resolve(input, { resolver = 'auto' } = {}) {
  if (resolver === 'native') return resolveNative(input);
  if (resolver === 'api') return resolveApi(input);
  if (resolver !== 'auto') throw new Error('Resolver must be auto, native, or api');
  try { return await resolveNative(input); } catch (nativeError) {
    try { return await resolveApi(input); } catch (apiError) { throw new AggregateError([nativeError, apiError], 'Both resolvers failed'); }
  }
}
export function chooseFormat(formats, type = 'mp4') {
  const isAudio = f => f.audioOnly || f.mimeType?.startsWith('audio/');
  const isMp4 = f => f.mimeType?.startsWith('video/mp4');
  const hasAudio = f => f.hasAudio || [18, 22].includes(Number(f.itag)) || /codecs="[^"]*,\s*[^"]*"/.test(f.mimeType || '');
  if (type === 'mp4') {
    const combined = formats.filter(f => isMp4(f) && hasAudio(f));
    if (combined.length) return combined.sort((a,b) => (b.height || (b.itag === 22 ? 720 : 360)) - (a.height || (a.itag === 22 ? 720 : 360)))[0];
    return formats.filter(f => isMp4(f) && !isAudio(f)).sort((a,b) => (b.height || 0)-(a.height || 0))[0];
  }
  const audio = formats.filter(isAudio);
  if (type === 'm4a') return audio.filter(f => f.mimeType?.includes('mp4')).sort((a,b) => b.bitrate-a.bitrate || b.fileSize-a.fileSize)[0];
  return audio.sort((a,b) => b.bitrate-a.bitrate || b.fileSize-a.fileSize)[0];
}
export function isCombined(format) {
  return !!(format.hasAudio || [18,22].includes(Number(format.itag)) || /codecs="[^"]*,\s*[^"]*"/.test(format.mimeType || ''));
}
export function chooseAudio(formats) {
  return formats.filter(f => f.audioOnly || f.mimeType?.startsWith('audio/')).sort((a,b) => b.bitrate-a.bitrate || b.fileSize-a.fileSize)[0];
}
export async function mergeMp4(video, audio, destination) {
  await new Promise((done, fail) => {
    const child = spawn('ffmpeg', ['-hide_banner','-loglevel','error','-y','-i',video,'-i',audio,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-movflags','+faststart',destination], { stdio: 'inherit' });
    child.on('error', e => fail(new Error(`FFmpeg unavailable: ${e.message}`)));
    child.on('close', code => code === 0 ? done() : fail(new Error(`FFmpeg exited with ${code}`)));
  });
  return destination;
}
export async function downloadStream(url, destination, { maxBytes = Infinity } = {}) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`Stream download HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maxBytes) { await response.body.cancel(); throw new Error('Media exceeds maximum size'); }
  let bytes = 0;
  const limited = Readable.fromWeb(response.body);
  limited.on('data', chunk => { bytes += chunk.length; if (bytes > maxBytes) limited.destroy(new Error('Media exceeds maximum size')); });
  await pipeline(limited, createWriteStream(destination));
  return destination;
}
export async function convertToMp3(source, destination, bitrate = 320) {
  if (!Number.isInteger(bitrate) || bitrate < 32 || bitrate > 320) throw new Error('MP3 bitrate must be between 32 and 320');
  await new Promise((done, fail) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-vn', '-codec:a', 'libmp3lame', '-b:a', `${bitrate}k`, destination], { stdio: 'inherit' });
    child.on('error', e => fail(new Error(`FFmpeg unavailable: ${e.message}`)));
    child.on('close', code => code === 0 ? done() : fail(new Error(`FFmpeg exited with ${code}`)));
  });
  return destination;
}

export async function convertViaApi(mediaUrl, destination, { endpoint = 'http://127.0.0.1:8787/api/convert/mp3', bitrate = 192, token } = {}) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ url: mediaUrl, bitrate }) });
  if (!response.ok) throw new Error(`Converter API HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  if (!response.body) throw new Error('Converter returned no audio');
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
  return destination;
}
