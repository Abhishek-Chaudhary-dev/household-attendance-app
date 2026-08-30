# V3 Final Design

Mobile-first consumer-app UI for household attendance and payments, based on the agreed Zomato + Urban Company + Uber benchmark.

## Navigation
- Primary: Home, Workers, Reports, Payments
- Secondary: This month, History, Household under More
- One navigation controller owns panel visibility: `navigation.js`
- Larger touch targets and clear active states

## Data and calculation rules
- Existing workers with no saved `shiftType` are treated as **double shift** to preserve historical attendance meaning.
- New workers default to **single shift (morning only)**.
- Editing an existing worker preserves their saved shift type unless explicitly changed.
- Single-shift workers count morning attendance only; double-shift workers count morning + evening.
- Reports, monthly summaries, history and settlements all use the same shift-aware calculation rules.
- Attendance, authentication, Firebase household access, Firestore rules and multi-user access remain intact.

## Implementation
- Shift calculation logic is consolidated into `app.js`, `settlement.js`, and `history.js`.
- The obsolete DOM-patching `shift-rules.js` module has been removed.
- `.hidden { display:none!important }` is part of the final stylesheet.
- `index.html` cache-busts the final CSS/JS assets so a fresh Hosting deployment does not retain stale browser assets.

This branch is the final candidate for review. Production deployment occurs only after the PR is reviewed and merged into `main`.
