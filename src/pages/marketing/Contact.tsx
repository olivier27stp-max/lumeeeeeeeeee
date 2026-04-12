import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Mail, MapPin, Check } from 'lucide-react';

export default function Contact() {
  const [submitted, setSubmitted] = useState(false);

  return (
    <div style={{ backgroundColor: '#fafaf8', backgroundImage: 'url("/paper-texture.png")', backgroundRepeat: 'repeat', backgroundSize: '300px 300px' }}>
      {/* Hero */}
      <section className="pt-28 pb-12 md:pt-36 md:pb-16 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[11px] uppercase tracking-[0.2em] font-semibold text-[#1F5F4F] mb-4"
          >
            Contact
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-[-0.03em] leading-[1.08] text-[#111]"
          >
            Book a demo with
            <br />
            our team
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-5 text-lg font-normal text-text-secondary max-w-2xl mx-auto leading-relaxed"
          >
            We'll walk you through everything — no commitment required.
          </motion.p>
        </div>
      </section>

      {/* Info left + Form right */}
      <section className="px-6 pb-24 md:pb-32">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row gap-10 md:gap-16 items-start">
          {/* Info left */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex-1 md:pt-4"
          >
            <h2 className="text-2xl md:text-3xl font-extrabold text-[#111] leading-snug mb-8">
              Get in touch
            </h2>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#111] flex items-center justify-center shrink-0">
                  <Mail size={16} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#111]">Email</p>
                  <a href="mailto:admin@lumecrm.net" className="text-sm text-text-secondary hover:text-[#111] transition-colors">
                    admin@lumecrm.net
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-full bg-[#111] flex items-center justify-center shrink-0">
                  <MapPin size={16} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-[#111]">Location</p>
                  <p className="text-sm text-text-secondary">Quebec, Canada</p>
                </div>
              </div>
            </div>

            <div className="mt-10 pt-8 border-t border-[#e0e0e0]">
              <p className="text-sm font-bold text-[#111] mb-3">What to expect</p>
              <ul className="space-y-2.5">
                {[
                  'A quick walkthrough of Lume',
                  'Tailored to your industry',
                  'No commitment, no pressure',
                  'Response within 24 hours',
                ].map(item => (
                  <li key={item} className="flex items-center gap-2.5 text-sm text-text-secondary">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ border: '2px solid #3FAF97' }}>
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                        <path d="M3 8.5l3.5 3.5L13 5" stroke="#3FAF97" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </motion.div>

          {/* Form right — dark box */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="flex-1 w-full"
          >
            {submitted ? (
              <div className="bg-[#111] rounded-2xl p-10 text-center">
                <div className="w-14 h-14 rounded-full bg-[#3FAF97]/20 flex items-center justify-center mx-auto mb-5">
                  <Check size={28} className="text-[#3FAF97]" />
                </div>
                <h3 className="text-xl font-bold text-white">Request sent!</h3>
                <p className="mt-2 text-sm text-white/50">
                  Our team will reach out within 24 hours to schedule your demo.
                </p>
              </div>
            ) : (
              <div className="bg-[#111] rounded-2xl p-8">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setSubmitted(true);
                  }}
                  className="flex flex-col gap-4"
                >
                  <input type="text" required placeholder="Full name *" className="px-4 py-3 border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#3FAF97] transition-colors rounded-lg" />
                  <input type="email" required placeholder="Email *" className="px-4 py-3 border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#3FAF97] transition-colors rounded-lg" />
                  <input type="tel" required placeholder="Phone *" className="px-4 py-3 border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#3FAF97] transition-colors rounded-lg" />
                  <input type="text" required placeholder="Company *" className="px-4 py-3 border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#3FAF97] transition-colors rounded-lg" />
                  <textarea rows={3} placeholder="Message" className="px-4 py-3 border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:border-[#3FAF97] transition-colors rounded-lg resize-none" />
                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 bg-[#3FAF97] text-white px-7 py-3.5 rounded-lg text-sm font-medium hover:bg-[#1F5F4F] transition-colors group mt-2"
                  >
                    Book demo
                    <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </form>
              </div>
            )}
          </motion.div>
        </div>
      </section>
    </div>
  );
}
