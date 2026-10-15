import React, { useEffect, useRef, useState, useId } from 'react';
import { Search, X } from 'lucide-react';

export default function MistakeListSearch({ scrollRef, value, onChange }) {
  const inlineRef = useRef(null);
  const floatingInputRef = useRef(null);
  const toggleRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const placeholder = '搜索错题标题、复盘、解析、日期...';
  const inputClass = 'w-full pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm transition';

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const update = () => setScrolled(inlineRef.current.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().top);
    scroller.addEventListener('scroll', update, { passive: true });
    update();
    return () => scroller.removeEventListener('scroll', update);
  }, [scrollRef]);
  useEffect(() => {
    if (open) floatingInputRef.current?.focus({ preventScroll: true });
  }, [open]);

  return <>
    <div ref={inlineRef} className="mb-4 relative" style={{ visibility: open ? 'hidden' : 'visible' }}>
      <Search size={18} className="absolute left-3 top-3.5 text-gray-400"/>
      <input value={value} onChange={onChange} placeholder={placeholder} aria-label="搜索错题" className={inputClass}/>
    </div>
    {(scrolled || open) && <div className={`mistake-list-quick-search${open ? ' is-open' : ''}`}>
      {open && <div id={panelId} className="relative flex-1 min-w-0">
        <Search size={18} className="absolute left-3 top-3.5 text-gray-400"/>
        <input ref={floatingInputRef} value={value} onChange={onChange} placeholder={placeholder} aria-label="随时搜索错题" className={inputClass} onKeyDown={event => {
          if (event.key === 'Escape') { setOpen(false); toggleRef.current?.focus({ preventScroll: true }); }
        }}/>
      </div>}
      <button ref={toggleRef} type="button" aria-label={open ? '收起搜索框' : '展开搜索框'} title={open ? '收起搜索框' : '展开搜索框'} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(current => !current)} className="flex-none w-10 h-10 flex items-center justify-center rounded-full bg-white/95 border border-gray-200 text-gray-500 shadow-sm hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
        {open ? <X size={18}/> : <Search size={18}/>}
      </button>
    </div>}
  </>;
}
