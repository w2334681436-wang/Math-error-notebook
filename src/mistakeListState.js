import { MISTAKE_PAGE_SIZE } from './searchIndex';

export const LIST_CONTEXT_EVENT = 'math-notebook-list-context-change';
const STATE_PREFIX = 'mathNotebook.mistakeListState.';

export function readMistakeListState(subjectId, roundNo, storage = globalThis.localStorage) {
  let saved;
  try {
    saved = JSON.parse(storage?.getItem(`${STATE_PREFIX}${subjectId}.${roundNo}`) || 'null');
  } catch { /* 损坏或不可用的浏览记录不影响错题数据。 */ }
  return {
    keyword: typeof saved?.keyword === 'string' ? saved.keyword : '',
    visibleLimit: Number.isSafeInteger(saved?.visibleLimit) && saved.visibleLimit >= MISTAKE_PAGE_SIZE
      ? saved.visibleLimit : MISTAKE_PAGE_SIZE,
    scrollTop: Number.isFinite(saved?.scrollTop) ? Math.max(0, saved.scrollTop) : 0,
    anchorId: saved?.anchorId ?? null,
    anchorOffset: Number.isFinite(saved?.anchorOffset) ? saved.anchorOffset : 0,
  };
}

export function writeMistakeListState(subjectId, roundNo, state, storage = globalThis.localStorage) {
  if (subjectId === null || subjectId === undefined) return;
  try {
    storage?.setItem(`${STATE_PREFIX}${subjectId}.${roundNo}`, JSON.stringify(state));
  } catch { /* 存储空间不足时仍允许浏览、编辑和刷题。 */ }
}

export function notifyListContextChanged(subjectId) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LIST_CONTEXT_EVENT, { detail: { subjectId } }));
  }
}

export function clearMistakeNavigationState(storage = globalThis.localStorage) {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('math-notebook-reset-navigation'));
  if (!storage) return;
  try {
    const prefixes = [STATE_PREFIX, 'mathNotebook.lastReviewProgress.', 'mathNotebook.selectedReviewRound.'];
    for (const key of Object.keys(storage)) {
      if (prefixes.some(prefix => key.startsWith(prefix))) storage.removeItem(key);
    }
    storage.removeItem('mathNotebook.activeMistakeId');
    storage.removeItem('mathNotebook.pendingOpenMistake');
    storage.removeItem('mathNotebook.activeSubjectId');
  } catch { /* 不让浏览偏好清理阻止成功导入。 */ }
}
