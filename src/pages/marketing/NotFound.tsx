import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Home } from 'lucide-react';
import { useEffect } from 'react';

export default function MarketingNotFound() {
  const navigate = useNavigate();

  // Hint crawlers that this is a 404 (SPA can't set status codes, but the
  // soft-signal via meta + title helps SEO tooling and Lighthouse).
  useEffect(() => {
    const prev = document.title;
    document.title = '404 — Page not found | Lume';
    return () => { document.title = prev; };
  }, []);

  return (
    <section className="min-h-[60vh] flex items-center justify-center px-6 py-24">
      <div className="max-w-lg text-center">
        <p className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#1F5F4F] mb-4">404</p>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-[-0.03em] leading-[1.08] text-[#111]">
          Page not found
        </h1>
        <p className="mt-5 text-base text-text-secondary leading-relaxed">
          The link may be broken, or the page may have been moved. Try going back or heading to the homepage.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 rounded-lg border border-[#111] bg-white px-5 py-2.5 text-sm font-medium text-[#111] hover:bg-[#f5f5f2] transition-colors"
          >
            <ArrowLeft size={14} />
            Go back
          </button>
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-lg bg-[#3FAF97] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#1F5F4F] transition-colors"
          >
            <Home size={14} />
            Homepage
          </Link>
        </div>
      </div>
    </section>
  );
}
