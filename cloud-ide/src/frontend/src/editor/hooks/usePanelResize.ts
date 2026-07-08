// One mouse-drag resize helper, replacing the two near-identical drag handlers
// (sidebar width + terminal height) that lived inline in EditorWorkspace.
//
// No React state of its own, so it's a plain function, not a hook — the current
// size is read at mousedown and clamped deltas are streamed to `onResize`.
import type React from 'react';

interface ResizeOptions {
  axis: 'x' | 'y';
  /** Size (px) at drag start; the delta is applied on top of this. */
  initial: number;
  min: number;
  max: number;
  /** Grow when the cursor moves toward the origin (e.g. a bottom panel resized
   *  by its top edge — up = bigger). */
  invert?: boolean;
  onResize: (size: number) => void;
}

export function startPanelDrag(e: React.MouseEvent, opts: ResizeOptions): void {
  e.preventDefault();
  const { axis, initial, min, max, invert, onResize } = opts;
  const start = axis === 'x' ? e.clientX : e.clientY;

  const onMouseMove = (move: MouseEvent) => {
    const pos = axis === 'x' ? move.clientX : move.clientY;
    const delta = (pos - start) * (invert ? -1 : 1);
    onResize(Math.max(min, Math.min(initial + delta, max)));
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'default';
  };

  document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}
