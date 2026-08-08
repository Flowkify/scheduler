# Flowkify Scheduler PCF

Dataverse host example for `@flowkify/scheduler`. The target environment must
already contain the Flowkify tables and an unmanaged solution.

## Configuration

- **Project Number** is the optional scheduler scope. Add the control to the
  `flowkify_projectno` column on a Project form; it resolves the project and
  selects its active Project Person records in the scheduler filters. Custom
  Pages can leave it unset to retain the unfiltered scheduler.
- **Default view** controls whether a new scheduler session opens on the current
  day, week, or month. An unset or invalid value opens the current week.
- **Height** optionally fixes the scheduler height; otherwise the control fills
  its allocated height. Configure the field or section height in the
  model-driven form designer.

With a project scope active, users can still select any active person. Selected
people remain visible even without an allocation for that project, and creating
an allocation preselects the scoped project.

The adapter reads a person's weekly work hours and distributes them evenly over
Monday through Friday. Time off reduces those daily hours, public holidays have
zero availability, and employment start/end dates bound the calculation. No
separate daily-capacity table is required. Active people with zero weekly work
hours are omitted from the planning board.

Week view hides Saturday and Sunday by default. Users can reveal them from the
session-only **View** menu; loading and period-capacity calculations still use
the complete seven-day week.

The compact create and edit dialogs use searchable project, company, and person
pickers. Notes are optional; when empty, the adapter supplies an allocation name
for Dataverse's primary-name column (`flowkify_name`). A click edits an
allocation, while right-click exposes edit and delete actions. Repeating
allocations require a recurrence end date so the Dataverse recurrence plug-in
always has a finite boundary. Occurrences offer an explicit occurrence/series
choice for move, resize, and delete actions. Series updates go through the root
allocation, and **Edit recurring series** loads that root into the same compact
PCF editor for recurrence-pattern or end-date changes.

When an allocation has a selected project, its editor exposes a project colour
picker backed by `flowkify_project.flowkify_color`. The adjacent pop-out button
opens the full project form in a new Dataverse window for all other project
changes. Colours are stored as `#RRGGBB`; projects without a stored value use
the scheduler accent colour.

## Deploy

One-time setup from the repository root:

```powershell
npm install
pac auth create --name FlowkifyDev --environment "<environment-url>"
```

Build the scheduler library, then bump and deploy the PCF from its project
directory:

```powershell
npm run build:library
Set-Location examples/pcf
pac pcf version --strategy manifest
pac pcf push --publisher-prefix flowkify
```

`pac pcf push` targets the organization selected by the active PAC
authentication profile. The version bump ensures Power Platform detects each
component update.
