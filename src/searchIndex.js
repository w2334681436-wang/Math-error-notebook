// src/searchIndex.js
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

function getSelectedRoundNo(subjectId) {
  if (typeof localStorage === 'undefined') return 1;
  const raw = localStorage.getItem(`mathNotebook.selectedReviewRound.${subjectId}`);
  const n = Number(raw || 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

function getPendingOpenId(subjectId, roundNo) {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem('mathNotebook.pendingOpenMistake');
  if (!raw) return null;

  try {
    const data = JSON.parse(raw);
    if (String(data.subjectId) === String(subjectId) && Number(data.roundNo) === Number(roundNo)) {
      return data.mistakeId;
    }
  } catch {
    return null;
  }

  return null;
}

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
// 新复盘系统不再使用 reviewLogs/reviewCount，因此 reviewCount 永远为 0。
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
    hasReflection: Boolean(normalizeSearchText(mistake.reflection)),
    hasAnalysis: Boolean(normalizeSearchText(mistake.analysisText) || analysisImages.length > 0),
    isMastered: Boolean(mistake.isMastered),
    reviewCount: 0,
    searchText,
    tokens: createSearchTokens(searchText),
  };
}

export async function rebuildAllMistakeCards(db) {
  const mistakes = await db.mistakes.toArray();
  const cards = mistakes
    .filter(m => m && m.id !== undefined && m.id !== null)
    .map(buildMistakeCard);

  await db.transaction('rw', db.mistakeCards, async () => {
    await db.mistakeCards.clear();
    if (cards.length > 0) await db.mistakeCards.bulkPut(cards);
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

async function queryFirstRoundCards(db, subjectId, q, offset, limit, reversed) {
  if (!q) {
    const collection = db.mistakeCards
      .where('[subjectId+createdAtMs]')
      .between([subjectId, 0], [subjectId, Number.MAX_SAFE_INTEGER]);

    const orderedCollection = reversed ? collection : collection.reverse();

    return orderedCollection
      .offset(offset)
      .limit(limit)
      .toArray();
  }

  const anchor = pickBestToken(q);
  let candidates = [];

  if (anchor) {
    candidates = await db.mistakeCards.where('tokens').equals(anchor).toArray();
  } else {
    candidates = await db.mistakeCards.where('subjectId').equals(subjectId).toArray();
  }

  return candidates
    .filter(card => card.subjectId === subjectId)
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

  const cards = (await db.mistakeCards.bulkGet(items.map(item => item.mistakeId)))
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

function movePendingCardToTop(cards, pendingId) {
  if (!pendingId || !Array.isArray(cards) || cards.length === 0) return cards;

  const index = cards.findIndex(card => String(card.id) === String(pendingId));
  if (index <= 0) return cards;

  const copy = [...cards];
  const [target] = copy.splice(index, 1);
  copy.unshift(target);
  return copy;
}

export async function queryMistakeCards(db, { subjectId, keyword = '', offset = 0, limit = MISTAKE_PAGE_SIZE }) {
  if (!subjectId) return [];

  const q = normalizeSearchText(keyword);
  const roundNo = getSelectedRoundNo(subjectId);
  const pendingId = getPendingOpenId(subjectId, roundNo);
  const reversed = isMistakeListReversed(subjectId);
  let cards = [];

  if (roundNo <= 1) {
    cards = await queryFirstRoundCards(db, subjectId, q, offset, limit, reversed);
  } else {
    cards = await queryRoundCards(db, subjectId, roundNo, q, offset, limit, reversed);
  }

  // “上次刷到”跳转时，把目标卡片提到当前列表第一项，避免分页未加载导致找不到。
  if (offset === 0 && pendingId) {
    const exists = cards.some(card => String(card.id) === String(pendingId));
    if (!exists) {
      const pendingCard = await db.mistakeCards.get(pendingId);
      if (pendingCard && pendingCard.subjectId === subjectId && cardMatchesKeyword(pendingCard, q)) {
        cards = [pendingCard, ...cards.filter(card => String(card.id) !== String(pendingId))].slice(0, limit);
      }
    } else {
      cards = movePendingCardToTop(cards, pendingId);
    }
  }

  return cards;
}
