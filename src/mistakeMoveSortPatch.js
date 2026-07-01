// src/mistakeMoveSortPatch.js
// 这个文件只增强错题列表交互，不改原始数据结构：
// 1. 给每张错题卡片补一个“移动”按钮，可移动到其他学科。
// 2. 给列表补一个“倒序/还原”按钮，排序由 searchIndex.js 从 IndexedDB 查询时完成。
// 3. 加固编辑页图片选择按钮，避免点了没有反应。

import { db } from './db';
import { buildMistakeCard, getMistakeListReverseKey, isMistakeListReversed } from './searchIndex';

const PATCHED = 'data-mn-move-sort-patched';
const CARD_PATCHED = 'data-mn-move-button-patched';
const IMAGE_INPUT_PATCHED = 'data-mn-image-input-patched';
const IMAGE_BACKUP_BUTTON_PATCHED = 'data-mn-backup-image-button-patched';
const SORT_BUTTON_ID = 'mn-global-list-reverse-toggle';
let rafId = 0;

function buttonStyle(extra = {}) {
  return Object.assign({
    border: '0',
    borderRadius: '999px',
    padding: '6px 10px',
    fontSize: '12px',
    fontWeight: '800',
    cursor: 'pointer',
    lineHeight: '1',
    boxShadow: '0 2px 8px rgba(15, 23, 42, 0.10)',
    WebkitTapHighlightColor: 'transparent',
  }, extra);
}

function showToast(message) {
  const old = document.getElementById('mn-patch-toast');
  old?.remove();

  const toast = document.createElement('div');
  toast.id = 'mn-patch-toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position: 'fixed',
    left: '50%',
    bottom: '96px',
    transform: 'translateX(-50%)',
    zIndex: '999999',
    background: 'rgba(15, 23, 42, 0.92)',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '999px',
    fontSize: '13px',
    fontWeight: '700',
    boxShadow: '0 12px 30px rgba(15, 23, 42, 0.25)',
    maxWidth: '86vw',
    textAlign: 'center',
  });

  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 1800);
}

function stopCardOpen(event) {
  event.preventDefault();
  event.stopPropagation();
}

function getMistakeIdFromCard(card) {
  const raw = card?.id || '';
  const match = raw.match(/^mistake-card-(.+)$/);
  if (!match) return null;

  const value = match[1];
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && String(numberValue) === value ? numberValue : value;
}

async function findActiveSubject() {
  const subjects = await db.subjects.toArray();
  if (subjects.length === 0) return null;

  const selectedButton = Array.from(document.querySelectorAll('nav button'))
    .find(button => {
      const text = button.textContent?.trim();
      const className = String(button.getAttribute('class') || '');
      return text && className.includes('bg-blue-600') && subjects.some(subject => subject.name === text);
    });

  const selectedName = selectedButton?.textContent?.trim();
  return subjects.find(subject => subject.name === selectedName) || subjects[0];
}

function closeMoveDialog() {
  document.getElementById('mn-move-dialog')?.remove();
}

function createMoveDialog({ mistake, subjects }) {
  closeMoveDialog();

  const targets = subjects.filter(subject => String(subject.id) !== String(mistake.subjectId));
  const overlay = document.createElement('div');
  overlay.id = 'mn-move-dialog';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '999998',
    background: 'rgba(15, 23, 42, 0.42)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '18px',
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    width: 'min(420px, 94vw)',
    maxHeight: '80vh',
    overflowY: 'auto',
    background: '#fff',
    borderRadius: '18px',
    boxShadow: '0 22px 70px rgba(15, 23, 42, 0.28)',
    padding: '16px',
  });
  panel.addEventListener('click', event => event.stopPropagation());

  const title = document.createElement('div');
  title.textContent = '移动错题到其他学科';
  Object.assign(title.style, {
    fontSize: '16px',
    fontWeight: '900',
    color: '#111827',
    marginBottom: '6px',
  });

  const subTitle = document.createElement('div');
  subTitle.textContent = mistake.title || '未命名错题';
  Object.assign(subTitle.style, {
    fontSize: '12px',
    color: '#6b7280',
    marginBottom: '14px',
    lineHeight: '1.5',
    wordBreak: 'break-word',
  });

  panel.appendChild(title);
  panel.appendChild(subTitle);

  if (targets.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = '当前只有一个学科，请先在顶部添加新学科。';
    Object.assign(empty.style, {
      padding: '14px',
      background: '#f3f4f6',
      color: '#6b7280',
      borderRadius: '12px',
      fontSize: '13px',
      fontWeight: '700',
    });
    panel.appendChild(empty);
  }

  targets.forEach(subject => {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = subject.name;
    Object.assign(item.style, buttonStyle({
      width: '100%',
      display: 'block',
      textAlign: 'left',
      padding: '13px 14px',
      marginTop: '8px',
      background: '#eff6ff',
      color: '#1d4ed8',
      borderRadius: '12px',
      boxShadow: 'none',
    }));

    item.addEventListener('click', async event => {
      stopCardOpen(event);
      item.disabled = true;
      item.textContent = `正在移动到 ${subject.name}...`;
      try {
        await moveMistakeToSubject(mistake.id, subject.id);
        closeMoveDialog();
        showToast(`已移动到：${subject.name}`);
      } catch (error) {
        console.error(error);
        item.disabled = false;
        item.textContent = subject.name;
        alert(`移动失败：${error.message || error}`);
      }
    });

    panel.appendChild(item);
  });

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = '取消';
  Object.assign(cancel.style, buttonStyle({
    width: '100%',
    marginTop: '12px',
    padding: '12px 14px',
    background: '#f3f4f6',
    color: '#374151',
    boxShadow: 'none',
  }));
  cancel.addEventListener('click', closeMoveDialog);
  panel.appendChild(cancel);

  overlay.appendChild(panel);
  overlay.addEventListener('click', closeMoveDialog);
  document.body.appendChild(overlay);
}

async function moveMistakeToSubject(mistakeId, targetSubjectId) {
  const mistake = await db.mistakes.get(mistakeId);
  if (!mistake) throw new Error('没有找到这道错题，可能已经被删除。');
  if (String(mistake.subjectId) === String(targetSubjectId)) return;

  const now = new Date();
  const tables = [db.mistakes, db.mistakeCards];
  if (db.reviewRoundItems) tables.push(db.reviewRoundItems);

  await db.transaction('rw', ...tables, async () => {
    await db.mistakes.update(mistakeId, {
      subjectId: targetSubjectId,
      updatedAt: now,
    });

    const updated = await db.mistakes.get(mistakeId);
    await db.mistakeCards.put(buildMistakeCard(updated));

    // 跨学科后，原来的“第二轮/第三轮”归属已经不可靠，清掉旧轮次项，避免错题在旧学科轮次里残留。
    if (db.reviewRoundItems) {
      await db.reviewRoundItems.where('mistakeId').equals(mistakeId).delete();
    }
  });
}

async function openMoveDialog(mistakeId) {
  const [mistake, subjects] = await Promise.all([
    db.mistakes.get(mistakeId),
    db.subjects.toArray(),
  ]);

  if (!mistake) {
    alert('没有找到这道错题，可能已经被删除。');
    return;
  }

  createMoveDialog({ mistake, subjects });
}

function patchMistakeCards() {
  document.querySelectorAll('[id^="mistake-card-"]').forEach(card => {
    if (card.getAttribute(CARD_PATCHED) === '1') return;

    const mistakeId = getMistakeIdFromCard(card);
    if (mistakeId === null || mistakeId === undefined) return;

    card.setAttribute(CARD_PATCHED, '1');
    card.style.position = card.style.position || 'relative';

    const moveButton = document.createElement('button');
    moveButton.type = 'button';
    moveButton.textContent = '移动';
    moveButton.title = '移动到其他学科';
    Object.assign(moveButton.style, buttonStyle({
      position: 'absolute',
      top: '8px',
      right: '8px',
      zIndex: '5',
      background: '#fef3c7',
      color: '#92400e',
      border: '1px solid #fde68a',
    }));

    moveButton.addEventListener('pointerdown', stopCardOpen, true);
    moveButton.addEventListener('mousedown', stopCardOpen, true);
    moveButton.addEventListener('touchstart', event => event.stopPropagation(), { capture: true, passive: true });
    moveButton.addEventListener('click', async event => {
      stopCardOpen(event);
      await openMoveDialog(mistakeId);
    });

    card.appendChild(moveButton);
  });
}

async function bumpSubjectCards(subjectId) {
  if (!subjectId) return;
  const count = await db.mistakeCards.where('subjectId').equals(subjectId).count();
  if (count === 0) return;

  const sortTick = Date.now();
  await db.mistakeCards
    .where('subjectId')
    .equals(subjectId)
    .modify(card => {
      card._sortTick = sortTick;
    });
}

async function patchSortButton() {
  const searchInput = Array.from(document.querySelectorAll('input'))
    .find(input => input.placeholder?.includes('搜索错题'));
  if (!searchInput) return;

  const searchBox = searchInput.closest('div');
  if (!searchBox || document.getElementById(SORT_BUTTON_ID)) {
    updateSortButtonLabel().catch(() => {});
    return;
  }

  const bar = document.createElement('div');
  bar.id = SORT_BUTTON_ID;
  Object.assign(bar.style, {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: '8px',
    margin: '-4px 0 12px',
  });

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-role', 'reverse-toggle');
  Object.assign(button.style, buttonStyle({
    background: '#eef2ff',
    color: '#4338ca',
    border: '1px solid #c7d2fe',
    padding: '9px 12px',
  }));

  button.addEventListener('click', async event => {
    stopCardOpen(event);
    const subject = await findActiveSubject();
    if (!subject) {
      alert('没有找到当前学科。');
      return;
    }

    const key = getMistakeListReverseKey(subject.id);
    const nextReversed = !isMistakeListReversed(subject.id);
    localStorage.setItem(key, nextReversed ? '1' : '0');
    await updateSortButtonLabel();
    await bumpSubjectCards(subject.id);
    showToast(nextReversed ? '已切换为倒序显示' : '已还原默认顺序');
  });

  bar.appendChild(button);
  searchBox.insertAdjacentElement('afterend', bar);
  await updateSortButtonLabel();
}

async function updateSortButtonLabel() {
  const wrapper = document.getElementById(SORT_BUTTON_ID);
  const button = wrapper?.querySelector('button[data-role="reverse-toggle"]');
  if (!button) return;

  const subject = await findActiveSubject();
  const reversed = subject ? isMistakeListReversed(subject.id) : false;
  button.textContent = reversed ? '还原顺序' : '倒序显示';
  button.title = reversed ? '恢复默认顺序' : '按数据库完整倒序显示全部错题';
}

function findUploadContainer(input) {
  let node = input.parentElement;
  let depth = 0;
  while (node && depth < 5) {
    const text = node.textContent || '';
    if (text.includes('添加图片') || text.includes('添加补充截图')) return node;
    node = node.parentElement;
    depth += 1;
  }
  return input.parentElement;
}

function removeLegacyBackupButtons() {
  document.querySelectorAll('[data-role="backup-image-picker"], [data-mn-backup-image-icon="1"]').forEach(element => {
    element.remove();
  });
}

function assignFilesToInput(targetInput, fileList) {
  if (!targetInput || !fileList || fileList.length === 0) return false;

  try {
    targetInput.files = fileList;
    return targetInput.files?.length === fileList.length;
  } catch (_) {
    // 某些浏览器不允许直接赋值 FileList，下面用 DataTransfer 兜底。
  }

  try {
    const dataTransfer = new DataTransfer();
    Array.from(fileList).forEach(file => dataTransfer.items.add(file));
    targetInput.files = dataTransfer.files;
    return targetInput.files?.length === fileList.length;
  } catch (_) {
    return false;
  }
}

function dispatchNativeFileChange(input) {
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function isMistakeFormRootCandidate(node) {
  const text = node?.textContent || '';
  return (text.includes('记录错题') || text.includes('编辑错题'))
    && text.includes('题目图片')
    && text.includes('答案解析');
}

function findMistakeFormRoot() {
  const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
    .filter(element => /记录错题|编辑错题/.test(element.textContent || ''));

  for (const heading of headings) {
    let node = heading;
    let depth = 0;
    while (node && node !== document.body && depth < 8) {
      if (isMistakeFormRootCandidate(node)) return node;
      node = node.parentElement;
      depth += 1;
    }
  }

  return null;
}

function getFormImageInputs(root) {
  const inputs = Array.from(root.querySelectorAll('input[type="file"][accept*="image"]'))
    .filter(input => input.getAttribute('data-mn-quick-upload-input') !== '1')
    .filter(input => !input.closest('[data-role="backup-image-picker"]'));

  const uploadInputs = inputs.filter(input => {
    const container = findUploadContainer(input);
    const text = container?.textContent || '';
    return text.includes('添加图片');
  });

  return {
    question: uploadInputs[0] || inputs[0] || null,
    analysis: uploadInputs[1] || inputs[1] || null,
  };
}

function resolveTargetInput(kind) {
  const root = findMistakeFormRoot();
  if (!root) return null;
  return getFormImageInputs(root)[kind] || null;
}

function findQuestionAnchor(root) {
  const heading = Array.from(root.querySelectorAll('h1, h2, h3'))
    .find(element => /记录错题|编辑错题/.test(element.textContent || ''));
  if (heading) return heading;

  return Array.from(root.querySelectorAll('label, div, span'))
    .find(element => (element.textContent || '').includes('题目图片')) || null;
}

function findAnalysisAnchor(root) {
  const labels = Array.from(root.querySelectorAll('label'));
  const label = labels.find(element => (element.textContent || '').includes('答案解析'));
  if (label) return label;

  const candidates = Array.from(root.querySelectorAll('div, span, p'));
  return candidates
    .filter(element => (element.textContent || '').includes('答案解析'))
    .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length)[0] || null;
}

function quickUploadButtonStyle() {
  return {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '26px',
    padding: '0 8px',
    borderRadius: '999px',
    border: '1px solid #dbeafe',
    background: '#f8fafc',
    color: '#2563eb',
    fontSize: '12px',
    fontWeight: '800',
    lineHeight: '1',
    cursor: 'pointer',
    boxShadow: '0 1px 4px rgba(15, 23, 42, 0.06)',
    overflow: 'hidden',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };
}

function createQuickUploadControl(kind) {
  const shortcut = kind === 'question' ? 'Ctrl+Alt+Q' : 'Ctrl+Alt+A';
  const labelText = kind === 'question' ? '错题图' : '解析图';
  const title = kind === 'question'
    ? '上传错题图片，支持一次选择多张图片'
    : '上传解析图片，支持一次选择多张图片';

  const wrap = document.createElement('span');
  wrap.setAttribute('data-mn-quick-upload-wrap', kind);
  Object.assign(wrap.style, {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    marginLeft: '8px',
    verticalAlign: 'middle',
    flexShrink: '0',
  });

  const picker = document.createElement('label');
  picker.setAttribute('data-mn-quick-upload-button', kind);
  picker.title = `${title}；快捷键：${shortcut}`;
  Object.assign(picker.style, quickUploadButtonStyle());

  const icon = document.createElement('span');
  icon.textContent = '↥';
  Object.assign(icon.style, {
    fontSize: '14px',
    lineHeight: '1',
    marginRight: '3px',
    pointerEvents: 'none',
  });

  const text = document.createElement('span');
  text.textContent = '上传';
  text.style.pointerEvents = 'none';

  const quickInput = document.createElement('input');
  quickInput.type = 'file';
  quickInput.accept = 'image/*';
  quickInput.multiple = true;
  quickInput.setAttribute('data-mn-quick-upload-input', '1');
  quickInput.setAttribute('aria-label', title);
  Object.assign(quickInput.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    opacity: '0',
    cursor: 'pointer',
  });

  // 避免外层上传卡片、拖拽或表单捕获逻辑抢走点击。
  ['pointerdown', 'mousedown', 'touchstart', 'click'].forEach(type => {
    picker.addEventListener(type, event => {
      event.stopPropagation();
    }, { capture: true, passive: type === 'touchstart' });
  });

  quickInput.addEventListener('click', event => {
    event.stopPropagation();
    quickInput.value = '';
  }, true);

  quickInput.addEventListener('change', () => {
    const files = quickInput.files;
    if (!files || files.length === 0) return;

    const targetInput = resolveTargetInput(kind);
    if (!targetInput) {
      alert(kind === 'question'
        ? '没有找到错题图片上传入口，请刷新页面后再试。'
        : '没有找到解析图片上传入口，可能当前解析图片已达到数量上限。');
      quickInput.value = '';
      return;
    }

    targetInput.setAttribute('multiple', 'multiple');
    targetInput.value = '';

    const assigned = assignFilesToInput(targetInput, files);
    if (assigned) {
      dispatchNativeFileChange(targetInput);
      showToast(`${labelText}已选择 ${files.length} 张`);
    } else {
      showToast('请在弹出的窗口里重新选择图片');
      window.setTimeout(() => {
        targetInput.value = '';
        targetInput.click();
      }, 0);
    }

    quickInput.value = '';
  });

  const shortcutMark = document.createElement('span');
  shortcutMark.textContent = `${shortcut} ${labelText}`;
  Object.assign(shortcutMark.style, {
    color: '#94a3b8',
    fontSize: '10px',
    fontWeight: '700',
    lineHeight: '1',
    whiteSpace: 'nowrap',
  });

  picker.appendChild(icon);
  picker.appendChild(text);
  picker.appendChild(quickInput);
  wrap.appendChild(picker);
  wrap.appendChild(shortcutMark);
  return wrap;
}

function prepareAnchorForInlineActions(anchor) {
  if (!anchor) return;
  const tag = anchor.tagName?.toLowerCase();

  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'label') {
    anchor.style.display = 'flex';
    anchor.style.alignItems = 'center';
    anchor.style.gap = anchor.style.gap || '6px';
    anchor.style.flexWrap = 'wrap';
  }
}

function attachQuickUpload(anchor, kind) {
  if (!anchor) return;
  const old = anchor.querySelector?.(`[data-mn-quick-upload-wrap="${kind}"]`);
  if (old) return;

  prepareAnchorForInlineActions(anchor);
  anchor.appendChild(createQuickUploadControl(kind));
}

function patchQuickUploadControls() {
  removeLegacyBackupButtons();

  const root = findMistakeFormRoot();
  if (!root) {
    document.querySelectorAll('[data-mn-quick-upload-wrap]').forEach(element => element.remove());
    return;
  }

  const inputs = getFormImageInputs(root);
  if (inputs.question) {
    inputs.question.setAttribute('multiple', 'multiple');
    inputs.question.setAttribute('data-mn-form-upload-kind', 'question');
  }
  if (inputs.analysis) {
    inputs.analysis.setAttribute('multiple', 'multiple');
    inputs.analysis.setAttribute('data-mn-form-upload-kind', 'analysis');
  }

  attachQuickUpload(findQuestionAnchor(root), 'question');
  attachQuickUpload(findAnalysisAnchor(root), 'analysis');
}

function patchImageInputs() {
  removeLegacyBackupButtons();

  document.querySelectorAll('input[type="file"][accept*="image"]').forEach(input => {
    if (input.getAttribute('data-mn-quick-upload-input') === '1') return;

    const alreadyPatched = input.getAttribute(IMAGE_INPUT_PATCHED) === '1';
    const container = findUploadContainer(input);
    const isImageButton = /添加图片|添加补充截图/.test(container?.textContent || '');

    if (isImageButton) input.setAttribute('multiple', 'multiple');

    if (!alreadyPatched) {
      input.setAttribute(IMAGE_INPUT_PATCHED, '1');

      Object.assign(input.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        display: 'block',
        opacity: '0',
        cursor: 'pointer',
        zIndex: '20',
        pointerEvents: 'auto',
      });

      input.addEventListener('click', () => {
        // 允许连续选择同一张图片，否则浏览器可能不会触发 change。
        input.value = '';
      }, true);
    }

    if (container && container.getAttribute(PATCHED) !== '1') {
      container.setAttribute(PATCHED, '1');
      const currentPosition = window.getComputedStyle(container).position;
      if (currentPosition === 'static') container.style.position = 'relative';

      container.addEventListener('click', event => {
        if (event.target === input) return;
        if (event.target?.closest?.('[data-mn-quick-upload-wrap]')) return;
        const removeButton = event.target?.closest?.('button');
        if (removeButton) return;
        event.preventDefault();
        event.stopPropagation();
        input.value = '';
        input.click();
      }, true);
    }
  });

  patchQuickUploadControls();
}

function openQuickUploadByShortcut(kind) {
  const root = findMistakeFormRoot();
  if (!root) return false;

  const pickerInput = root.querySelector(`input[data-mn-quick-upload-input="1"]`)
    && root.querySelector(`[data-mn-quick-upload-wrap="${kind}"] input[data-mn-quick-upload-input="1"]`);

  if (!pickerInput) return false;
  pickerInput.value = '';
  pickerInput.click();
  return true;
}

function handleQuickUploadShortcut(event) {
  if (event.defaultPrevented) return;
  if (!(event.ctrlKey || event.metaKey) || !event.altKey || event.shiftKey) return;

  const key = String(event.key || '').toLowerCase();
  if (key === 'q') {
    if (openQuickUploadByShortcut('question')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  if (key === 'a') {
    if (openQuickUploadByShortcut('analysis')) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
}

function runPatch() {
  patchMistakeCards();
  patchSortButton().catch(error => console.error('[mistakeMoveSortPatch] sort button patch failed:', error));
  patchImageInputs();
}

function schedulePatch() {
  if (rafId) return;
  rafId = window.requestAnimationFrame(() => {
    rafId = 0;
    runPatch();
  });
}

function boot() {
  runPatch();
  const observer = new MutationObserver(schedulePatch);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  window.addEventListener('focus', schedulePatch);
  document.addEventListener('keydown', handleQuickUploadShortcut, true);
  window.setInterval(schedulePatch, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
