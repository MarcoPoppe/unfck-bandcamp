'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { resolveTheme, loadThemeMode, THEME_CHANGE_EVENT, type ThemeMode } from '@/lib/settings/theme';

interface Props {
  /** Tailwind sizing classes, e.g. `h-7 w-auto`. */
  className?: string;
  priority?: boolean;
}

/**
 * Brand wordmark for the app itself ("unfck bandcamp"). Rendered as a
 * theme-aware <Image>: the dark variant has white ink, the light variant
 * has black ink, both with transparent background.
 *
 * We pick the right variant on the client after mount. Server-render shows
 * the dark variant (matches default <html class="dark"> on first paint);
 * the FOUC boot script reconciles <html>, then this component reconciles
 * its own image source on hydration.
 */
export default function UnfckBandcampLogo({ className = '', priority = false }: Props) {
  const [resolved, setResolved] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const compute = () => {
      const mode: ThemeMode = loadThemeMode();
      setResolved(resolveTheme(mode));
    };
    compute();

    window.addEventListener(THEME_CHANGE_EVENT, compute);
    window.addEventListener('storage', compute);
    const mq = window.matchMedia?.('(prefers-color-scheme: light)');
    const onMq = () => compute();
    mq?.addEventListener?.('change', onMq);

    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, compute);
      window.removeEventListener('storage', compute);
      mq?.removeEventListener?.('change', onMq);
    };
  }, []);

  const src =
    resolved === 'light'
      ? '/logo/unfck-bandcamp-light.png'
      : '/logo/unfck-bandcamp-dark.png';

  return (
    <Image
      src={src}
      alt="Unfck Bandcamp"
      width={1673}
      height={321}
      priority={priority}
      className={className}
      unoptimized
    />
  );
}
