# Flowkify Scheduler PCF

Dataverse host example for `@flowkify/scheduler`. The target environment must
already contain the Flowkify tables and an unmanaged solution.

## Configuration

- **Default view** controls whether a new scheduler session opens on the current
  day, week, or month. An unset or invalid value opens the current week.
- **Height** optionally fixes the scheduler height; otherwise the allocated PCF
  height is used with a 680px fallback.

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

## Deploy

One-time setup from the repository root:

```powershell
npm install
pac auth create --name FlowkifyDev --environment "<environment-url>"
```

Build, bump the component patch version, and deploy:

```powershell
npm run build:library
Set-Location examples/pcf
pac pcf version --strategy manifest
npm run build
pac pcf push --environment "<environment-url>" --solution-unique-name "<solution-unique-name>"
```

The version bump ensures Power Platform detects each component update.
