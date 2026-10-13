// src/searchIndex.js
import {
  getExcludedMistakeIds,
  getSelectedReviewRound,
} from './reviewRoundActions';

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
  return mistake?.questionImages || (mistake?.questionImg ? [mistake.questionImg] : []);
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

export async function refreshMistakeCard(db, mistakeId) {
  const mistake = await db.mistakes.get(mistakeId);
  if (!mistake) {
    await db.mistakeCards.delete(mistakeId);
    return;
  }
  await db.mistakeCards.put(buildMistakeCard(mistake));
}

async function queryFirstRoundCards(db, subjectId, q, offset, limit, reversed) {
  const excludedIds = await getExcludedMistakeIds(db, subjectId, 1);

  if (!q) {
    const collection = db.mistakeCards
      .where('[subjectId+createdAtMs]')
      .between([subjectId, 0], [subjectId, Number.MAX_SAFE_INTEGER]);

    const orderedCollection = reversed ? collection : collection.reverse();

    const cards = await orderedCollection.toArray();
    return cards
      .filter(card => !excludedIds.has(String(card.id)))
      .slice(offset, offset + limit);
  }

  // tokens 有容量上限，不能用它排除长解析末尾、英文子串等合法命中。
  const candidates = await db.mistakeCards.where('subjectId').equals(subjectId).toArray();
  return candidates
    .filter(card => !excludedIds.has(String(card.id)))
    .filter(card => cardMatchesKeyword(card, q))
    .sort((a, b) => {
      const at = a.createdAtMs || 0;
      const bt = b.createdAtMs || 0;
      return reversed ? at - bt : bt - at;
    })
    .slice(offset, offset + limit);
}

async function queryRoundCards(db, subjectId, roundNo, q, offset, limit, reversed) {
  const items = await db.reviewRoundItems
    .where('[subjectId+roundNo+order]')
    .between([subjectId, roundNo, 0], [subjectId, roundNo, Number.MAX_SAFE_INTEGER])
    .toArray();

  if (items.length === 0) return [];

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
