const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const cloud = fs.readFileSync(path.join(root, 'cloud-sync.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
const icon = fs.readFileSync(path.join(root, 'icons', 'sundial.svg'), 'utf8');

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, 'HTML contains duplicate ids');

const runtimeIds = new Set(['manualMinutes', 'pomoMinutes']);
const referencedIds = [...app.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)].map(match => match[1]);
const missingIds = [...new Set(referencedIds)].filter(id => !ids.includes(id) && !runtimeIds.has(id));
assert.deepEqual(missingIds, [], `app.js references missing HTML ids: ${missingIds.join(', ')}`);

for (const match of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
  const attributes = match[1];
  const text = match[2].replace(/<[^>]+>/g, '').trim();
  if (/^[×+↻⌑‹›⧉⌫•]+$/u.test(text)) {
    assert.match(attributes, /(?:aria-label|title)=/, `symbol button "${text}" needs an accessible name`);
  }
}

assert.match(css, /:focus-visible/, 'visible keyboard focus styles are required');
assert.match(css, /@media\(pointer:coarse\)/, 'coarse pointer touch targets are required');
assert.match(css, /\.dialog-close[^}]*[\s\S]*?color:#fff!important/, 'dialog close buttons need an explicit contrasting color');
assert.match(html, /id="regionToggle"[^>]*aria-expanded="false"/, 'region picker needs an explicit menu toggle');
assert.match(html, /id="regionOptions"[^>]*role="listbox"/, 'region history needs an accessible listbox');
assert.match(app, /state\.regions=Object\.keys\(sceneMaps\)/, 'saved region names must persist independently');
assert.match(app, /state\.records\|\|\[\]\)\.map\(record=>record\.region\)/, 'regions from historical records must be recovered');
assert.match(html, /class="brand-mark"><img src="icons\/sundial\.svg"/, 'in-app brand must use the shared sundial icon');
assert.match(icon, /中式赤道日晷/, 'the sundial asset needs a descriptive accessible title');
assert.equal(manifest.icons[0].src, 'icons/sundial.svg', 'install icon must use the shared sundial asset');
assert.match(html, /<script src="cloud-sync\.js"><\/script>\s*<script src="app\.js">/, 'cloud sync must load before the application');
assert.match(html, /<input(?=[^>]*id="cloudEmail")(?=[^>]*type="email")[^>]*>/, 'cloud login needs a typed email field');
assert.match(html, /<input(?=[^>]*id="cloudPassword")(?=[^>]*autocomplete="current-password")[^>]*>/, 'cloud password field needs password-manager support');
assert.match(cloud, /on_conflict=user_id/, 'cloud writes must use a deterministic user-level upsert');
assert.doesNotMatch(cloud, /service_role|sb_secret_/, 'browser code must never contain a Supabase secret key');
assert.match(cloud, /signup\?redirect_to=/, 'signup must provide an explicit confirmation redirect');
assert.match(cloud, /github\.io\/origin2\//, 'confirmation must return to the deployed project path');
assert.match(html, /id="cloudSummary" role="status" aria-live="polite"/, 'cloud auth feedback needs an announced inline status');
assert.match(html, /id="sceneConflict" role="alert"/, 'scene conflicts need an explicit recovery surface');
assert.match(app, /sceneRevision=.*sceneRevision.*\+1/, 'scene edits must advance their own sync revision');
assert.match(app, /before-scene-conflict-resolution/, 'scene conflict resolution must create a recovery backup');
assert.match(app, /RijiData\.splitTimeWindow/, 'timers and sleep sessions must split safely across midnight');
assert.match(app, /sleepQuality:quality/, 'sleep quality must be attached to the sleep record');
assert.match(app, /id:`\$\{details\.sessionId\}_\$\{part\.date\}`/, 'cross-device session records need deterministic ids');
assert.match(app, /'睡眠质量'/, 'sleep quality must be included in CSV exports');
assert.match(app, /\$\$\('dialog\[open\]'\)/, 'toast feedback must be moved into the active top-layer dialog');
assert.match(app, /over_email_send_rate_limit/, 'email throttling needs a specific user-facing explanation');

function rgb(hex) {
  return [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
}
function luminance(hex) {
  return rgb(hex).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + .05) / (dark + .05);
}

assert.ok(contrast('#f1f3ef', '#080a09') >= 7, 'primary text must meet enhanced contrast');
assert.ok(contrast('#9da59f', '#080a09') >= 4.5, 'muted text must meet normal-text contrast');
assert.ok(contrast('#ffffff', '#303632') >= 4.5, 'symbol buttons must meet normal-text contrast');

console.log('Usability structure and contrast checks passed.');
