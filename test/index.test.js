import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { videoId, chooseFormat } from '../src/index.js';
test('parses video IDs and URLs', () => {
 assert.equal(videoId('azYjzFzd7jM'), 'azYjzFzd7jM');
 assert.equal(videoId('https://youtu.be/azYjzFzd7jM'), 'azYjzFzd7jM');
 assert.equal(videoId('https://www.youtube.com/watch?v=azYjzFzd7jM'), 'azYjzFzd7jM');
});
test('chooses combined MP4', () => {
 const formats = [{itag:137,mimeType:'video/mp4; codecs="avc1"',bitrate:900},{itag:18,mimeType:'video/mp4; codecs="avc1, mp4a"',bitrate:300}];
 assert.equal(chooseFormat(formats,'mp4').itag,18);
});

test('parses YtUltra data.medias response and selects combined MP4', async () => {
  const { resolveApi, chooseAudio, isCombined } = await import('../src/index.js');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ code:'0000', data: { title:null, medias:[
    {url:'https://example.org/v?itag=299', format:'1080p (121 MB) [.mp4]', fileSize:127456586},
    {url:'https://example.org/v?itag=18', format:'360p (15 MB) [.mp4]', fileSize:15297538},
    {url:'https://example.org/a?itag=140', format:'128kbps [.m4a]', fileSize:3000000}
  ] } }) });
  try {
    const media = await resolveApi('azYjzFzd7jM');
    assert.equal(media.formats.length, 3);
    assert.equal(chooseFormat(media.formats,'mp4').itag, 18);
    assert.equal(isCombined(chooseFormat(media.formats,'mp4')), true);
    assert.equal(chooseAudio(media.formats).itag, 140);
  } finally { globalThis.fetch = originalFetch; }
});
