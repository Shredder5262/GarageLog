GarageLog 0.7.11 OBD association update

This ZIP is rooted at the GarageLog repository itself. There is NO extra wrapper folder.

Visible server-side change:
  User menu -> Settings -> OBD Devices & Mileage

That section contains:
  - Registered OBD devices
  - One-time GarageLog vehicle association
  - VIN status / automatic matching support
  - Pending odometer proposals with Apply / Dismiss
  - Explanation that OBD telemetry does not silently overwrite manual mileage

After replacing your working tree:
  1. Stop GarageLog.
  2. Run .\VERIFY-OBD-UPDATE.ps1
  3. dotnet restore
  4. dotnet build .\GarageLog.sln
  5. Start GarageLog again.
  6. Hard refresh the browser (Ctrl+F5).

The index now cache-busts settings.js/settings.css with ?v=0.7.11.
