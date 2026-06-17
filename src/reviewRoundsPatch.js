// src/reviewRoundsPatch.js
// 新复盘轮次系统 UI 可靠修正版：
// 1. 刷题轮次目录固定嵌入“科目标题栏右侧”，不再另外生成一整行。
// 2. 只在主页错题列表显示轮次目录，避免遮挡题目详情。
// 3. “加入下一轮/已掌握”只在打开解析后出现，并插入原详情页底部按钮栏。
// 4. 打开题目/查看解析不记录刷过；只有点击两个决策按钮才记录。
import { db } from './db';
import { refreshMistakeCard } from './searchIndex';

const SELECTED_ROUND_PREFIX = 'mathNotebook.selectedReviewRound.';
const LAST_PROGRESS_PREFIX = 'mathNotebook.lastReviewProgress.';
const ACTIVE_MISTAKE_KEY = 'mathNotebook.activeMistakeId';
const PENDING_OPEN_KEY = 'mathNotebook.pendingOpenMistake';
const ROOT_ID = 'math-review-rounds-root';
const MENU_ID = 'math-review-round-menu-floating';
const DECISION_BAR_ID = 'math-review-decision-inline';

let roundMenuOpen = false;
let renderTimer = null;
let lastRootBox = null;

function toNumber(value, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isElementVisible(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

function isInsideReviewPatchUi(el) {
  return Boolean(el?.closest?.(`#${ROOT_ID}, #${MENU_ID}, #${DECISION_BAR_ID}, #math-review-toast`));
}

function buttonText(button) {
  return (button?.textContent || '').replace(/\s+/g, ' ').trim();
}

function safeParseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getSelectedRound(subjectId) {
  const raw = localStorage.getItem(`${SELECTED_ROUND_PREFIX}${subjectId}`);
  const n = toNumber(raw, 1);
  return n >= 1 ? Math.floor(n) : 1;
}

function setSelectedRound(subjectId, roundNo) {
  localStorage.setItem(`${SELECTED_ROUND_PREFIX}${subjectId}`, String(Math.max(1, Math.floor(roundNo))));
}

function lastProgressKey(subjectId, roundNo) {
  return `${LAST_PROGRESS_PREFIX}${subjectId}.${roundNo}`;
}

function getRoundName(roundNo) {
  return roundNo === 1 ? '第一轮刷题' : `第${roundNo}轮刷题`;
}

function isMistakeListPageVisible() {
  return Boolean(
    document.querySelector('input[placeholder*="搜索错题"]') ||
    Array.from(document.querySelectorAll('button')).some(btn => isElementVisible(btn) && buttonText(btn) === '错题本')
  );
}

function isDetailPageVisible() {
  const bodyText = document.body?.innerText || '';
  return bodyText.includes('题目详情') || bodyText.includes('查看解析') || bodyText.includes('遮住答案') || bodyText.includes('我的复盘') || bodyText.includes('标准解析');
}

function isAnalysisOpen() {
  const bodyText = document.body?.innerText || '';
  const hasHideAnswerButton = Array.from(document.querySelectorAll('button')).some(btn => isElementVisible(btn) && buttonText(btn).includes('遮住答案'));
  return hasHideAnswerButton || (bodyText.includes('我的复盘') && bodyText.includes('标准解析'));
}

async function getSubjects() {
  try {
    return await db.subjects.toArray();
  } catch {
    return [];
  }
}

function findVisibleSubjectButtons(subjects) {
  const buttons = Array.from(document.querySelectorAll('button'))
    .filter(isElementVisible)
    .filter(button => !isInsideReviewPatchUi(button));
  return subjects
    .map(subject => {
      const candidates = buttons.filter(button => buttonText(button) === subject.name);
      const active = candidates.find(button => {
        const cls = String(button.className || '');
        const aria = button.getAttribute('aria-selected');
        return aria === 'true' || cls.includes('bg-blue-600') || cls.includes('text-white');
      });
      const button = active || candidates[0] || null;
      return button ? { subject, button, active: Boolean(active) } : null;
    })
    .filter(Boolean);
}

async function getActiveSubjectFromDom() {
  const subjects = await getSubjects();
  if (!subjects.length) return null;

  const subjectButtons = findVisibleSubjectButtons(subjects);
  if (!subjectButtons.length) return null;

  const active = subjectButtons.find(item => item.active);
  if (active) return active.subject;

  const storedId = localStorage.getItem('mathNotebook.activeSubjectId');
  const stored = subjectButtons.find(item => String(item.subject.id) === String(storedId));
  return stored?.subject || subjectButtons[0].subject;
}

async function getRoundCount(subjectId) {
  if (!db.reviewRoundItems) return 1;
  try {
    const items = await db.reviewRoundItems.where('subjectId').equals(subjectId).toArray();
    const maxRound = items.reduce((max, item) => Math.max(max, toNumber(item.roundNo, 1)), 1);
    return Math.max(1, maxRound);
  } catch {
    return 1;
  }
}

async function countRoundItems(subjectId, roundNo) {
  try {
    if (roundNo <= 1 || !db.reviewRoundItems) {
      return db.mistakes.where('subjectId').equals(subjectId).count();
    }
    return db.reviewRoundItems
      .where('[subjectId+roundNo+order]')
      .between([subjectId, roundNo, 0], [subjectId, roundNo, Number.MAX_SAFE_INTEGER])
      .count();
  } catch {
    return 0;
  }
}

function showToast(message) {
  let toast = document.getElementById('math-review-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'math-review-toast';
    toast.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:128px',
      'transform:translateX(-50%)',
      'z-index:100000',
      'max-width:88vw',
      'padding:10px 14px',
      'border-radius:999px',
      'background:rgba(15,23,42,.92)',
      'color:#fff',
      'font-size:13px',
      'font-weight:700',
      'box-shadow:0 10px 30px rgba(0,0,0,.25)',
      'transition:opacity .2s ease',
      'pointer-events:none'
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.style.opacity = '0';
  }, 1800);
}

async function calculateHeaderSlot(subject) {
  const subjects = await getSubjects();
  const subjectButtons = findVisibleSubjectButtons(subjects);
  const current = subjectButtons.find(item => String(item.subject.id) === String(subject.id));
  if (!current) return null;

  const currentRect = current.button.getBoundingClientRect();
  const rowTop = currentRect.top;
  const rowCenterY = currentRect.top + currentRect.height / 2;

  const sameRowButtons = Array.from(document.querySelectorAll('button'))
    .filter(isElementVisible)
    .filter(button => !isInsideReviewPatchUi(button))
    .map(button => ({ button, rect: button.getBoundingClientRect(), text: buttonText(button) }))
    .filter(item => Math.abs((item.rect.top + item.rect.height / 2) - rowCenterY) <= 14);

  const leftCluster = sameRowButtons.filter(item => item.rect.left < window.innerWidth * 0.55);
  const rightCluster = sameRowButtons.filter(item => item.rect.left > window.innerWidth * 0.55);

  const leftEdge = Math.max(
    currentRect.right,
    ...subjectButtons.map(item => item.button.getBoundingClientRect().right),
    ...leftCluster.filter(item => item.text === '+' || item.text.includes('＋')).map(item => item.rect.right)
  ) + 10;

  const firstRightIconLeft = rightCluster.length
    ? Math.min(...rightCluster.map(item => item.rect.left))
    : window.innerWidth - 16;

  let left = leftEdge;
  let right = Math.max(12, window.innerWidth - firstRightIconLeft + 10);
  let available = window.innerWidth - left - right;

  // 小屏幕空间不够时，退到第二行但仍贴着顶部科目栏，不遮挡题目卡片。
  if (available < 230) {
    left = 12;
    right = 12;
    available = window.innerWidth - 24;
    return {
      top: Math.round(currentRect.bottom + 8),
      left,
      right,
      compact: available < 360,
      width: available
    };
  }

  return {
    top: Math.round(rowTop),
    left: Math.round(left),
    right: Math.round(right),
    compact: available < 430,
    width: available
  };
}

function styleRoundRoot(root, slot) {
  lastRootBox = slot;
  const width = Math.max(220, Math.floor(slot.width || (window.innerWidth - slot.left - slot.right)));
  root.style.cssText = [
    'position:fixed',
    `top:${slot.top}px`,
    `left:${slot.left}px`,
    `width:${width}px`,
    'height:44px',
    'z-index:99990',
    'display:flex',
    'align-items:center',
    'justify-content:flex-end',
    'gap:8px',
    'padding:0',
    'border:0',
    'background:transparent',
    'box-shadow:none',
    'pointer-events:none',
    'min-width:0',
    'max-width:calc(100vw - 16px)',
    'transform:translateZ(0)',
    'will-change:auto'
  ].join(';');
}

function renderRoundMenu(root, subject, roundCount, selectedRound, counts) {
  let menu = document.getElementById(MENU_ID);
  if (!roundMenuOpen || !root || !isElementVisible(root)) {
    menu?.remove();
    return;
  }

  if (!menu) {
    menu = document.createElement('div');
    menu.id = MENU_ID;
    document.body.appendChild(menu);
  }

  const rect = root.getBoundingClientRect();
  const width = Math.min(280, Math.max(220, Math.min(rect.width, 280)));
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width));
  const top = Math.min(window.innerHeight - 80, rect.bottom + 8);

  menu.style.cssText = [
    'position:fixed',
    `left:${left}px`,
    `top:${top}px`,
    `width:${width}px`,
    'z-index:100000',
    'background:#fff',
    'border:1px solid #e2e8f0',
    'border-radius:16px',
    'box-shadow:0 16px 40px rgba(15,23,42,.18)',
    'overflow:hidden',
    'max-height:52vh',
    'overflow-y:auto'
  ].join(';');

  menu.innerHTML = Array.from({ length: roundCount }, (_, index) => {
    const roundNo = index + 1;
    const active = roundNo === selectedRound;
    return `<button type="button" data-review-round="${roundNo}" style="width:100%;border:0;background:${active ? '#eff6ff' : '#fff'};color:${active ? '#1d4ed8' : '#334155'};display:flex;justify-content:space-between;align-items:center;padding:12px 14px;font-size:14px;font-weight:${active ? '900' : '700'};border-bottom:1px solid #f1f5f9;">
      <span>${getRoundName(roundNo)}</span>
      <span style="font-size:12px;color:#64748b;">${counts[index] || 0} 题</span>
    </button>`;
  }).join('');

  menu.querySelectorAll('[data-review-round]').forEach(button => {
    button.addEventListener('click', () => {
      const nextRound = Number(button.getAttribute('data-review-round'));
      roundMenuOpen = false;
      setSelectedRound(subject.id, nextRound);
      localStorage.removeItem(PENDING_OPEN_KEY);
      window.location.reload();
    });
  });
}

async function renderRoundDirectory() {
  if (!isMistakeListPageVisible() || isDetailPageVisible()) {
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(MENU_ID)?.remove();
    return;
  }

  const subject = await getActiveSubjectFromDom();
  if (!subject) {
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(MENU_ID)?.remove();
    return;
  }
  localStorage.setItem('mathNotebook.activeSubjectId', String(subject.id));

  const slot = await calculateHeaderSlot(subject);
  if (!slot) {
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(MENU_ID)?.remove();
    return;
  }

  const roundCount = await getRoundCount(subject.id);
  const selectedRound = Math.min(getSelectedRound(subject.id), roundCount);
  setSelectedRound(subject.id, selectedRound);

  const lastProgress = safeParseJson(localStorage.getItem(lastProgressKey(subject.id, selectedRound)));

  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    document.body.appendChild(root);
  }
  if (root.parentElement !== document.body) document.body.appendChild(root);
  styleRoundRoot(root, slot);

  const counts = [];
  for (let i = 1; i <= roundCount; i += 1) {
    counts.push(await countRoundItems(subject.id, i));
  }

  const compact = slot.compact;
  const rootState = JSON.stringify({
    subjectId: subject.id,
    selectedRound,
    roundCount,
    counts,
    compact,
    lastMistakeId: lastProgress?.mistakeId || null
  });

  if (root.dataset.reviewState !== rootState) {
    root.dataset.reviewState = rootState;
    root.innerHTML = `
      <span style="pointer-events:auto;font-size:12px;color:#64748b;font-weight:900;white-space:nowrap;${compact ? 'display:none;' : ''}">刷题列表</span>
      <button id="math-review-round-toggle" type="button" style="pointer-events:auto;height:34px;border:0;background:#2563eb;color:#fff;border-radius:999px;padding:0 12px;font-size:13px;font-weight:900;white-space:nowrap;box-shadow:0 4px 12px rgba(37,99,235,.22);">
        ${compact ? `第${selectedRound}轮` : getRoundName(selectedRound)} ▾
      </button>
      <span style="pointer-events:auto;font-size:12px;color:#64748b;white-space:nowrap;display:inline-flex;align-items:center;font-weight:800;">
        ${counts[selectedRound - 1] || 0}题
      </span>
      <button id="math-review-last-progress" type="button" ${lastProgress ? '' : 'disabled'} style="pointer-events:auto;height:34px;border:0;border-radius:999px;padding:0 10px;font-size:12px;font-weight:800;white-space:nowrap;background:${lastProgress ? '#ecfdf5' : '#f1f5f9'};color:${lastProgress ? '#047857' : '#94a3b8'};">
        ${lastProgress ? '上次刷到' : '暂无进度'}
      </button>
    `;

    root.querySelector('#math-review-round-toggle')?.addEventListener('click', (event) => {
      event.stopPropagation();
      roundMenuOpen = !roundMenuOpen;
      renderRoundMenu(root, subject, roundCount, selectedRound, counts);
    });

    root.querySelector('#math-review-last-progress')?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!lastProgress?.mistakeId) return;
      setSelectedRound(subject.id, selectedRound);
      localStorage.setItem(PENDING_OPEN_KEY, JSON.stringify({
        subjectId: subject.id,
        roundNo: selectedRound,
        mistakeId: lastProgress.mistakeId,
        createdAt: Date.now()
      }));
      window.location.reload();
    });
  }

  renderRoundMenu(root, subject, roundCount, selectedRound, counts);
}

function captureListOpenClick(event) {
  if (isInsideReviewPatchUi(event.target)) return;
  const card = event.target.closest?.('[id^="mistake-card-"]');
  if (!card) return;
  const id = card.id.replace('mistake-card-', '');
  if (id) localStorage.setItem(ACTIVE_MISTAKE_KEY, id);
}

async function getCurrentMistakeFromActiveKey() {
  const idRaw = localStorage.getItem(ACTIVE_MISTAKE_KEY);
  if (!idRaw) return null;
  const asNumber = Number(idRaw);
  const id = Number.isFinite(asNumber) ? asNumber : idRaw;
  try {
    return await db.mistakes.get(id);
  } catch {
    return null;
  }
}

async function markProgress(mistake, action) {
  const currentRound = getSelectedRound(mistake.subjectId);
  const progress = {
    subjectId: mistake.subjectId,
    roundNo: currentRound,
    mistakeId: mistake.id,
    title: mistake.title || '未命名错题',
    action,
    decidedAt: Date.now()
  };
  localStorage.setItem(lastProgressKey(mistake.subjectId, currentRound), JSON.stringify(progress));
}

async function addToNextRound(mistake) {
  if (!db.reviewRoundItems) {
    showToast('复盘轮次表未初始化，请确认已上传完整补丁');
    return;
  }

  const currentRound = getSelectedRound(mistake.subjectId);
  const nextRound = currentRound + 1;

  const existed = await db.reviewRoundItems
    .where('[subjectId+roundNo+mistakeId]')
    .equals([mistake.subjectId, nextRound, mistake.id])
    .first();

  if (!existed) {
    await db.reviewRoundItems.add({
      subjectId: mistake.subjectId,
      roundNo: nextRound,
      mistakeId: mistake.id,
      sourceRoundNo: currentRound,
      order: Date.now(),
      decidedAt: new Date(),
      title: mistake.title || '未命名错题'
    });
  }

  await db.mistakes.update(mistake.id, { isMastered: false, updatedAt: new Date() });
  await refreshMistakeCard(db, mistake.id);
  await markProgress(mistake, 'nextRound');

  showToast(existed ? `已在第 ${nextRound} 轮中，本题进度已记录` : `已加入第 ${nextRound} 轮刷题`);
  await renderRoundDirectory();
}

async function markMastered(mistake) {
  await db.mistakes.update(mistake.id, { isMastered: true, updatedAt: new Date() });
  await refreshMistakeCard(db, mistake.id);
  await markProgress(mistake, 'mastered');
  showToast('已记录：这题已掌握');
  await renderRoundDirectory();
}

function findAnalysisButton() {
  return Array.from(document.querySelectorAll('button'))
    .filter(isElementVisible)
    .find(button => /查看解析|遮住答案/.test(buttonText(button))) || null;
}

function findDetailToolbar() {
  const analysisButton = findAnalysisButton();
  if (!analysisButton) return null;

  let node = analysisButton.parentElement;
  let best = null;
  for (let i = 0; node && i < 7; i += 1) {
    const text = (node.textContent || '').replace(/\s+/g, ' ');
    const buttonCount = node.querySelectorAll('button').length;
    const style = window.getComputedStyle(node);
    if (buttonCount >= 2 && /查看解析|遮住答案/.test(text)) {
      best = node;
    }
    if (style.position === 'fixed' && buttonCount >= 2) {
      return node;
    }
    node = node.parentElement;
  }

  return best || analysisButton.parentElement;
}

function styleDecisionBar(bar) {
  bar.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:6px',
    'flex:0 0 auto',
    'white-space:nowrap'
  ].join(';');
}

async function renderDecisionBar() {
  let bar = document.getElementById(DECISION_BAR_ID);

  if (!isDetailPageVisible() || !isAnalysisOpen()) {
    bar?.remove();
    return;
  }

  const mistake = await getCurrentMistakeFromActiveKey();
  if (!mistake) {
    bar?.remove();
    return;
  }

  const toolbar = findDetailToolbar();
  const analysisButton = findAnalysisButton();
  if (!toolbar || !analysisButton) {
    bar?.remove();
    return;
  }

  if (!bar) {
    bar = document.createElement('span');
    bar.id = DECISION_BAR_ID;
  }

  if (bar.parentElement !== toolbar) {
    analysisButton.insertAdjacentElement('afterend', bar);
  }
  styleDecisionBar(bar);

  const roundNo = getSelectedRound(mistake.subjectId);
  const nextRound = roundNo + 1;

  bar.innerHTML = `
    <button id="math-review-add-next" type="button" style="height:34px;border:0;border-radius:999px;background:#2563eb;color:#fff;padding:0 11px;font-size:12px;font-weight:900;box-shadow:0 4px 12px rgba(37,99,235,.22);line-height:1;">
      加入第${nextRound}轮
    </button>
    <button id="math-review-mastered" type="button" style="height:34px;border:0;border-radius:999px;background:#dcfce7;color:#166534;padding:0 11px;font-size:12px;font-weight:900;line-height:1;">
      已掌握
    </button>
  `;

  bar.querySelector('#math-review-add-next')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    const current = await getCurrentMistakeFromActiveKey();
    if (current) await addToNextRound(current);
  });

  bar.querySelector('#math-review-mastered')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    const current = await getCurrentMistakeFromActiveKey();
    if (current) await markMastered(current);
  });

  toolbar.style.maxWidth = 'calc(100vw - 16px)';
  toolbar.style.overflowX = 'auto';
  toolbar.style.webkitOverflowScrolling = 'touch';
}

function tryOpenPendingMistake() {
  const raw = localStorage.getItem(PENDING_OPEN_KEY);
  if (!raw) return;

  const data = safeParseJson(raw);
  if (!data?.mistakeId) {
    localStorage.removeItem(PENDING_OPEN_KEY);
    return;
  }

  const target = document.getElementById(`mistake-card-${data.mistakeId}`);
  if (target) {
    localStorage.setItem(ACTIVE_MISTAKE_KEY, String(data.mistakeId));
    localStorage.removeItem(PENDING_OPEN_KEY);
    target.click();
  }
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(async () => {
    try {
      await renderRoundDirectory();
      await renderDecisionBar();
      tryOpenPendingMistake();
    } catch (error) {
      console.warn('[reviewRoundsPatch]', error);
    }
  }, 60);
}

function startReviewRoundsPatch() {
  document.addEventListener('click', captureListOpenClick, true);
  document.addEventListener('click', (event) => {
    const root = document.getElementById(ROOT_ID);
    const menu = document.getElementById(MENU_ID);
    if (root?.contains(event.target) || menu?.contains(event.target)) return;
    if (roundMenuOpen) {
      roundMenuOpen = false;
      menu?.remove();
    }
  }, true);

  window.addEventListener('resize', scheduleRender);
  window.addEventListener('orientationchange', scheduleRender);

  const observer = new MutationObserver((mutations) => {
    const onlyPatchUi = mutations.every(mutation => {
      const target = mutation.target;
      return isInsideReviewPatchUi(target) || Array.from(mutation.addedNodes || []).every(node => node.nodeType === 1 && isInsideReviewPatchUi(node));
    });
    if (!onlyPatchUi) scheduleRender();
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  scheduleRender();
  setInterval(scheduleRender, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startReviewRoundsPatch, { once: true });
} else {
  startReviewRoundsPatch();
}
