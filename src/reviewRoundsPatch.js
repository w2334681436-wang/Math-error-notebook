// src/reviewRoundsPatch.js
// 新复盘轮次系统 UI 修正版：
// 1. 刷题轮次目录嵌入顶部科目栏右侧，不再单独悬浮占一整行。
// 2. “加入下一轮/已掌握”只在打开解析后出现，并嵌入原详情页底部按钮栏。
// 3. 打开题目/查看解析不再自动增加旧复盘次数。
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

function safeParseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function buttonText(button) {
  return (button?.textContent || '').replace(/\s+/g, ' ').trim();
}

async function getActiveSubjectFromDom() {
  const subjects = await db.subjects.toArray();
  if (!subjects.length) return null;

  const buttons = Array.from(document.querySelectorAll('button')).filter(isElementVisible);

  for (const subject of subjects) {
    const activeButton = buttons.find(button => {
      const text = buttonText(button);
      const cls = String(button.className || '');
      return text === subject.name && (cls.includes('bg-blue-600') || cls.includes('text-white'));
    });
    if (activeButton) return subject;
  }

  const storedId = localStorage.getItem('mathNotebook.activeSubjectId');
  const storedSubject = subjects.find(subject => String(subject.id) === String(storedId));
  return storedSubject || subjects[0];
}

async function getRoundCount(subjectId) {
  const items = await db.reviewRoundItems.where('subjectId').equals(subjectId).toArray();
  const maxRound = items.reduce((max, item) => Math.max(max, toNumber(item.roundNo, 1)), 1);
  return Math.max(1, maxRound);
}

async function countRoundItems(subjectId, roundNo) {
  if (roundNo <= 1) {
    return db.mistakes.where('subjectId').equals(subjectId).count();
  }
  return db.reviewRoundItems
    .where('[subjectId+roundNo+order]')
    .between([subjectId, roundNo, 0], [subjectId, roundNo, Number.MAX_SAFE_INTEGER])
    .count();
}

function isMistakePageVisible() {
  const bodyText = document.body?.innerText || '';
  return bodyText.includes('错题本') || bodyText.includes('添加错题') || bodyText.includes('题目详情') || bodyText.includes('查看解析') || bodyText.includes('遮住答案');
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

async function findSubjectButton(subject) {
  const buttons = Array.from(document.querySelectorAll('button')).filter(isElementVisible);
  const exactButtons = buttons.filter(button => buttonText(button) === subject.name);
  return exactButtons.find(button => String(button.className || '').includes('bg-blue-600')) || exactButtons[0] || null;
}

async function findSubjectToolbarMount(subject) {
  const subjectButton = await findSubjectButton(subject);
  if (!subjectButton) return null;

  let node = subjectButton.parentElement;
  let best = null;
  for (let i = 0; node && i < 5; i += 1) {
    const text = (node.textContent || '').replace(/\s+/g, ' ');
    const buttonCount = node.querySelectorAll('button').length;
    const hasSubjectName = text.includes(subject.name);
    const rect = node.getBoundingClientRect();
    if (hasSubjectName && buttonCount >= 2 && rect.width > 240) {
      best = node;
    }
    node = node.parentElement;
  }

  return best || subjectButton.parentElement;
}

function styleRoundRoot(root) {
  root.style.cssText = [
    'position:relative',
    'z-index:20',
    'display:flex',
    'align-items:center',
    'gap:6px',
    'margin-left:auto',
    'flex-shrink:0',
    'padding:0',
    'border:0',
    'background:transparent',
    'box-shadow:none',
    'min-width:0'
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
  const width = Math.min(260, Math.max(210, rect.width));
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
  if (!isMistakePageVisible()) {
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(MENU_ID)?.remove();
    return;
  }

  const subject = await getActiveSubjectFromDom();
  if (!subject) return;
  localStorage.setItem('mathNotebook.activeSubjectId', String(subject.id));

  const mount = await findSubjectToolbarMount(subject);
  if (!mount) return;

  const roundCount = await getRoundCount(subject.id);
  const selectedRound = Math.min(getSelectedRound(subject.id), roundCount);
  setSelectedRound(subject.id, selectedRound);

  const lastProgress = safeParseJson(localStorage.getItem(lastProgressKey(subject.id, selectedRound)));

  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
  }
  if (root.parentElement !== mount) {
    mount.appendChild(root);
  }
  styleRoundRoot(root);

  const counts = [];
  for (let i = 1; i <= roundCount; i += 1) {
    counts.push(await countRoundItems(subject.id, i));
  }

  root.innerHTML = `
    <button id="math-review-round-toggle" type="button" style="height:34px;border:0;background:#2563eb;color:#fff;border-radius:999px;padding:0 12px;font-size:13px;font-weight:900;white-space:nowrap;box-shadow:0 4px 12px rgba(37,99,235,.22);">
      ${getRoundName(selectedRound)} ▾
    </button>
    <span style="font-size:12px;color:#64748b;white-space:nowrap;display:inline-flex;align-items:center;">
      ${counts[selectedRound - 1] || 0}题
    </span>
    <button id="math-review-last-progress" type="button" ${lastProgress ? '' : 'disabled'} style="height:34px;border:0;border-radius:999px;padding:0 10px;font-size:12px;font-weight:800;white-space:nowrap;background:${lastProgress ? '#ecfdf5' : '#f1f5f9'};color:${lastProgress ? '#047857' : '#94a3b8'};">
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

  renderRoundMenu(root, subject, roundCount, selectedRound, counts);
}

function captureListOpenClick(event) {
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
  return db.mistakes.get(id);
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
    <button id="math-review-add-next" type="button" style="height:40px;border:0;border-radius:999px;background:#2563eb;color:#fff;padding:0 12px;font-size:12px;font-weight:900;box-shadow:0 4px 12px rgba(37,99,235,.22);line-height:1.1;">
      加入下一轮<br><span style="font-size:10px;font-weight:700;opacity:.9;">第${nextRound}轮</span>
    </button>
    <button id="math-review-mastered" type="button" style="height:40px;border:0;border-radius:999px;background:#dcfce7;color:#166534;padding:0 12px;font-size:12px;font-weight:900;line-height:1.1;">
      已掌握<br><span style="font-size:10px;font-weight:700;opacity:.85;">记录刷过</span>
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

  // 让原底部按钮栏横向可滚动，避免小屏幕被挤坏。
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

  const observer = new MutationObserver(scheduleRender);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  scheduleRender();
  setInterval(scheduleRender, 1000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startReviewRoundsPatch, { once: true });
} else {
  startReviewRoundsPatch();
}
