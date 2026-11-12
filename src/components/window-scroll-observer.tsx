'use client';

import { useEffect } from 'react';

export function WindowScrollObserver() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    function handleScroll() {
      document.documentElement.classList.add('page-scrolling');
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        document.documentElement.classList.remove('page-scrolling');
      }, 1500);
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  return null;
}
