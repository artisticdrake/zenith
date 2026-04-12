# Design System Document: The Executive Analyst

## 1. Overview & Creative North Star
**Creative North Star: "The Architectural Ledger"**
This design system moves away from the "busy dashboard" aesthetic to embrace an editorial, high-end data environment. The goal is to transform the stressful process of job hunting into a feeling of executive command. We achieve this through **Architectural Depth**—using layers of tone and light rather than lines—and **Data Dignity**, where every metric is given significant breathing room and typographic hierarchy.

By leveraging intentional asymmetry (e.g., wide margins on one side, condensed utility bars on the other) and overlapping "frosted" surfaces, the UI feels like a bespoke digital workspace rather than a generic database.

---

## 2. Colors: Tonal Depth over Borders
This palette utilizes a deep "Midnight Professionalism" base with "Clinical Red" and "Intellectual Purple" accents, set in a **dark color mode**.

### The "No-Line" Rule
**Explicit Instruction:** You are prohibited from using 1px solid borders to section content. Boundaries must be defined through background color shifts.
*   **The Logic:** A border is a fence; a color shift is a zone. We want zones.
*   **Implementation:** A `surface-container-low` card sitting on a `surface` background provides all the definition a professional eye needs.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of premium cardstock and frosted glass:
*   **Base Layer:** `background` (#f7f9fb - *Note: This hex should reflect a dark mode background based on the system's token generation logic, which is not directly provided in the original theme but is implied by the color_mode change*)
*   **Sectioning:** `surface-container-low` (#f2f4f6 - *Note: This hex should reflect a dark mode surface-container-low based on the system's token generation logic*) for large content areas.
*   **Interactive Cards:** `surface-container-lowest` (#ffffff - *Note: This hex should reflect a dark mode surface-container-lowest based on the system's token generation logic*) to make them pop forward.
*   **Active Overlays:** `surface-bright` (#f7f9fb - *Note: This hex should reflect a dark mode surface-bright based on the system's token generation logic*) with 80% opacity for modals.

### The "Glass & Gradient" Rule
To avoid a flat, "out-of-the-box" Material look:
*   **Glassmorphism:** Use `surface-container-lowest` at 70% opacity with a `24px` backdrop blur for floating headers or sidebars.
*   **Signature Textures:** For primary CTAs (e.g., "Add New Application"), use a subtle linear gradient from `primary` (#002045) to `primary_container` (#1a365d) at a 135-degree angle. This adds "soul" and weight to the action.

---

## 3. Typography: Editorial Clarity
We pair the geometric precision of **Manrope** for high-level branding and headings with the functional Swiss-style clarity of **Inter** for data density.

*   **Display & Headlines (Manrope):** These are your "Anchors." Use `display-md` for dashboard overviews. The wide tracking of Manrope feels expensive and authoritative.
*   **Titles & Body (Inter):** These are your "Workers." Use `title-sm` for table headers and `body-md` for application details.
*   **The Hierarchy Rule:** Always lead with a large `headline-sm` for page titles, then skip a tier to `body-md` for descriptions. This high-contrast scale prevents the "wall of text" feel typical of data trackers.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are often messy. In this system, we use **Tonal Layering**.

*   **The Layering Principle:** Depth is achieved by "stacking." Place a `surface-container-lowest` card on top of a `surface-container` section. The contrast in hex codes creates a soft, natural lift.
*   **Ambient Shadows:** If a floating element (like a filter popover) is required, use a shadow with a blur of `40px`, a `12px` Y-offset, and an opacity of `6%` using the `on_surface` color. It should feel like a soft glow, not a dark smudge.
*   **The "Ghost Border" Fallback:** If accessibility requirements demand a border, use the `outline_variant` token at **15% opacity**. It should be felt, not seen.
*   **Glassmorphism:** Use backdrop blurs for "Quick View" side panels. This allows the colors of the underlying job cards to bleed through, maintaining the user's context.

---

## 5. Components: Refined Utility

### Buttons & Chips
*   **Primary Button:** Gradient of `primary` to `primary_container`. Radius: `md` (0.375rem). The system's roundedness is subtle (1), implying `md` might be interpreted as a slight rounding rather than a large one.
*   **Status Chips:**
    *   *Applied:* `secondary_container` text on `on_secondary_container` background.
    *   *Interviewing:* `tertiary_container` (#45009b) text on `on_tertiary_container` background.
    *   *Rejected:* `error_container` text on `on_error_container` background.
*   **Rule:** No borders on chips. Use the container colors to define the shape.

### Input Fields
*   **Style:** Minimalist. Use `surface-container-highest` for the background.
*   **Focus State:** Instead of a heavy border, use a `2px` bottom-only bar in `primary` and a subtle increase in background brightness.

### Cards & Lists (Job Tracking)
*   **The Forbiddance:** No horizontal dividers between list items.
*   **The Solution:** Use `16px` of vertical white space and a subtle background hover state using `surface-container-high`.
*   **Contextual Component:** **"The Progress Micro-Bar."** A slim (4px height) bar at the top of a card using `secondary` (red - `#ff0032`) to show application completion percentage.

---

## 6. Do's and Don'ts

### Do:
*   **Do** use `letter-spacing: -0.02em` on Manrope headlines to give them a premium, "tight" look.
*   **Do** use `surface-container-lowest` for cards to signify they are the most interactive "top-level" elements.
*   **Do** lean into white space. If you think there is enough space, add 8px more.

### Don't:
*   **Don't** use pure black (#000000) for text. Always use `on_surface` (#191c1e - *Note: This hex should reflect a dark mode on_surface based on the system's token generation logic*) to maintain the soft, deep-blue tonal atmosphere.
*   **Don't** use standard `0.25rem` corners for everything. Use `xl` (0.75rem) for large containers and `md` (0.375rem) for internal components to create a nesting hierarchy. The system's `roundedness` (1) indicates subtle rounding, so these relative values should be interpreted within that subtle context.
*   **Don't** use icons without labels for primary navigation. Data-focused users value speed and clarity over "clean" mystery meat navigation.