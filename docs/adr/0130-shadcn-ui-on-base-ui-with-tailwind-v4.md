# 0130. shadcn/ui on Base UI with Tailwind CSS v4

- Date: 2026-11-01
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-007 (component primitives and styling), DS-000 (design system tooling check), PROTO-011 (every kit component in rough form)

## Context

The UI needs accessible behaviour for its controls and one way to style them from the kit's tokens in dark and light. The backlog default was React Aria Components with CSS Modules over CSS variables. The owner asked to choose this personally (it was decision 15 in [decisions.md](../decisions.md)) and wants the option that causes the fewest problems, keeps full control over every component and needs the fewest components written by hand. The prototype port of [ADR 0129](0129-the-prototype-moves-into-react-as-the-design-source.md) puts speed first, so ready components matter more than they did.

In 2026 shadcn/ui made Base UI its default base for new projects (changelog "Base UI as the Default", July 2026), kept Radix fully supported and added React Aria Components as a third base on 2026-07-17. Base UI comes from the team behind Radix, Floating UI and Material UI. shadcn/ui copies each component's source into the repository instead of installing a closed package, and styles it with Tailwind CSS v4.

## Options considered

1. React Aria Components with CSS Modules over CSS variables, the backlog default. The broadest set of accessible controls, including date and colour pickers, and plain CSS files. Every component has to be written and styled by hand, which is slow for a port of the whole kit.
2. shadcn/ui on Base UI with Tailwind CSS v4. Ready components for most of the kit, owned as source code in the repository, the default path that most shadcn docs, blocks and examples target first, and tokens mapped once into `@theme`. Utility classes sit in the markup, and Base UI covers fewer exotic controls than React Aria.
3. shadcn/ui on React Aria Components with Tailwind CSS v4. The same owned components on React Aria's deeper keyboard and screen reader behaviour. It has been a shadcn base only since July 2026, so it has fewer examples and community blocks.
4. shadcn/ui on Radix Primitives with Tailwind CSS v4. The longest record, but no longer shadcn's default, and its development has slowed under WorkOS.

## Decision

Option 2, chosen by the owner on 2026-11-01 for the fewest problems, full customisation through owned code and the fewest components written by hand.

- shadcn/ui is set up in `packages/ui` with Base UI as its base. Generated components live there as source, carry no comments, and follow the repository's lint and format rules.
- Tailwind CSS v4 builds the styles. `packages/tokens` holds the kit's tokens as CSS variables for dark and light, and a theme file maps them into `@theme`, so the utilities and every shadcn component read the kit's values. Changing a token changes every component.
- Storybook in `packages/ui` is the component catalogue.
- A control that Base UI covers badly may use the React Aria version of the same shadcn component, recorded in the DS task that needs it.

The kit's controls map to these components and primitives.

| Kit control | shadcn/ui component | Base UI primitive |
|---|---|---|
| Button and icon button | `button` | Button |
| Segmented control | `toggle-group` | Toggle Group |
| Toggle | `switch` | Switch |
| Popover | `popover` | Popover |
| Dialog | `dialog` | Dialog |
| Menu | `dropdown-menu` | Menu |
| Tabs | `tabs` | Tabs |
| Slider | `slider` | Slider |
| Listbox and select | `select`, `combobox` | Select, Combobox |
| Tooltip | `tooltip` | Tooltip |

TODO: STACK-007's Done-when asks for axe-clean output. DS-000 (design system tooling check) runs axe over the stories of these components and records the result here before STACK-007 is ticked.

## Consequences

- STACK-007 (component primitives and styling) records the owner's decision, and the "Decisions already made" table of the backlog has a UI components row.
- DS-000 (design system tooling check) sets up Tailwind CSS v4, shadcn/ui on Base UI and Storybook, and runs the axe check.
- The DS epic (design system) and PROTO-011 (every kit component in rough form) start from shadcn components where one fits, and write by hand only the pathology-specific pieces such as the tool rail, the inspector primitives, gallery tiles, the progress ring and object ID tags.
- Styles live in utility classes in the markup instead of separate CSS files.
