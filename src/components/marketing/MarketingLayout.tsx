import { Outlet } from 'react-router-dom';
import Header from './Header';
import Footer from './Footer';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export default function MarketingLayout() {
  const { pathname, hash } = useLocation();

  // Marketing/landing pages are designed for light mode only. Strip the global
  // `dark` class while they're mounted so dark-mode users still see the public
  // site with its intended black text and dark sections, then restore on unmount.
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    if (wasDark) root.classList.remove('dark');
    return () => {
      if (wasDark) root.classList.add('dark');
    };
  }, []);

  useEffect(() => {
    if (hash) {
      setTimeout(() => {
        const el = document.getElementById(hash.slice(1));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash]);

  return (
    <div className="marketing-landing min-h-screen text-text-primary">
      <Header />
      <main>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
