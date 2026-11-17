import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, ListTree } from 'lucide-react';

/**
 * 正文目录：直接从 Markdown 已渲染的标题生成，不解析代码块里的 #，
 * 因此目录项与实际可跳转的标题始终一一对应。
 * 仅控制阅读界面，不写入或改动笔记数据。
 */
export default function NoteOutlineMenu({
  contentRef, noteId, sourceVersion, enabled = true,
}) {
  const [open, setOpen] = useState(false);
  const [headings, setHeadings] = useState([]);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [panelPosition, setPanelPosition] = useState({ left: 12, top: 64, width: 320 });
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  // React 已完成 DOM 更新后读取真正的标题，避免代码块、公式和文本造成假目录。
  useLayoutEffect(() => {
    if (!enabled || !contentRef.current) {
      setHeadings([]);
      return;
    }

    const stack = [];
    const next = Array.from(contentRef.current.querySelectorAll('h1,h2,h3,h4,h5,h6'))
      .map((element, index) => {
        const level = Number(element.tagName.slice(1));
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const parentIndex = stack.length ? stack[stack.length - 1].index : null;
        stack.push({ index, level });

        return {
          index, level, parentIndex, element,
          title: (element.textContent || '').trim() || '未命名标题',
          hasChildren: false,
        };
      });

    next.forEach(item => {
      if (item.parentIndex !== null) next[item.parentIndex].hasChildren = true;
    });
    setHeadings(next);
  }, [contentRef, noteId, sourceVersion, enabled]);

  useEffect(() => {
    setOpen(false);
    setCollapsed(new Set());
  }, [noteId]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(336, Math.max(220, window.innerWidth - 24));
    const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
    const top = Math.min(rect.bottom + 8, Math.max(12, window.innerHeight - 190));
    setPanelPosition({ left, top, width });
  }, []);

  const toggleMenu = () => {
    if (!open) updatePosition();
    setOpen(value => !value);
  };

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = event => {
      if (triggerRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const handleKeyDown = event => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  const toggleChapter = index => {
    setCollapsed(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const jumpTo = item => {
    setOpen(false);
    item.element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const visibleHeadings = headings.filter(item => {
    let parent = item.parentIndex;
    while (parent !== null) {
      if (collapsed.has(parent)) return false;
      parent = headings[parent]?.parentIndex ?? null;
    }
    return true;
  });

  const baseLevel = headings.length ? Math.min(...headings.map(item => item.level)) : 1;

  return (
    <>
      <div ref={triggerRef} className="inline-flex shrink-0 items-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700">
        <button type="button" onClick={toggleMenu} aria-haspopup="true" aria-expanded={open}
          title="正文目录：点击标题快速跳转"
          className="flex items-center gap-1.5 rounded-l-lg px-2 py-2 text-xs font-semibold hover:bg-indigo-100">
          <ListTree size={17}/><span>目录</span>
        </button>
        <button type="button" onClick={toggleMenu} aria-label={open ? '收起正文目录' : '展开正文目录'}
          aria-expanded={open} title={open ? '收起目录' : '展开目录'}
          className="border-l border-indigo-200 rounded-r-lg px-1.5 py-2 hover:bg-indigo-100">
          <ChevronDown size={13} className={open ? 'rotate-180 transition-transform' : 'transition-transform'}/>
        </button>
      </div>

      {open && createPortal(
        <div ref={panelRef} role="dialog" aria-label="笔记章节目录"
          className="fixed z-[10010] flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl"
          style={{
            left: panelPosition.left,
            top: panelPosition.top,
            width: panelPosition.width,
            maxHeight: Math.max(130, window.innerHeight - panelPosition.top - 12),
          }}>
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-3 py-2">
            <span className="text-sm font-bold text-gray-800">章节目录</span>
            <span className="text-xs text-gray-400">{headings.length} 个标题</span>
          </div>
          <nav aria-label="正文标题快速跳转" className="min-h-0 flex-1 overflow-y-auto p-2">
            {!enabled ? (
              <p className="px-3 py-5 text-sm text-gray-500">切换到预览模式，即可使用正文目录。</p>
            ) : !headings.length ? (
              <p className="px-3 py-5 text-sm text-gray-500">当前笔记没有章节标题。可用 Markdown 的 #、## 等标题生成目录。</p>
            ) : visibleHeadings.map(item => (
              <div key={item.index} className="flex items-center rounded-lg hover:bg-indigo-50"
                style={{ paddingLeft: Math.min(item.level - baseLevel, 4) * 12 }}>
                {item.hasChildren ? (
                  <button type="button" aria-label={(collapsed.has(item.index) ? '展开' : '收起') + item.title + '的子目录'}
                    aria-expanded={!collapsed.has(item.index)} onClick={() => toggleChapter(item.index)}
                    className="flex h-8 w-7 shrink-0 items-center justify-center rounded text-gray-500 hover:text-indigo-600">
                    {collapsed.has(item.index) ? <ChevronRight size={14}/> : <ChevronDown size={14}/>}
                  </button>
                ) : <span className="w-7 shrink-0"/>}
                <button type="button" title={item.title} onClick={() => jumpTo(item)}
                  className="min-w-0 flex-1 truncate px-1 py-2 text-left text-sm text-gray-700 hover:text-indigo-700">
                  {item.title}
                </button>
              </div>
            ))}
          </nav>
        </div>,
        document.body
      )}
    </>
  );
}
