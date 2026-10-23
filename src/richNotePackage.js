// Portable .knote packages: Markdown + KaTeX + interleaved PNG/JPEG/WebP/GIF assets.
// Imported content is added to db.notes only; it never invokes whole-app backup restore.
export const RICH_NOTE_FORMAT = 'MathNotebookRichNote';
export const RICH_NOTE_BUNDLE_FORMAT = 'MathNotebookRichNoteBundle';
const ALLOWED_MIME = new Set(['image/png','image/jpeg','image/webp','image/gif']);
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const safeName = (value, fallback = '未命名笔记') => {
  const name = String(value ?? '').trim();
  return name && name.length <= 120 ? name : fallback;
};

// Version 1 single-note files remain compatible. Bundle v1 adds an array of
// independent v1 notes; each has its own folderPath and image asset namespace.
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_NOTES_PER_BUNDLE = 100;

function parseRichNoteObject(data) {
  if (!data || data.format !== RICH_NOTE_FORMAT || data.version !== 1) {
    throw new Error('不支持的笔记格式，需要 MathNotebookRichNote v1');
  }
  if (typeof data.markdown !== 'string') throw new Error('笔记缺少 markdown 正文');
  if (data.markdown.length > 2_000_000) throw new Error('正文超过 200 万字符');
  if (!Array.isArray(data.folderPath ?? []) || (data.folderPath || []).length > 8) {
    throw new Error('文件夹层级不正确');
  }
  const folderPath = (data.folderPath || []).map(p => {
    if (typeof p !== 'string' || !p.trim() || p.trim().length > 80) {
      throw new Error('文件夹名称不合法');
    }
    return p.trim();
  });
  const tags = Array.isArray(data.tags)
    ? data.tags.filter(t => typeof t === 'string' && t.trim())
        .slice(0, 20).map(t => t.trim().slice(0, 40))
    : [];
  if (!Array.isArray(data.assets ?? []) || (data.assets || []).length > 30) {
    throw new Error('每篇笔记最多支持 30 张插图');
  }
  const assets = Object.create(null);
  for (const item of (data.assets || [])) {
    if (!item || typeof item.id !== 'string'
      || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)
      || !ALLOWED_MIME.has(item.mime)
      || typeof item.base64 !== 'string'
      || !/^[a-zA-Z0-9+/]*={0,2}$/.test(item.base64)
      || item.base64.length % 4 !== 0
      || item.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
      || Object.prototype.hasOwnProperty.call(assets, item.id)) {
      throw new Error('插图信息有误、存在重复编号或大小超过限制');
    }
    assets[item.id] = 'data:' + item.mime + ';base64,' + item.base64;
  }
  const references = [...data.markdown.matchAll(/note-asset:([a-zA-Z0-9_-]+)/g)]
    .map(match => match[1]);
  if (references.some(id => !Object.prototype.hasOwnProperty.call(assets, id))) {
    throw new Error('正文引用了缺失的图片，请检查笔记包完整性');
  }
  return { title: safeName(data.title), text: data.markdown, folderPath, tags, assets };
}

// Validate the complete file before any database transaction begins.
// Old .knote/.md -> one note; new .knote bundle -> many independent notes.
export async function parseRichNoteCollection(file) {
  if (file.size > MAX_BUNDLE_BYTES) throw new Error('图文笔记合集不能超过 64 MB');
  const body = await file.text();
  if (/\.md$/i.test(file.name)) {
    if (file.size > MAX_PACKAGE_BYTES) throw new Error('单篇 Markdown 不能超过 16 MB');
    return {
      isBundle: false,
      notes: [{
        title: safeName(file.name.replace(/\.md$/i, '')),
        text: body, folderPath: [], tags: [], assets: Object.create(null)
      }]
    };
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error('文件不是有效的 .knote JSON 笔记包');
  }
  if (data && data.format === RICH_NOTE_BUNDLE_FORMAT && data.version === 1) {
    if (!Array.isArray(data.notes) || data.notes.length === 0
      || data.notes.length > MAX_NOTES_PER_BUNDLE) {
      throw new Error('合集应包含 1–100 篇有效笔记');
    }
    const notes = data.notes.map((entry, i) => {
      try {
        return parseRichNoteObject(entry);
      } catch (err) {
        throw new Error('第 ' + (i + 1) + ' 篇笔记格式有误：' + err.message);
      }
    });
    return { isBundle: true, notes };
  }
  if (file.size > MAX_PACKAGE_BYTES) throw new Error('单篇图文笔记不能超过 16 MB');
  return { isBundle: false, notes: [parseRichNoteObject(data)] };
}

// Keep the old single-note API for compatibility with other app code.
export async function parseRichNoteFile(file) {
  const collection = await parseRichNoteCollection(file);
  if (collection.notes.length !== 1) {
    throw new Error('这是多篇笔记合集，请使用合集导入功能');
  }
  return collection.notes[0];
}

export function buildRichNotePackage(note, folderPath = []) {
  const assets = [];
  const content = (note.content || []);
  const markdownImages = Object.entries(note.assets || {});
  for (const [id, uri] of markdownImages) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=]+)$/.exec(uri);
    if (match) assets.push({ id, mime: match[1], base64: match[2] });
  }
  let markdown = note.text || '';
  content.forEach((item, index) => {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=]+)$/.exec(item.src || '');
    if (!match) return;
    const id = 'attachment_' + index;
    if (assets.some(a => a.id === id)) return;
    assets.push({ id, mime: match[1], base64: match[2] });
    markdown += '\n\n![' + String(item.desc || '补充图片').replace(/[\]\\]/g, '') + '](note-asset:' + id + ')\n';
  });
  return {
    format: RICH_NOTE_FORMAT, version: 1,
    title: note.title || '知识笔记', folderPath,
    tags: Array.isArray(note.tags) ? note.tags : [],
    markdown, assets
  };
}

export function downloadRichNotePackage(note, folderPath = []) {
  const content = JSON.stringify(buildRichNotePackage(note, folderPath));
  const objectUrl = URL.createObjectURL(new Blob([content], {type: 'application/json;charset=utf-8'}));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = (note.title || '知识笔记').replace(/[\\/:*?"<>|]/g, '_') + '.knote';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}
