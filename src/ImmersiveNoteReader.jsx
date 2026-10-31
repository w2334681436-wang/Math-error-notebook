import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus, X } from 'lucide-react';

/**
 * 只读沉浸式笔记阅读层：覆盖整个应用，优先使用浏览器原生全屏，
 * 浏览器拒绝全屏时退化为全视口阅读。此组件不修改笔记数据。
 */
export default function ImmersiveNoteReader({
  title, noteId, body, images = [], prevId, nextId,
  onNavigate, onClose, nativeFullscreenRef,
}) {
  const [fontSize, setFontSize] = useState(17);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [noteId]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !nativeFullscreenRef.current) {
        event.preventDefault();
        onClose();
      }
    };
    const onFullscreenChange = () => {
      // 用户按 Esc 退出原生全屏时，也同步关闭沉浸式界面。
      if (nativeFullscreenRef.current && !document.fullscreenElement) {
        onClose(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, [onClose, nativeFullscreenRef]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`沉浸阅读：${title}`}
      className="fixed inset-0 z-[9999] flex flex-col bg-slate-50 text-slate-900"
      style={{ height: '100dvh', minHeight: '100vh' }}>
      <div className="shrink-0 bg-white/95 border-b border-slate-200 flex items-center gap-2 px-3 sm:px-6 py-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm sm:text-base font-semibold" title={title}>{title}</div>
          <div className="text-[11px] text-slate-400">沉浸阅读 · Esc退出</div>
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <button type="button" disabled={!prevId} onClick={() => onNavigate(prevId)}
            className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-25" title="上一篇" aria-label="上一篇">
            <ChevronLeft size={18}/>
          </button>
          <button type="button" disabled={!nextId} onClick={() => onNavigate(nextId)}
            className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-25" title="下一篇" aria-label="下一篇">
            <ChevronRight size={18}/>
          </button>
          <span className="w-px h-5 mx-0.5 bg-slate-200"/>
          <button type="button" disabled={fontSize <= 13} onClick={() => setFontSize(n => Math.max(13, n - 1))}
            className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30" title="缩小字体" aria-label="缩小字体">
            <Minus size={17}/>
          </button>
          <button type="button" disabled={fontSize >= 24} onClick={() => setFontSize(n => Math.min(24, n + 1))}
            className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30" title="放大字体" aria-label="放大字体">
            <Plus size={17}/>
          </button>
          <button type="button" onClick={() => onClose()} title="退出沉浸阅读" aria-label="退出沉浸阅读"
            className="ml-1 px-3 py-2 flex items-center gap-1 rounded-lg bg-slate-900 text-white hover:bg-slate-700 text-xs font-medium">
            <X size={18}/><span className="hidden sm:inline">退出全屏</span>
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <article className="mx-auto w-full max-w-[1024px] min-h-full bg-white px-4 sm:px-10 lg:px-16 py-8 sm:py-12 sm:shadow-sm">
          <section className="prose prose-slate max-w-none prose-pre:overflow-x-auto prose-img:max-w-full"
            style={{ fontSize: `${fontSize}px`, lineHeight: 1.85, overflowWrap: 'anywhere' }}>
            {body}
          </section>
          {images?.length > 0 && (
            <div className="mt-10 pt-7 border-t border-slate-200 space-y-6">
              <h3 className="text-lg font-semibold">补充图片</h3>
              {images.map((item, index) => (
                <figure key={item.id ?? index} className="space-y-2">
                  <img src={item.src} alt={item.desc || '笔记补充图片'} loading="lazy"
                    className="block w-full h-auto rounded-lg border border-slate-100"/>
                  {item.desc && <figcaption className="text-sm text-slate-500">{item.desc}</figcaption>}
                </figure>
              ))}
            </div>
          )}
        </article>
      </div>
    </div>,
    document.body
  );
}
