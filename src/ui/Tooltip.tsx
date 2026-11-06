/** Global tooltips (spec §4.9). One listener serves every element with a data-tooltip attribute. */
import { useEffect, useRef, useState } from 'react';

export function tip(text: string) { return { 'data-tooltip': text, 'aria-label': text.replace(/[^\p{L}\p{N}\s,.!'?:-]/gu, '').trim() }; }

export function TooltipLayer() {
  const [t, setT] = useState<{ text: string; x: number; y: number; above: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  useEffect(() => {
    const show = (el: Element) => {
      const r = el.getBoundingClientRect();
      const above = r.bottom + 70 > innerHeight;
      setT({ text: el.getAttribute('data-tooltip')!, x: Math.min(innerWidth - 140, Math.max(140, r.left + r.width / 2)), y: above ? r.top - 8 : r.bottom + 8, above });
    };
    const target = (e: Event) => (e.target as Element | null)?.closest?.('[data-tooltip]') ?? null;
    const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      clear();
      const el = target(e);
      if (el) timer.current = setTimeout(() => show(el), 350); else setT(null);
    };
    const down = (e: PointerEvent) => {
      clear(); setT(null); longPressed.current = false;
      if (e.pointerType !== 'mouse') {
        const el = target(e);
        if (el) timer.current = setTimeout(() => { longPressed.current = true; show(el); }, 600);
      }
    };
    const up = () => clear();
    // A long-press shows help; it must not also press the button.
    const click = (e: MouseEvent) => { if (longPressed.current) { e.stopPropagation(); e.preventDefault(); longPressed.current = false; } };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('click', click, true);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('click', click, true);
    };
  }, []);
  if (!t) return null;
  return <div className="tooltip" role="tooltip" style={{ left: t.x, top: t.y, translate: `-50% ${t.above ? '-100%' : '0'}` }}>{t.text}</div>;
}
