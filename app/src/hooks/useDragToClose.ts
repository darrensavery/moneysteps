import { useRef } from 'react';

/**
 * Returns refs and event handlers to wire up drag-to-close on a bottom sheet.
 * Drag the sheet down >120px to trigger onClose; otherwise it snaps back.
 */
export function useDragToClose(onClose: () => void) {
  const sheetRef    = useRef<HTMLDivElement>(null);
  const dragStartY  = useRef<number | null>(null);
  const dragOffsetY = useRef(0);

  function onDragStart(clientY: number) {
    dragStartY.current = clientY;
    dragOffsetY.current = 0;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  }

  function onDragMove(clientY: number) {
    if (dragStartY.current === null) return;
    const delta = Math.max(0, clientY - dragStartY.current);
    dragOffsetY.current = delta;
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${delta}px)`;
  }

  function onDragEnd() {
    if (dragStartY.current === null) return;
    dragStartY.current = null;
    if (sheetRef.current) sheetRef.current.style.transition = '';
    if (dragOffsetY.current > 120) {
      onClose();
    } else {
      if (sheetRef.current) sheetRef.current.style.transform = '';
    }
  }

  const handleProps = {
    className: 'flex justify-center items-center py-4 shrink-0 cursor-grab active:cursor-grabbing touch-none',
    onMouseDown: (e: React.MouseEvent) => onDragStart(e.clientY),
    onMouseMove: (e: React.MouseEvent) => { if (dragStartY.current !== null) onDragMove(e.clientY); },
    onMouseUp: onDragEnd,
    onMouseLeave: onDragEnd,
    onTouchStart: (e: React.TouchEvent) => onDragStart(e.touches[0].clientY),
    onTouchMove: (e: React.TouchEvent) => onDragMove(e.touches[0].clientY),
    onTouchEnd: onDragEnd,
  };

  return { sheetRef, handleProps };
}
