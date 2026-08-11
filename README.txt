GarageLog Settings + API Tokens patch
=========================================

This patch is designed for the current GarageLog web source layout:

  src/GarageLog.Web/Program.cs
  src/GarageLog.Web/wwwroot/app.js
  src/GarageLog.Web/wwwroot/index.html

What it changes
---------------

1. Adds Settings to the user dropdown directly under My Profile.

2. Removes Share Links management from My Profile.

3. Removes the Active Share Links shortcut from the document share dialog.

4. Adds a full Settings page containing:
   - API & Devices
   - API token list
   - create/revoke/delete token controls
   - Share Links summary
   - Manage Share Links entry point

5. Adds server-side scoped API tokens:
   - Token values are generated cryptographically.
   - Only a SHA-256 hash is stored in SQLite.
   - Full token is displayed exactly once after creation.
   - Supported scopes:
       vehicles:read
       telemetry:write
       device:sync
   - Expiration:
       Never
       30 days
       90 days
       1 year
       Custom
   - Revoke and permanent delete.
   - Last-used tracking.

6. Adds:
     GET /api/mobile/health

   This endpoint accepts:
     Authorization: Bearer <GarageLog API token>

   and requires:
     device:sync

Applying
--------

From the GarageLog repository root:

  powershell -ExecutionPolicy Bypass -File .\Apply-GarageLog-SettingsApiPatch.ps1

Then:

  dotnet build .\GarageLog.sln

The patch creates a timestamped backup folder before editing Program.cs, app.js, and
index.html.

Mobile bridge
-------------

After creating a "GarageLog Mobile" token in GarageLog Settings, put that token into
the mobile app.

The mobile bridge health test should then use:

  /api/mobile/health

instead of the browser-admin endpoint:

  /api/health

Do not expose GarageLog directly to the public Internet. API tokens are credentials;
treat them like passwords and use HTTPS or a trusted private network/VPN for remote
access.

v2 updates
----------

This package now also includes the Settings UI polish and token-copy fixes:

- Compact, rectangular Settings action buttons.
- Better API-token row alignment.
- Cleaner API-token dialogs.
- Custom expiration stays hidden unless Custom is selected.
- Token-creation dialog closes before the one-time token reveal opens.
- Token mask uses HTML entities to prevent mojibake.
- Patch script reads/writes web assets explicitly as UTF-8.
- Copy Token works over local HTTP using a legacy clipboard fallback.
- If browser copying is still blocked, the token is automatically selected so Ctrl+C works.


v3 updates
----------

- Fixed Copy Token fallback while the token-created modal is open.
- The legacy copy control is now placed inside the active modal, avoiding the
  browser's modal-dialog inert-content restriction.
- The generated token is displayed in a readonly selectable text field.
- Clicking the token field selects the complete token.
- If automatic copy is blocked, Copy Token selects the complete token so
  Ctrl+C works immediately.
- Clipboard API is attempted first, followed by the in-dialog fallback.


v4 fuel-camera companion update
-------------------------------
- Adds POST /api/mobile/fuel-captures (requires telemetry:write bearer token).
- Stores JPEG/PNG pump images under the GarageLog data directory / fuel-captures.
- Runs Tesseract OCR on the uploaded pump image.
- Attempts to extract a gallons value, preferring a labeled GALLONS/GAL value.
- Returns OCR confidence high/low and lets the mobile app show/edit the value.
- Adds POST /api/mobile/fuel-captures/{id}/confirm for corrected/confirmed gallons.
- Adds the FuelCaptures SQLite table.
- Uses GARAGELOG_TESSERACT_PATH when set, then common Windows/Linux Tesseract paths, then PATH.

This stores the image and OCR result in GarageLog. It does not yet create a full
vehicle fuel-log/expense entry because vehicle/device association is the next
server-side step.


v5 encoding repair update
-------------------------
This package now repairs mojibake across the GarageLog desktop/web source,
rather than only repairing the Settings token mask.

Repair-GarageLog-Mojibake.ps1:
- Scans GarageLog.Web text/source files recursively.
- Repairs common one-, two-, and three-times UTF-8/Windows-1252 corruption.
- Covers punctuation, arrows, checkmarks, degree symbols and common GarageLog
  emoji/icon characters.
- Writes files as UTF-8 without BOM.
- Creates a timestamped backup before changing any file.
- Reports files that still contain suspicious encoding markers.
- Does not blindly re-encode whole files, which avoids damaging valid Unicode.
- If a previous conversion already produced the Unicode replacement character,
  the original byte may be unrecoverable; such files are reported for review.

The normal Apply-GarageLog-SettingsApiPatch.ps1 now runs this repair step
automatically after applying the Settings/API/fuel-OCR changes.

The repair can also be run by itself from the GarageLog repository root:

  .\Repair-GarageLog-Mojibake.ps1


v6 nullable warning fix
-----------------------
- Fixes CS8602 in ApiTokenFeature.cs fuel-image handling.
- Uses string.Equals(image.ContentType, ...) so a missing Content-Type cannot
  cause a possible null dereference.
- GarageLog should build with zero warnings from this API-token/fuel-OCR patch.


v7 telemetry-trip synchronization
---------------------------------
- Adds POST /api/telemetry/trips.
- Requires telemetry:write bearer-token permission.
- Adds TelemetryTrips storage.
- Stores trip ID, start/end time, trip distance, optional odometer values,
  source, token/device identity, and GarageLog receive time.
- Uploads are idempotent per API token + client trip ID.
- Duplicate uploads return the original receipt rather than creating a second row.
- GarageLog returns a server receipt before Mobile marks a trip uploaded.

Current scope:
- The trip is safely stored and acknowledged by GarageLog.
- It is not yet automatically assigned to a specific GarageLog vehicle or used
  to change that vehicle's dashboard odometer. Device-to-vehicle association
  should be added as a separate controlled step.


v8 OBD device association + odometer reconciliation
---------------------------------------------------
- Adds persistent OBD device registration by DeviceId.
- Telemetry trips can include DeviceId, DeviceName, and VIN.
- VIN exact-match is preferred when the VIN exists on a GarageLog vehicle.
- If VIN is unavailable, the saved DeviceId -> VehicleId association is used.
- If a detected VIN conflicts with the saved device pairing, GarageLog does not silently attach the trip to the wrong vehicle.
- Adds mobile vehicle-list and device-association endpoints for one-time manual pairing.
- Adds an OBD Devices & Mileage section to GarageLog Settings.
- OBD mileage never overwrites GarageLog automatically. Each newer value becomes an odometer proposal.
- Manual GarageLog odometer readings win automatically when they are equal to or newer than a pending proposal.
- Administrators can Apply or Dismiss a proposal. Apply updates the matching vehicle and adds a mileage-history entry.

New endpoints:
  GET  /api/mobile/vehicles
  GET  /api/mobile/obd-devices/{deviceId}
  POST /api/mobile/obd-devices/{deviceId}/associate
  GET  /api/obd-devices
  POST /api/obd-devices/{deviceId}/associate
  POST /api/odometer-proposals/{tripId}/apply
  POST /api/odometer-proposals/{tripId}/dismiss
