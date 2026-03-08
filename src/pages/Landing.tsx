import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, CheckCircle2, BarChart3, Users2, ShieldCheck, Zap } from 'lucide-react';

interface LandingProps {
  onStart: () => void;
}

export default function Landing({ onStart }: LandingProps) {
  return (
    <div className="min-h-screen bg-[#F8F9FA] selection:bg-black/10">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 glass border-b border-white/20 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
              <div className="w-4 h-4 bg-white rounded-sm rotate-45" />
            </div>
            <span className="text-xl font-extralight tracking-widest">LUME</span>
          </div>
          <div className="flex items-center gap-6">
            <button onClick={onStart} className="text-sm font-light text-gray-500 hover:text-black transition-colors">Sign In</button>
            <button onClick={onStart} className="glass-button-primary text-xs px-6 py-2">Get Started</button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto text-center space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-black/5 border border-black/5 text-[10px] uppercase tracking-widest font-medium text-gray-500"
          >
            <Zap size={12} className="text-black" />
            The next generation of CRM
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-6xl md:text-8xl font-extralight tracking-tighter leading-tight"
          >
            Relationships, <br />
            <span className="italic serif">refined.</span>
          </motion.h1>

          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="max-w-2xl mx-auto text-lg text-gray-500 font-light leading-relaxed"
          >
            LUME is a minimalist CRM designed for high-end teams who value clarity over complexity. 
            Manage leads, track pipelines, and close deals in a beautiful glassmorphism interface.
          </motion.p>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex items-center justify-center gap-4 pt-4"
          >
            <button onClick={onStart} className="glass-button-primary px-8 py-4 text-sm flex items-center gap-2 group">
              Start Free Trial
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <button onClick={onStart} className="glass-button px-8 py-4 text-sm">View Demo</button>
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-6 bg-white/50">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              icon: <BarChart3 className="text-gray-400" />,
              title: "Visual Pipeline",
              desc: "Drag and drop leads through custom stages with real-time value tracking."
            },
            {
              icon: <Users2 className="text-gray-400" />,
              title: "Lead Intelligence",
              desc: "High-density lead management with CSV import and advanced filtering."
            },
            {
              icon: <ShieldCheck className="text-gray-400" />,
              title: "Secure Auth",
              desc: "Enterprise-grade security powered by Supabase. Your data, your control."
            }
          ].map((feature, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="glass-card p-8 space-y-4 hover:bg-white/80 transition-colors"
            >
              <div className="w-12 h-12 rounded-xl bg-black/5 flex items-center justify-center">
                {feature.icon}
              </div>
              <h3 className="text-xl font-light tracking-tight">{feature.title}</h3>
              <p className="text-sm text-gray-500 font-light leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20 px-6">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="text-center space-y-4">
            <h2 className="text-4xl font-extralight tracking-tight">Simple, transparent pricing</h2>
            <p className="text-gray-500 font-light">Choose the plan that fits your growth</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 max-w-4xl mx-auto gap-8">
            <div className="glass-card p-10 space-y-6 border-white/40">
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-widest font-medium text-gray-400">Starter</p>
                <h3 className="text-4xl font-extralight">$0<span className="text-lg text-gray-400">/mo</span></h3>
              </div>
              <ul className="space-y-4">
                {['Up to 50 leads', 'Basic Pipeline', 'Task Management', 'CSV Export'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm font-light text-gray-500">
                    <CheckCircle2 size={16} className="text-black" />
                    {item}
                  </li>
                ))}
              </ul>
              <button onClick={onStart} className="glass-button w-full py-3 text-sm block text-center">Get Started</button>
            </div>

            <div className="glass-card p-10 space-y-6 border-black/10 bg-black text-white">
              <div className="space-y-2">
                <p className="text-[10px] uppercase tracking-widest font-medium text-white/40">Pro</p>
                <h3 className="text-4xl font-extralight">$29<span className="text-lg text-white/40">/mo</span></h3>
              </div>
              <ul className="space-y-4">
                {['Unlimited leads', 'Custom Pipelines', 'Advanced Analytics', 'Priority Support', 'Team Collaboration'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm font-light text-white/60">
                    <CheckCircle2 size={16} className="text-white" />
                    {item}
                  </li>
                ))}
              </ul>
              <button onClick={onStart} className="glass-button-primary bg-white text-black w-full py-3 text-sm block text-center">Go Pro</button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-black/5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-black rounded flex items-center justify-center">
              <div className="w-3 h-3 bg-white rounded-sm rotate-45" />
            </div>
            <span className="text-sm font-extralight tracking-widest">LUME</span>
          </div>
          <p className="text-xs text-gray-400 font-light">© 2024 LUME CRM. All rights reserved.</p>
          <div className="flex gap-6 text-xs text-gray-400 font-light">
            <a href="#" className="hover:text-black transition-colors">Privacy</a>
            <a href="#" className="hover:text-black transition-colors">Terms</a>
            <a href="#" className="hover:text-black transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
