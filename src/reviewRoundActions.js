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
  const previous = getSelectedReviewRound(subjectId, storage);
  const next = normalizeRoundNo(roundNo);
  storage.setItem(
    `${SELECTED_REVIEW_ROUND_PREFIX}${subjectId}`,
    String(next)
  );
  if (previous !== next && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('math-notebook-list-context-change', { detail: { subjectId } }));
  }
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

// 第一轮和后续轮次现在同样是“真实成员表”。无成员行 = 本轮确实不存在该题。
export async function isMistakeInReviewRound(db, { subjectId, roundNo, mistakeId }) {
  if (!db.reviewRoundItems) return false;
  const normalizedRound = normalizeRoundNo(roundNo);
  const item = await db.reviewRoundItems
    .where('[subjectId+roundNo+mistakeId]')
    .equals([subjectId, normalizedRound, mistakeId])
    .first();
  return Boolean(item);
}

// “移出本轮”永久删除当前轮次的成员行，不创建任何隐藏或排除标记。
// 原题存放于 mistakes，以便其它轮次及后续手动导入继续复用。
export async function removeMistakeFromReviewRound(db, {
  subjectId, roundNo, mistakeId,
}) {
  const normalizedRound = normalizeRoundNo(roundNo);
  if (!db.reviewRoundItems) throw new Error('当前数据库尚未完成轮次表升级');

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
