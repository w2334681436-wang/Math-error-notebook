// 独立的错题增量导入协议；绝不清空或替换现有数据。
import { buildMistakeCard } from './searchIndex';

export const MISTAKE_PACK_FORMAT = 'MathNotebookMistakePack';
const MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_FILE = 24 * 1024 * 1024;
const MAX_IMAGE = 8 * 1024 * 1024;

function nonempty(value, field, max = 200000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(field + '必须是非空文字，且不能超过长度限制');
  }
  return value.trim();
}

function parseAssets(assets = [], context) {
  if (!Array.isArray(assets) || assets.length > 18) throw new Error(context + '最多允许18张图');
  const result = {};
  for (const asset of assets) {
    if (!asset || typeof asset.id !== 'string' || !/^[\w-]{1,64}$/.test(asset.id)
      || !MIME.has(asset.mime) || typeof asset.base64 !== 'string'
      || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64)
      || asset.base64.length % 4 !== 0
      || asset.base64.length > Math.ceil(MAX_IMAGE / 3) * 4
      || Object.prototype.hasOwnProperty.call(result, asset.id)) {
      throw new Error(context + '图解格式不正确');
    }
    result[asset.id] = 'data:' + asset.mime + ';base64,' + asset.base64;
  }
  return result;
}

function verifyReferences(markdown, assets, label) {
  for (const match of markdown.matchAll(/note-asset:([A-Za-z0-9_-]+)/g)) {
    if (!Object.prototype.hasOwnProperty.call(assets, match[1])) {
      throw new Error(label + '中图片 ' + match[1] + ' 未附带资源');
    }
  }
}

export async function parseMistakePack(file) {
  if (!file || !/\.merror$|\.json$/i.test(file.name)) throw new Error('请选择 .merror 或 .json 格式的错题包');
  if (file.size > MAX_FILE) throw new Error('文件不能超过24 MB');
  let data;
  try { data = JSON.parse(await file.text()); } catch { throw new Error('文件不是有效的UTF-8 JSON'); }
  if (data?.format !== MISTAKE_PACK_FORMAT || data?.version !== 1 || !Array.isArray(data.items)) {
    throw new Error('不是 MathNotebookMistakePack v1 错题包；请勿选用整库备份或 .knote');
  }
  if (!data.items.length || data.items.length > 120) throw new Error('单次只支持1~120道错题');
  const keys = new Set();
  const items = data.items.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error('第' + (index + 1) + '题结构不正确');
    const key = nonempty(raw.sourceId, 'sourceId', 160);
    if (keys.has(key)) throw new Error('包内 sourceId 重复：' + key);
    keys.add(key);
    const title = nonempty(raw.title, 'title', 120);
    const questionMarkdown = nonempty(raw.questionMarkdown, 'questionMarkdown', 100000);
    const analysisText = nonempty(raw.analysisMarkdown, 'analysisMarkdown', 400000);
    const reflection = typeof raw.reflectionMarkdown === 'string' ? raw.reflectionMarkdown.slice(0, 100000) : '';
    const questionAssets = parseAssets(raw.questionAssets || [], '第' + (index + 1) + '题题干');
    const analysisAssets = parseAssets(raw.analysisAssets || [], '第' + (index + 1) + '题解析');
    const questionThumbnailAssetId = typeof raw.questionThumbnailAssetId === 'string' ? raw.questionThumbnailAssetId : '';
    if (questionThumbnailAssetId && !Object.prototype.hasOwnProperty.call(questionAssets, questionThumbnailAssetId)) {
      throw new Error(title + '封面缩略图未附带');
    }
    verifyReferences(questionMarkdown, questionAssets, title + '题干');
    verifyReferences(analysisText, analysisAssets, title + '解析');
    const tags = Array.isArray(raw.tags) ? raw.tags.filter(t => typeof t === 'string').slice(0, 15).map(t => t.slice(0, 48)) : [];
    return { sourceId: key, title, questionMarkdown, analysisText, reflection, questionAssets, analysisAssets, tags, questionThumbnailAssetId };
  });
  return { subject: typeof data.subject === 'string' ? data.subject.trim() : '', items };
}

export async function addMistakePack(db, pack, subjectId, subjectName = '') {
  if (!subjectId) throw new Error('请先选择导入的科目');
  if (pack.subject && subjectName && pack.subject !== subjectName) {
    throw new Error('错题包科目为「' + pack.subject + '」，当前选择的是「' + subjectName + '」，请先切换科目');
  }
  return db.transaction('rw', db.mistakes, db.mistakeCards, async () => {
    const known = new Set();
    await db.mistakes.where('subjectId').equals(subjectId).each(item => {
      if (item.importKey) known.add(item.importKey);
    });
    let added = 0, skipped = 0;
    const now = Date.now();
    for (let i = 0; i < pack.items.length; i++) {
      const item = pack.items[i];
      const importKey = MISTAKE_PACK_FORMAT + ':' + item.sourceId;
      if (known.has(importKey)) { skipped++; continue; }
      known.add(importKey);
      const createdAt = new Date(now - i * 1000); // 默认倒序列表保持包内第1题排在最前
      const record = {
        subjectId, importKey, title: item.title,
        questionMarkdown: item.questionMarkdown, questionAssets: item.questionAssets,
        questionImages: item.questionThumbnailAssetId ? [item.questionAssets[item.questionThumbnailAssetId]] : [], analysisText: item.analysisText, analysisAssets: item.analysisAssets,
        analysisImages: [], reflection: item.reflection, tags: item.tags,
        isMastered: false, reviewLogs: [], reviewCount: 0, reviewTimes: 0,
        createdAt, updatedAt: createdAt
      };
      const id = await db.mistakes.add(record);
      await db.mistakeCards.put(buildMistakeCard({ ...record, id }));
      added++;
    }
    return { added, skipped };
  });
}
