# Flowkify Scheduler PCF

Dataverse host example for `@flowkify/scheduler`. The target environment must
already contain the Flowkify tables and an unmanaged solution.

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
