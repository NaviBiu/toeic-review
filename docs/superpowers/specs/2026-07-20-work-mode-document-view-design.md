# Work Mode Document View Design

## Goal

When work mode is active, the application should read at a glance as an English internal requirements document rather than a TOEIC study interface. Normal study mode remains unchanged.

## Header and navigation

- Replace the horizontally scrolling navigation with a fixed-width document header.
- Show an English document title, document identifier, and a compact menu button.
- Keep the English navigation hidden by default in work mode.
- Open and close the navigation from the menu button. The menu is a vertical document index, so it never causes horizontal page overflow.
- Keep the existing mode toggle available as a small, neutral document control.
- Add an `Open another document` control that rotates through one of five bundled document skins without network or API calls. Consecutive clicks must not keep the same skin.

## English work-mode vocabulary

Each route keeps its functionality but uses work-document terminology while work mode is active. The review route uses:

- `Daily Review` for the page title.
- `N items pending` for the remaining count.
- `All workstreams` for the scenario filter.
- `Confirmed` and `Needs follow-up` for the two answer actions.
- `Continue` for advancing, and `Revert decision` for changing an answer.
- English error, loading, empty-state, deletion, and restore messages.

The same approach will be available to other routes through a small display-copy helper, rather than modifying stored study data.

## Visual treatment

- Use a white and pale-slate document canvas with fine ruled/grid lines.
- Use restrained monospace metadata and neutral slate controls.
- Avoid colourful study-app styling when work mode is active.
- Do not suppress the actual English term and example, since they plausibly resemble document content.
- Do not render Chinese user-interface text anywhere in the work-mode review route.
- Keep the palette neutral: white, grey, slate, and restrained navy only. Skin variety must come primarily from different layouts, document metadata, headings, paper treatments, and density rather than bright colours.
- Provide five fixed skins: requirements specification, project work board, meeting notes, release summary, and control checklist.
- In work mode, non-review routes show a static route-specific English document overlay so their original Chinese UI cannot appear after a navigation click.
- The review route remains interactive. `Confirmed` records the normal correct answer; `Needs follow-up` records the normal incorrect answer. Its labels, remaining count, filter, loading, errors, empty state, undo controls, and action feedback are English.

## State and accessibility

- Persist work mode in local storage under the existing `toeic-work-mode` key.
- Persist no menu-open state; opening the menu is transient.
- Use a native button with `aria-expanded` and an accessible English label for the menu control.
- Ensure the header cannot exceed the viewport width at desktop or mobile widths.

## Verification

- Add unit tests for the work-mode display copy and menu state helpers.
- Run focused unit tests and a production build.
- Verify the review page visually in both modes at desktop and mobile widths, including the hidden and expanded work-mode menu.
