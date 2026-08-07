import React from 'react';
import { motion } from 'motion/react';
import { useTranslation } from '../../i18n';

/**
 * Shared "trusted by" logo strip.
 * Only real Lume customers belong here — no placeholder brands.
 */

function TrustLogo({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 select-none h-10">
      {children}
    </div>
  );
}

export default function TrustSection() {
  const { t } = useTranslation();

  return (
    <section className="py-16 md:py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="text-center text-base md:text-lg uppercase tracking-[0.15em] font-semibold text-black mb-12"
        >
          {t.marketingSite.trust.heading}
        </motion.p>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="flex flex-wrap items-center justify-center gap-x-14 gap-y-8 md:justify-between"
        >
          <TrustLogo>
            <img src="/vision-lavage.png" alt="Vision Lavage" className="h-8 w-auto" />
          </TrustLogo>

          <TrustLogo>
            <img
              src="/construction-audet.png"
              alt="Construction Audet"
              className="h-16 w-auto"
            />
          </TrustLogo>

          {/* Pelt — lawn care */}
          <TrustLogo>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
              <path
                d="M4 20c-.4-4 .6-6.6 3-7.9M9 20c-.9-5.3.3-9 3.6-11M14.4 20c.2-4.6 1.6-7.6 4.2-9M19.6 20c.5-3.2.2-5.4-.9-6.7"
                stroke="#2f7d32"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <path d="M2.5 20.2h19" stroke="#2f7d32" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
            <span className="text-[26px] font-bold tracking-tight text-black">
              Pelt
            </span>
          </TrustLogo>

          {/* Entretiens Dubreuil — navy/gold handshake mark, per entretiensdubreuil.com */}
          <TrustLogo>
            <div className="w-10 h-10 shrink-0 bg-[#161e35] rounded-xl border-2 border-[#d4b43b] flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M11.9 6.3 9.6 8.4a1.6 1.6 0 0 0 2.1 2.4l1.6-1.4 3.4 3.1a1.5 1.5 0 0 1-2 2.2l-.5-.4a1.5 1.5 0 0 1-2.3 1.8 1.5 1.5 0 0 1-2.4 1.6 1.5 1.5 0 0 1-2.5-1.1L4.4 14a1.7 1.7 0 0 1-.3-2.2l2.5-3.6a2 2 0 0 1 1.5-.8h1.4l1-1a1.2 1.2 0 0 1 1.4-.1Z"
                  fill="white"
                />
                <path
                  d="M14.3 6.2h-1.9l2.1 1.9 4 3.6.9-1.3a1.7 1.7 0 0 0-.1-2L17 6.9a2 2 0 0 0-1.4-.7h-1.3Z"
                  fill="white"
                />
              </svg>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[15px] font-black uppercase tracking-tighter text-[#161e35]">
                Entretiens
              </span>
              <span className="text-[15px] font-black uppercase tracking-tighter text-[#d4b43b]">
                Dubreuil
              </span>
            </div>
          </TrustLogo>
        </motion.div>
      </div>
    </section>
  );
}
