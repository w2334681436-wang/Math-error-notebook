// src/chatgptMarkdownPatch.js
// 给 ReactMarkdown 渲染出来的内容自动加上 ChatGPT 风格容器类。
// 不改 IndexedDB，不动错题/笔记数据，只负责识别 Markdown 预览区域。

const ROOT_CLASS = 'chatgpt-markdown';
const ARTICLE_CLASS = 'chatgpt-reading-frame';
const MARKDOWN_CHILD_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'ul', 'ol', 'blockquote', 'pre', 'table',
  '.katex-display'
].join(',');

function isBadContainer(el) {
  if (!el || !(el instanceof HTMLElement)) return true;
  if (el.matches('html, body, #root, nav, header, footer, button, label, input, textarea, select, form')) return true;
  if (el.closest('button, nav, header, footer, form, textarea, input, select')) return true;
  if (el.isContentEditable) return true;
  return false;
}

function looksLikeMarkdownContainer(el) {
  if (isBadContainer(el)) return false;

  const directMarkdownChildren = Array.from(el.children).filter(child => child.matches?.(MARKDOWN_CHILD_SELECTOR));
  if (directMarkdownChildren.length === 0) return false;

  const text = (el.innerText || '').trim();
  const hasRichMarkdown = Boolean(el.querySelector('pre, table, blockquote, .katex, .katex-display, ul, ol, h1, h2, h3, h4, h5, h6'));
  const hasMultipleBlocks = directMarkdownChildren.length >= 2;
  const hasLongText = text.length >= 40;

  return hasRichMarkdown || hasMultipleBlocks || hasLongText;
}

function markMarkdownContainers() {
  const nodes = Array.from(document.querySelectorAll(MARKDOWN_CHILD_SELECTOR));
  const containers = new Set();

  for (const node of nodes) {
    let parent = node.parentElement;
    let depth = 0;

    while (parent && depth < 3) {
      if (looksLikeMarkdownContainer(parent)) {
        containers.add(parent);
        break;
      }
      parent = parent.parentElement;
      depth += 1;
    }
  }

  for (const el of containers) {
    el.classList.add(ROOT_CLASS);

    // 给外层阅读区也加一个类，用于“左右收窄”的阅读布局。
    // 只向上找很近的父级，避免把整个 App 或导航栏错误收窄。
    let frame = el.parentElement;
    let depth = 0;
    while (frame && depth < 3 && !isBadContainer(frame)) {
      const rect = frame.getBoundingClientRect();
      const hasOnlyOneMainMarkdown = frame.querySelectorAll(`.${ROOT_CLASS}`).length <= 2;
      if (rect.width > 720 && hasOnlyOneMainMarkdown) {
        frame.classList.add(ARTICLE_CLASS);
        break;
      }
      frame = frame.parentElement;
      depth += 1;
    }
  }
}

let timer = null;
function scheduleMark() {
  window.clearTimeout(timer);
  timer = window.setTimeout(markMarkdownContainers, 80);
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
