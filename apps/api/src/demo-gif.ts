import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve('../..');
const directory = join(root, '.data/demo-frames');
const labels = [
  'Find a SAMPLE polling unit',
  'Save a sheet while offline',
  'Reconnect: sent once',
  'Filter the discrepancy board',
  'Compare the two documents',
  'Check differences and provenance',
];
const frames = (await readdir(directory)).filter((name) => /^0[1-6]-.*\.png$/.test(name)).sort();
if (frames.length !== 6) throw new Error('Run demo:captures to create six walkthrough frames.');
for (const [index, file] of frames.entries()) {
  const title = Buffer.from(
    `<svg width="960" height="55"><rect width="960" height="55" fill="#145332"/><text x="24" y="36" font-family="sans-serif" font-size="25" font-weight="bold" fill="white">${labels[index]}</text></svg>`,
  );
  const screenshot = await sharp(join(directory, file))
    .resize(960, 665, { fit: 'contain', background: '#f6f7f2' })
    .png()
    .toBuffer();
  await sharp({ create: { width: 960, height: 720, channels: 3, background: '#f6f7f2' } })
    .composite([
      { input: title, top: 0, left: 0 },
      { input: screenshot, top: 55, left: 0 },
    ])
    .png()
    .toFile(join(directory, `frame-${String(index + 1).padStart(2, '0')}.png`));
}
const result = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-loglevel',
    'error',
    '-framerate',
    '1/3',
    '-i',
    join(directory, 'frame-%02d.png'),
    '-filter_complex',
    '[0:v]split[a][b];[a]palettegen[p];[b][p]paletteuse',
    '-loop',
    '0',
    join(root, 'docs/screenshots/sheetmatch-demo.gif'),
  ],
  { stdio: 'inherit' },
);
if (result.error) throw result.error;
if (result.status) throw new Error('The demo GIF could not be written.');
console.log('Wrote docs/screenshots/sheetmatch-demo.gif');
