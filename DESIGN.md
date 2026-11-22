---
name: Whats4Linux
description: A calm, native-feeling WhatsApp desktop client built on a green signal over deep neutral surfaces.
colors:
  signal-green: "#21c063"
  signal-green-deep: "#1b9a58"
  signal-green-hover: "#1ea952"
  signal-glow: "rgba(33, 192, 99, 0.35)"
  signal-muted: "rgba(33, 192, 99, 0.12)"
  ink: "#000000"
  charcoal: "#121212"
  slate: "#1a1a1a"
  lift: "#242424"
  hairline-dark: "rgba(255, 255, 255, 0.08)"
  ink-text: "#f0f2f5"
  ink-muted: "#8696a0"
  paper: "#ffffff"
  paper-secondary: "#f0f2f5"
  paper-tertiary: "#e9edef"
  paper-primary: "#00a884"
  paper-text: "#111b21"
  paper-muted: "#667781"
  sent-bubble: "#d9fdd3"
  sent-bubble-dark: "#0b3d2b"
  received-bubble: "#ffffff"
  received-bubble-dark: "#121212"
  chat-wallpaper: "#efeae2"
  action-ink: "#0a1014"
  danger: "#ef4444"
  link-blue: "#53bdeb"
typography:
  body:
    fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "13px"
    fontWeight: 500
  title:
    fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "18px"
    fontWeight: 600
  headline:
    fontFamily: '"Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif'
    fontSize: "24px"
    fontWeight: 600
rounded:
  sm: "4px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  2xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.signal-green}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.xl}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.signal-green-hover}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.xl}"
    padding: "8px 16px"
  button-neutral:
    backgroundColor: "rgba(0, 0, 0, 0.05)"
    textColor: "{colors.paper-text}"
    rounded: "{rounded.xl}"
    padding: "8px 16px"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.paper}"
    rounded: "{rounded.xl}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-text}"
    rounded: "{rounded.2xl}"
    padding: "16px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.paper-text}"
    rounded: "{rounded.xl}"
    padding: "8px 12px"
  chat-bubble-sent:
    backgroundColor: "{colors.sent-bubble}"
    textColor: "{colors.paper-text}"
    rounded: "{rounded.2xl}"
    padding: "6px 12px 8px"
  chat-bubble-received:
    backgroundColor: "{colors.received-bubble}"
    textColor: "{colors.paper-text}"
    rounded: "{rounded.2xl}"
    padding: "6px 12px 8px"
  toggle:
    backgroundColor: "{colors.signal-green}"
    rounded: "{rounded.full}"
    size: "48px"
    height: "28px"
  chat-row:
    backgroundColor: "transparent"
    textColor: "{colors.paper-text}"
    rounded: "{rounded.xl}"
    padding: "12px"
  toast-success:
    backgroundColor: "#0d2118"
    textColor: "#d9fdd3"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
---

# Design System: Whats4Linux

## Overview

**Creative North Star: "The Quiet Signal"**

Green is information, not decoration. The interface is built from deep neutral surfaces and dense, readable rows, with Signal Green reserved for the moments that mean something: someone is online, a message is unread, a chat is selected, an action is available. When the green appears, it has a job. When it does not, the system falls back to carbon-grey tonal steps and hairline separators rather than reaching for ornament.

The mood is calm, utilitarian, and quietly confident. This is a long-running desktop tool, so density and legibility outrank flourish: a 15px body, tight 8–16px rhythm, generous use of 12–16px radii to soften an otherwise rectangular workspace, and motion that resolves almost before you notice it. The Nickname "quietly tactile" is intentional — buttons answer the pointer, toggles travel with a spring, bubbles arrive with a small pop, but nothing asks for attention. Skeuomorphism, playful confetti, and marketing-page flourish are explicit visual rejections; the product's performance and privacy story is carried by restraint, not by spectacle.

Light and dark are peers, not an afterthought. Every surface, text, and bubble token has a dark counterpart, and the two canvases share the same geometry and motion. A legacy runtime customiser (`theme.config.ts` + `applyThemeColors`) can override individual colour keys at runtime; the values in the frontmatter are the declared `@theme` baseline. Because the two layers disagree on a few dark bubble and dropdown values, any colour change must be checked in both places.

**Key Characteristics:**
- Signal-led: one accent, used only for live, selected, or actionable states.
- Dense but breathable: 15px body, 8–16px rhythm, 12–16px radii.
- Dual-canvas: every token has a light and dark expression.
- Flat at rest: tonal steps and hairline borders do the structural work.
- Restrained motion: state changes finish within a few hundred milliseconds.

## Colors

The palette is a single vivid green living on two neutral canvases — near-black for dark mode, soft paper grey for light mode — with chat bubbles and status tones as the only meaningful departures.

### Primary

- **Signal Green** (#21c063): The accent of record. Presence dots, unread-badge glow, the selected-chat left edge, the active sidebar-tab underline, links, mentions, blockquote rules, and primary button fills.
- **Signal Green Deep** (#1b9a58): The darker voice of the accent for success text, deep ambient orbs, and hover-adjacent emphasis.
- **Signal Green Hover** (#1ea952): The primary button's pressed-on state, used only on hover.

### Secondary

- **Paper Teal** (#00a884): The declared light-theme primary token. Retained in the system for compatibility; current controls deliberately use Signal Green instead.

### Tertiary

- **Link Blue** (#53bdeb): In-message web links only. Distinct from the accent so a link never reads as an action button.

### Neutral

- **Ink** (#000000): Dark-mode canvas and dark chat wallpaper base.
- **Charcoal** (#121212): Dark secondary surfaces and the dark received bubble.
- **Slate** (#1a1a1a): Dark tertiary surfaces and navigation fills.
- **Lift** (#242424): The elevated dark surface — dropdowns and menus.
- **Hairline** (rgba(255, 255, 255, 0.08)): The default dark border and divider; opacity, never a solid grey line.
- **Ink Text** (#f0f2f5) / **Ink Muted** (#8696a0): Dark-mode primary and secondary text.
- **Paper** (#ffffff) / **Paper Secondary** (#f0f2f5) / **Paper Tertiary** (#e9edef): Light canvas, chrome, and input/search fills.
- **Paper Text** (#111b21) / **Paper Muted** (#667781): Light-mode primary and secondary text.
- **Chat Wallpaper** (#efeae2): The faint tiled chat backdrop, carrying a low-opacity repeat texture in both themes.
- **Action Ink** (#0a1014): The near-black label on green primary buttons and unread badges.
- **Danger** (#ef4444): Destructive actions and error toasts; always paired with a tinted background rather than a solid field.

### Named Rules

**The Signal Rule.** Signal Green appears only where something is live, selected, or actionable. Decoration never gets the green.

**The Two-Canvas Rule.** No new colour enters the system without its dark-mode counterpart. A token with one expression is an incomplete token.

## Typography

**Display Font:** none — the system has no separate display face.
**Body Font:** Inter (system-ui, -apple-system, BlinkMacSystemFont, sans-serif), bundled locally as a variable font for offline use.
**Label/Mono Font:** JetBrains Mono, Fira Code, Courier New for inline code only.

**Character:** Inter is used at almost every size with the `cv02`, `cv03`, `cv04`, `cv11` feature settings enabled and antialiasing on. The result is neutral and highly legible at small sizes; hierarchy comes from weight and size, never from a second family.

### Hierarchy

- **Headline** (600, 24px): Login and onboarding headings only.
- **Title** (600, 18px, tight tracking): Settings page headers and dialog titles.
- **Body** (400, 15px, 1.5 line-height): The default for messages, rows, and content.
- **Label** (500, 13px): Metadata, buttons, toasts, and secondary copy.
- **Field label** (600, 12px, uppercase, wide tracking): Form labels and small uppercase badges such as GIF.

### Named Rules

**The Single-Voice Rule.** One family, one weight ladder. A second font appears only inside code spans; never for headings, never for emphasis.

## Layout

The workspace is a resizable two-pane shell: a 30% conversation list (minimum 320px) beside a 70% conversation pane (minimum 400px). At narrow widths the `md` breakpoint collapses to one pane at a time — selecting a chat swaps the visible pane — and the chat-info panel becomes a 400px column at `md` and above. Settings uses a centred 3xl column with 24px padding, increasing to 40px at `lg`; login centres a 900px card.

Vertical rhythm comes from 3–4px gaps between related rows, 8px between controls, 12px inside rows, and 16px around cards and sections. Chat rows use 12px horizontal and 12px vertical padding; settings rows use 16px horizontal and 14px vertical. Message bubbles cap at 85% of the conversation width, tightening to 65% at `lg`, so a transcript never becomes an unreadable full-width block. The scrollbar is a 6px overlay with a 4px thumb.

## Elevation & Depth

Flat by default. Hierarchy is built from tonal surface steps and 1px alpha borders; shadows are reserved for things that temporarily leave the page — menus, toasts, dialogs, the login card — and for the small lift on a toggle knob or message bubble. The login surface adds a restrained glass treatment (12px blur, 180% saturation) behind ambient green orbs; that is a showcase moment, not the system default.

### Shadow Vocabulary

- **Resting card** (`box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04)`): The almost-invisible lift under settings cards.
- **Bubble** (`box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08)`): Keeps a message bubble just above the wallpaper.
- **Toast** (`box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35)`): The heaviest shadow in the system, for transient feedback only.
- **Menu / dialog** (`box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15)`): Floating menus, dropdowns, and the login card.

### Named Rules

**The Quiet Layer Rule.** Surfaces are flat at rest. If a shadow is doing structural work on a permanent surface, use a tonal step or a hairline border instead.

## Shapes

Soft but not pillowy. Pills and circles own the 9999px radius: avatars, presence dots, the search field, the toggle knob, icon buttons, and the send control. Cards and message bubbles use 16px; buttons, inputs, toasts, and icon tiles use 12px; message sub-cards use 10px; poll options and inline code use 8px. A selected chat row carries a 3px Signal Green left edge with padding adjusted to compensate; the active sidebar tab uses a 2px, 20px-wide green underline. Borders are alpha hairlines, never solid mid-greys, and clipping is used deliberately for avatar stacks and media thumbnails.

## Components

### Buttons

- **Shape:** 12px radius, 8px vertical and 16px horizontal padding, 14px semibold label.
- **Primary:** Signal Green fill with Action Ink text; hover moves to Signal Green Hover; disabled drops to 40% opacity and a not-allowed cursor.
- **Neutral / Ghost / Danger:** neutral uses a 5% fill that lifts on hover; ghost is text-only until hover; danger uses Danger with white text. All share the same geometry.
- **Focus:** the system's form fields use a 2px ring at 20% accent opacity; action buttons rely on the platform focus ring.

### Chips

- **Style:** small uppercase badges use a 10px semibold label over a 12% Signal Green tint; status banners use 10% tone-on-tone fills with matching text.
- **State:** selected options in menus are marked with Signal Green text and a check icon, never a filled green row.

### Cards / Containers

- **Corner Style:** 16px, with an overflow-hidden clip for divided row lists.
- **Background:** Paper in light mode, Charcoal in dark mode; subtly tinted fills for message sub-cards.
- **Shadow Strategy:** resting-card shadow only; see Elevation & Depth.
- **Border:** 6% black in light mode, 8% white in dark mode.
- **Internal Padding:** 16px around grouped settings; 10px inside message sub-cards.

### Inputs / Fields

- **Style:** 12px radius, hairline border, 8px vertical and 12px horizontal padding, 14px text. The chat composer is a full-width pill using the tertiary surface fill.
- **Focus:** border shifts to Signal Green with a 2px 20%-opacity ring; outline is suppressed in favour of that ring.
- **Error / Disabled:** error states use Danger text on a 10% fill; disabled controls drop opacity rather than changing hue.

### Navigation

- **Style:** 12px-radius chat rows with a 3px green left edge when selected; a 2px, 20px green underline marks the active sidebar tab.
- **States:** hover lifts rows by 3–4% surface tint; icon buttons are circular with a matching hover fill.

### Toggle (signature component)

A 48×28px pill with a 20px knob that travels 20px on GSAP with an elastic ease over 600ms — the longest motion in the system. The track crossfades between Signal Green and the closed grey over 300ms. It is the one place where a spring is deliberate.

### Chat Bubble (signature component)

A 16px-radius bubble capped at 85% width (65% at `lg`), with 12px horizontal padding and a slightly tighter top than bottom. Sent and received bubbles are distinguished by tonal fills, not borders, and the bubble pops in over 180ms with a gentle overshoot.

### Toast (signature component)

A 12px-radius, 220ms slide-up panel with a 3px coloured left border encoding tone — muted, green, red, or amber — and a heavy shadow that marks it as transient.

### Named Rules

**The Restrained Motion Rule.** State changes resolve within 300ms — menus 160ms, slides and toasts 220ms, bubbles 180ms. The toggle's 600ms elastic slide is the deliberate exception, not a precedent.

## Do's and Don'ts

### Do:

- **Do** keep Signal Green to live, selected, or actionable states, per The Signal Rule.
- **Do** pair every new token with a light and dark expression, per The Two-Canvas Rule.
- **Do** keep body copy at 15px/1.5 and let 13px and 11px carry only metadata.
- **Do** use alpha hairlines (8% white in dark mode) for permanent separators.
- **Do** keep conversation bubbles within 85% width, tightening to 65% at `lg`.
- **Do** extend the `@theme` block in `style.css` when adding a token, then check `theme.config.ts` for a runtime override of the same key.

### Don't:

- **Don't** use the accent as section decoration, background wash, or large fill.
- **Don't** add resting shadows to cards, rows, or panels; see The Quiet Layer Rule.
- **Don't** introduce a second typeface outside inline code; see The Single-Voice Rule.
- **Don't** let a new colour ship with only one theme's value.
- **Don't** exceed the established motion budget; the toggle's spring is the sole exception.
- **Don't** set one-off colours in components when a token belongs in `@theme`.
