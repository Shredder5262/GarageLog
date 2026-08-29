# GarageLog source maintenance

This source package contains the maintenance hardening pass for the current .NET 8 GarageLog application.

## Database safeguards

On startup GarageLog now:

- creates a timestamped SQLite backup before schema-changing maintenance when needed;
- explicitly enables foreign keys, WAL journaling, a busy timeout, and `synchronous=NORMAL`;
- runs `PRAGMA quick_check` and logs the result;
- tracks one-time changes in `SchemaMigrations`;
- adds an `AppState.Revision` value used for optimistic concurrency protection.

Pre-migration backups are stored under `data/backups/` inside the GarageLog data root.

## One-time migrations

- `20260829_01_appstate_revision` — adds revision-aware state storage.
- `20260829_02_legacy_document_share_cleanup` — makes `DocumentShareLinks` authoritative and removes retired per-document share metadata so deleted links cannot be recreated on restart.
- `20260829_03_telemetry_trip_fingerprint_and_odometer_dedupe` — fingerprints telemetry trips, backfills existing trips, and supersedes duplicate pending odometer proposals.

## Regression checks

A small dependency-light regression runner is included in `src/GarageLog.Web.Tests`.

```powershell
dotnet run --project .\src\GarageLog.Web.Tests\GarageLog.Web.Tests.csproj
```

It checks stale state-write rejection, legacy share-link cleanup, telemetry fingerprint stability, and historical telemetry/proposal deduplication.

Build the web project with:

```powershell
dotnet build .\src\GarageLog.Web\GarageLog.Web.csproj -c Release
```

`bin/`, `obj/`, runtime databases, uploaded documents, and other machine-local data are intentionally excluded from source control/source archives.

## Framework lifecycle

The application remains on `net8.0` for this maintenance release to avoid combining persistence/concurrency fixes with a major framework migration. The package references are serviced to the current .NET 8 line. Plan the .NET 10 LTS migration as a separate tested release before .NET 8 support ends.
