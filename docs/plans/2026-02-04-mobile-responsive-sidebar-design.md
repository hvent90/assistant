# Mobile-Responsive Sidebar

## Problem

The web dashboard sidebar is fixed at 280px and takes up most of the screen on mobile devices, leaving little room for conversation content.

## Design

Below the `md` breakpoint (768px), the app switches from a side-by-side layout to a single-view navigation pattern. Desktop layout is unchanged.

### Mobile behavior (< 768px)

- **No session selected:** Sidebar fills the full screen width, showing the session list.
- **Session selected:** Sidebar is hidden, conversation thread fills the full screen. A back button appears at the top-left to return to the session list.
- Transitions between views are instant (no animation).

### Desktop behavior (>= 768px)

Unchanged: fixed 280px sidebar + flex-1 thread side by side.

## Implementation

1. **`main.tsx`**: Conditionally show sidebar or thread on mobile based on session selection state. Use Tailwind `md:` prefix to preserve desktop layout:
   - Sidebar: `hidden md:flex` when session selected; `flex md:flex` when none selected
   - Thread: `flex md:flex` when session selected; `hidden md:flex` when none selected

2. **`Sidebar.tsx`**: Full-width on mobile (`w-full md:w-[280px]`).

3. **`ConversationThread.tsx`**: Add a back button visible only on mobile (`md:hidden`) that deselects the current session.

## Files touched

- `clients/heartbeat-viewer/src/main.tsx`
- `clients/heartbeat-viewer/src/components/Sidebar.tsx`
- `clients/heartbeat-viewer/src/components/ConversationThread.tsx`
