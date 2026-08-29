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
- `20260829_04_server_notifications` — adds persisted server notification settings and event storage.
- `20260829_05_nhtsa_recall_cache` — adds the local NHTSA recall cache and per-vehicle synchronization status.

## Regression checks

A small dependency-light regression runner is included in `src/GarageLog.Web.Tests`.

```powershell
dotnet run --project .\src\GarageLog.Web.Tests\GarageLog.Web.Tests.csproj
```

It checks stale state-write rejection, legacy share-link cleanup, telemetry fingerprint stability, historical telemetry/proposal deduplication, server-notification persistence/settings, and linked reminder/maintenance notification deduplication.

Build the web project with:

```powershell
dotnet build .\src\GarageLog.Web\GarageLog.Web.csproj -c Release
```

`bin/`, `obj/`, runtime databases, uploaded documents, and other machine-local data are intentionally excluded from source control/source archives.

## Framework lifecycle

The application remains on `net8.0` for this maintenance release to avoid combining persistence/concurrency fixes with a major framework migration. The package references are serviced to the current .NET 8 line. Plan the .NET 10 LTS migration as a separate tested release before .NET 8 support ends.

## Server Notifications and Recall Monitoring

GarageLog now persists server-generated notification events in SQLite instead of relying only on browser-derived reminder alerts. The server evaluates date and mileage reminders on a background loop and exposes notification events through `/api/notifications`. Scoped API tokens may use `notifications:read` with `/api/mobile/notifications`, providing the read side of a future GarageLog Mobile notification pipeline without coupling the server to a push provider yet.

Notification generation is controlled under Settings → Notifications & Vehicle Recalls. The master switch, reminder/maintenance alerts, recall monitoring, lead-day/mileage thresholds, and recall check interval are persisted server-side. Recall monitoring is opt-in by default because enabling it makes an outbound request to NHTSA containing the vehicle model year, make, and model.

Recall monitoring uses the official NHTSA `recallsByVehicle` API with model year, make, and model. GarageLog caches campaigns locally, records per-vehicle sync status, and creates a server notification when campaigns are first discovered or when a new campaign appears on a later check. Model-level recall matches are intentionally described as potential campaigns; GarageLog links to NHTSA's VIN lookup when a 17-character VIN is available so the user can verify whether a specific vehicle still has an unrepaired recall.

## Recall monitoring schedule + dashboard alert

- Recall monitoring is independent from the general reminder-notification master switch.
- NHTSA checks can be Manual only, At server startup, Once a month, Every 3 months, or Every 6 months.
- Recurring schedules use calendar-month intervals from the last successful NHTSA check.
- Active recall notifications for the current vehicle surface as a Recall badge in the Dashboard vehicle header.
- Selecting the badge shows cached campaign details and a VIN-verification link to NHTSA.
- Clearing the badge dismisses the currently surfaced recall notice; a newly discovered campaign receives a new notification id and can surface again.
