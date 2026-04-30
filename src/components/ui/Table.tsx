// Table — composable wrappers around the native <table> elements. Default
// styling is dense (h-9 rows, py-2 cells) per design rules ("Density is good").
// SegmentedControl handles the "switch view" use case; this is for actual
// tabular data.
//
// Numbers in cells get tabular figures via .font-tabular — apply at the
// <TableCell> level with `numeric` prop, or wrap individual values inline.
import { forwardRef } from 'react'
import { cn } from '../../lib/cn'

export const Table = forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table
      ref={ref}
      className={cn('w-full caption-bottom text-sm', className)}
      {...props}
    />
  </div>
))
Table.displayName = 'Table'

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    // Sticky by default — dashboard tables benefit from header-on-scroll.
    className={cn(
      '[&_tr]:border-b [&_tr]:border-border sticky top-0 bg-surface z-10',
      className
    )}
    {...props}
  />
))
TableHeader.displayName = 'TableHeader'

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn('[&_tr:last-child]:border-0', className)}
    {...props}
  />
))
TableBody.displayName = 'TableBody'

export const TableFooter = forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-t border-border bg-surface-subtle font-medium [&>tr]:last:border-b-0',
      className
    )}
    {...props}
  />
))
TableFooter.displayName = 'TableFooter'

export const TableRow = forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      'border-b border-border transition-colors hover:bg-surface-muted/60',
      'data-[state=selected]:bg-surface-muted',
      className
    )}
    {...props}
  />
))
TableRow.displayName = 'TableRow'

export const TableHead = forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-9 px-3 text-left align-middle text-xs uppercase tracking-wide font-medium text-fg-subtle',
      className
    )}
    {...props}
  />
))
TableHead.displayName = 'TableHead'

export interface TableCellProps
  extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** Apply tabular figures + right-align — use for numeric columns. */
  numeric?: boolean
}

export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, numeric, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        'h-9 px-3 align-middle',
        numeric && 'text-right font-mono tabular-nums',
        className
      )}
      {...props}
    />
  )
)
TableCell.displayName = 'TableCell'

export const TableCaption = forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn('mt-4 text-sm text-fg-muted', className)}
    {...props}
  />
))
TableCaption.displayName = 'TableCaption'
