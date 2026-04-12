import { motion } from 'motion/react';

interface SectionProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
  bg?: 'white' | 'neutral' | 'dark';
}

export default function Section({ children, className = '', id, bg = 'white' }: SectionProps) {
  const bgClass = {
    white: 'bg-surface',
    neutral: 'bg-surface-secondary',
    dark: 'bg-text-primary text-white',
  }[bg];

  return (
    <section id={id} className={`py-20 md:py-28 px-6 ${bgClass} ${className}`}>
      <div className="max-w-7xl mx-auto">
        {children}
      </div>
    </section>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  centered = true,
  light = false,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  centered?: boolean;
  light?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      className={`max-w-3xl ${centered ? 'mx-auto text-center' : ''} mb-14`}
    >
      {eyebrow && (
        <p className={`text-[10px] uppercase tracking-[0.2em] font-semibold mb-3 ${
          light ? 'text-white/40' : 'text-primary'
        }`}>
          {eyebrow}
        </p>
      )}
      <h2 className={`text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1] ${
        light ? 'text-white' : 'text-text-primary'
      }`}>
        {title}
      </h2>
      {description && (
        <p className={`mt-4 text-lg font-normal leading-relaxed ${
          light ? 'text-white/50' : 'text-text-tertiary'
        }`}>
          {description}
        </p>
      )}
    </motion.div>
  );
}

export function FadeIn({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ delay, duration: 0.4 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
