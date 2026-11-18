// src/searchIndex.js
import {
  getSelectedReviewRound,
} from './reviewRoundActions';
import { getStoredQuestionImages } from './mistakePackImages';

export const MISTAKE_PAGE_SIZE = 20;
export const MISTAKE_SORT_STORAGE_PREFIX = 'mathNotebook.mistakeListReversed.';

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toTime(value) {
  const time = new Date(value || Date.now()).getTime();
  return Number.isFinite(time) ? time : Date.now();
}

function getQuestionImages(mistake) {
  return getStoredQuestionImages(mistake);
}

function getAnalysisImages(mistake) {
  return mistake?.analysisImages || (mistake?.analysisImg ? [mistake.analysisImg] : []);
}

export { getSelectedReviewRound } from './reviewRoundActions';

export function getMistakeListReverseKey(subjectId) {
  return `${MISTAKE_SORT_STORAGE_PREFIX}${subjectId}`;
}

export function isMistakeListReversed(subjectId) {
  if (typeof localStorage === 'undefined' || !subjectId) return false;
  return localStorage.getItem(getMistakeListReverseKey(subjectId)) === '1';
}

// 适配中文、英文、数字搜索。
export function createSearchTokens(text) {
  const normalized = normalizeSearchText(text);
  const tokens = new Set();

  if (!normalized) return [];

  const words = normalized.match(/[a-z0-9_./+-]+/g) || [];
  for (const word of words) {
    if (word.length >= 1) tokens.add(word);
  }

  const cjk = normalized.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i < cjk.length; i++) tokens.add(cjk[i]);

  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i <= cjk.length - n; i++) {
      tokens.add(cjk.slice(i, i + n));
    }
  }

  return Array.from(tokens).slice(0, 160);
}

function cardMatchesKeyword(card, keyword) {
  const q = normalizeSearchText(keyword);
  if (!q) return true;
  const text = card.searchText || '';
  return text.includes(q) || q.split(/\s+/).every(term => text.includes(term));
}

// 从完整错题生成轻量卡片。
// 新复盘系统不再使用 reviewLogs/reviewCount，因此 reviewCount 永远为 0。
export function buildMistakeCard(mistake) {
  const questionImages = getQuestionImages(mistake);
  const analysisImages = getAnalysisImages(mistake);
  const relatedQuestions = Array.isArray(mistake.relatedQuestions) ? mistake.relatedQuestions : [];
  const createdAtMs = toTime(mistake.createdAt);
  const updatedAtMs = toTime(mistake.updatedAt || mistake.createdAt);
  const title = mistake.title || '未命名错题';
  const dateText = new Date(createdAtMs).toLocaleDateString();
  const searchText = normalizeSearchText([
    title,
    mistake.questionMarkdown || '',
    mistake.reflection || '',
    mistake.analysisText || '',
    ...relatedQuestions.flatMap(item => [
      item?.title || '',
      item?.questionMarkdown || '',
      item?.reflection || '',
      item?.analysisText || '',
    ]),
    dateText,
    mistake.isMastered ? '已掌握 熟练' : '',
    mistake.reflection ? '已复盘' : '待复盘',
  ].join(' '));

  return {
    id: mistake.id,
    subjectId: mistake.subjectId ?? null,
    title,
    createdAt: mistake.createdAt || new Date(createdAtMs),
    createdAtMs,
    updatedAtMs,
    imageCount: questionImages.length,
    analysisImageCount: analysisImages.length,
    hasQuestionMarkdown: Boolean(normalizeSearchText(mistake.questionMarkdown)),
    relatedQuestionCount: relatedQuestions.length,
    hasReflection: Boolean(normalizeSearchText(mistake.reflection)),
    hasAnalysis: Boolean(normalizeSearchText(mistake.analysisText) || analysisImages.length > 0),
    isMastered: Boolean(mistake.isMastered),
    reviewCount: 0,
    searchText,
    tokens: createSearchTokens(searchText),
  };
}

export async function rebuildAllMistakeCards(db) {
  return db.transaction('rw', db.mistakes, db.mistakeCards, async () => {
    await db.mistakeCards.clear();
    let count = 0;
    while (true) {
      // 分批读取，避免一次性把整个错题库的所有 base64 图片装入内存。
      const records = await db.mistakes.orderBy(':id').offset(count).limit(10).toArray();
      if (!records.length) return count;
      await db.mistakeCards.bulkPut(records.map(buildMistakeCard));
      count += records.length;
    }
  });
}

// Recover derived index entries in tiny independent writes; never clear or
// overwrite the user's original mistakes, pictures, edits or review history.
// Safe to run again after an interruption or quota error.
export async function repairMistakeCardIndex(db, onProgress = () => {}) {
  const sourceKeys = await db.mistakes.toCollection().primaryKeys();
  const cardKeys = await db.mistakeCards.toCollection().primaryKeys();
  const sourceSet = new Set(sourceKeys.map(String));
  const cardSet = new Set(cardKeys.map(String));
  const missing = sourceKeys.filter(key => !cardSet.has(String(key)));
  const stale = cardKeys.filter(key => !sourceSet.has(String(key)));
  let completed = 0;
  for (const id of missing) {
    const record = await db.mistakes.get(id);
    if (record) await db.mistakeCards.put(buildMistakeCard(record));
    completed++;
    onProgress({ completed, total: missing.length, stage: 'repair' });
    if (completed % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  // These are search-index entries only. The underlying original mistakes
  // are never removed, including if one imported pack was interrupted.
  for (let offset = 0; offset < stale.length; offset += 100) {
    await db.mistakeCards.bulkDelete(stale.slice(offset, offset + 100));
  }
  return { repaired: completed, removedStaleCards: stale.length };
}

export async function refreshMistakeCard(db, mistakeId) {
  const mistake = await db.mistakes.get(mistakeId);
  if (!mistake) {
    await db.mistakeCards.delete(mistakeId);
    return;
  }
  await db.mistakeCards.put(buildMistakeCard(mistake));
}

async function queryFirstRoundCards(db, subjectId, q, offset, limit, reversed) {
  const firstRound = await db.reviewRoundItems
    .where('[subjectId+roundNo+order]')
    .between([subjectId, 1, 0], [subjectId, 1, Number.MAX_SAFE_INTEGER])
    .toArray();
  const memberIds = new Set(firstRound.map(row => String(row.mistakeId)));
  if (!memberIds.size) return [];

  // Do not call toArray() for every card before taking a 20-card page.
  // IndexedDB cursors short-circuit at offset + limit, even when filtering.
  // Search still covers the WHOLE current round, not only the visible page.
  const collection = db.mistakeCards.where('[subjectId+createdAtMs]')
    .between([subjectId, 0], [subjectId, Number.MAX_SAFE_INTEGER]);
  const ordered = reversed ? collection : collection.reverse();
  return ordered
    .filter(card => memberIds.has(String(card.id)) && cardMatchesKeyword(card, q))
    .offset(offset)
    .limit(limit)
    .toArray();
}

async function queryRoundCards(db, subjectId, roundNo, q, offset, limit, reversed) {
  const items = await db.reviewRoundItems
    .where('[subjectId+roundNo+order]')
    .between([subjectId, roundNo, 0], [subjectId, roundNo, Number.MAX_SAFE_INTEGER])
    .toArray();

  if (items.length === 0) return [];

  // For an unfiltered list, fetch only the requested page of card bodies.
  // Round member rows are tiny and retain the complete, user-defined ordering.
  if (!q) {
    const ordered = reversed ? [...items].reverse() : items;
    const pageItems = ordered.slice(offset, offset + limit);
    return (await db.mistakeCards.bulkGet(pageItems.map(item => item.mistakeId)))
      .filter(card => card && card.subjectId === subjectId);
  }

  const ids = [...new Set(items.map(item => item.mistakeId))];
  const cards = (await db.mistakeCards.bulkGet(ids))
    .filter(Boolean)
    .filter(card => card.subjectId === subjectId)
    .filter(card => cardMatchesKeyword(card, q));

  const orderMap = new Map(items.map((item, index) => [item.mistakeId, item.order ?? index]));
  cards.sort((a, b) => {
    const ao = orderMap.get(a.id) ?? 0;
    const bo = orderMap.get(b.id) ?? 0;
    return reversed ? bo - ao : ao - bo;
  });

  return cards.slice(offset, offset + limit);
}

export async function queryMistakeCards(db, {
  subjectId, keyword = '', offset = 0, limit = MISTAKE_PAGE_SIZE,
  roundNo = getSelectedReviewRound(subjectId), reversed = isMistakeListReversed(subjectId),
}) {
  if (!subjectId) return [];
  const q = normalizeSearchText(keyword);
  return roundNo <= 1
    ? queryFirstRoundCards(db, subjectId, q, offset, limit, reversed)
    : queryRoundCards(db, subjectId, roundNo, q, offset, limit, reversed);
}
