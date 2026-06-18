// src/answerPreviewPatch.js
// 只美化“题目详情 -> 查看解析”后的答案/复盘 Markdown 预览。
// 修复：解析预览页滚到底部后，因为反复 cleanup/re-mark 引发布局高度变化而弹回上方。
// 原则：只在目标变化时增量标记；隐藏解析/离开详情页时再清理；不再每次 DOM 变化都清空重挂样式。

const CARD_CLASS = 'math-answer-card';
const PREVIEW_CLASS = 'math-answer-preview';
const TARGET_TITLES = ['我的复盘', '标准解析'];
const MARK_ATTR = 'data-answer-preview-patch';
const PATCH_VERSION = '3.4.7';

let timer = null;
let lastOpenState = false;
let lastSignature = '';

function textOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function isVisible(el) {
  if (!el || !(el instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function isForbidden(el) {
  return Boolean(el?.matches?.('html, body, #root, nav, header, footer, button, input, textarea, select'));
}

function isDetailAnalysisOpen() {
  const bodyText = textOf(document.body);
  if (!bodyText.includes('标准解析') && !bodyText.includes('我的复盘')) return false;

  // 只有点开“查看解析”后，按钮通常会变成“遮住答案”；避免在编辑页或列表页误加样式。
  const hasHideAnswerButton = Array.from(document.querySelectorAll('button'))
    .some(btn => isVisible(btn) && /遮住答案/.test(textOf(btn)));

  return hasHideAnswerButton || (bodyText.includes('标准解析') && bodyText.includes('我的复盘'));
}

function findTitleElements() {
  const selector = 'h1,h2,h3,h4,h5,h6,div,p,span,strong';
  return Array.from(document.querySelectorAll(selector))
    .filter(isVisible)
    .filter(el => TARGET_TITLES.includes(textOf(el)))
    .filter(el => !el.closest('button, nav, header, footer, form, textarea, input, select'));
}

function scoreCard(el, title) {
  if (!el || isForbidden(el)) return -1;
  const text = textOf(el);
  if (!text.includes(title)) return -1;
  if (text.length < title.length) return -1;

  const rect = el.getBoundingClientRect();
  if (rect.width < 180 || rect.height < 24) return -1;

  let score = 0;
  const cls = String(el.className || '');
  if (/bg-white|rounded|border|shadow|p-\d|space-y/.test(cls)) score += 4;
  if (el.querySelector('p,ul,ol,pre,table,blockquote,.katex,.katex-display,img')) score += 3;
  if (el.querySelectorAll('button').length === 0) score += 2;
  if (text.includes('题目详情') || text.includes('查看解析') || text.includes('遮住答案')) score -= 6;
  if (text.includes('标准解析') && text.includes('我的复盘') && title !== '我的复盘') score -= 2;
  if (rect.height > window.innerHeight * 0.9) score -= 6;
  return score;
}

function findAnswerCard(titleEl) {
  const title = textOf(titleEl);
  let node = titleEl.parentElement;
  let best = null;
  let bestScore = -1;

  for (let i = 0; node && i < 7; i += 1) {
    const score = scoreCard(node, title);
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
    if (textOf(node).includes('题目详情') && textOf(node).includes('遮住答案')) break;
    node = node.parentElement;
  }

  return bestScore >= 1 ? best : titleEl.parentElement;
}

function hasMarkdownBlocks(el) {
  return Boolean(el.querySelector?.('p,ul,ol,pre,table,blockquote,.katex,.katex-display,code,h1,h2,h3,h4,h5,h6'));
}

function markEl(el, className, type) {
  if (!el || !(el instanceof HTMLElement)) return false;
  let changed = false;
  if (!el.classList.contains(className)) {
    el.classList.add(className);
    changed = true;
  }
  if (el.getAttribute(MARK_ATTR) !== type) {
    el.setAttribute(MARK_ATTR, type);
    changed = true;
  }
  if (el.dataset.answerPreviewVersion !== PATCH_VERSION) {
    el.dataset.answerPreviewVersion = PATCH_VERSION;
  }
  return changed;
}

function markPreviewInsideCard(card, titleEl) {
  if (!card) return 0;
  let changedCount = markEl(card, CARD_CLASS, 'card') ? 1 : 0;

  const descendants = Array.from(card.querySelectorAll('div,section,article'))
    .filter(isVisible)
    .filter(el => !el.contains(titleEl))
    .filter(el => !el.closest('button, nav, header, footer, form, textarea, input, select'))
    .filter(el => {
      const text = textOf(el);
      if (!text) return false;
      if (TARGET_TITLES.includes(text)) return false;
      if (text.includes('题目详情') || text.includes('查看解析') || text.includes('遮住答案')) return false;
      return hasMarkdownBlocks(el) || text.length >= 8;
    });

  if (descendants.length === 0) {
    changedCount += markEl(card, PREVIEW_CLASS, 'card preview') ? 1 : 0;
    return changedCount;
  }

  const previewTargets = descendants.filter(el => {
    const childMarked = descendants.some(other => other !== el && el.contains(other) && textOf(other).length >= 8);
    return !childMarked || el.matches('pre, table, blockquote');
  });

  for (const el of previewTargets.slice(0, 4)) {
    changedCount += markEl(el, PREVIEW_CLASS, 'preview') ? 1 : 0;
  }

  return changedCount;
}

function cleanup() {
  document.querySelectorAll(`[${MARK_ATTR}]`).forEach(el => {
    el.classList.remove(CARD_CLASS, PREVIEW_CLASS);
    el.removeAttribute(MARK_ATTR);
    if (el.dataset) delete el.dataset.answerPreviewVersion;
  });
  lastSignature = '';
}

function currentSignature(titleElements) {
  return titleElements.map(el => {
    const rect = el.getBoundingClientRect();
    return `${textOf(el)}:${Math.round(rect.top)}:${Math.round(rect.left)}:${Math.round(rect.width)}:${textOf(el.parentElement).slice(0, 40)}`;
  }).join('|');
}

function preserveScrollIfNeeded(beforeY, beforeHeight, changedCount) {
  if (!changedCount) return;

  // 只在用户已经接近底部时保护滚动位置，避免“最底部弹回上方”。
  const doc = document.documentElement;
  const beforeDistanceToBottom = beforeHeight - beforeY - window.innerHeight;
  const wasNearBottom = beforeDistanceToBottom < 220;
  if (!wasNearBottom) return;

  window.requestAnimationFrame(() => {
    const afterHeight = doc.scrollHeight;
    const afterDistanceToBottom = afterHeight - window.scrollY - window.innerHeight;

    // 如果样式标记导致页面高度变化，就保持用户仍停留在底部附近。
    if (afterDistanceToBottom > beforeDistanceToBottom + 80) {
      const targetY = Math.max(0, afterHeight - window.innerHeight - Math.max(0, beforeDistanceToBottom));
      window.scrollTo({ top: targetY, left: window.scrollX, behavior: 'auto' });
    }
  });
}

function markAnswerPreview() {
  const open = isDetailAnalysisOpen();

  if (!open) {
    if (lastOpenState) cleanup();
    lastOpenState = false;
    return;
  }

  const titleElements = findTitleElements();
  const signature = currentSignature(titleElements);

  // 同一批目标已经处理过，不再反复 cleanup/re-mark，解决滚到底部弹回。
  if (open === lastOpenState && signature && signature === lastSignature) return;

  const beforeY = window.scrollY;
  const beforeHeight = document.documentElement.scrollHeight;
  let changedCount = 0;

  for (const titleEl of titleElements) {
    const card = findAnswerCard(titleEl);
    changedCount += markPreviewInsideCard(card, titleEl);
  }

  lastOpenState = true;
  lastSignature = signature;
  preserveScrollIfNeeded(beforeY, beforeHeight, changedCount);
}

function scheduleMark() {
  window.clearTimeout(timer);
  timer = window.setTimeout(markAnswerPreview, 120);
}

if (typeof window !== 'undefined') {
  window.addEventListener('load', scheduleMark);
  window.addEventListener('resize', scheduleMark);
  window.addEventListener('orientationchange', scheduleMark);
  window.addEventListener('click', scheduleMark, true);
  window.addEventListener('input', scheduleMark, true);

  const observer = new MutationObserver((mutations) => {
    // 自己刚加的 class / data 属性不再触发二次处理，减少抖动和滚动跳动。
    const onlySelfPatch = mutations.every(mutation => {
      if (mutation.type === 'attributes') {
        return mutation.attributeName === 'class' || mutation.attributeName === MARK_ATTR || mutation.attributeName === 'data-answer-preview-version';
      }
      return false;
    });
    if (!onlySelfPatch) scheduleMark();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: false,
    attributes: true,
    attributeFilter: ['class', MARK_ATTR, 'data-answer-preview-version']
  });

  scheduleMark();
}
