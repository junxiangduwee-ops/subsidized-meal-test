'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Wraps a horizontally-scrolling row (day tabs, mobile section nav, etc.)
 * with a fade + tappable chevron on whichever edge still has more content,
 * so a swipeable row doesn't look like the full set of options fits on
 * screen. The row's own scrollbar stays hidden - these are the only
 * indicator that it's scrollable.
 *
 * The fade/arrows appear only on the edges that currently have more content
 * to reveal, and disappear entirely once everything fits (e.g. a wide
 * desktop viewport), so this never shows a stale affordance.
 */
export function ScrollFadeRow({
  children,
  innerClassName = '',
  fadeColorClassName = 'from-white',
  ariaLabel,
  role,
}: {
  children: ReactNode;
  /** Classes for the actual scrolling flex row (gap, padding, etc). */
  innerClassName?: string;
  /** Tailwind `from-*` class matching the row's own background, so the fade blends in. */
  fadeColorClassName?: string;
  ariaLabel?: string;
  role?: string;
}) {
  const t = useTranslations('common');
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    // A few px of slack so sub-pixel rounding doesn't leave a phantom arrow.
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    updateEdges();
    const el = scrollerRef.current;
    if (!el) return;
    // Content or viewport width can change (e.g. day tabs' badges loading,
    // window resize) without a scroll event firing, so watch size directly.
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, updateEdges]);

  function scrollByPage(direction: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: 'smooth' });
  }

  return (
    <div className="relative">
      <div
        ref={scrollerRef}
        onScroll={updateEdges}
        role={role}
        aria-label={ariaLabel}
        className={`flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${innerClassName}`}
      >
        {children}
      </div>

      {canScrollLeft ? (
        <>
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r ${fadeColorClassName} to-transparent`}
          />
          <button
            type="button"
            aria-label={t('scrollLeftAriaLabel')}
            onClick={() => scrollByPage(-1)}
            className="absolute left-0.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm active:scale-95"
          >
            <ChevronIcon direction="left" />
          </button>
        </>
      ) : null}

      {canScrollRight ? (
        <>
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l ${fadeColorClassName} to-transparent`}
          />
          <button
            type="button"
            aria-label={t('scrollRightAriaLabel')}
            onClick={() => scrollByPage(1)}
            className="absolute right-0.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm active:scale-95"
          >
            <ChevronIcon direction="right" />
          </button>
        </>
      ) : null}
    </div>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path
        d={direction === 'left' ? 'M7.5 2.5 3.5 6l4 3.5' : 'M4.5 2.5 8.5 6l-4 3.5'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
