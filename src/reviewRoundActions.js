export const FIRST_REVIEW_ROUND = 1;
export const SELECTED_REVIEW_ROUND_PREFIX = 'mathNotebook.selectedReviewRound.';
export const LAST_REVIEW_PROGRESS_PREFIX = 'mathNotebook.lastReviewProgress.';

function normalizeRoundNo(roundNo) {
  const value = Number(roundNo);
  return Number.isFinite(value) && value >= FIRST_REVIEW_ROUND
    ? Math.floor(value)
    : FIRST_REVIEW_ROUND;
}

export function getSelectedReviewRound(subjectId, storage = globalThis.localStorage) {
  if (!storage || subjectId === null || subjectId === undefined) return FIRST_REVIEW_ROUND;
  return normalizeRoundNo(storage.getItem(`${SELECTED_REVIEW_ROUND_PREFIX}${subjectId}`));
}

export function setSelectedReviewRound(subjectId, roundNo, storage = globalThis.localStorage) {
  if (!storage || subjectId === null || subjectId === undefined) return;
  storage.setItem(
    `${SELECTED_REVIEW_ROUND_PREFIX}${subjectId}`,
    String(normalizeRoundNo(roundNo))
  );
}

export function getLastReviewProgressKey(subjectId, roundNo) {
  return `${LAST_REVIEW_PROGRESS_PREFIX}${subjectId}.${normalizeRoundNo(roundNo)}`;
}

export async function getExcludedMistakeIds(db, subjectId, roundNo = FIRST_REVIEW_ROUND) {
  if (!db.reviewRoundExclusions) return new Set();

  const normalizedRound = normalizeRoundNo(roundNo);
  const exclusions = await db.reviewRoundExclusions
    .where('[subjectId+roundNo]')
    .equals([subjectId, normalizedRound])
    .toArray();

  return new Set(exclusions.map(item => String(item.mistakeId)));
}

export async function isMistakeInReviewRound(db, { subjectId, roundNo, mistakeId }) {
  const normalizedRound = normalizeRoundNo(roundNo);

  if (normalizedRound === FIRST_REVIEW_ROUND) {
    if (!db.reviewRoundExclusions) return true;
    const exclusion = await db.reviewRoundExclusions
      .where('[subjectId+roundNo+mistakeId]')
      .equals([subjectId, normalizedRound, mistakeId])
      .first();
    return !exclusion;
  }

  if (!db.reviewRoundItems) return false;
  const item = await db.reviewRoundItems
    .where('[subjectId+roundNo+mistakeId]')
    .equals([subjectId, normalizedRound, mistakeId])
    .first();
  return Boolean(item);
}

// 只修改“当前轮次的成员关系”，绝不删除 mistakes 原题或其他轮次记录。
export async function removeMistakeFromReviewRound(db, {
  subjectId,
  roundNo,
  mistakeId,
  title = '',
}) {
  const normalizedRound = normalizeRoundNo(roundNo);

  if (normalizedRound === FIRST_REVIEW_ROUND) {
    if (!db.reviewRoundExclusions) {
      throw new Error('当前数据库尚未完成轮次删除功能升级');
    }

    const existing = await db.reviewRoundExclusions
      .where('[subjectId+roundNo+mistakeId]')
      .equals([subjectId, normalizedRound, mistakeId])
      .first();

    if (!existing) {
      await db.reviewRoundExclusions.add({
        subjectId,
        roundNo: normalizedRound,
        mistakeId,
        title,
        removedAt: new Date(),
      });
    }

    return { removed: !existing, roundNo: normalizedRound };
  }

  if (!db.reviewRoundItems) {
    throw new Error('当前数据库尚未完成复习轮次初始化');
  }

  const removedCount = await db.reviewRoundItems
    .where('[subjectId+roundNo+mistakeId]')
    .equals([subjectId, normalizedRound, mistakeId])
    .delete();

  const remainingInRound = await db.reviewRoundItems
    .where('[subjectId+roundNo+order]')
    .between(
      [subjectId, normalizedRound, 0],
      [subjectId, normalizedRound, Number.MAX_SAFE_INTEGER]
    )
    .count();

  return { removed: removedCount > 0, roundNo: normalizedRound, remainingInRound };
}
