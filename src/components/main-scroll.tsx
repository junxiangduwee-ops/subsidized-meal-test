'use client';

import { useRef, useCallback } from 'react';

export function MainScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add('scrollbar-visible');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      el?.classList.remove('scrollbar-visible');
    }, 1500);
  }, []);

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      className="main-scroll min-w-0 flex-1 overflow-y-auto py-6"
    >
      {children}
    </div>
  );
}
