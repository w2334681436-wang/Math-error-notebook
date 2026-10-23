// Portable .knote packages: Markdown + KaTeX + interleaved PNG/JPEG/WebP/GIF assets.
// Imported content is added to db.notes only; it never invokes whole-app backup restore.
export const RICH_NOTE_FORMAT = 'MathNotebookRichNote';
const ALLOWED_MIME = new Set(['image/png','image/jpeg','image/webp','image/gif']);
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const safeName = (value, fallback = '未命名笔记') => {
  const name = String(value ?? '').trim();
  return name && name.length <= 120 ? name : fallback;
};

export async function parseRichNoteFile(file) {
  if (file.size > MAX_PACKAGE_BYTES) throw new Error('图文笔记包不能超过 16 MB');
  const body = await file.text();
  if (/\.md$/i.test(file.name)) {
    return { title: safeName(file.name.replace(/\.md$/i, '')), text: body,
      folderPath: [], tags: [], assets: {} };
  }
  let data;
  try { data = JSON.parse(body); } catch { throw new Error('文件不是有效的 .knote JSON 笔记包'); }
  if (!data || data.format !== RICH_NOTE_FORMAT || data.version !== 1) {
    throw new Error('不支持的笔记格式，需要 MathNotebookRichNote v1');
  }
  if (typeof data.markdown !== 'string') throw new Error('笔记缺少 markdown 正文');
  if (data.markdown.length > 2_000_000) throw new Error('正文超过 200 万字符');
  if (!Array.isArray(data.folderPath ?? []) || (data.folderPath || []).length > 8) {
    throw new Error('文件夹层级不正确');
  }
  const folderPath = (data.folderPath || []).map(p => {
    if (typeof p !== 'string' || !p.trim() || p.trim().length > 80) throw new Error('文件夹名称不合法');
    return p.trim();
  });
  const tags = Array.isArray(data.tags) ? data.tags.filter(t => typeof t === 'string' && t.trim()).slice(0, 20).map(t => t.trim().slice(0, 40)) : [];
  if (!Array.isArray(data.assets ?? []) || (data.assets || []).length > 30) {
    throw new Error('最多支持 30 张插图');
  }
  const assets = {};
  for (const item of (data.assets || [])) {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id)
      || !ALLOWED_MIME.has(item.mime) || typeof item.base64 !== 'string'
      || !/^[a-zA-Z0-9+/]*={0,2}$/.test(item.base64)
      || item.base64.length % 4 !== 0
      || item.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4
      || Object.hasOwn(assets, item.id)) {
      throw new Error('插图信息有误或大小超过限制');
    }
    assets[item.id] = 'data:' + item.mime + ';base64,' + item.base64;
  }
  const references = [...data.markdown.matchAll(/note-asset:([a-zA-Z0-9_-]+)/g)].map(m => m[1]);
  if (references.some(id => !Object.hasOwn(assets, id))) {
    throw new Error('正文引用了缺失的图片，请检查笔记包完整性');
  }
  return { title: safeName(data.title), text: data.markdown, folderPath, tags, assets };
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
