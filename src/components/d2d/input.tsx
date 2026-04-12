import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm text-text-primary placeholder:text-text-muted',
          'transition-colors duration-150',
          'hover:border-border',
          'focus:border-outline-strong focus:outline-none focus:ring-2 focus:ring-outline/30',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-surface-elevated',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
