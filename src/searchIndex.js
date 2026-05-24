// src/searchIndex.js

export const MISTAKE_PAGE_SIZE = 20;

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

function getReviewCountSafe(logs) {
  if (!Array.isArray(logs)) return 0;
  return new Set(logs.map(ts => new Date(ts).toDateString())).size;
}

function getQuestionImages(mistake) {
  return mistake?.questionImages || (mistake?.questionImg ? [mistake.questionImg] : []);
}

function getAnalysisImages(mistake) {
  return mistake?.analysisImages || (mistake?.analysisImg ? [mistake.analysisImg] : []);
}

// 适配中文、英文、数字搜索。
// 中文：生成单字、二字、三字 token，例如“极限计算”会有“极限”“限计”“计算”。
// 英文/数字：按词生成 token，例如 cache、2026、chapter4。
export function createSearchTokens(text) {
  const normalized = normalizeSearchText(text);
  const tokens = new Set();

  if (!normalized) return [];

  const words = normalized.match(/[a-z0-9_./+-]+/g) || [];
  for (const word of words) {
    if (word.length >= 1) tokens.add(word);
  }

  const cjk = normalized.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i < cjk.length; i++) {
    tokens.add(cjk[i]);
  }

  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i <= cjk.length - n; i++) {
      tokens.add(cjk.slice(i, i + n));
    }
  }

  return Array.from(tokens).slice(0, 160);
}

function pickBestToken(keyword) {
  const tokens = createSearchTokens(keyword);
  if (tokens.length === 0) return '';
  return tokens.sort((a, b) => b.length - a.length)[0];
}

function cardMatchesKeyword(card, keyword) {
  const q = normalizeSearchText(keyword);
  if (!q) return true;

  const searchText = card.searchText || '';
  if (searchText.includes(q)) return true;

  const queryTokens = createSearchTokens(q).filter(t => t.length >= 2);
  if (queryTokens.length === 0) {
    return createSearchTokens(q).every(t => card.tokens?.includes(t));
  }

  return queryTokens.every(t => card.tokens?.includes(t));
}

// 从完整错题生成轻量卡片。
// 注意：这里不保存 base64 大图，只保存图片数量、复盘状态、搜索字段。
export function buildMistakeCard(mistake) {
  const questionImages = getQuestionImages(mistake);
  const analysisImages = getAnalysisImages(mistake);

  const createdAtMs = toTime(mistake.createdAt);
  const updatedAtMs = toTime(mistake.updatedAt || mistake.createdAt);

  const title = mistake.title || '未命名错题';
  const dateText = new Date(createdAtMs).toLocaleDateString();

  const searchText = normalizeSearchText([
    title,
    mistake.reflection || '',
    mistake.analysisText || '',
    dateText,
    mistake.isMastered ? '已掌握 熟练' : '',
    mistake.reflection ? '已复盘' : '待复盘'
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
    hasReflection: Boolean(normalizeSearchText(mistake.reflection)),
    hasAnalysis: Boolean(normalizeSearchText(mistake.analysisText) || analysisImages.length > 0),
    isMastered: Boolean(mistake.isMastered),
    reviewCount: getReviewCountSafe(mistake.reviewLogs),

    searchText,
    tokens: createSearchTokens(searchText)
  };
}

export async function rebuildAllMistakeCards(db) {
  const mistakes = await db.mistakes.toArray();
  const cards = mistakes
    .filter(m => m && m.id !== undefined && m.id !== null)
    .map(buildMistakeCard);

  await db.transaction('rw', db.mistakeCards, async () => {
    await db.mistakeCards.clear();
    if (cards.length > 0) {
      await db.mistakeCards.bulkPut(cards);
    }
  });

  return cards.length;
}

export async function refreshMistakeCard(db, mistakeId) {
  const mistake = await db.mistakes.get(mistakeId);

  if (!mistake) {
    await db.mistakeCards.delete(mistakeId);
    return;
  }

  await db.mistakeCards.put(buildMistakeCard(mistake));
}

export async function queryMistakeCards(db, {
  subjectId,
  keyword = '',
  offset = 0,
  limit = MISTAKE_PAGE_SIZE
}) {
  if (!subjectId) return [];

  const q = normalizeSearchText(keyword);

  // 普通列表：直接按 subjectId + createdAtMs 走复合索引分页。
  if (!q) {
    return db.mistakeCards
      .where('[subjectId+createdAtMs]')
      .between([subjectId, 0], [subjectId, Number.MAX_SAFE_INTEGER])
      .reverse()
      .offset(offset)
      .limit(limit)
      .toArray();
  }

  // 搜索：查轻量索引表，不查原始大图表。
  const anchor = pickBestToken(q);

  let candidates = [];
  if (anchor) {
    candidates = await db.mistakeCards
      .where('tokens')
      .equals(anchor)
      .toArray();
  } else {
    candidates = await db.mistakeCards
      .where('subjectId')
      .equals(subjectId)
      .toArray();
  }

  return candidates
    .filter(card => card.subjectId === subjectId)
    .filter(card => cardMatchesKeyword(card, q))
    .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
    .slice(offset, offset + limit);
}
