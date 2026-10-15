import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

// 视觉上只占 4px，透明的触控区域方便手机拖动。
export default function ListScrollHandle({ scrollRef, controlsId }) {
  const trackRef = useRef(null);
  const metricsRef = useRef(null);
  const dragRef = useRef(null);
  const [metrics, setMetrics] = useState(null);
  const [dragging, setDragging] = useState(false);

  const scrollToPointer = useCallback(clientY => {
    const scroller = scrollRef.current;
    const track = trackRef.current;
    const geometry = metricsRef.current;
    if (!scroller || !track || !geometry || !dragRef.current) return;
    const y = clientY - track.getBoundingClientRect().top - dragRef.current.grab * geometry.height;
    const ratio = Math.max(0, Math.min(1, y / Math.max(1, geometry.travel)));
    scroller.scrollTop = ratio * geometry.max;
  }, [scrollRef]);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const track = trackRef.current;
    if (!scroller || !track) return;
    let frame;
    const measure = () => {
      const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const height = Math.min(track.clientHeight, Math.max(44, track.clientHeight * scroller.clientHeight / Math.max(1, scroller.scrollHeight)));
      const geometry = { max, height, travel: Math.max(0, track.clientHeight - height) };
      metricsRef.current = geometry;
      // 加载更多、图片展开或窗口变化时，滑块仍跟着手指，不会突然跳开。
      if (dragRef.current) scrollToPointer(dragRef.current.clientY);
      setMetrics({ ...geometry, top: max ? scroller.scrollTop / max * geometry.travel : 0, value: scroller.scrollTop });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    observer.observe(track);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    scroller.addEventListener('scroll', schedule, { passive: true });
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener('scroll', schedule);
      dragRef.current = null;
    };
  }, [scrollRef, scrollToPointer]);

  const finishDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };
  const visible = metrics?.max > 1 && metrics.travel > 0;

  return <div
    ref={trackRef}
    className={`mistake-list-scroll-handle${dragging ? ' is-dragging' : ''}`}
    style={{ visibility: visible ? 'visible' : 'hidden' }}
    role="scrollbar"
    aria-label="快速滚动错题列表"
    aria-controls={controlsId}
    aria-orientation="vertical"
    aria-valuemin={0}
    aria-valuemax={Math.round(metrics?.max || 0)}
    aria-valuenow={Math.round(metrics?.value || 0)}
    tabIndex={visible ? 0 : -1}
    onPointerDown={event => {
      if (!visible || !event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      const y = event.clientY - event.currentTarget.getBoundingClientRect().top;
      const onThumb = y >= metrics.top && y <= metrics.top + metrics.height;
      dragRef.current = { pointerId: event.pointerId, clientY: event.clientY, grab: onThumb ? (y - metrics.top) / metrics.height : 0.5 };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      scrollToPointer(event.clientY);
    }}
    onPointerMove={event => {
      if (dragRef.current?.pointerId !== event.pointerId) return;
      dragRef.current.clientY = event.clientY;
      scrollToPointer(event.clientY);
    }}
    onPointerUp={finishDrag}
    onPointerCancel={finishDrag}
    onLostPointerCapture={finishDrag}
    onKeyDown={event => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      const amount = { ArrowUp: -48, ArrowDown: 48, PageUp: -scroller.clientHeight * 0.9, PageDown: scroller.clientHeight * 0.9 }[event.key];
      if (amount !== undefined || event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        scroller.scrollTop = event.key === 'Home' ? 0 : event.key === 'End' ? scroller.scrollHeight : scroller.scrollTop + amount;
      }
    }}
  >
    <div className="mistake-list-scroll-thumb" style={{ height: metrics?.height || 44, transform: `translateY(${metrics?.top || 0}px)` }} />
  </div>;
}
