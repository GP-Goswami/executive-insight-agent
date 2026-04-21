# Executive Reporting Dashboard - Design Guidelines

## Design Approach: Custom Ultra AI Enterprise Dashboard

This is a **data-intensive enterprise application** with explicitly defined visual requirements. The design follows the "Ultra AI Dashboard" aesthetic as specified.

---

## Visual Theme

**Dark Mode Enterprise**
- Background: Deep navy/charcoal (#0f172a to #1e293b range) with subtle grid or noise texture
- Accent colors: Neon cyan (#06b6d4) + purple gradient (#a855f7 to #8b5cf6) for highlights
- Glows: Soft cyan/purple glow shadows on interactive elements
- Borders: Thin, high-contrast borders with subtle luminosity

**Typography**
- Font families: Inter, Sora, or Manrope (modern, clean sans-serif)
- Primary text: Crisp white (#ffffff)
- Secondary text: Muted gray (#94a3b8 to #cbd5e1)
- Headings: Bold weights, tight letter-spacing
- Data labels: Tabular numerals, monospace for metrics

---

## Layout System

**Spacing**: Use Tailwind units of 2, 4, 6, 8, 12, 16, 20, 24 for consistent rhythm

**Container Strategy**
- Max-width: 1400px for primary content
- Dashboard grid: 12-column responsive system
- Card padding: p-6 to p-8
- Section spacing: py-8 to py-12

**Responsive Breakpoints**
- Mobile: Stack all cards single-column
- Tablet: 2-column KPI grids
- Desktop: Multi-column layouts with sidebar filters

---

## Component Library

### Cards & Containers
- Rounded corners: 12-16px (rounded-xl to rounded-2xl)
- Background: Semi-transparent glassy effect (bg-slate-800/50)
- Borders: 1px solid with rgba white (border-white/10)
- Drop shadows: Soft, multi-layered (shadow-xl + custom glow)
- Hover state: Subtle glow border in cyan (#06b6d4) with increased shadow

### KPI Cards
- Grid layout: 4 cards per row on desktop
- Large metric number: text-4xl font-bold
- Metric label: text-sm text-gray-400 uppercase tracking-wide
- Trend indicator: Small arrow + percentage with color coding (green up, red down)
- Border glow on hover: 2px cyan gradient border

### Data Tables
- Header: Sticky, darker background (#0f172a), uppercase labels
- Rows: Alternating subtle striping (bg-slate-800/30)
- Hover row: bg-slate-700/50 transition
- Pagination: Bottom-aligned, minimal design
- Column filters: Inline dropdown icons
- Sortable columns: Arrow indicators

### Charts & Visualizations
- Clean, minimal aesthetic - no gridline clutter
- Color palette: Cyan primary, purple secondary, gradient fills
- Axis labels: Small, gray
- Tooltips: Dark card with white text, subtle shadow
- Line thickness: 2-3px for clarity
- Area fills: Gradient with low opacity

### Filters Panel
- Collapsible sidebar (left or top bar)
- Dark background with border separation
- Input fields: Dark with light borders, cyan focus state
- Dropdowns: Custom styled, dark theme
- Clear/Reset button: Text link in muted color

### Date Range Selector
- Prominent placement: Top-right of dashboard
- Preset buttons: Pill-style (Last 7d, 14d, 28d, 30d, 90d, Last Month, Custom)
- Active preset: Cyan background with glow
- Calendar picker: Dark theme custom component
- **Apply button**: Primary action, cyan gradient background with glow shadow, positioned adjacent to date picker

### Status Badges
- Rounded pill shape (rounded-full)
- Sync OK: Green glow (#10b981)
- Stale: Yellow/amber (#f59e0b)
- Failed: Red glow (#ef4444)
- Small text with dot indicator

### Buttons
- Primary: Cyan gradient background (#06b6d4 to #0891b2) with glow shadow
- Secondary: Transparent with cyan border
- Hover: Increased glow intensity
- Disabled: 50% opacity, no interaction
- Icon buttons: Square/circular with subtle background

### Loading States
- Skeleton shimmer: Gradient animation from dark to light gray
- Spinner: Cyan gradient circular indicator
- Minimal, non-blocking when possible

---

## Page Layouts

### Login Page
- Centered card (max-w-md)
- Logo at top with glow effect
- Simple form with dark inputs
- Gradient background with subtle animation

### Dashboard Pages
- **Top bar**: Logo left, property selector center, user menu right, date range selector
- **Sidebar** (optional/collapsible): Navigation + filters
- **Main content**: Grid of KPI cards + tabular/chart sections below
- **Footer**: Minimal, dark, sync status indicators

### Executive Overview
- 4-6 KPI cards in top grid
- AI Traffic tile: Prominent placement, special accent treatment
- Trend charts: 2-column layout below KPIs
- Tables: Full-width sections with headers

### Explorer Pages (AI/GSC/Rankings/Backlinks)
- Filters panel: Collapsible left sidebar
- Main table: Full-width with pagination
- Drilldown rows: Indented expandable sections
- Charts above table: Contextual visualizations

### Export Page
- PDF preview area: Light or dark variant selector
- Filter summary: Displayed as tags
- Action buttons: Download + Copy share link
- Share link list: Table with expiry and audit info

---

## Interactions

- **Transitions**: 150-200ms easing for hovers, 300ms for state changes
- **Focus states**: Cyan outline (ring-2 ring-cyan-500)
- **Active states**: Slightly darker with inner glow
- **Disabled states**: 50% opacity, cursor-not-allowed
- **Minimal animations**: Only where they enhance UX (loading, data refresh)

---

## Export PDF Styling

- **Background option**: White background variant OR dark-to-light gradient
- **Header**: Include logo, date range, filters applied, generation timestamp
- **Content**: Match dashboard layout but print-optimized
- **Typography**: Ensure readability in print/screen
- **Charts**: SVG export for crispness

---

## Accessibility

- WCAG AA contrast ratios (light text on dark backgrounds)
- Keyboard navigation: Full support, visible focus indicators
- Screen reader labels: All interactive elements
- Color-blind safe: Don't rely solely on color for status (use icons + text)
- Form inputs: Consistent sizing and spacing, clear labels

---

## Images

**No hero images required** - this is a data-dense dashboard application. Imagery limited to:
- Logo: Top-left navigation (white/cyan variant)
- Empty states: Simple illustrations with dark theme
- User avatars: Circular, small scale
- Icons: Heroicons or Lucide icons via CDN (outline style, stroke-2, cyan accents)