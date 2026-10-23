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

// “移出本轮”永久删除本轮成员行，不写隐藏标记。
// 若原题已不属于任何轮次，则连同原题/卡片一起删除，杜绝孤儿记录拦截下次导入。
// 若原题仍属于其他轮次，就只删当前成员行，保留其余轮次的内容。
export async function removeMistakeFromReviewRound(db, {
  subjectId, roundNo, mistakeId,
}) {
  const normalizedRound = normalizeRoundNo(roundNo);
  if (!db.reviewRoundItems) throw new Error('当前数据库尚未完成轮次表升级');

  return db.transaction('rw', db.reviewRoundItems, db.mistakes, db.mistakeCards, async () => {
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

    let originalDeleted = false;
    if (removedCount > 0) {
      const remainingMembershipCount = await db.reviewRoundItems.where('mistakeId').equals(mistakeId).count();
      if (remainingMembershipCount === 0) {
        // 没有任何轮次使用该题：彻底删除正文/图片与轻量搜索卡片。
        // 下次导入同一 sourceId 应是新题，不是“恢复隐藏项”。
        await db.mistakes.delete(mistakeId);
        await db.mistakeCards.delete(mistakeId);
        originalDeleted = true;
      }
    }
    return {
      removed: removedCount > 0,
      roundNo: normalizedRound,
      remainingInRound,
      originalDeleted
    };
  });
}
