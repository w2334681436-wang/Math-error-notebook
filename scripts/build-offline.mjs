import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const distRoot = path.join(projectRoot, 'dist');
const serviceWorkerPath = path.join(distRoot, 'service-worker.js');
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));

async function collectFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath, relativePath));
    } else if (entry.isFile() && relativePath !== 'service-worker.js') {
      files.push(relativePath);
    }
  }

  return files;
}

const requiredFiles = [
  'index.html',
  'manifest.json',
  'icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

const files = (await collectFiles(distRoot)).sort((left, right) => {
  if (left === 'index.html') return -1;
  if (right === 'index.html') return 1;
  return left.localeCompare(right);
});

for (const requiredFile of requiredFiles) {
  if (!files.includes(requiredFile)) {
    throw new Error(`离线构建缺少必要文件：${requiredFile}`);
  }
}

const digest = createHash('sha256');
let totalBytes = 0;
for (const file of files) {
  const absolutePath = path.join(distRoot, file);
  const fileStat = await stat(absolutePath);
  const content = await readFile(absolutePath);
  totalBytes += fileStat.size;
  digest.update(file);
  digest.update(content);
}

const serviceWorkerTemplate = await readFile(serviceWorkerPath, 'utf8');
digest.update(serviceWorkerTemplate);
const version = `${packageJson.version}-${digest.digest('hex').slice(0, 12)}`;
let serviceWorker = serviceWorkerTemplate;

if (!serviceWorker.includes('__OFFLINE_VERSION__')) {
  throw new Error('Service Worker 缺少 __OFFLINE_VERSION__ 构建标记');
}
if (!serviceWorker.includes('/* __PRECACHE_FILES__ */ []')) {
  throw new Error('Service Worker 缺少 __PRECACHE_FILES__ 构建标记');
}

serviceWorker = serviceWorker
  .replace('__OFFLINE_VERSION__', version)
  .replace('/* __PRECACHE_FILES__ */ []', JSON.stringify(files, null, 2));

if (serviceWorker.includes('__OFFLINE_VERSION__') || serviceWorker.includes('__PRECACHE_FILES__')) {
  throw new Error('Service Worker 离线清单注入不完整');
}

await writeFile(serviceWorkerPath, serviceWorker, 'utf8');

console.log(`✅ 完整离线包已生成：${files.length} 个文件，${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`✅ 离线缓存版本：math-notebook-offline-${version}`);
