// Streaming, loss-conscious full database backups. Original data is never cleared
// until the entire archive has been validated in a separate staging table.
import { buildMistakeCard } from './searchIndex';
import { migrateLegacyFirstRoundMembership } from './firstRoundMembership';

const FORMAT = 'MathNotebookBackupNDJSON';
const VERSION = 6;
const TABLES = ['subjects', 'notes', 'mistakes', 'mistakeCards', 'reviewRoundItems', 'reviewRoundExclusions'];
const SET = new Set(TABLES);
const encoder = new TextEncoder();
const BATCH = 4;
const MAX_ROW = 256 * 1024 * 1024;
const hashString = (s, start) => {
  let h = start >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};
const nextFrame = () => new Promise(resolve => setTimeout(resolve, 0));
const pad = n => n.toString(16).padStart(8, '0');

async function getCounts(db) {
  const values = await Promise.all(TABLES.map(name => db[name].count()));
  return Object.fromEntries(TABLES.map((name, index) => [name, values[index]]));
}

async function* generateBackup(db, counts, onProgress) {
  const metadata = {
    format: FORMAT, version: VERSION, firstRoundMembershipExplicit: true,
    createdAt: new Date().toISOString(), counts
  };
  yield encoder.encode(JSON.stringify(metadata) + '\n');
  let hash = 2166136261;
  let completed = 0;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const table of TABLES) {
    let lastId = null;
    while (true) {
      const collection = db[table].orderBy(':id');
      const rows = await (lastId === null ? collection : db[table].where('id').above(lastId)).limit(BATCH).toArray();
      if (!rows.length) break;
      for (const record of rows) {
        const line = JSON.stringify({ table, record }) + '\n';
        hash = hashString(line, hash);
        // Encode one item only, never hold images from every mistake in memory.
        const bytes = encoder.encode(line);
        for (let index = 0; index < bytes.byteLength; index += 64 * 1024) {
          yield bytes.slice(index, index + 64 * 1024);
        }
        completed++;
        if (completed % 8 === 0) onProgress({ stage: 'export', completed, total });
      }
      lastId = rows[rows.length - 1].id;
      // Give Android browsers opportunities to process user interaction.
      await nextFrame();
    }
  }
  yield encoder.encode(JSON.stringify({ type: 'end', counts, checksum: pad(hash) }) + '\n');
  onProgress({ stage: 'ready', completed: total, total });
}

async function downloadWithSavePicker(iterator, handle) {
  const writable = await handle.createWritable();
  try {
    for await (const chunk of iterator) await writable.write(chunk);
    await writable.close();
  } catch (err) {
    try { await writable.abort(); } catch { /* browser may have closed writer */ }
    throw err;
  }
}

async function downloadViaServiceWorker(iterator, filename) {
  if (!('serviceWorker' in navigator)) throw new Error('浏览器不支持流式下载，请使用最新版 Chrome');
  await navigator.serviceWorker.ready;
  let controller = navigator.serviceWorker.controller;
  if (!controller) {
    controller = await new Promise(resolve => {
      const done = () => { clearTimeout(timeout); navigator.serviceWorker.removeEventListener('controllerchange', changed); resolve(navigator.serviceWorker.controller); };
      const changed = () => { if (navigator.serviceWorker.controller) done(); };
      const timeout = setTimeout(done, 3500);
      navigator.serviceWorker.addEventListener('controllerchange', changed);
    });
  }
  if (!controller) throw new Error('离线下载服务尚未接管页面，请先刷新一次网页再导出；请勿清除网站数据');
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const channel = new MessageChannel();
  const port = channel.port1;
  let finished = false;
  let busy = false;
  let resolveEnd, rejectEnd;
  const finishedPromise = new Promise((resolve, reject) => { resolveEnd = resolve; rejectEnd = reject; });
  let resolveRegister, rejectRegister;
  const registered = new Promise((resolve, reject) => { resolveRegister = resolve; rejectRegister = reject; });
  const registrationTimer = setTimeout(() => rejectRegister(new Error('下载服务没有响应')), 8000);
  const downloadTimer = setTimeout(() => {
    if (!finished) rejectEnd(new Error('系统没有开始接收备份，请检查下载权限或尝试 Chrome 浏览器'));
  }, 20000);
  port.onmessage = async event => {
    const msg = event.data || {};
    if (msg.type === 'registered') {
      clearTimeout(registrationTimer);
      resolveRegister();
      return;
    }
    if (msg.type === 'cancel') {
      finished = true;
      rejectEnd(new Error('下载被浏览器取消，请检查设备空间'));
      return;
    }
    if (msg.type !== 'pull' || busy || finished) return;
    clearTimeout(downloadTimer);
    busy = true;
    try {
      const next = await iterator.next();
      if (next.done) {
        finished = true;
        port.postMessage({ type: 'end' });
        resolveEnd();
      } else {
        const bytes = next.value;
        port.postMessage({ type: 'chunk', bytes: bytes.buffer }, [bytes.buffer]);
      }
    } catch (error) {
      finished = true;
      port.postMessage({ type: 'error', error: String(error?.message || error) });
      rejectEnd(error);
    } finally { busy = false; }
  };
  try {
    controller.postMessage({ type: 'BACKUP_DOWNLOAD_REGISTER', id, filename }, [channel.port2]);
    await registered;
    const a = document.createElement('a');
    a.href = new URL('./__mathbackup_download__/' + encodeURIComponent(id), location.href).href;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    await finishedPromise;
  } finally {
    clearTimeout(registrationTimer);
    clearTimeout(downloadTimer);
    setTimeout(() => port.close(), 1000);
  }
}

export async function exportCompleteBackup(db, onProgress = () => {}) {
  const filename = 'MathNotebook_All_' + new Date().toISOString().slice(0, 10) + '.mathbackup';
  // Saving must be requested while the click still has user activation.
  const picker = typeof window.showSaveFilePicker === 'function'
    ? window.showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: '错题本完整备份', accept: { 'application/octet-stream': ['.mathbackup'] } }]
    }) : null;
  const counts = await getCounts(db);
  const iterator = generateBackup(db, counts, onProgress)[Symbol.asyncIterator]();
  if (picker) {
    await downloadWithSavePicker({ [Symbol.asyncIterator]: () => iterator }, await picker);
  } else {
    await downloadViaServiceWorker(iterator, filename);
  }
  return { filename, counts };
}

async function readLines(file, onLine, onProgress) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let fragments = [];
  let length = 0;
  let number = 0;
  let received = 0;
  async function appendPart(text) {
    let index = 0;
    while (true) {
      const end = text.indexOf('\n', index);
      if (end === -1) {
        const tail = text.slice(index);
        fragments.push(tail);
        length += tail.length;
        if (length > MAX_ROW) throw new Error('单条记录超过256MB，建议先压缩这一题的原始超大图片');
        break;
      }
      fragments.push(text.slice(index, end));
      const line = fragments.join('').replace(/\r$/, '');
      fragments = [];
      length = 0;
      number++;
      if (line) await onLine(line, number);
      index = end + 1;
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      await appendPart(decoder.decode(value, { stream: true }));
      if (number % 20 === 0) onProgress({ stage: 'validate', completed: received, total: file.size });
    }
    await appendPart(decoder.decode());
    if (fragments.some(Boolean)) throw new Error('文件没有完整换行结尾，备份可能下载不全');
  } finally { reader.releaseLock(); }
  return number;
}

export async function restoreCompleteBackup(db, file, onProgress = () => {}) {
  if (!file || !/\.(mathbackup)$/i.test(file.name)) throw new Error('请选择完整备份 .mathbackup 文件');
  let meta = null;
  let footer = null;
  let hash = 2166136261;
  const counts = Object.fromEntries(TABLES.map(name => [name, 0]));
  const stage = db.restoreStaging;
  // Never clear the user's original data before checking the complete file.
  await stage.clear();
  let lineNumber = 0;
  try {
    lineNumber = await readLines(file, async (line, index) => {
      let obj;
      try { obj = JSON.parse(line); }
      catch { throw new Error('备份第' + index + '行 JSON 损坏，原数据未修改'); }
      if (index === 1) {
        if (obj.format !== FORMAT || ![5, 6].includes(obj.version)) throw new Error('备份格式不兼容；旧版 JSON 请使用旧版导入入口');
        meta = obj;
        return;
      }
      if (obj.type === 'end') {
        if (footer) throw new Error('文件存在重复结束标记');
        footer = obj;
        return;
      }
      if (footer) throw new Error('结束标记后还有记录，文件可能损坏');
      if (!SET.has(obj.table) || !obj.record || typeof obj.record !== 'object' || obj.record.id == null) {
        throw new Error('第' + index + '行的数据表、ID或记录不正确');
      }
      if (obj.table === 'mistakeCards' && meta.version < 6) throw new Error('旧备份包含异常索引记录');
      counts[obj.table]++;
      hash = hashString(line + '\n', hash);
      await stage.add({ table: obj.table, record: obj.record });
    }, onProgress);
    if (!meta) throw new Error('备份缺少元信息');
    if (meta.version === 6 && (!footer || footer.checksum !== pad(hash))) {
      throw new Error('备份缺少结束标记或校验码不匹配；原数据未修改');
    }
    if (lineNumber === 1 || (meta.version === 6 && !footer)) throw new Error('备份内容不完整');
    for (const table of TABLES) {
      const actual = counts[table];
      const expected = meta.counts?.[table];
      if (meta.version === 6 && (!Number.isInteger(expected) || actual !== expected)) {
        throw new Error(table + '记录数量与备份声明不一致；原数据未修改');
      }
      if (meta.version === 5 && expected != null && actual !== expected) {
        throw new Error(table + '记录数量不匹配；原数据未修改');
      }
    }
    onProgress({ stage: 'commit', completed: 0, total: await stage.count() });
    const live = TABLES.map(name => db[name]);
    const tablesToClear = TABLES.slice();
    await db.transaction('rw', ...live, stage, async () => {
      for (const name of tablesToClear) await db[name].clear();
      let last = null;
      let done = 0;
      const rebuilt = [];
      while (true) {
        const collection = stage.orderBy(':id');
        const rows = await (last == null ? collection : stage.where('id').above(last)).limit(BATCH).toArray();
        if (!rows.length) break;
        for (const entry of rows) {
          const restored = { ...entry.record };
          for (const key of ['createdAt', 'updatedAt', 'decidedAt', 'removedAt']) {
            if (typeof restored[key] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(restored[key])) {
              const date = new Date(restored[key]);
              if (!Number.isNaN(date.getTime())) restored[key] = date;
            }
          }
          if (Array.isArray(restored.relatedQuestions)) {
            restored.relatedQuestions = restored.relatedQuestions.map(q => {
              const next = { ...q };
              for (const key of ['createdAt','updatedAt']) {
                if (typeof next[key] === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(next[key])) next[key] = new Date(next[key]);
              }
              return next;
            });
          }
          await db[entry.table].put(restored);
          if (entry.table === 'mistakes' && meta.version < 6) rebuilt.push(buildMistakeCard(restored));
          done++;
        }
        last = rows[rows.length - 1].id;
        onProgress({ stage: 'commit', completed: done, total: Object.values(counts).reduce((a,b)=>a+b,0) });
      }
      if (meta.version < 6) {
        // Rebuild searchable card index from legacy backups only.
        for (let i = 0; i < rebuilt.length; i += BATCH) {
          await db.mistakeCards.bulkPut(rebuilt.slice(i, i + BATCH));
        }
      }
      if (counts.subjects === 0) throw new Error('备份中没有科目，拒绝覆盖现有数据库');
      if (meta.firstRoundMembershipExplicit !== true) await migrateLegacyFirstRoundMembership(db);
      await stage.clear();
    });
    return { counts, filename: file.name };
  } catch (error) {
    // Failed validation or a rolled-back commit must not keep temporary copies.
    try { await stage.clear(); } catch { /* quota or device failure */ }
    throw error;
  }
}
