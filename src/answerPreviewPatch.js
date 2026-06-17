// src/answerPreviewPatch.js
// 只美化“题目详情 -> 查看解析”后的答案/复盘 Markdown 预览。
// 不处理知识库、不处理主页、不处理编辑器、不处理全局 Markdown，避免把其他页面改成 ChatGPT 风格。

const CARD_CLASS = 'math-answer-card';
const PREVIEW_CLASS = 'math-answer-preview';
const TARGET_TITLES = ['我的复盘', '标准解析'];

let timer = null;

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
  return Boolean(el?.matches?.('html, body, #root, nav, header, footer, button, input, textarea, select, form'));
}

function isDetailAnalysisOpen() {
  const bodyText = textOf(document.body);
  if (!bodyText.includes('标准解析') && !bodyText.includes('我的复盘')) return false;

  // 只有点开“查看解析”后，按钮才会变成“遮住答案”；避免在编辑页或列表页误加样式。
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

function markPreviewInsideCard(card, titleEl) {
  if (!card) return;
  card.classList.add(CARD_CLASS);

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

  // 选择最靠近内容的容器：如果没有更小容器，就退回卡片本身。
  if (descendants.length === 0) {
    card.classList.add(PREVIEW_CLASS);
    return;
  }

  const previewTargets = descendants.filter(el => {
    const childMarked = descendants.some(other => other !== el && el.contains(other) && textOf(other).length >= 8);
    return !childMarked || el.matches('pre, table, blockquote');
  });

  for (const el of previewTargets.slice(0, 4)) {
    el.classList.add(PREVIEW_CLASS);
  }
}

function cleanup() {
  document.querySelectorAll(`.${CARD_CLASS}`).forEach(el => el.classList.remove(CARD_CLASS));
  document.querySelectorAll(`.${PREVIEW_CLASS}`).forEach(el => el.classList.remove(PREVIEW_CLASS));
}

function markAnswerPreview() {
  cleanup();

  if (!isDetailAnalysisOpen()) return;

  const titleElements = findTitleElements();
  for (const titleEl of titleElements) {
    const card = findAnswerCard(titleEl);
    markPreviewInsideCard(card, titleEl);
  }
}

function scheduleMark() {
  window.clearTimeout(timer);
  timer = window.setTimeout(markAnswerPreview, 80);
}

if (typeof window !== 'undefined') {
  window.addEventListener('load', scheduleMark);
  window.addEventListener('resize', scheduleMark);
  window.addEventListener('click', scheduleMark, true);
  window.addEventListener('input', scheduleMark, true);

  const observer = new MutationObserver(scheduleMark);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  scheduleMark();
}
