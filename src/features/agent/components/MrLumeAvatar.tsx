import React, { useState } from 'react';
import { motion } from 'motion/react';

interface MrLumeAvatarProps {
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  className?: string;
}

const SIZES = {
  sm: 'w-7 h-7',
  md: 'w-10 h-10',
  lg: 'w-14 h-14',
};

const IMG_SIZES = {
  sm: 'w-5 h-5',
  md: 'w-7 h-7',
  lg: 'w-10 h-10',
};

const TEXT_SIZES = {
  sm: 'text-[10px]',
  md: 'text-xs',
  lg: 'text-sm',
};

export default function MrLumeAvatar({ size = 'sm', pulse = false, className = '' }: MrLumeAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <motion.div
      role="img"
      aria-label="Mr Lume"
      className={`${SIZES[size]} rounded-xl bg-surface-secondary border border-outline-subtle flex items-center justify-center shrink-0 ${className}`}
      animate={pulse ? { scale: [1, 1.05, 1] } : undefined}
      transition={pulse ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      {imgFailed ? (
        <span className={`${TEXT_SIZES[size]} font-bold text-text-tertiary select-none`}>ML</span>
      ) : (
        <img
          src="/lume-logo.png"
          alt="Mr Lume"
          className={`${IMG_SIZES[size]} object-contain`}
          onError={() => setImgFailed(true)}
        />
      )}
    </motion.div>
  );
}
