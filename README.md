# Flowkify Scheduler

A compact, date-only employee scheduler for React and Power Apps Component Framework.

The v1 workspace contains:

- `@flowkify/scheduler`: the generic React 17 scheduler.
- `apps/demo`: a standalone interactive demo and 1,000-person fixture.
- [`examples/pcf`](examples/pcf/README.md): a Flowkify Dataverse adapter and PCF host example.

## Development

```sh
npm install
npm run dev
npm test
npm run build
```

Dates use inclusive `YYYY-MM-DD` values. The component is controlled: hosts persist mutation requests, update `entries`, then resolve the callback.

The PCF example starts on the current week by default and exposes a maker-facing
Day/Week/Month startup setting. Its Dataverse adapter derives availability from
weekly work hours, time off, public holidays, and employment dates.

Licensed under Apache-2.0.

