import { cn } from '../../lib/utils';

interface AvatarProps {
  src?: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-11 w-11',
};

export function Avatar({ src, name, size = 'md', className }: AvatarProps) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn('shrink-0 rounded-full object-cover', sizeClasses[size], className)}
      />
    );
  }

  // Default: grey silhouette avatar (no initials)
  return (
    <div
      className={cn('shrink-0 rounded-full bg-[#d1d5db] flex items-center justify-center overflow-hidden', sizeClasses[size], className)}
      title={name}
    >
      <svg viewBox="0 0 120 120" fill="none" className="h-full w-full">
        <circle cx="60" cy="60" r="60" fill="#D1D5DB" />
        <circle cx="60" cy="46" r="20" fill="white" />
        <ellipse cx="60" cy="100" rx="35" ry="24" fill="white" />
      </svg>
    </div>
  );
}
