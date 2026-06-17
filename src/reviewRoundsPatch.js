// src/reviewRoundsPatch.js
// 新复盘轮次系统：不改原 App.jsx 的主体结构，用轻量增强层接管“多轮刷题/上次刷到/决策按钮”。
import { db } from './db';
import { refreshMistakeCard } from './searchIndex';

const SELECTED_ROUND_PREFIX = 'mathNotebook.selectedReviewRound.';
const LAST_PROGRESS_PREFIX = 'mathNotebook.lastReviewProgress.';
const ACTIVE_MISTAKE_KEY = 'mathNotebook.activeMistakeId';
const PENDING_OPEN_KEY = 'mathNotebook.pendingOpenMistake';
const ROOT_ID = 'math-review-rounds-root';
const DECISION_BAR_ID = 'math-review-decision-bar';

function toNumber(value, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

async function getActiveSubjectFromDom() {
  const subjects = await db.subjects.toArray();
  if (!subjects.length) return null;

  const buttons = Array.from(document.querySelectorAll('button'));
  for (const subject of subjects) {
    const activeButton = buttons.find(button => {
      const text = (button.textContent || '').trim();
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
  return db.reviewRoundItems.where('[subjectId+roundNo+order]')
    .between([subjectId, roundNo, 0], [subjectId, roundNo, Number.MAX_SAFE_INTEGER])
    .count();
}

function isMistakePageVisible() {
  const bodyText = document.body?.innerText || '';
  return bodyText.includes('错题本') || bodyText.includes('添加错题') || bodyText.includes('题目详情');
}

function isDetailPageVisible() {
  const bodyText = document.body?.innerText || '';
  return bodyText.includes('题目详情') || bodyText.includes('我的复盘') || bodyText.includes('标准解析');
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
      'transition:opacity .2s ease'
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

async function renderRoundDirectory() {
  if (!isMistakePageVisible()) {
    document.getElementById(ROOT_ID)?.remove();
    return;
  }

  const subject = await getActiveSubjectFromDom();
  if (!subject) return;

  localStorage.setItem('mathNotebook.activeSubjectId', String(subject.id));

  const roundCount = await getRoundCount(subject.id);
  const selectedRound = Math.min(getSelectedRound(subject.id), roundCount);
  setSelectedRound(subject.id, selectedRound);

  const lastRaw = localStorage.getItem(lastProgressKey(subject.id, selectedRound));
  let lastProgress = null;
  try {
    lastProgress = lastRaw ? JSON.parse(lastRaw) : null;
  } catch {
    lastProgress = null;
  }

  let root = document.getElementById(ROOT_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    root.style.cssText = [
      'position:fixed',
      'top:58px',
      'left:10px',
      'right:10px',
      'z-index:99990',
      'display:flex',
      'gap:8px',
      'align-items:center',
      'justify-content:space-between',
      'padding:8px',
      'border:1px solid rgba(59,130,246,.18)',
      'border-radius:16px',
      'background:rgba(255,255,255,.96)',
      'box-shadow:0 8px 24px rgba(15,23,42,.10)',
      'backdrop-filter:blur(10px)'
    ].join(';');
    document.body.appendChild(root);
  }

  const counts = [];
  for (let i = 1; i <= roundCount; i += 1) {
    counts.push(await countRoundItems(subject.id, i));
  }

  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
      <button id="math-review-round-toggle" type="button" style="border:0;background:#2563eb;color:#fff;border-radius:999px;padding:8px 12px;font-size:13px;font-weight:800;white-space:nowrap;box-shadow:0 4px 12px rgba(37,99,235,.25);">
        ${selectedRound === 1 ? '第一轮刷题' : `第${selectedRound}轮刷题`} ▾
      </button>
      <span style="font-size:12px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${subject.name} · 本轮 ${counts[selectedRound - 1] || 0} 题
      </span>
    </div>
    <button id="math-review-last-progress" type="button" ${lastProgress ? '' : 'disabled'} style="border:0;border-radius:999px;padding:8px 10px;font-size:12px;font-weight:800;white-space:nowrap;background:${lastProgress ? '#ecfdf5' : '#f1f5f9'};color:${lastProgress ? '#047857' : '#94a3b8'};">
      ${lastProgress ? '上次刷到' : '暂无进度'}
    </button>
    <div id="math-review-round-menu" style="display:none;position:absolute;left:8px;right:8px;top:48px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 16px 40px rgba(15,23,42,.18);overflow:hidden;max-height:50vh;overflow-y:auto;">
      ${Array.from({ length: roundCount }, (_, index) => {
        const roundNo = index + 1;
        const active = roundNo === selectedRound;
        return `<button type="button" data-review-round="${roundNo}" style="width:100%;border:0;background:${active ? '#eff6ff' : '#fff'};color:${active ? '#1d4ed8' : '#334155'};display:flex;justify-content:space-between;align-items:center;padding:12px 14px;font-size:14px;font-weight:${active ? '900' : '700'};border-bottom:1px solid #f1f5f9;">
          <span>${roundNo === 1 ? '第一轮刷题' : `第${roundNo}轮刷题`}</span>
          <span style="font-size:12px;color:#64748b;">${counts[index] || 0} 题</span>
        </button>`;
      }).join('')}
    </div>
  `;

  root.querySelector('#math-review-round-toggle')?.addEventListener('click', () => {
    const menu = root.querySelector('#math-review-round-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  });

  root.querySelectorAll('[data-review-round]').forEach(button => {
    button.addEventListener('click', () => {
      const nextRound = Number(button.getAttribute('data-review-round'));
      setSelectedRound(subject.id, nextRound);
      localStorage.removeItem(PENDING_OPEN_KEY);
      window.location.reload();
    });
  });

  root.querySelector('#math-review-last-progress')?.addEventListener('click', () => {
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

async function renderDecisionBar() {
  let bar = document.getElementById(DECISION_BAR_ID);
  if (!isDetailPageVisible()) {
    bar?.remove();
    return;
  }

  const mistake = await getCurrentMistakeFromActiveKey();
  if (!mistake) {
    bar?.remove();
    return;
  }

  const roundNo = getSelectedRound(mistake.subjectId);
  const nextRound = roundNo + 1;

  if (!bar) {
    bar = document.createElement('div');
    bar.id = DECISION_BAR_ID;
    bar.style.cssText = [
      'position:fixed',
      'left:10px',
      'right:10px',
      'bottom:82px',
      'z-index:99995',
      'display:grid',
      'grid-template-columns:1fr 1fr',
      'gap:10px',
      'padding:8px',
      'border-radius:18px',
      'background:rgba(255,255,255,.96)',
      'box-shadow:0 10px 30px rgba(15,23,42,.16)',
      'border:1px solid rgba(226,232,240,.95)',
      'backdrop-filter:blur(10px)'
    ].join(';');
    document.body.appendChild(bar);
  }

  bar.innerHTML = `
    <button id="math-review-add-next" type="button" style="border:0;border-radius:14px;background:#2563eb;color:#fff;padding:12px 8px;font-size:13px;font-weight:900;box-shadow:0 6px 16px rgba(37,99,235,.25);">
      加入到下一轮错题<br><span style="font-size:11px;font-weight:700;opacity:.9;">第 ${nextRound} 轮刷题</span>
    </button>
    <button id="math-review-mastered" type="button" style="border:0;border-radius:14px;background:#dcfce7;color:#166534;padding:12px 8px;font-size:13px;font-weight:900;">
      已掌握<br><span style="font-size:11px;font-weight:700;opacity:.85;">记录本题已刷过</span>
    </button>
  `;

  bar.querySelector('#math-review-add-next')?.addEventListener('click', async () => {
    const current = await getCurrentMistakeFromActiveKey();
    if (current) await addToNextRound(current);
  });

  bar.querySelector('#math-review-mastered')?.addEventListener('click', async () => {
    const current = await getCurrentMistakeFromActiveKey();
    if (current) await markMastered(current);
  });
}

function tryOpenPendingMistake() {
  const raw = localStorage.getItem(PENDING_OPEN_KEY);
  if (!raw) return;

  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    localStorage.removeItem(PENDING_OPEN_KEY);
    return;
  }

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

function startReviewRoundsPatch() {
  document.addEventListener('click', captureListOpenClick, true);

  const tick = async () => {
    try {
      await renderRoundDirectory();
      await renderDecisionBar();
      tryOpenPendingMistake();
    } catch (error) {
      console.warn('[reviewRoundsPatch]', error);
    }
  };

  tick();
  setInterval(tick, 900);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startReviewRoundsPatch, { once: true });
} else {
  startReviewRoundsPatch();
}
