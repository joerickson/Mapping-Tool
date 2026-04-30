// Tabs — Radix Tabs themed two ways:
//   <Tabs> / <TabsList> / <TabsTrigger> / <TabsContent>     classic underline tabs
//   <SegmentedControl> + <SegmentedControlOption>          dense pill segments
//
// Same Radix primitive under both — separate styling because the underline
// look is right for "switch which view of this section is on screen", while
// segmented control is right for "pick a value" (e.g. per-branch /
// per-region / portfolio scope).
import { forwardRef } from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '../../lib/cn'

export const Tabs = TabsPrimitive.Root

export const TabsList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex items-center gap-2 border-b border-border',
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'relative inline-flex items-center px-1 py-2.5 text-sm font-medium',
      'text-fg-muted hover:text-fg transition-colors duration-150',
      'data-[state=active]:text-fg',
      // Underline indicator. Matches Linear's tab style.
      'after:content-[""] after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-transparent',
      'data-[state=active]:after:bg-fg',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm',
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

export const TabsContent = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm',
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

// ─────────────────────────────────────────────────────────────────────────────
// SegmentedControl — same Radix primitive, denser look. Optimized for
// 2-4 mutually-exclusive options. Use Tabs (above) when you have content
// panels per option.
// ─────────────────────────────────────────────────────────────────────────────

export const SegmentedControl = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Root
    ref={ref}
    className={cn('inline-flex', className)}
    {...props}
  />
))
SegmentedControl.displayName = 'SegmentedControl'

export const SegmentedControlList = forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex items-center gap-1 rounded-md border border-border bg-surface-subtle p-1',
      className
    )}
    {...props}
  />
))
SegmentedControlList.displayName = 'SegmentedControlList'

export const SegmentedControlOption = forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center px-2.5 py-1 rounded text-xs font-medium',
      'text-fg-muted hover:text-fg transition-colors duration-150',
      // Active segment uses the surface fill so it appears "pressed in" against
      // the subtle bg of the list.
      'data-[state=active]:bg-surface data-[state=active]:text-fg data-[state=active]:shadow-sm',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      className
    )}
    {...props}
  />
))
SegmentedControlOption.displayName = 'SegmentedControlOption'
