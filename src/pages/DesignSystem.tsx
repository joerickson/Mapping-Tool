// /design-system — visual reference for the Phase B component library.
// Open this page and toggle the theme to verify every component reads
// well in both light and dark.
//
// Intentionally scrappy structure (no sidebar, no nav cleanup) — Phase C
// builds the real chrome. This page exists for design-review only.
import { useState } from 'react'
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  CircleAlert,
  CircleHelp,
  Inbox,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import Button from '../components/ui/Button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/Card'
import { FormField, Input, Label, Textarea } from '../components/ui/Input'
import { Badge } from '../components/ui/Badge'
import { StatusDot } from '../components/ui/StatusDot'
import { Skeleton } from '../components/ui/Skeleton'
import { EmptyState } from '../components/ui/EmptyState'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/Dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../components/ui/DropdownMenu'
import {
  SegmentedControl,
  SegmentedControlList,
  SegmentedControlOption,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui/Tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/Select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/Table'
import { toast } from '../components/ui/Toast'
import ThemeToggle from '../components/ui/ThemeToggle'

export default function DesignSystemPage() {
  return (
    <div className="min-h-screen bg-surface text-fg">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur-sm">
        <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-tight">
              PortfolioIQ
            </span>
            <span className="text-fg-subtle">/</span>
            <span className="text-sm text-fg-muted">Design System</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Phase B</Badge>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-16 px-6 py-12">
        <Intro />
        <ButtonsSection />
        <BadgesSection />
        <CardsSection />
        <FormsSection />
        <SelectSection />
        <DialogsSection />
        <DropdownSection />
        <TabsSection />
        <SegmentedSection />
        <TableSection />
        <StatusSection />
        <SkeletonSection />
        <EmptyStateSection />
        <ToastSection />
      </main>
    </div>
  )
}

function Intro() {
  return (
    <section className="space-y-3">
      <h1 className="text-3xl font-semibold tracking-tight">
        Component library
      </h1>
      <p className="max-w-2xl text-base leading-relaxed text-fg-muted">
        Phase B reference. Every primitive renders against the Phase A token
        sheet, so flipping the theme above verifies that contrast and accent
        usage hold up. The aesthetic target is{' '}
        <span className="text-fg">restrained minimalism</span> — one accent
        (indigo), 1px borders, no shadows, no gradients, density over decoration.
      </p>
    </section>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-fg-muted">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>
}

// ─── Sections ────────────────────────────────────────────────────────────────

function ButtonsSection() {
  return (
    <Section
      title="Buttons"
      description="Reserve primary for the page's main CTA — most actions get secondary or ghost."
    >
      <Row>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">
          <Trash2 className="h-4 w-4" /> Delete
        </Button>
      </Row>
      <Row>
        <Button size="sm">Small</Button>
        <Button size="md">Default</Button>
        <Button size="lg">Large</Button>
      </Row>
      <Row>
        <Button loading>Saving…</Button>
        <Button disabled>Disabled</Button>
        <Button>
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
      </Row>
    </Section>
  )
}

function BadgesSection() {
  return (
    <Section title="Badges">
      <Row>
        <Badge>Default</Badge>
        <Badge variant="accent">Accent</Badge>
        <Badge variant="success">Active</Badge>
        <Badge variant="warning">Stale</Badge>
        <Badge variant="danger">Failed</Badge>
        <Badge variant="outline">Outline</Badge>
      </Row>
    </Section>
  )
}

function CardsSection() {
  return (
    <Section title="Cards">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Default</CardTitle>
            <CardDescription>
              Flat surface, 1px border, 24px padding.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-fg-muted">
              Use for grouping content — module cards, stat cards, settings
              panels.
            </p>
          </CardContent>
          <CardFooter>
            <Button size="sm" variant="secondary">
              Action
            </Button>
          </CardFooter>
        </Card>

        <Card variant="interactive">
          <CardHeader>
            <CardTitle>Interactive</CardTitle>
            <CardDescription>Hover state shifts surface + border.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-fg-muted">
              Pair with onClick or wrap in a Link.
            </p>
          </CardContent>
        </Card>

        <Card variant="elevated">
          <CardHeader>
            <CardTitle>Elevated</CardTitle>
            <CardDescription>Subtle hover shadow.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-fg-muted">
              For affordances that "lift": drag handles, primary CTAs.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Stat-card pattern — what the dashboard top row will look like */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Properties" value="521" />
        <StatCard label="Service Locations" value="993" />
        <StatCard label="States" value="6" />
        <StatCard label="Branches" value="3" />
      </div>
    </Section>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card padding="md">
      <p className="font-mono text-3xl font-semibold tabular-nums text-fg">
        {value}
      </p>
      <p className="mt-1 text-xs uppercase tracking-wide text-fg-subtle">
        {label}
      </p>
    </Card>
  )
}

function FormsSection() {
  return (
    <Section title="Forms">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <FormField
          label="Email"
          htmlFor="ds-email"
          helper="We'll only use this for billing."
        >
          <Input id="ds-email" type="email" placeholder="you@example.com" />
        </FormField>

        <FormField
          label="API Key"
          htmlFor="ds-key"
          error="This key has expired. Generate a new one."
        >
          <Input id="ds-key" placeholder="sk-…" invalid defaultValue="sk-expired" />
        </FormField>

        <FormField label="Notes" htmlFor="ds-notes" className="md:col-span-2">
          <Textarea
            id="ds-notes"
            placeholder="What's the context for this client?"
            rows={4}
          />
        </FormField>

        <div className="md:col-span-2 flex items-center gap-3">
          <Label className="uppercase tracking-wide">Inline label</Label>
          <Input className="flex-1" placeholder="Search properties…" />
        </div>
      </div>
    </Section>
  )
}

function SelectSection() {
  return (
    <Section title="Select">
      <FormField label="Scope" htmlFor="ds-scope" className="max-w-sm">
        <Select defaultValue="per_branch">
          <SelectTrigger id="ds-scope">
            <SelectValue placeholder="Select a scope…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="per_branch">Per branch</SelectItem>
            <SelectItem value="per_region">Per region</SelectItem>
            <SelectItem value="portfolio">Portfolio-wide</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
    </Section>
  )
}

function DialogsSection() {
  return (
    <Section title="Dialog">
      <Row>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Discard scenario draft?</DialogTitle>
              <DialogDescription>
                You have 3 unsaved changes on the current scenario. Discarding
                will revert to the saved baseline.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button variant="danger">Discard</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Row>
    </Section>
  )
}

function DropdownSection() {
  return (
    <Section title="Dropdown menu">
      <Row>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">Actions</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Manage</DropdownMenuLabel>
            <DropdownMenuItem>
              View details <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              Edit constraints <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-danger">
              Delete client
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Row>
    </Section>
  )
}

function TabsSection() {
  return (
    <Section title="Tabs">
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="risks">Risks</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <p className="text-sm text-fg-muted">
            Overview tab body. Tab content panels swap on selection.
          </p>
        </TabsContent>
        <TabsContent value="properties">
          <p className="text-sm text-fg-muted">Properties tab body.</p>
        </TabsContent>
        <TabsContent value="risks">
          <p className="text-sm text-fg-muted">Risks tab body.</p>
        </TabsContent>
      </Tabs>
    </Section>
  )
}

function SegmentedSection() {
  const [scope, setScope] = useState('per_branch')
  return (
    <Section
      title="Segmented control"
      description="Use for picking among 2–4 mutually exclusive options when content doesn't change."
    >
      <SegmentedControl value={scope} onValueChange={setScope}>
        <SegmentedControlList>
          <SegmentedControlOption value="per_branch">
            Per branch
          </SegmentedControlOption>
          <SegmentedControlOption value="per_region">
            Per region
          </SegmentedControlOption>
          <SegmentedControlOption value="portfolio">
            Portfolio
          </SegmentedControlOption>
        </SegmentedControlList>
      </SegmentedControl>
    </Section>
  )
}

function TableSection() {
  return (
    <Section title="Table">
      <Card padding="none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead>
              <TableHead className="text-right">Properties</TableHead>
              <TableHead className="text-right">Avg drive</TableHead>
              <TableHead className="text-right">Drive cost</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Frisco, TX</TableCell>
              <TableCell numeric>184</TableCell>
              <TableCell numeric>22 mi</TableCell>
              <TableCell numeric>$84,210</TableCell>
              <TableCell>
                <StatusDot variant="fresh" label={false} />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Houston, TX</TableCell>
              <TableCell numeric>156</TableCell>
              <TableCell numeric>31 mi</TableCell>
              <TableCell numeric>$92,540</TableCell>
              <TableCell>
                <StatusDot variant="stale" label={false} />
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Albuquerque, NM</TableCell>
              <TableCell numeric>121</TableCell>
              <TableCell numeric>48 mi</TableCell>
              <TableCell numeric>$108,003</TableCell>
              <TableCell>
                <StatusDot variant="running" label={false} />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>
    </Section>
  )
}

function StatusSection() {
  return (
    <Section title="Status dots">
      <Card>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <StatusDot variant="fresh" />
          <StatusDot variant="stale" />
          <StatusDot variant="running" />
          <StatusDot variant="never" />
          <StatusDot variant="failed" />
          <StatusDot variant="idle" />
        </div>
      </Card>
    </Section>
  )
}

function SkeletonSection() {
  return (
    <Section
      title="Skeleton"
      description="Loading placeholder. Match the shape of the content that's coming."
    >
      <Card>
        <div className="space-y-3">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <div className="grid grid-cols-2 gap-4 pt-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        </div>
      </Card>
    </Section>
  )
}

function EmptyStateSection() {
  return (
    <Section title="Empty states">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card padding="none">
          <EmptyState
            icon={Inbox}
            title="No saved scenarios"
            description="Save a what-if scenario from the slider panel to compare against the baseline later."
            action={
              <Button size="sm" variant="secondary">
                Open sliders
              </Button>
            }
          />
        </Card>
        <Card padding="none">
          <EmptyState
            icon={Building2}
            title="No clients on this account"
            description="Add a client to start running portfolio analysis."
            action={<Button size="sm">+ Add client</Button>}
          />
        </Card>
      </div>
    </Section>
  )
}

function ToastSection() {
  return (
    <Section
      title="Toasts"
      description="Imperative API. Fires from anywhere with toast.success(...)."
    >
      <Row>
        <Button
          variant="secondary"
          onClick={() =>
            toast.success('Constraints saved', {
              description: '5 fields updated.',
            })
          }
        >
          <Check className="h-4 w-4" />
          Success
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast.error('Save failed', { description: 'Try again in a moment.' })
          }
        >
          <CircleAlert className="h-4 w-4" />
          Error
        </Button>
        <Button
          variant="secondary"
          onClick={() => toast.info('Synthesis is running in the background')}
        >
          <CircleHelp className="h-4 w-4" />
          Info
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            toast.show('Plain notice', {
              description: 'No icon, neutral surface.',
            })
          }
        >
          Default
        </Button>
      </Row>
      <p className="text-xs text-fg-subtle">
        <CalendarDays className="mr-1 inline h-3 w-3" /> Auto-dismiss in 4s
        unless durationMs is provided. Hover any toast to keep it open.
      </p>
      {/* Keep the unused-import warning quiet for icons used only conditionally. */}
      <span className="hidden">
        <TriangleAlert />
      </span>
    </Section>
  )
}
