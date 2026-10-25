import { cn } from 'cn';
import type * as React from 'react';

/**
 * Textarea styled following the project's design system, matching Input.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-[120px] w-full min-w-0 rounded-lg border border-input bg-card px-3 py-2 text-base shadow-xs transition-colors outline-none hover:not-disabled:not-focus-visible:not-aria-invalid:border-content-secondary placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
