using System.Diagnostics;
using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

static class ApiTokenFeature
{
    private static readonly HashSet<string> AllowedScopes = new(StringComparer.Ordinal)
    {
        "vehicles:read",
        "telemetry:write",
        "device:sync"
    };

    public static async Task InitializeAsync(string connectionString)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();

        await using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS ApiTokens (
                Id TEXT PRIMARY KEY,
                Name TEXT NOT NULL,
                TokenHash TEXT NOT NULL UNIQUE,
                TokenPrefix TEXT NOT NULL,
                ScopesJson TEXT NOT NULL,
                CreatedByUserId TEXT NULL,
                CreatedUtc TEXT NOT NULL,
                ExpiresUtc TEXT NULL,
                RevokedUtc TEXT NULL,
                LastUsedUtc TEXT NULL,
                FOREIGN KEY(CreatedByUserId) REFERENCES Users(Id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS IX_ApiTokens_TokenHash
                ON ApiTokens(TokenHash);

            CREATE INDEX IF NOT EXISTS IX_ApiTokens_Status
                ON ApiTokens(RevokedUtc, ExpiresUtc);

            CREATE TABLE IF NOT EXISTS FuelCaptures (
                Id TEXT PRIMARY KEY,
                ApiTokenId TEXT NOT NULL,
                ImagePath TEXT NOT NULL,
                CapturedUtc TEXT NULL,
                ReceivedUtc TEXT NOT NULL,
                OcrStatus TEXT NOT NULL,
                OcrText TEXT NULL,
                Gallons REAL NULL,
                OcrConfidence TEXT NULL,
                ConfirmedUtc TEXT NULL,
                FOREIGN KEY(ApiTokenId) REFERENCES ApiTokens(Id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS IX_FuelCaptures_ReceivedUtc
                ON FuelCaptures(ReceivedUtc);

            CREATE TABLE IF NOT EXISTS TelemetryTrips (
                Id TEXT PRIMARY KEY,
                ApiTokenId TEXT NOT NULL,
                ClientTripId TEXT NOT NULL,
                StartedAt TEXT NOT NULL,
                EndedAt TEXT NOT NULL,
                DistanceMiles REAL NOT NULL,
                StartOdometer REAL NULL,
                EndOdometer REAL NULL,
                Source TEXT NULL,
                ReceivedUtc TEXT NOT NULL,
                UNIQUE(ApiTokenId, ClientTripId),
                FOREIGN KEY(ApiTokenId) REFERENCES ApiTokens(Id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS IX_TelemetryTrips_ReceivedUtc
                ON TelemetryTrips(ReceivedUtc);

            CREATE INDEX IF NOT EXISTS IX_TelemetryTrips_ClientTripId
                ON TelemetryTrips(ClientTripId);

            CREATE TABLE IF NOT EXISTS ObdDevices (
                DeviceId TEXT PRIMARY KEY,
                ApiTokenId TEXT NULL,
                DisplayName TEXT NULL,
                LastVin TEXT NULL,
                VehicleId TEXT NULL,
                AssociationSource TEXT NULL,
                CreatedUtc TEXT NOT NULL,
                LastSeenUtc TEXT NOT NULL,
                LastAssociationUtc TEXT NULL,
                TrustedVehicleId TEXT NULL,
                AutoApproveMileage INTEGER NOT NULL DEFAULT 0,
                TrustedUtc TEXT NULL,
                FOREIGN KEY(ApiTokenId) REFERENCES ApiTokens(Id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS IX_ObdDevices_VehicleId
                ON ObdDevices(VehicleId);

            CREATE TABLE IF NOT EXISTS TelemetryTripAssociations (
                TripId TEXT PRIMARY KEY,
                DeviceId TEXT NULL,
                Vin TEXT NULL,
                VehicleId TEXT NULL,
                SuggestedVehicleId TEXT NULL,
                AssociationStatus TEXT NOT NULL,
                AssociationMethod TEXT NULL,
                BaselineMileage REAL NULL,
                CandidateOdometer REAL NULL,
                CandidateSource TEXT NULL,
                OdometerStatus TEXT NOT NULL,
                CreatedUtc TEXT NOT NULL,
                UpdatedUtc TEXT NOT NULL,
                AppliedUtc TEXT NULL,
                DismissedUtc TEXT NULL,
                FOREIGN KEY(TripId) REFERENCES TelemetryTrips(Id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS IX_TelemetryTripAssociations_DeviceId
                ON TelemetryTripAssociations(DeviceId);

            CREATE INDEX IF NOT EXISTS IX_TelemetryTripAssociations_VehicleId
                ON TelemetryTripAssociations(VehicleId, OdometerStatus);
            """;

        await command.ExecuteNonQueryAsync();

        // Existing GarageLog databases predate the OBD trust settings. Keep this
        // migration additive so current vehicle and telemetry data is preserved.
        await EnsureColumnAsync(connection, "ObdDevices", "TrustedVehicleId", "TEXT NULL");
        await EnsureColumnAsync(connection, "ObdDevices", "AutoApproveMileage", "INTEGER NOT NULL DEFAULT 0");
        await EnsureColumnAsync(connection, "ObdDevices", "TrustedUtc", "TEXT NULL");
    }

    private static async Task EnsureColumnAsync(
        SqliteConnection connection,
        string tableName,
        string columnName,
        string definition)
    {
        await using var pragma = connection.CreateCommand();
        pragma.CommandText = $"PRAGMA table_info({tableName});";
        await using var reader = await pragma.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            if (string.Equals(reader.GetString(1), columnName, StringComparison.OrdinalIgnoreCase))
                return;
        }

        await reader.DisposeAsync();
        await using var alter = connection.CreateCommand();
        alter.CommandText = $"ALTER TABLE {tableName} ADD COLUMN {columnName} {definition};";
        await alter.ExecuteNonQueryAsync();
    }

    public static void MapEndpoints(WebApplication app, string connectionString, string applicationVersion, string vehiclesDirectory)
    {
        app.MapGet("/api/api-tokens", async () =>
        {
            var tokens = await ReadTokensAsync(connectionString);
            return Results.Ok(new { tokens });
        }).RequireAuthorization("Administrator");

        app.MapPost("/api/api-tokens", async (ApiTokenCreateRequest request, HttpContext context) =>
        {
            var name = (request.Name ?? string.Empty).Trim();
            if (name.Length is < 2 or > 80)
                return Results.BadRequest(new { error = "Token name must be between 2 and 80 characters." });

            var requestedScopes = (request.Scopes ?? Array.Empty<string>())
                .Where(scope => !string.IsNullOrWhiteSpace(scope))
                .Select(scope => scope.Trim())
                .Distinct(StringComparer.Ordinal)
                .ToArray();

            if (requestedScopes.Length == 0)
                return Results.BadRequest(new { error = "Select at least one API permission." });

            var invalidScopes = requestedScopes.Where(scope => !AllowedScopes.Contains(scope)).ToArray();
            if (invalidScopes.Length > 0)
                return Results.BadRequest(new { error = "One or more requested API permissions are not supported." });

            if (!TryResolveExpiration(
                    request.ExpiresInDays,
                    request.ExpiresAtUtc,
                    out var expiresUtc,
                    out var expirationError))
                return Results.BadRequest(new { error = expirationError });

            var rawToken = GenerateToken();
            var createdByUserId = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value;
            var createdBy = context.User.Identity?.Name;
            var record = new ApiTokenRecord(
                Id: Guid.NewGuid().ToString("N"),
                Name: name,
                TokenHash: HashToken(rawToken),
                TokenPrefix: rawToken[..Math.Min(rawToken.Length, 14)],
                Scopes: requestedScopes,
                CreatedByUserId: createdByUserId,
                CreatedBy: createdBy,
                CreatedUtc: DateTimeOffset.UtcNow,
                ExpiresUtc: expiresUtc,
                RevokedUtc: null,
                LastUsedUtc: null);

            await InsertTokenAsync(connectionString, record);

            return Results.Ok(new
            {
                token = rawToken,
                apiToken = ToDto(record)
            });
        }).RequireAuthorization("Administrator");

        app.MapPost("/api/api-tokens/{id}/revoke", async (string id) =>
        {
            var changed = await RevokeTokenAsync(connectionString, id);
            return changed
                ? Results.Ok(new { revoked = true })
                : Results.NotFound(new { error = "The API token was not found." });
        }).RequireAuthorization("Administrator");

        app.MapDelete("/api/api-tokens/{id}", async (string id) =>
        {
            var changed = await DeleteTokenAsync(connectionString, id);
            return changed
                ? Results.Ok(new { deleted = true })
                : Results.NotFound(new { error = "The API token was not found." });
        }).RequireAuthorization("Administrator");

        // Mobile/device health endpoint. Unlike /api/health, this does not use the
        // browser cookie session. It requires a scoped GarageLog bearer token.
        app.MapGet("/api/mobile/health", async (HttpContext context) =>
        {
            var token = await AuthenticateBearerAsync(connectionString, context, "device:sync");
            if (token is null)
                return Results.Unauthorized();

            return Results.Ok(new
            {
                status = "ok",
                application = "GarageLog",
                version = applicationVersion,
                authenticated = true,
                tokenName = token.Name,
                scopes = token.Scopes,
                timeUtc = DateTimeOffset.UtcNow
            });
        }).AllowAnonymous();

        app.MapGet("/api/mobile/vehicles", async (HttpContext context) =>
        {
            var token = await AuthenticateBearerAsync(connectionString, context, "vehicles:read");
            if (token is null)
                return Results.Unauthorized();

            var vehicles = await ReadVehicleSummariesAsync(connectionString);
            return Results.Ok(new { vehicles });
        }).AllowAnonymous();

        app.MapGet("/api/mobile/vehicles/{vehicleId}/image", async (
            string vehicleId,
            HttpContext context) =>
        {
            var token = await AuthenticateBearerAsync(connectionString, context, "vehicles:read");
            if (token is null)
                return Results.Unauthorized();

            var vehicles = await ReadVehicleSummariesAsync(connectionString);
            var vehicle = vehicles.FirstOrDefault(item => item.Id == vehicleId);
            if (vehicle is null || string.IsNullOrWhiteSpace(vehicle.ImageStoredName))
                return Results.NotFound();

            var safeName = Path.GetFileName(vehicle.ImageStoredName);
            var path = Path.Combine(vehiclesDirectory, safeName);
            if (!File.Exists(path))
                return Results.NotFound();

            var contentType = Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".png" => "image/png",
                ".webp" => "image/webp",
                ".jpg" or ".jpeg" => "image/jpeg",
                _ => "application/octet-stream"
            };

            return Results.File(path, contentType, enableRangeProcessing: true);
        }).AllowAnonymous();

        app.MapGet("/api/mobile/obd-devices/{deviceId}", async (
            string deviceId,
            HttpContext context) =>
        {
            var token = await AuthenticateBearerAsync(connectionString, context, "device:sync");
            if (token is null)
                return Results.Unauthorized();

            var normalizedDeviceId = NormalizeDeviceId(deviceId);
            if (normalizedDeviceId is null)
                return Results.BadRequest(new { error = "The GarageLog OBD device ID is invalid." });

            var device = await ReadObdDeviceAsync(connectionString, normalizedDeviceId);
            var vehicles = await ReadVehicleSummariesAsync(connectionString);
            var linked = device?.VehicleId is null
                ? null
                : vehicles.FirstOrDefault(vehicle => vehicle.Id == device.VehicleId);

            return Results.Ok(new
            {
                deviceId = normalizedDeviceId,
                registered = device is not null,
                displayName = device?.DisplayName,
                lastVin = device?.LastVin,
                vehicleId = device?.VehicleId,
                vehicleName = linked?.Name,
                associationSource = device?.AssociationSource,
                lastSeenUtc = device?.LastSeenUtc,
                isTrusted = device is not null
                    && device.VehicleId is not null
                    && string.Equals(device.TrustedVehicleId, device.VehicleId, StringComparison.Ordinal),
                autoApproveMileage = device is not null
                    && device.AutoApproveMileage
                    && device.VehicleId is not null
                    && string.Equals(device.TrustedVehicleId, device.VehicleId, StringComparison.Ordinal),
                trustedUtc = device?.TrustedUtc
            });
        }).AllowAnonymous();

        app.MapPost("/api/mobile/obd-devices/{deviceId}/associate", async (
            string deviceId,
            ObdDeviceAssociateRequest request,
            HttpContext context) =>
        {
            var token = await AuthenticateBearerAsync(connectionString, context, "device:sync");
            if (token is null)
                return Results.Unauthorized();
            if (!token.Scopes.Contains("vehicles:read", StringComparer.Ordinal))
                return Results.StatusCode(StatusCodes.Status403Forbidden);

            var normalizedDeviceId = NormalizeDeviceId(deviceId);
            if (normalizedDeviceId is null)
                return Results.BadRequest(new { error = "The GarageLog OBD device ID is invalid." });

            var vehicles = await ReadVehicleSummariesAsync(connectionString);
            var vehicle = vehicles.FirstOrDefault(item => item.Id == (request.VehicleId ?? string.Empty).Trim());
            if (vehicle is null)
                return Results.NotFound(new { error = "The selected GarageLog vehicle was not found or is archived." });

            await PairObdDeviceAsync(
                connectionString,
                normalizedDeviceId,
                token.Id,
                request.DisplayName,
                NormalizeVin(request.Vin),
                vehicle.Id,
                "manual");

            return Results.Ok(new
            {
                associated = true,
                deviceId = normalizedDeviceId,
                vehicleId = vehicle.Id,
                vehicleName = vehicle.Name,
                message = $"GarageLog OBD device associated with {vehicle.Name}."
            });
        }).AllowAnonymous();

        app.MapGet("/api/obd-devices", async () =>
        {
            var vehicles = await ReadVehicleSummariesAsync(connectionString);
            var devices = await ReadObdDevicesAsync(connectionString, vehicles);
            var proposals = await ReadOdometerProposalsAsync(connectionString, vehicles);
            return Results.Ok(new { vehicles, devices, odometerProposals = proposals });
        }).RequireAuthorization("Administrator");

        app.MapPost("/api/obd-devices/{deviceId}/associate", async (
            string deviceId,
            ObdDeviceAssociateRequest request) =>
        {
            var normalizedDeviceId = NormalizeDeviceId(deviceId);
            if (normalizedDeviceId is null)
                return Results.BadRequest(new { error = "The GarageLog OBD device ID is invalid." });

            var vehicles = await ReadVehicleSummariesAsync(connectionString);
            var vehicle = vehicles.FirstOrDefault(item => item.Id == (request.VehicleId ?? string.Empty).Trim());
            if (vehicle is null)
                return Results.NotFound(new { error = "The selected GarageLog vehicle was not found or is archived." });

            var existing = await ReadObdDeviceAsync(connectionString, normalizedDeviceId);
            await PairObdDeviceAsync(
                connectionString,
                normalizedDeviceId,
                existing?.ApiTokenId,
                request.DisplayName ?? existing?.DisplayName,
                NormalizeVin(request.Vin) ?? existing?.LastVin,
                vehicle.Id,
                "manual");

            return Results.Ok(new { associated = true, vehicleId = vehicle.Id, vehicleName = vehicle.Name });
        }).RequireAuthorization("Administrator");

        app.MapPost("/api/obd-devices/{deviceId}/settings", async (
            string deviceId,
            ObdDeviceSettingsRequest request) =>
        {
            var normalizedDeviceId = NormalizeDeviceId(deviceId);
            if (normalizedDeviceId is null)
                return Results.BadRequest(new { error = "The GarageLog OBD device ID is invalid." });

            var device = await ReadObdDeviceAsync(connectionString, normalizedDeviceId);
            if (device is null)
                return Results.NotFound(new { error = "The GarageLog OBD device was not found." });
            if (string.IsNullOrWhiteSpace(device.VehicleId))
                return Results.BadRequest(new { error = "Associate this OBD device with a vehicle before marking it trusted." });
            if (request.AutoApproveMileage && !request.Trusted)
                return Results.BadRequest(new { error = "Automatic mileage approval requires a trusted device and vehicle pairing." });

            var changed = await UpdateObdDeviceSettingsAsync(
                connectionString,
                normalizedDeviceId,
                device.VehicleId,
                request.Trusted,
                request.AutoApproveMileage);

            if (!changed)
                return Results.Conflict(new { error = "The OBD device vehicle association changed. Refresh Settings and try again." });

            return Results.Ok(new
            {
                saved = true,
                deviceId = normalizedDeviceId,
                vehicleId = device.VehicleId,
                trusted = request.Trusted,
                autoApproveMileage = request.Trusted && request.AutoApproveMileage
            });
        }).RequireAuthorization("Administrator");

        app.MapPost("/api/odometer-proposals/{tripId}/apply", async (string tripId) =>
        {
            var result = await ApplyOdometerProposalAsync(connectionString, tripId);
            return result.Found
                ? Results.Ok(new
                {
                    applied = result.Applied,
                    vehicleId = result.VehicleId,
                    previousMileage = result.PreviousMileage,
                    mileage = result.Mileage,
                    message = result.Message
                })
                : Results.NotFound(new { error = "The odometer proposal was not found." });
        }).RequireAuthorization("Administrator");

        app.MapPost("/api/odometer-proposals/{tripId}/dismiss", async (string tripId) =>
        {
            var changed = await DismissOdometerProposalAsync(connectionString, tripId);
            return changed
                ? Results.Ok(new { dismissed = true })
                : Results.NotFound(new { error = "The odometer proposal was not found." });
        }).RequireAuthorization("Administrator");

        app.MapPost("/api/telemetry/trips", async (
            TelemetryTripUploadRequest request,
            HttpContext context) =>
        {
            var token = await AuthenticateBearerAsync(
                connectionString,
                context,
                "telemetry:write");

            if (token is null)
                return Results.Unauthorized();

            var tripId = (request.TripId ?? string.Empty).Trim();

            if (tripId.Length is < 1 or > 120)
                return Results.BadRequest(new
                {
                    error = "TripId is required and must be 120 characters or fewer."
                });

            if (request.EndedAt < request.StartedAt)
                return Results.BadRequest(new
                {
                    error = "Trip end time cannot be earlier than the start time."
                });

            if (request.DistanceMiles < 0 || request.DistanceMiles > 5000)
                return Results.BadRequest(new
                {
                    error = "Trip distance must be between 0 and 5000 miles."
                });

            if (request.StartOdometer.HasValue && request.StartOdometer.Value < 0)
                return Results.BadRequest(new
                {
                    error = "Starting odometer cannot be negative."
                });

            if (request.EndOdometer.HasValue && request.EndOdometer.Value < 0)
                return Results.BadRequest(new
                {
                    error = "Ending odometer cannot be negative."
                });

            if (request.StartOdometer.HasValue &&
                request.EndOdometer.HasValue &&
                request.EndOdometer.Value < request.StartOdometer.Value)
            {
                return Results.BadRequest(new
                {
                    error = "Ending odometer cannot be less than starting odometer."
                });
            }

            var receipt = await StoreTelemetryTripAsync(
                connectionString,
                token.Id,
                tripId,
                request.StartedAt.ToUniversalTime(),
                request.EndedAt.ToUniversalTime(),
                request.DistanceMiles,
                request.StartOdometer,
                request.EndOdometer,
                request.Source);

            var association = await ResolveVehicleAssociationAsync(
                connectionString,
                token.Id,
                request.DeviceId,
                request.DeviceName,
                request.Vin);

            var odometer = await StoreTripAssociationAsync(
                connectionString,
                receipt.ReceiptId,
                association,
                request.EndedAt.ToUniversalTime(),
                request.DistanceMiles,
                request.EndOdometer);

            OdometerApplyResult? automaticApply = null;
            if (!receipt.Duplicate
                && string.Equals(odometer.Status, "pending", StringComparison.Ordinal)
                && !string.IsNullOrWhiteSpace(association.DeviceId)
                && !string.IsNullOrWhiteSpace(association.VehicleId))
            {
                var device = await ReadObdDeviceAsync(connectionString, association.DeviceId);
                var trustedForVehicle = device is not null
                    && device.AutoApproveMileage
                    && string.Equals(device.VehicleId, association.VehicleId, StringComparison.Ordinal)
                    && string.Equals(device.TrustedVehicleId, association.VehicleId, StringComparison.Ordinal);

                if (trustedForVehicle)
                    automaticApply = await ApplyOdometerProposalAsync(connectionString, receipt.ReceiptId);
            }

            var returnedOdometerStatus = automaticApply is null
                ? odometer.Status
                : automaticApply.Applied
                    ? "applied"
                    : automaticApply.Found
                        ? "covered"
                        : odometer.Status;

            return Results.Ok(new
            {
                accepted = true,
                tripId,
                receiptId = receipt.ReceiptId,
                duplicate = receipt.Duplicate,
                receivedUtc = receipt.ReceivedUtc,
                association = new
                {
                    status = association.Status,
                    method = association.Method,
                    deviceId = association.DeviceId,
                    vin = association.Vin,
                    vehicleId = association.VehicleId,
                    vehicleName = association.VehicleName,
                    suggestedVehicleId = association.SuggestedVehicleId,
                    suggestedVehicleName = association.SuggestedVehicleName
                },
                odometer = new
                {
                    status = returnedOdometerStatus,
                    baselineMileage = odometer.BaselineMileage,
                    candidateOdometer = odometer.CandidateOdometer,
                    candidateSource = odometer.CandidateSource,
                    autoApproved = automaticApply?.Applied == true,
                    autoApprovalMessage = automaticApply?.Message
                }
            });
        }).AllowAnonymous();

        // GarageLog Mobile manual odometer entry updates the authoritative
        // GarageLog vehicle and its mileage history.
        app.MapPost("/api/mobile/vehicles/{vehicleId}/mileage", async (
            string vehicleId,
            MobileMileageUpdateRequest request,
            HttpContext context) =>
        {
            var token = await AuthenticateBearerAsync(connectionString, context, "telemetry:write");
            if (token is null)
                return Results.Unauthorized();

            var normalizedVehicleId = (vehicleId ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(normalizedVehicleId))
                return Results.BadRequest(new { error = "A GarageLog vehicle ID is required." });

            if (!double.IsFinite(request.Mileage) || request.Mileage < 0 || request.Mileage > 10_000_000)
                return Results.BadRequest(new { error = "Mileage must be a valid non-negative value." });

            var recordedUtc = (request.RecordedUtc ?? DateTimeOffset.UtcNow).ToUniversalTime();
            var source = string.IsNullOrWhiteSpace(request.Source) ? "GarageLog Mobile" : request.Source.Trim();
            if (source.Length > 80) source = source[..80];

            var result = await ApplyManualMileageAsync(
                connectionString,
                normalizedVehicleId,
                request.Mileage,
                recordedUtc,
                source,
                request.IsCorrection);

            if (!result.Found)
                return Results.NotFound(new { error = "The selected GarageLog vehicle was not found or is archived." });

            if (!result.Accepted)
                return Results.Conflict(new
                {
                    error = result.Message,
                    vehicleId = result.VehicleId,
                    vehicleName = result.VehicleName,
                    currentMileage = result.PreviousMileage
                });

            return Results.Ok(new
            {
                updated = result.Changed,
                vehicleId = result.VehicleId,
                vehicleName = result.VehicleName,
                previousMileage = result.PreviousMileage,
                mileage = result.Mileage,
                recordedUtc,
                source,
                correction = request.IsCorrection,
                message = result.Message
            });
        }).AllowAnonymous();

        // A mobile fuel receipt becomes a normal GarageLog document. The pending
        // document is persisted before OCR runs so the original image remains
        // available even when OCR is unavailable or cannot identify the values.
        app.MapPost("/api/mobile/documents/receipts", async (HttpContext context) =>
        {
            var token = await AuthenticateBearerAsync(connectionString, context, "telemetry:write");
            if (token is null)
                return Results.Unauthorized();

            if (!context.Request.HasFormContentType)
                return Results.BadRequest(new { error = "A multipart receipt image upload is required." });

            var form = await context.Request.ReadFormAsync();
            var image = form.Files.GetFile("image");
            if (image is null || image.Length == 0)
                return Results.BadRequest(new { error = "Choose a non-empty receipt image." });
            if (image.Length > 15L * 1024L * 1024L)
                return Results.BadRequest(new { error = "Receipt images must be 15 MB or smaller." });

            var vehicleId = form["vehicleId"].ToString().Trim();
            if (string.IsNullOrWhiteSpace(vehicleId))
                return Results.BadRequest(new { error = "Choose a GarageLog vehicle before uploading the receipt." });

            var vehicles = await ReadVehicleSummariesAsync(connectionString);
            var vehicle = vehicles.FirstOrDefault(item => string.Equals(item.Id, vehicleId, StringComparison.Ordinal));
            if (vehicle is null)
                return Results.NotFound(new { error = "The selected GarageLog vehicle was not found or is archived." });

            var captureType = string.Equals(
                    form["captureType"].ToString().Trim(),
                    "pump",
                    StringComparison.OrdinalIgnoreCase)
                ? "pump"
                : "receipt";

            var contentType = (image.ContentType ?? string.Empty).Trim().ToLowerInvariant();
            var extension = contentType switch
            {
                "image/png" => ".png",
                "image/jpeg" or "image/jpg" => ".jpg",
                _ => string.Empty
            };
            if (string.IsNullOrWhiteSpace(extension))
                return Results.BadRequest(new { error = "Use a JPEG or PNG receipt image." });

            await using (var signatureStream = image.OpenReadStream())
            {
                if (!await HasExpectedReceiptImageSignatureAsync(signatureStream, extension))
                    return Results.BadRequest(new { error = "The uploaded receipt does not contain a valid JPEG or PNG image." });
            }

            var capturedUtc = DateTimeOffset.UtcNow;
            if (DateTimeOffset.TryParse(
                    form["capturedUtc"].ToString(),
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal,
                    out var parsedCaptured))
                capturedUtc = parsedCaptured.ToUniversalTime();

            var documentId = Guid.NewGuid().ToString("N");
            var storedName = $"{Guid.NewGuid():N}{extension}";
            var originalName = Path.GetFileName(image.FileName);
            if (string.IsNullOrWhiteSpace(originalName))
                originalName = $"fuel-receipt-{capturedUtc:yyyyMMdd-HHmmss}{extension}";

            var documentsDirectory = Path.Combine(ResolveDataRoot(connectionString), "documents");
            Directory.CreateDirectory(documentsDirectory);
            var fullPath = Path.Combine(documentsDirectory, storedName);

            try
            {
                await using (var input = image.OpenReadStream())
                await using (var output = File.Create(fullPath))
                {
                    await input.CopyToAsync(output);
                }

                if (!await CreatePendingMobileReceiptAsync(
                        connectionString,
                        documentId,
                        vehicle.Id,
                        vehicle.Name,
                        storedName,
                        originalName,
                        extension,
                        contentType,
                        image.Length,
                        capturedUtc,
                        token.Name,
                        captureType))
                {
                    try { File.Delete(fullPath); } catch { }
                    return Results.Conflict(new { error = "GarageLog could not create the pending receipt document." });
                }

                var ocr = await RunFuelOcrAsync(fullPath, captureType);
                var extraction = captureType == "pump"
                    ? ExtractPumpDisplayDetails(ocr.Text)
                    : ExtractFuelReceiptDetails(ocr.Text);
                var documentOcrStatus = ocr.Status switch
                {
                    "complete" when !string.IsNullOrWhiteSpace(ocr.Text) => "indexed",
                    "complete" => "empty",
                    "unavailable" => "needs-ocr",
                    _ => "error"
                };

                await UpdateMobileReceiptOcrAsync(
                    connectionString,
                    documentId,
                    documentOcrStatus,
                    ocr.Status,
                    ocr.Text,
                    extraction);

                var message = documentOcrStatus switch
                {
                    "indexed" when extraction.Amount.HasValue || extraction.Gallons.HasValue =>
                        "Receipt uploaded to GarageLog as a pending document. OCR suggestions are ready for review.",
                    "indexed" =>
                        "Receipt uploaded to GarageLog as a pending document. OCR text is available for review.",
                    "needs-ocr" =>
                        "Receipt uploaded to GarageLog as a pending document, but Tesseract OCR is unavailable on this host.",
                    _ =>
                        "Receipt uploaded to GarageLog as a pending document. OCR needs review."
                };

                return Results.Ok(new
                {
                    documentId,
                    vehicleId = vehicle.Id,
                    vehicleName = vehicle.Name,
                    storedName,
                    reviewStatus = "Pending",
                    captureType,
                    ocrStatus = documentOcrStatus,
                    gallons = extraction.Gallons,
                    amount = extraction.Amount,
                    merchant = extraction.Merchant,
                    pricePerGallon = extraction.PricePerGallon,
                    message
                });
            }
            catch
            {
                if (!await MobileReceiptExistsAsync(connectionString, documentId))
                {
                    try { File.Delete(fullPath); } catch { }
                }
                throw;
            }
        }).AllowAnonymous();

        app.MapPost("/api/mobile/fuel-captures", async (HttpContext context) =>
        {
            var token = await AuthenticateBearerAsync(connectionString, context, "telemetry:write");
            if (token is null)
                return Results.Unauthorized();

            if (!context.Request.HasFormContentType)
                return Results.BadRequest(new { error = "A multipart image upload is required." });

            var form = await context.Request.ReadFormAsync();
            var image = form.Files.GetFile("image");

            if (image is null || image.Length == 0)
                return Results.BadRequest(new { error = "No fuel-pump image was uploaded." });

            if (image.Length > 12 * 1024 * 1024)
                return Results.BadRequest(new { error = "Fuel-pump images must be 12 MB or smaller." });

            var allowedTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "image/jpeg",
                "image/jpg",
                "image/png"
            };

            if (!allowedTypes.Contains(image.ContentType ?? string.Empty))
                return Results.BadRequest(new { error = "Use a JPEG or PNG fuel-pump image." });

            DateTimeOffset? capturedUtc = null;
            if (DateTimeOffset.TryParse(
                    form["capturedUtc"].ToString(),
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.AssumeUniversal,
                    out var parsedCaptured))
            {
                capturedUtc = parsedCaptured.ToUniversalTime();
            }

            var id = Guid.NewGuid().ToString("N");
            var dataRoot = ResolveDataRoot(connectionString);
            var fuelDirectory = Path.Combine(dataRoot, "fuel-captures");
            Directory.CreateDirectory(fuelDirectory);

            var extension = string.Equals(
                    image.ContentType,
                    "image/png",
                    StringComparison.OrdinalIgnoreCase)
                ? ".png"
                : ".jpg";

            var fileName = $"{id}{extension}";
            var fullPath = Path.Combine(fuelDirectory, fileName);

            await using (var output = File.Create(fullPath))
            {
                await image.CopyToAsync(output);
            }

            var ocr = await RunFuelOcrAsync(fullPath);
            var extraction = ExtractGallons(ocr.Text);
            var receivedUtc = DateTimeOffset.UtcNow;
            var relativePath = Path.Combine("fuel-captures", fileName).Replace('\\', '/');

            await InsertFuelCaptureAsync(
                connectionString,
                id,
                token.Id,
                relativePath,
                capturedUtc,
                receivedUtc,
                ocr.Status,
                ocr.Text,
                extraction.Gallons,
                extraction.Confidence);

            var message = extraction.Gallons.HasValue
                ? $"Fuel photo saved. OCR detected {extraction.Gallons.Value:0.###} gallons."
                : ocr.Status == "unavailable"
                    ? "Fuel photo saved, but Tesseract OCR is not available on this GarageLog host."
                    : "Fuel photo saved. OCR could not confidently identify the gallons value.";

            return Results.Ok(new
            {
                captureId = id,
                uploaded = true,
                gallons = extraction.Gallons,
                confidence = extraction.Confidence,
                ocrStatus = ocr.Status,
                message
            });
        }).AllowAnonymous();

        app.MapPost(
            "/api/mobile/fuel-captures/{id}/confirm",
            async (string id, FuelGallonsConfirmRequest request, HttpContext context) =>
        {
            var token = await AuthenticateBearerAsync(connectionString, context, "telemetry:write");
            if (token is null)
                return Results.Unauthorized();

            if (request.Gallons <= 0 || request.Gallons > 200)
                return Results.BadRequest(new
                {
                    error = "Gallons must be greater than zero and no more than 200."
                });

            var updated = await ConfirmFuelGallonsAsync(
                connectionString,
                id,
                token.Id,
                request.Gallons);

            return updated
                ? Results.Ok(new
                {
                    captureId = id,
                    gallons = request.Gallons,
                    confirmed = true
                })
                : Results.NotFound(new
                {
                    error = "The fuel capture was not found for this API token."
                });
        }).AllowAnonymous();
    }

    private static async Task<TelemetryTripReceipt> StoreTelemetryTripAsync(
        string connectionString,
        string apiTokenId,
        string clientTripId,
        DateTimeOffset startedAt,
        DateTimeOffset endedAt,
        double distanceMiles,
        double? startOdometer,
        double? endOdometer,
        string? source)
    {
        var receiptId = Guid.NewGuid().ToString("N");
        var receivedUtc = DateTimeOffset.UtcNow;

        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();

        await using (var insert = connection.CreateCommand())
        {
            insert.CommandText = """
                INSERT OR IGNORE INTO TelemetryTrips
                    (Id, ApiTokenId, ClientTripId, StartedAt, EndedAt, DistanceMiles,
                     StartOdometer, EndOdometer, Source, ReceivedUtc)
                VALUES
                    ($id, $tokenId, $clientTripId, $startedAt, $endedAt, $distanceMiles,
                     $startOdometer, $endOdometer, $source, $receivedUtc);
                """;

            insert.Parameters.AddWithValue("$id", receiptId);
            insert.Parameters.AddWithValue("$tokenId", apiTokenId);
            insert.Parameters.AddWithValue("$clientTripId", clientTripId);
            insert.Parameters.AddWithValue("$startedAt", startedAt.ToString("O"));
            insert.Parameters.AddWithValue("$endedAt", endedAt.ToString("O"));
            insert.Parameters.AddWithValue("$distanceMiles", distanceMiles);
            insert.Parameters.AddWithValue(
                "$startOdometer",
                startOdometer.HasValue ? startOdometer.Value : DBNull.Value);
            insert.Parameters.AddWithValue(
                "$endOdometer",
                endOdometer.HasValue ? endOdometer.Value : DBNull.Value);
            insert.Parameters.AddWithValue(
                "$source",
                string.IsNullOrWhiteSpace(source) ? DBNull.Value : source.Trim());
            insert.Parameters.AddWithValue("$receivedUtc", receivedUtc.ToString("O"));

            var inserted = await insert.ExecuteNonQueryAsync();

            if (inserted > 0)
                return new TelemetryTripReceipt(receiptId, false, receivedUtc);
        }

        await using var existing = connection.CreateCommand();
        existing.CommandText = """
            SELECT Id, ReceivedUtc
            FROM TelemetryTrips
            WHERE ApiTokenId = $tokenId
              AND ClientTripId = $clientTripId
            LIMIT 1;
            """;

        existing.Parameters.AddWithValue("$tokenId", apiTokenId);
        existing.Parameters.AddWithValue("$clientTripId", clientTripId);

        await using var reader = await existing.ExecuteReaderAsync();

        if (await reader.ReadAsync())
        {
            return new TelemetryTripReceipt(
                reader.GetString(0),
                true,
                DateTimeOffset.Parse(reader.GetString(1)));
        }

        throw new InvalidOperationException(
            "GarageLog could not confirm the telemetry trip after storage.");
    }

    private static string? NormalizeDeviceId(string? value)
    {
        var normalized = (value ?? string.Empty).Trim();
        return Regex.IsMatch(normalized, @"^[A-Za-z0-9._:-]{6,120}$")
            ? normalized
            : null;
    }

    private static string? NormalizeVin(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var normalized = Regex.Replace(
            value.Trim().ToUpperInvariant(),
            "[^A-Z0-9]",
            string.Empty);

        return normalized.Length >= 8 && normalized.Length <= 24
            ? normalized
            : null;
    }

    private static string JsonString(JsonNode? node)
    {
        if (node is JsonValue value && value.TryGetValue<string>(out var result))
            return result ?? string.Empty;
        return string.Empty;
    }

    private static double JsonDouble(JsonNode? node)
    {
        if (node is JsonValue value)
        {
            if (value.TryGetValue<double>(out var doubleValue))
                return doubleValue;
            if (value.TryGetValue<int>(out var intValue))
                return intValue;
            if (value.TryGetValue<long>(out var longValue))
                return longValue;
        }
        return 0;
    }

    private static async Task<JsonObject> ReadGarageStateAsync(string connectionString)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Json FROM AppState WHERE Id = 1;";
        var json = await command.ExecuteScalarAsync() as string;
        return JsonNode.Parse(json ?? "{}") as JsonObject ?? new JsonObject();
    }

    private static async Task<List<GarageVehicleSummary>> ReadVehicleSummariesAsync(string connectionString)
    {
        var root = await ReadGarageStateAsync(connectionString);
        var vehicles = new List<GarageVehicleSummary>();

        foreach (var node in root["vehicles"] as JsonArray ?? new JsonArray())
        {
            if (node is not JsonObject vehicle)
                continue;

            var id = JsonString(vehicle["id"]);
            if (string.IsNullOrWhiteSpace(id))
                continue;

            var lifecycle = JsonString(vehicle["lifecycleStatus"]);
            if (lifecycle is "Sold" or "Decommissioned")
                continue;

            var year = JsonString(vehicle["year"]);
            var make = JsonString(vehicle["make"]);
            var model = JsonString(vehicle["model"]);
            var name = JsonString(vehicle["name"]);
            if (string.IsNullOrWhiteSpace(name))
                name = string.Join(" ", new[] { year, make, model }.Where(part => !string.IsNullOrWhiteSpace(part)));
            if (string.IsNullOrWhiteSpace(name))
                name = "GarageLog vehicle";

            // Match the full vehicle title shown by the GarageLog web UI.
            var trim = JsonString(vehicle["trim"]);
            if (!string.IsNullOrWhiteSpace(trim) &&
                !name.EndsWith(trim, StringComparison.OrdinalIgnoreCase))
                name = $"{name} {trim}".Trim();

            var vin = NormalizeVin(JsonString(vehicle["vin"]));
            var maskedVin = string.IsNullOrWhiteSpace(vin)
                ? null
                : vin.Length <= 6 ? vin : $"...{vin[^6..]}";

            vehicles.Add(new GarageVehicleSummary(
                id,
                name,
                year,
                make,
                model,
                JsonString(vehicle["type"]),
                JsonString(vehicle["imageStoredName"]),
                vin,
                maskedVin,
                JsonDouble(vehicle["mileage"]),
                lifecycle));
        }

        return vehicles;
    }

    private static async Task<ObdDeviceRecord?> ReadObdDeviceAsync(
        string connectionString,
        string deviceId)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT DeviceId, ApiTokenId, DisplayName, LastVin, VehicleId,
                   AssociationSource, CreatedUtc, LastSeenUtc, LastAssociationUtc,
                   TrustedVehicleId, AutoApproveMileage, TrustedUtc
            FROM ObdDevices
            WHERE DeviceId = $deviceId
            LIMIT 1;
            """;
        command.Parameters.AddWithValue("$deviceId", deviceId);

        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
            return null;

        return new ObdDeviceRecord(
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            DateTimeOffset.Parse(reader.GetString(6)),
            DateTimeOffset.Parse(reader.GetString(7)),
            reader.IsDBNull(8) ? null : DateTimeOffset.Parse(reader.GetString(8)),
            reader.IsDBNull(9) ? null : reader.GetString(9),
            !reader.IsDBNull(10) && reader.GetInt32(10) == 1,
            reader.IsDBNull(11) ? null : DateTimeOffset.Parse(reader.GetString(11)));
    }

    private static async Task PairObdDeviceAsync(
        string connectionString,
        string deviceId,
        string? apiTokenId,
        string? displayName,
        string? vin,
        string vehicleId,
        string associationSource)
    {
        var now = DateTimeOffset.UtcNow;
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO ObdDevices
                (DeviceId, ApiTokenId, DisplayName, LastVin, VehicleId, AssociationSource,
                 CreatedUtc, LastSeenUtc, LastAssociationUtc, TrustedVehicleId, AutoApproveMileage, TrustedUtc)
            VALUES
                ($deviceId, $tokenId, $displayName, $vin, $vehicleId, $associationSource,
                 $now, $now, $now, NULL, 0, NULL)
            ON CONFLICT(DeviceId) DO UPDATE SET
                ApiTokenId = COALESCE(excluded.ApiTokenId, ObdDevices.ApiTokenId),
                DisplayName = COALESCE(excluded.DisplayName, ObdDevices.DisplayName),
                LastVin = COALESCE(excluded.LastVin, ObdDevices.LastVin),
                TrustedVehicleId = CASE
                    WHEN ObdDevices.VehicleId = excluded.VehicleId THEN ObdDevices.TrustedVehicleId
                    ELSE NULL
                END,
                AutoApproveMileage = CASE
                    WHEN ObdDevices.VehicleId = excluded.VehicleId THEN ObdDevices.AutoApproveMileage
                    ELSE 0
                END,
                TrustedUtc = CASE
                    WHEN ObdDevices.VehicleId = excluded.VehicleId THEN ObdDevices.TrustedUtc
                    ELSE NULL
                END,
                VehicleId = excluded.VehicleId,
                AssociationSource = excluded.AssociationSource,
                LastSeenUtc = excluded.LastSeenUtc,
                LastAssociationUtc = excluded.LastAssociationUtc;
            """;
        command.Parameters.AddWithValue("$deviceId", deviceId);
        command.Parameters.AddWithValue("$tokenId", (object?)apiTokenId ?? DBNull.Value);
        command.Parameters.AddWithValue("$displayName", string.IsNullOrWhiteSpace(displayName) ? DBNull.Value : displayName.Trim());
        command.Parameters.AddWithValue("$vin", (object?)vin ?? DBNull.Value);
        command.Parameters.AddWithValue("$vehicleId", vehicleId);
        command.Parameters.AddWithValue("$associationSource", associationSource);
        command.Parameters.AddWithValue("$now", now.ToString("O"));
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<bool> UpdateObdDeviceSettingsAsync(
        string connectionString,
        string deviceId,
        string vehicleId,
        bool trusted,
        bool autoApproveMileage)
    {
        var now = DateTimeOffset.UtcNow;
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE ObdDevices
            SET TrustedVehicleId = CASE WHEN $trusted = 1 THEN VehicleId ELSE NULL END,
                AutoApproveMileage = CASE WHEN $trusted = 1 AND $autoApprove = 1 THEN 1 ELSE 0 END,
                TrustedUtc = CASE
                    WHEN $trusted = 1 THEN COALESCE(TrustedUtc, $now)
                    ELSE NULL
                END
            WHERE DeviceId = $deviceId
              AND VehicleId = $vehicleId;
            """;
        command.Parameters.AddWithValue("$trusted", trusted ? 1 : 0);
        command.Parameters.AddWithValue("$autoApprove", autoApproveMileage ? 1 : 0);
        command.Parameters.AddWithValue("$now", now.ToString("O"));
        command.Parameters.AddWithValue("$deviceId", deviceId);
        command.Parameters.AddWithValue("$vehicleId", vehicleId);
        return await command.ExecuteNonQueryAsync() > 0;
    }

    private static async Task TouchObdDeviceAsync(
        string connectionString,
        string deviceId,
        string apiTokenId,
        string? displayName,
        string? vin,
        string? vehicleId,
        string? associationSource)
    {
        var now = DateTimeOffset.UtcNow;
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO ObdDevices
                (DeviceId, ApiTokenId, DisplayName, LastVin, VehicleId, AssociationSource,
                 CreatedUtc, LastSeenUtc, LastAssociationUtc)
            VALUES
                ($deviceId, $tokenId, $displayName, $vin, $vehicleId, $associationSource,
                 $now, $now, CASE WHEN $vehicleId IS NULL THEN NULL ELSE $now END)
            ON CONFLICT(DeviceId) DO UPDATE SET
                ApiTokenId = excluded.ApiTokenId,
                DisplayName = COALESCE(excluded.DisplayName, ObdDevices.DisplayName),
                LastVin = COALESCE(excluded.LastVin, ObdDevices.LastVin),
                VehicleId = COALESCE(excluded.VehicleId, ObdDevices.VehicleId),
                AssociationSource = COALESCE(excluded.AssociationSource, ObdDevices.AssociationSource),
                LastSeenUtc = excluded.LastSeenUtc,
                LastAssociationUtc = CASE
                    WHEN excluded.VehicleId IS NULL THEN ObdDevices.LastAssociationUtc
                    ELSE excluded.LastSeenUtc
                END;
            """;
        command.Parameters.AddWithValue("$deviceId", deviceId);
        command.Parameters.AddWithValue("$tokenId", apiTokenId);
        command.Parameters.AddWithValue("$displayName", string.IsNullOrWhiteSpace(displayName) ? DBNull.Value : displayName.Trim());
        command.Parameters.AddWithValue("$vin", (object?)vin ?? DBNull.Value);
        command.Parameters.AddWithValue("$vehicleId", (object?)vehicleId ?? DBNull.Value);
        command.Parameters.AddWithValue("$associationSource", (object?)associationSource ?? DBNull.Value);
        command.Parameters.AddWithValue("$now", now.ToString("O"));
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<VehicleAssociationResolution> ResolveVehicleAssociationAsync(
        string connectionString,
        string apiTokenId,
        string? rawDeviceId,
        string? deviceName,
        string? rawVin)
    {
        var deviceId = NormalizeDeviceId(rawDeviceId);
        var vin = NormalizeVin(rawVin);
        if (deviceId is null)
        {
            return new VehicleAssociationResolution(
                null, vin, null, null, "device-id-missing", null, null, null);
        }

        var vehicles = await ReadVehicleSummariesAsync(connectionString);
        var existing = await ReadObdDeviceAsync(connectionString, deviceId);
        var paired = existing?.VehicleId is null
            ? null
            : vehicles.FirstOrDefault(vehicle => vehicle.Id == existing.VehicleId);
        var vinMatches = string.IsNullOrWhiteSpace(vin)
            ? new List<GarageVehicleSummary>()
            : vehicles.Where(vehicle => string.Equals(vehicle.Vin, vin, StringComparison.OrdinalIgnoreCase)).ToList();
        var vinMatch = vinMatches.Count == 1 ? vinMatches[0] : null;

        if (vinMatch is not null)
        {
            if (paired is not null && paired.Id != vinMatch.Id)
            {
                await TouchObdDeviceAsync(connectionString, deviceId, apiTokenId, deviceName, vin, null, null);
                return new VehicleAssociationResolution(
                    deviceId, vin, null, null, "vin-conflict", null, vinMatch.Id, vinMatch.Name);
            }

            await TouchObdDeviceAsync(connectionString, deviceId, apiTokenId, deviceName, vin, vinMatch.Id, "vin");
            return new VehicleAssociationResolution(
                deviceId, vin, vinMatch.Id, vinMatch.Name,
                paired is null ? "matched-by-vin" : "matched-vin-and-device",
                "vin", null, null);
        }

        if (!string.IsNullOrWhiteSpace(vin))
        {
            await TouchObdDeviceAsync(connectionString, deviceId, apiTokenId, deviceName, vin, null, null);
            return new VehicleAssociationResolution(
                deviceId, vin, null, null,
                vinMatches.Count > 1 ? "vin-ambiguous" : "vin-not-found",
                null, null, null);
        }

        if (paired is not null)
        {
            await TouchObdDeviceAsync(connectionString, deviceId, apiTokenId, deviceName, null, paired.Id, existing?.AssociationSource ?? "device");
            return new VehicleAssociationResolution(
                deviceId, null, paired.Id, paired.Name, "matched-by-device", "device", null, null);
        }

        await TouchObdDeviceAsync(connectionString, deviceId, apiTokenId, deviceName, null, null, null);
        return new VehicleAssociationResolution(
            deviceId, null, null, null, "needs-vehicle-selection", null, null, null);
    }

    private static async Task<double?> ReadHighestPendingCandidateAsync(
        string connectionString,
        string vehicleId,
        string? deviceId)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT MAX(CandidateOdometer)
            FROM TelemetryTripAssociations
            WHERE VehicleId = $vehicleId
              AND ($deviceId IS NULL OR DeviceId = $deviceId)
              AND OdometerStatus = 'pending';
            """;
        command.Parameters.AddWithValue("$vehicleId", vehicleId);
        command.Parameters.AddWithValue("$deviceId", (object?)deviceId ?? DBNull.Value);
        var value = await command.ExecuteScalarAsync();
        return value is null or DBNull ? null : Convert.ToDouble(value, CultureInfo.InvariantCulture);
    }

    private static async Task<OdometerProposalResult> StoreTripAssociationAsync(
        string connectionString,
        string tripId,
        VehicleAssociationResolution association,
        DateTimeOffset endedAt,
        double distanceMiles,
        double? endOdometer)
    {
        double? baselineMileage = null;
        double? candidate = null;
        string? candidateSource = null;
        var odometerStatus = "waiting-for-vehicle";

        if (!string.IsNullOrWhiteSpace(association.VehicleId))
        {
            var vehicles = await ReadVehicleSummariesAsync(connectionString);
            var vehicle = vehicles.FirstOrDefault(item => item.Id == association.VehicleId);
            if (vehicle is not null)
            {
                baselineMileage = vehicle.Mileage;
                if (endOdometer.HasValue && endOdometer.Value > 0)
                {
                    candidate = endOdometer.Value;
                    candidateSource = "direct-obd";
                }
                else if (distanceMiles > 0)
                {
                    var pending = await ReadHighestPendingCandidateAsync(
                        connectionString,
                        vehicle.Id,
                        association.DeviceId);
                    baselineMileage = Math.Max(vehicle.Mileage, pending ?? vehicle.Mileage);
                    candidate = baselineMileage.Value + distanceMiles;
                    candidateSource = "estimated-from-trip";
                }

                if (candidate.HasValue)
                    odometerStatus = candidate.Value <= vehicle.Mileage + 0.01 ? "covered" : "pending";
                else
                    odometerStatus = "unavailable";
            }
        }

        var now = DateTimeOffset.UtcNow;
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO TelemetryTripAssociations
                (TripId, DeviceId, Vin, VehicleId, SuggestedVehicleId, AssociationStatus,
                 AssociationMethod, BaselineMileage, CandidateOdometer, CandidateSource,
                 OdometerStatus, CreatedUtc, UpdatedUtc, AppliedUtc, DismissedUtc)
            VALUES
                ($tripId, $deviceId, $vin, $vehicleId, $suggestedVehicleId, $associationStatus,
                 $associationMethod, $baselineMileage, $candidateOdometer, $candidateSource,
                 $odometerStatus, $now, $now, NULL, NULL)
            ON CONFLICT(TripId) DO UPDATE SET
                DeviceId = excluded.DeviceId,
                Vin = excluded.Vin,
                VehicleId = excluded.VehicleId,
                SuggestedVehicleId = excluded.SuggestedVehicleId,
                AssociationStatus = excluded.AssociationStatus,
                AssociationMethod = excluded.AssociationMethod,
                BaselineMileage = excluded.BaselineMileage,
                CandidateOdometer = excluded.CandidateOdometer,
                CandidateSource = excluded.CandidateSource,
                OdometerStatus = excluded.OdometerStatus,
                UpdatedUtc = excluded.UpdatedUtc
            WHERE TelemetryTripAssociations.OdometerStatus NOT IN ('applied', 'dismissed');
            """;
        command.Parameters.AddWithValue("$tripId", tripId);
        command.Parameters.AddWithValue("$deviceId", (object?)association.DeviceId ?? DBNull.Value);
        command.Parameters.AddWithValue("$vin", (object?)association.Vin ?? DBNull.Value);
        command.Parameters.AddWithValue("$vehicleId", (object?)association.VehicleId ?? DBNull.Value);
        command.Parameters.AddWithValue("$suggestedVehicleId", (object?)association.SuggestedVehicleId ?? DBNull.Value);
        command.Parameters.AddWithValue("$associationStatus", association.Status);
        command.Parameters.AddWithValue("$associationMethod", (object?)association.Method ?? DBNull.Value);
        command.Parameters.AddWithValue("$baselineMileage", baselineMileage.HasValue ? baselineMileage.Value : DBNull.Value);
        command.Parameters.AddWithValue("$candidateOdometer", candidate.HasValue ? candidate.Value : DBNull.Value);
        command.Parameters.AddWithValue("$candidateSource", (object?)candidateSource ?? DBNull.Value);
        command.Parameters.AddWithValue("$odometerStatus", odometerStatus);
        command.Parameters.AddWithValue("$now", now.ToString("O"));
        await command.ExecuteNonQueryAsync();

        return new OdometerProposalResult(odometerStatus, baselineMileage, candidate, candidateSource);
    }

    private static async Task<List<ObdDeviceDto>> ReadObdDevicesAsync(
        string connectionString,
        IReadOnlyList<GarageVehicleSummary> vehicles)
    {
        var result = new List<ObdDeviceDto>();
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT DeviceId, DisplayName, LastVin, VehicleId, AssociationSource,
                   CreatedUtc, LastSeenUtc, LastAssociationUtc, TrustedVehicleId,
                   AutoApproveMileage, TrustedUtc
            FROM ObdDevices
            ORDER BY LastSeenUtc DESC;
            """;

        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var vehicleId = reader.IsDBNull(3) ? null : reader.GetString(3);
            var vehicle = vehicleId is null ? null : vehicles.FirstOrDefault(item => item.Id == vehicleId);
            var trustedVehicleId = reader.IsDBNull(8) ? null : reader.GetString(8);
            var isTrusted = vehicleId is not null
                && string.Equals(trustedVehicleId, vehicleId, StringComparison.Ordinal);
            var autoApproveMileage = isTrusted && !reader.IsDBNull(9) && reader.GetInt32(9) == 1;
            result.Add(new ObdDeviceDto(
                reader.GetString(0),
                reader.IsDBNull(1) ? "GarageLog OBD" : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                vehicleId,
                vehicle?.Name,
                reader.IsDBNull(4) ? null : reader.GetString(4),
                DateTimeOffset.Parse(reader.GetString(5)),
                DateTimeOffset.Parse(reader.GetString(6)),
                reader.IsDBNull(7) ? null : DateTimeOffset.Parse(reader.GetString(7)),
                isTrusted,
                autoApproveMileage,
                isTrusted && !reader.IsDBNull(10) ? DateTimeOffset.Parse(reader.GetString(10)) : null));
        }
        return result;
    }

    private static async Task<List<OdometerProposalDto>> ReadOdometerProposalsAsync(
        string connectionString,
        IReadOnlyList<GarageVehicleSummary> vehicles)
    {
        var result = new List<OdometerProposalDto>();
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT a.TripId, a.DeviceId, a.VehicleId, a.AssociationStatus,
                   a.BaselineMileage, a.CandidateOdometer, a.CandidateSource,
                   a.OdometerStatus, a.AppliedUtc, a.DismissedUtc,
                   t.EndedAt, t.DistanceMiles
            FROM TelemetryTripAssociations a
            JOIN TelemetryTrips t ON t.Id = a.TripId
            WHERE a.CandidateOdometer IS NOT NULL
            ORDER BY t.EndedAt DESC
            LIMIT 100;
            """;

        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var vehicleId = reader.IsDBNull(2) ? null : reader.GetString(2);
            var vehicle = vehicleId is null ? null : vehicles.FirstOrDefault(item => item.Id == vehicleId);
            var candidate = reader.IsDBNull(5) ? (double?)null : reader.GetDouble(5);
            var storedStatus = reader.GetString(7);
            var effectiveStatus = storedStatus;
            if (storedStatus == "pending" && candidate.HasValue && vehicle is not null && candidate.Value <= vehicle.Mileage + 0.01)
                effectiveStatus = "covered-by-current-reading";

            result.Add(new OdometerProposalDto(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                vehicleId,
                vehicle?.Name,
                reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetDouble(4),
                candidate,
                reader.IsDBNull(6) ? null : reader.GetString(6),
                storedStatus,
                effectiveStatus,
                vehicle?.Mileage,
                DateTimeOffset.Parse(reader.GetString(10)),
                reader.GetDouble(11),
                reader.IsDBNull(8) ? null : DateTimeOffset.Parse(reader.GetString(8)),
                reader.IsDBNull(9) ? null : DateTimeOffset.Parse(reader.GetString(9))));
        }
        return result;
    }

    private static async Task<OdometerApplyResult> ApplyOdometerProposalAsync(
        string connectionString,
        string tripId)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        string? vehicleId;
        string? deviceId;
        double? candidate;
        DateTimeOffset endedAt;

        await using (var proposal = connection.CreateCommand())
        {
            proposal.Transaction = (SqliteTransaction)transaction;
            proposal.CommandText = """
                SELECT a.VehicleId, a.DeviceId, a.CandidateOdometer, t.EndedAt
                FROM TelemetryTripAssociations a
                JOIN TelemetryTrips t ON t.Id = a.TripId
                WHERE a.TripId = $tripId
                  AND a.CandidateOdometer IS NOT NULL
                  AND a.OdometerStatus NOT IN ('applied', 'dismissed')
                LIMIT 1;
                """;
            proposal.Parameters.AddWithValue("$tripId", tripId);
            await using var reader = await proposal.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
                return new OdometerApplyResult(false, false, null, null, null, "The odometer proposal is no longer available.");
            vehicleId = reader.IsDBNull(0) ? null : reader.GetString(0);
            deviceId = reader.IsDBNull(1) ? null : reader.GetString(1);
            candidate = reader.IsDBNull(2) ? null : reader.GetDouble(2);
            endedAt = DateTimeOffset.Parse(reader.GetString(3));
        }

        if (string.IsNullOrWhiteSpace(vehicleId) || !candidate.HasValue)
            return new OdometerApplyResult(false, false, vehicleId, null, candidate, "The trip is not associated with a GarageLog vehicle.");

        string stateJson;
        await using (var stateCommand = connection.CreateCommand())
        {
            stateCommand.Transaction = (SqliteTransaction)transaction;
            stateCommand.CommandText = "SELECT Json FROM AppState WHERE Id = 1;";
            stateJson = await stateCommand.ExecuteScalarAsync() as string ?? "{}";
        }

        var root = JsonNode.Parse(stateJson) as JsonObject ?? new JsonObject();
        var vehicles = root["vehicles"] as JsonArray ?? new JsonArray();
        var vehicle = vehicles.OfType<JsonObject>().FirstOrDefault(item => JsonString(item["id"]) == vehicleId);
        if (vehicle is null)
            return new OdometerApplyResult(false, false, vehicleId, null, candidate, "The GarageLog vehicle no longer exists.");

        var currentMileage = JsonDouble(vehicle["mileage"]);
        var now = DateTimeOffset.UtcNow;

        if (candidate.Value <= currentMileage + 0.01)
        {
            await using var covered = connection.CreateCommand();
            covered.Transaction = (SqliteTransaction)transaction;
            covered.CommandText = """
                UPDATE TelemetryTripAssociations
                SET OdometerStatus = 'covered', UpdatedUtc = $now
                WHERE TripId = $tripId;
                """;
            covered.Parameters.AddWithValue("$now", now.ToString("O"));
            covered.Parameters.AddWithValue("$tripId", tripId);
            await covered.ExecuteNonQueryAsync();
            await transaction.CommitAsync();
            return new OdometerApplyResult(
                true, false, vehicleId, currentMileage, currentMileage,
                "The current GarageLog odometer is already equal to or newer than this OBD proposal. No mileage was changed.");
        }

        vehicle["mileage"] = candidate.Value;
        var history = vehicle["mileageHistory"] as JsonArray;
        if (history is null)
        {
            history = new JsonArray();
            vehicle["mileageHistory"] = history;
        }
        var deviceLabel = string.IsNullOrWhiteSpace(deviceId)
            ? "GarageLog OBD"
            : $"GarageLog OBD ({deviceId[..Math.Min(10, deviceId.Length)]})";
        history.Add(new JsonObject
        {
            ["date"] = endedAt.ToString("O"),
            ["mileage"] = candidate.Value,
            ["source"] = deviceLabel
        });

        if (JsonString(root["activeVehicleId"]) == vehicleId)
        {
            root["mileage"] = candidate.Value;
            root["mileageHistory"] = history.DeepClone();
            root["vehicle"] = vehicle.DeepClone();
        }

        await using (var updateState = connection.CreateCommand())
        {
            updateState.Transaction = (SqliteTransaction)transaction;
            updateState.CommandText = """
                UPDATE AppState
                SET Json = $json, UpdatedUtc = $updatedUtc
                WHERE Id = 1;
                """;
            updateState.Parameters.AddWithValue("$json", root.ToJsonString(new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                WriteIndented = true
            }));
            updateState.Parameters.AddWithValue("$updatedUtc", now.ToString("O"));
            await updateState.ExecuteNonQueryAsync();
        }

        await using (var applied = connection.CreateCommand())
        {
            applied.Transaction = (SqliteTransaction)transaction;
            applied.CommandText = """
                UPDATE TelemetryTripAssociations
                SET OdometerStatus = 'applied', AppliedUtc = $now, UpdatedUtc = $now
                WHERE TripId = $tripId;
                """;
            applied.Parameters.AddWithValue("$now", now.ToString("O"));
            applied.Parameters.AddWithValue("$tripId", tripId);
            await applied.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();
        return new OdometerApplyResult(
            true, true, vehicleId, currentMileage, candidate.Value,
            $"GarageLog odometer updated from {currentMileage:0.0} to {candidate.Value:0.0} miles.");
    }

    private static async Task<bool> DismissOdometerProposalAsync(
        string connectionString,
        string tripId)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE TelemetryTripAssociations
            SET OdometerStatus = 'dismissed', DismissedUtc = $now, UpdatedUtc = $now
            WHERE TripId = $tripId
              AND OdometerStatus NOT IN ('applied', 'dismissed');
            """;
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$tripId", tripId);
        return await command.ExecuteNonQueryAsync() > 0;
    }

    private static async Task<MobileMileageApplyResult> ApplyManualMileageAsync(
        string connectionString,
        string vehicleId,
        double mileage,
        DateTimeOffset recordedUtc,
        string source,
        bool isCorrection)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        string stateJson;
        await using (var stateCommand = connection.CreateCommand())
        {
            stateCommand.Transaction = (SqliteTransaction)transaction;
            stateCommand.CommandText = "SELECT Json FROM AppState WHERE Id = 1;";
            stateJson = await stateCommand.ExecuteScalarAsync() as string ?? "{}";
        }

        var root = JsonNode.Parse(stateJson) as JsonObject ?? new JsonObject();
        var vehicles = root["vehicles"] as JsonArray ?? new JsonArray();
        var vehicle = vehicles.OfType<JsonObject>()
            .FirstOrDefault(item => string.Equals(JsonString(item["id"]), vehicleId, StringComparison.Ordinal));
        if (vehicle is null)
            return new MobileMileageApplyResult(false, false, false, vehicleId, null, null, null, "The GarageLog vehicle no longer exists.");

        var lifecycle = JsonString(vehicle["lifecycleStatus"]);
        if (lifecycle is "Sold" or "Decommissioned")
            return new MobileMileageApplyResult(false, false, false, vehicleId, VehicleDisplayName(vehicle), null, null, "Archived vehicles cannot receive mobile mileage updates.");

        var vehicleName = VehicleDisplayName(vehicle);
        var currentMileage = JsonDouble(vehicle["mileage"]);

        if (mileage + 0.01 < currentMileage && !isCorrection)
        {
            return new MobileMileageApplyResult(
                true,
                false,
                false,
                vehicleId,
                vehicleName,
                currentMileage,
                currentMileage,
                $"The entered mileage ({mileage:0.#}) is lower than the current GarageLog mileage ({currentMileage:0.#}). Confirm it as a correction to continue.");
        }

        if (Math.Abs(mileage - currentMileage) <= 0.01)
        {
            await transaction.CommitAsync();
            return new MobileMileageApplyResult(
                true,
                true,
                false,
                vehicleId,
                vehicleName,
                currentMileage,
                currentMileage,
                "GarageLog already has this odometer reading.");
        }

        vehicle["mileage"] = mileage;
        var history = vehicle["mileageHistory"] as JsonArray;
        if (history is null)
        {
            history = new JsonArray();
            vehicle["mileageHistory"] = history;
        }

        var historyEntry = new JsonObject
        {
            ["date"] = recordedUtc.ToString("O"),
            ["mileage"] = mileage,
            ["source"] = isCorrection ? $"{source} correction" : source,
            ["kind"] = "manual"
        };
        if (isCorrection)
            historyEntry["correction"] = true;
        history.Add(historyEntry);

        if (string.Equals(JsonString(root["activeVehicleId"]), vehicleId, StringComparison.Ordinal))
        {
            root["mileage"] = mileage;
            root["mileageHistory"] = history.DeepClone();
            root["vehicle"] = vehicle.DeepClone();
        }

        await using (var updateState = connection.CreateCommand())
        {
            updateState.Transaction = (SqliteTransaction)transaction;
            updateState.CommandText = """
                UPDATE AppState
                SET Json = $json, UpdatedUtc = $updatedUtc
                WHERE Id = 1;
                """;
            updateState.Parameters.AddWithValue("$json", root.ToJsonString(new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                WriteIndented = true
            }));
            updateState.Parameters.AddWithValue("$updatedUtc", DateTimeOffset.UtcNow.ToString("O"));
            await updateState.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();
        return new MobileMileageApplyResult(
            true,
            true,
            true,
            vehicleId,
            vehicleName,
            currentMileage,
            mileage,
            isCorrection
                ? $"GarageLog mileage corrected from {currentMileage:0.#} to {mileage:0.#} miles."
                : $"GarageLog mileage updated from {currentMileage:0.#} to {mileage:0.#} miles.");
    }

    private static async Task<bool> CreatePendingMobileReceiptAsync(
        string connectionString,
        string documentId,
        string vehicleId,
        string vehicleName,
        string storedName,
        string originalName,
        string extension,
        string contentType,
        long bytes,
        DateTimeOffset capturedUtc,
        string tokenName,
        string captureType)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        string stateJson;
        await using (var stateCommand = connection.CreateCommand())
        {
            stateCommand.Transaction = (SqliteTransaction)transaction;
            stateCommand.CommandText = "SELECT Json FROM AppState WHERE Id = 1;";
            stateJson = await stateCommand.ExecuteScalarAsync() as string ?? "{}";
        }

        var root = JsonNode.Parse(stateJson) as JsonObject ?? new JsonObject();
        var vehicles = root["vehicles"] as JsonArray ?? new JsonArray();
        var vehicleExists = vehicles.OfType<JsonObject>().Any(item =>
            string.Equals(JsonString(item["id"]), vehicleId, StringComparison.Ordinal));
        if (!vehicleExists)
            return false;

        var documents = root["documents"] as JsonArray;
        if (documents is null)
        {
            documents = new JsonArray();
            root["documents"] = documents;
        }

        var now = DateTimeOffset.UtcNow;
        var receiptName = captureType == "pump"
            ? $"Fuel Pump - {capturedUtc:MMM d, yyyy}"
            : $"Fuel Receipt - {capturedUtc:MMM d, yyyy}";
        var document = new JsonObject
        {
            ["id"] = documentId,
            ["vehicleId"] = vehicleId,
            ["name"] = receiptName,
            ["originalName"] = originalName,
            ["extension"] = extension.TrimStart('.'),
            ["contentType"] = contentType,
            ["category"] = "Receipts",
            ["tags"] = captureType == "pump"
                ? new JsonArray("fuel", "receipt", "mobile", "pump-display")
                : new JsonArray("fuel", "receipt", "mobile"),
            ["services"] = new JsonArray("Fuel"),
            ["shop"] = "",
            ["startsOn"] = null,
            ["expiresOn"] = null,
            ["date"] = capturedUtc.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            ["addedAt"] = now.ToString("O"),
            ["capturedUtc"] = capturedUtc.ToString("O"),
            ["bytes"] = bytes,
            ["size"] = FormatFileSize(bytes),
            ["storedName"] = storedName,
            ["lastViewedAt"] = null,
            ["ocrStatus"] = "indexing",
            ["ocrText"] = "",
            ["linkedExpenseId"] = null,
            ["reviewStatus"] = "Pending",
            ["source"] = "GarageLog Mobile",
            ["mobileCapture"] = true,
            ["mobileCaptureType"] = captureType,
            ["uploadedByToken"] = tokenName,
            ["vehicleNameAtCapture"] = vehicleName,
            ["receiptOcr"] = new JsonObject
            {
                ["status"] = "processing",
                ["captureType"] = captureType,
                ["gallons"] = null,
                ["amount"] = null,
                ["merchant"] = null,
                ["pricePerGallon"] = null
            }
        };
        documents.Insert(0, document);

        await using var update = connection.CreateCommand();
        update.Transaction = (SqliteTransaction)transaction;
        update.CommandText = """
            UPDATE AppState
            SET Json = $json, UpdatedUtc = $updatedUtc
            WHERE Id = 1;
            """;
        update.Parameters.AddWithValue("$json", root.ToJsonString(new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true
        }));
        update.Parameters.AddWithValue("$updatedUtc", now.ToString("O"));
        var changed = await update.ExecuteNonQueryAsync() > 0;

        await transaction.CommitAsync();
        return changed;
    }

    private static async Task UpdateMobileReceiptOcrAsync(
        string connectionString,
        string documentId,
        string documentOcrStatus,
        string rawOcrStatus,
        string? ocrText,
        FuelReceiptExtraction extraction)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        string stateJson;
        await using (var stateCommand = connection.CreateCommand())
        {
            stateCommand.Transaction = (SqliteTransaction)transaction;
            stateCommand.CommandText = "SELECT Json FROM AppState WHERE Id = 1;";
            stateJson = await stateCommand.ExecuteScalarAsync() as string ?? "{}";
        }

        var root = JsonNode.Parse(stateJson) as JsonObject ?? new JsonObject();
        var documents = root["documents"] as JsonArray ?? new JsonArray();
        var document = documents.OfType<JsonObject>().FirstOrDefault(item =>
            string.Equals(JsonString(item["id"]), documentId, StringComparison.Ordinal));
        if (document is null)
        {
            await transaction.CommitAsync();
            return;
        }

        var now = DateTimeOffset.UtcNow;
        document["ocrStatus"] = documentOcrStatus;
        document["ocrText"] = ocrText ?? "";
        document["ocrMethod"] = rawOcrStatus == "complete" ? "image-ocr" : rawOcrStatus;
        document["ocrIndexedAt"] = now.ToString("O");
        document["ocrError"] = rawOcrStatus switch
        {
            "unavailable" => "Tesseract OCR is not available on the GarageLog host.",
            "timeout" => "Receipt OCR timed out.",
            "failed" => "Receipt OCR could not read the image.",
            _ => ""
        };
        if (!string.IsNullOrWhiteSpace(extraction.Merchant))
            document["shop"] = extraction.Merchant;

        var captureType = JsonString(document["mobileCaptureType"]);
        document["receiptOcr"] = new JsonObject
        {
            ["status"] = rawOcrStatus,
            ["captureType"] = string.IsNullOrWhiteSpace(captureType) ? "receipt" : captureType,
            ["confidence"] = extraction.Confidence,
            ["gallons"] = extraction.Gallons,
            ["amount"] = extraction.Amount,
            ["merchant"] = extraction.Merchant,
            ["pricePerGallon"] = extraction.PricePerGallon,
            ["updatedUtc"] = now.ToString("O")
        };

        await using var update = connection.CreateCommand();
        update.Transaction = (SqliteTransaction)transaction;
        update.CommandText = """
            UPDATE AppState
            SET Json = $json, UpdatedUtc = $updatedUtc
            WHERE Id = 1;
            """;
        update.Parameters.AddWithValue("$json", root.ToJsonString(new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true
        }));
        update.Parameters.AddWithValue("$updatedUtc", now.ToString("O"));
        await update.ExecuteNonQueryAsync();
        await transaction.CommitAsync();
    }

    private static async Task<bool> MobileReceiptExistsAsync(string connectionString, string documentId)
    {
        var root = await ReadGarageStateAsync(connectionString);
        return (root["documents"] as JsonArray ?? new JsonArray())
            .OfType<JsonObject>()
            .Any(item => string.Equals(JsonString(item["id"]), documentId, StringComparison.Ordinal));
    }

    private static async Task<bool> HasExpectedReceiptImageSignatureAsync(Stream stream, string extension)
    {
        if (!stream.CanRead)
            return false;

        var buffer = new byte[12];
        var read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length));
        if (stream.CanSeek) stream.Position = 0;

        if (extension == ".jpg")
            return read >= 3 && buffer[0] == 0xFF && buffer[1] == 0xD8 && buffer[2] == 0xFF;

        if (extension == ".png")
        {
            byte[] expected = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
            return read >= expected.Length && expected.SequenceEqual(buffer.Take(expected.Length));
        }

        return false;
    }

    private static FuelReceiptExtraction ExtractPumpDisplayDetails(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return new FuelReceiptExtraction(null, null, null, null, null);

        var labeledGallons = ExtractGallons(text);
        var labeledAmount = ExtractReceiptAmount(text);

        decimal? amount = labeledAmount.Amount;
        if (!amount.HasValue)
        {
            var currencyMatches = Regex.Matches(
                    text,
                    @"(?<!\d)\$\s*(?<n>\d{1,4}(?:\.\d{2}))(?!\d)",
                    RegexOptions.CultureInvariant)
                .Select(match => ParsePumpNumber(match.Groups["n"].Value))
                .Where(value => value is > 0m and <= 1000m)
                .Select(value => value!.Value)
                .Distinct()
                .ToList();

            if (currencyMatches.Count == 1)
                amount = currencyMatches[0];
        }

        decimal? gallons = labeledGallons.Gallons;
        if (!gallons.HasValue)
        {
            var gallonCandidates = Regex.Matches(
                    text,
                    @"(?<!\d)(?<n>\d{1,3}[.,]\d{3,4})(?!\d)",
                    RegexOptions.CultureInvariant)
                .Select(match => ParsePumpNumber(match.Groups["n"].Value))
                .Where(value => value is > 0.05m and <= 200m)
                .Select(value => value!.Value)
                .Distinct()
                .ToList();

            // Do not guess between multiple three/four-decimal values because a
            // pump may also show price-per-gallon using the same number format.
            if (gallonCandidates.Count == 1)
                gallons = gallonCandidates[0];
        }

        if (!amount.HasValue)
        {
            var amountCandidates = Regex.Matches(
                    text,
                    @"(?<!\d)(?<n>\d{1,4}[.,]\d{2})(?!\d)",
                    RegexOptions.CultureInvariant)
                .Select(match => ParsePumpNumber(match.Groups["n"].Value))
                .Where(value => value is >= 1m and <= 1000m)
                .Select(value => value!.Value)
                .Where(value => !gallons.HasValue || value != gallons.Value)
                .Distinct()
                .ToList();

            if (amountCandidates.Count == 1)
                amount = amountCandidates[0];
        }

        decimal? pricePerGallon = null;
        if (amount.HasValue && gallons.HasValue && gallons.Value > 0)
        {
            var calculated = amount.Value / gallons.Value;
            if (calculated is >= 0.25m and <= 25m)
                pricePerGallon = decimal.Round(calculated, 3);
            else
            {
                // An impossible price means at least one unlabeled OCR guess is
                // wrong. Preserve only values backed by an explicit label.
                if (!labeledAmount.Amount.HasValue)
                    amount = null;
                if (!labeledGallons.Gallons.HasValue)
                    gallons = null;
            }
        }

        var confidence =
            labeledAmount.Confidence == "high" || labeledGallons.Confidence == "high"
                ? "high"
                : amount.HasValue || gallons.HasValue
                    ? "low"
                    : null;

        return new FuelReceiptExtraction(
            gallons,
            amount,
            null,
            pricePerGallon,
            confidence);
    }

    private static decimal? ParsePumpNumber(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var normalized = value.Trim().Replace(',', '.');
        return decimal.TryParse(
                normalized,
                NumberStyles.Number,
                CultureInfo.InvariantCulture,
                out var parsed)
            ? parsed
            : null;
    }

    private static FuelReceiptExtraction ExtractFuelReceiptDetails(string? text)
    {
        var gallonsResult = ExtractGallons(text);
        var amountResult = ExtractReceiptAmount(text);
        var priceResult = ExtractPricePerGallon(text);
        var merchant = ExtractReceiptMerchant(text);

        var confidence = gallonsResult.Confidence == "high" || amountResult.Confidence == "high"
            ? "high"
            : gallonsResult.Gallons.HasValue || amountResult.Amount.HasValue
                ? "low"
                : null;

        return new FuelReceiptExtraction(
            gallonsResult.Gallons,
            amountResult.Amount,
            merchant,
            priceResult,
            confidence);
    }

    private static (decimal? Amount, string? Confidence) ExtractReceiptAmount(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return (null, null);

        var patterns = new[]
        {
            @"(?im)^\s*(?:grand\s+total|total|amount\s+due|sale\s+total)\s*[:=\-]?\s*\$?\s*(?<n>\d{1,6}(?:\.\d{2}))\b",
            @"(?im)\b(?:grand\s+total|amount\s+due)\b[^\d$]{0,14}\$?\s*(?<n>\d{1,6}(?:\.\d{2}))\b"
        };

        foreach (var pattern in patterns)
        {
            var match = Regex.Match(text, pattern, RegexOptions.CultureInvariant);
            if (!match.Success)
                continue;
            if (decimal.TryParse(match.Groups["n"].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount)
                && amount > 0 && amount <= 100_000)
                return (amount, "high");
        }

        return (null, null);
    }

    private static decimal? ExtractPricePerGallon(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;

        var patterns = new[]
        {
            @"(?im)(?:price\s*(?:/|per)\s*gal(?:lon)?|unit\s+price|price)\s*[:=\-]?\s*\$?\s*(?<n>\d{1,2}(?:\.\d{2,4}))",
            @"(?im)\$?\s*(?<n>\d{1,2}(?:\.\d{2,4}))\s*(?:/gal|per\s+gal(?:lon)?)"
        };

        foreach (var pattern in patterns)
        {
            var match = Regex.Match(text, pattern, RegexOptions.CultureInvariant);
            if (!match.Success)
                continue;
            if (decimal.TryParse(match.Groups["n"].Value, NumberStyles.Number, CultureInfo.InvariantCulture, out var price)
                && price > 0.25m && price < 25m)
                return price;
        }

        return null;
    }

    private static string? ExtractReceiptMerchant(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;

        foreach (var raw in text.Split('\n').Take(10))
        {
            var line = Regex.Replace(raw.Trim(), @"\s{2,}", " ");
            if (line.Length is < 3 or > 80)
                continue;
            if (!Regex.IsMatch(line, "[A-Za-z]{3,}"))
                continue;
            if (Regex.IsMatch(line, @"(?i)^(receipt|customer\s+copy|transaction|date|time|total|amount|gallons?|fuel|pump|terminal|merchant\s+copy)\b"))
                continue;
            if (Regex.IsMatch(line, @"(?i)^\d+\s+\w+\s+(st|street|rd|road|ave|avenue|blvd|boulevard)\b"))
                continue;
            return line;
        }

        return null;
    }

    private static string VehicleDisplayName(JsonObject vehicle)
    {
        var name = JsonString(vehicle["name"]);
        if (string.IsNullOrWhiteSpace(name))
        {
            var parts = new[] { JsonString(vehicle["year"]), JsonString(vehicle["make"]), JsonString(vehicle["model"]) }
                .Where(part => !string.IsNullOrWhiteSpace(part));
            name = string.Join(" ", parts);
        }

        if (string.IsNullOrWhiteSpace(name))
            name = "GarageLog vehicle";

        var trim = JsonString(vehicle["trim"]);
        if (!string.IsNullOrWhiteSpace(trim) &&
            !name.EndsWith(trim, StringComparison.OrdinalIgnoreCase))
            name = $"{name} {trim}".Trim();

        return name;
    }

    private static string FormatFileSize(long bytes)
    {
        if (bytes >= 1024L * 1024L)
            return $"{bytes / 1024d / 1024d:0.##} MB";
        if (bytes >= 1024L)
            return $"{bytes / 1024d:0.##} KB";
        return $"{bytes} B";
    }

    private static string ResolveDataRoot(string connectionString)
    {
        try
        {
            var builder = new SqliteConnectionStringBuilder(connectionString);
            var dbPath = builder.DataSource;

            if (!Path.IsPathRooted(dbPath))
                dbPath = Path.GetFullPath(dbPath, AppContext.BaseDirectory);

            return Path.GetDirectoryName(dbPath) ?? AppContext.BaseDirectory;
        }
        catch
        {
            return Path.Combine(AppContext.BaseDirectory, "data");
        }
    }

    private static Task<(string Status, string? Text)> RunFuelOcrAsync(string imagePath) =>
        RunFuelOcrAsync(imagePath, "receipt");

    private static async Task<(string Status, string? Text)> RunFuelOcrAsync(
        string imagePath,
        string captureType)
    {
        if (!string.Equals(captureType, "pump", StringComparison.OrdinalIgnoreCase))
            return await RunTesseractPassAsync(imagePath, "6");

        // Pump LCD/LED displays are visually very different from printed receipts.
        // Run several sparse/numeric-friendly passes and combine their output so
        // the extraction logic can choose plausible amount/gallon candidates.
        var inputs = new List<string> { imagePath };
        string? processedPath = null;

        try
        {
            processedPath = await TryCreatePumpOcrImageAsync(imagePath);
            if (!string.IsNullOrWhiteSpace(processedPath))
                inputs.Add(processedPath);

            var passes = new List<Task<(string Status, string? Text)>>
            {
                RunTesseractPassAsync(imagePath, "6"),
                RunTesseractPassAsync(
                    imagePath,
                    "11",
                    "0123456789.$GgAaLlOoNnSs")
            };

            if (!string.IsNullOrWhiteSpace(processedPath))
            {
                passes.Add(RunTesseractPassAsync(processedPath, "6"));
                passes.Add(RunTesseractPassAsync(
                    processedPath,
                    "11",
                    "0123456789.$GgAaLlOoNnSs"));
            }

            var results = await Task.WhenAll(passes);
            var sawAvailableOcr = results.Any(pass => pass.Status != "unavailable");
            var outputs = results
                .Where(pass => pass.Status == "complete" && !string.IsNullOrWhiteSpace(pass.Text))
                .Select(pass => pass.Text!)
                .Distinct(StringComparer.Ordinal)
                .ToList();

            var combined = string.Join(
                Environment.NewLine + "---" + Environment.NewLine,
                outputs);

            if (!sawAvailableOcr)
                return ("unavailable", null);

            return ("complete", combined);
        }
        finally
        {
            if (!string.IsNullOrWhiteSpace(processedPath))
            {
                try { File.Delete(processedPath); } catch { }
            }
        }
    }

    private static async Task<(string Status, string? Text)> RunTesseractPassAsync(
        string imagePath,
        string pageSegmentationMode,
        string? whitelist = null)
    {
        var executable = FindTesseractExecutable();

        try
        {
            var start = new ProcessStartInfo
            {
                FileName = executable,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            start.ArgumentList.Add(imagePath);
            start.ArgumentList.Add("stdout");
            start.ArgumentList.Add("-l");
            start.ArgumentList.Add("eng");
            start.ArgumentList.Add("--psm");
            start.ArgumentList.Add(pageSegmentationMode);
            if (!string.IsNullOrWhiteSpace(whitelist))
            {
                start.ArgumentList.Add("-c");
                start.ArgumentList.Add($"tessedit_char_whitelist={whitelist}");
            }

            using var process = Process.Start(start);
            if (process is null)
                return ("unavailable", null);

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(25));
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(true); } catch { }
                return ("timeout", null);
            }

            var text = (await stdoutTask).Trim();
            _ = await stderrTask;

            return process.ExitCode == 0
                ? ("complete", text)
                : ("failed", text);
        }
        catch
        {
            return ("unavailable", null);
        }
    }

    private static async Task<string?> TryCreatePumpOcrImageAsync(string imagePath)
    {
        var executable = FindImageMagickExecutable();
        if (string.IsNullOrWhiteSpace(executable))
            return null;

        var output = Path.Combine(
            Path.GetTempPath(),
            $"garagelog-pump-ocr-{Guid.NewGuid():N}.png");

        try
        {
            var start = new ProcessStartInfo
            {
                FileName = executable,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            // Down/up sampling helps suppress photographed-screen moire before
            // contrast enhancement. Keep the original too; OCR runs against both.
            start.ArgumentList.Add(imagePath);
            start.ArgumentList.Add("-auto-orient");
            start.ArgumentList.Add("-colorspace");
            start.ArgumentList.Add("Gray");
            start.ArgumentList.Add("-resize");
            start.ArgumentList.Add("60%");
            start.ArgumentList.Add("-resize");
            start.ArgumentList.Add("330%");
            start.ArgumentList.Add("-contrast-stretch");
            start.ArgumentList.Add("3%x3%");
            start.ArgumentList.Add("-sharpen");
            start.ArgumentList.Add("0x1");
            start.ArgumentList.Add(output);

            using var process = Process.Start(start);
            if (process is null)
                return null;

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(12));
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                try { process.Kill(true); } catch { }
                return null;
            }

            return process.ExitCode == 0 && File.Exists(output)
                ? output
                : null;
        }
        catch
        {
            try { File.Delete(output); } catch { }
            return null;
        }
    }

    private static string? FindImageMagickExecutable()
    {
        var configured = Environment.GetEnvironmentVariable("GARAGELOG_IMAGEMAGICK_PATH");
        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        var candidates = OperatingSystem.IsWindows()
            ? new[]
            {
                @"C:\Program Files\ImageMagick-7.1.1-Q16-HDRI\magick.exe",
                @"C:\Program Files\ImageMagick-7.1.1-Q16\magick.exe",
                "magick.exe"
            }
            : new[]
            {
                "/usr/bin/convert",
                "/usr/local/bin/convert",
                "/usr/bin/magick",
                "/usr/local/bin/magick"
            };

        foreach (var candidate in candidates)
        {
            if (Path.IsPathRooted(candidate) && File.Exists(candidate))
                return candidate;
        }

        return OperatingSystem.IsWindows() ? "magick" : "convert";
    }

    private static string FindTesseractExecutable()
    {
        var configured = Environment.GetEnvironmentVariable("GARAGELOG_TESSERACT_PATH");

        if (!string.IsNullOrWhiteSpace(configured))
            return configured;

        var candidates = OperatingSystem.IsWindows()
            ? new[]
            {
                @"C:\Program Files\Tesseract-OCR\tesseract.exe",
                @"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"
            }
            : new[]
            {
                "/usr/bin/tesseract",
                "/usr/local/bin/tesseract"
            };

        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
                return candidate;
        }

        return "tesseract";
    }

    private static (decimal? Gallons, string? Confidence) ExtractGallons(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return (null, null);

        var labeledPatterns = new[]
        {
            @"(?im)(?:gallons?|gal)\s*[:=\-]?\s*(?<n>\d{1,3}(?:\.\d{1,4})?)",
            @"(?im)(?<n>\d{1,3}(?:\.\d{1,4})?)\s*(?:gallons?|gal)\b"
        };

        foreach (var pattern in labeledPatterns)
        {
            var match = Regex.Match(text, pattern, RegexOptions.CultureInvariant);

            if (match.Success &&
                TryGallons(match.Groups["n"].Value, out var gallons))
            {
                return (gallons, "high");
            }
        }

        // If OCR loses the label, a 3-4 decimal pump value above 4 gallons
        // is a reasonable low-confidence fallback and avoids most pump-price values.
        var candidates = Regex.Matches(text, @"\b\d{1,3}\.\d{3,4}\b")
            .Select(match => match.Value)
            .Select(value =>
                decimal.TryParse(
                    value,
                    NumberStyles.Number,
                    CultureInfo.InvariantCulture,
                    out var parsed)
                    ? parsed
                    : -1m)
            .Where(value => value > 0 && value <= 200)
            .ToList();

        var likely = candidates.FirstOrDefault(value => value >= 4m);

        return likely > 0
            ? (likely, "low")
            : (null, null);
    }

    private static bool TryGallons(string value, out decimal gallons)
    {
        if (!decimal.TryParse(
                value,
                NumberStyles.Number,
                CultureInfo.InvariantCulture,
                out gallons))
        {
            return false;
        }

        return gallons > 0 && gallons <= 200;
    }

    private static async Task InsertFuelCaptureAsync(
        string connectionString,
        string id,
        string apiTokenId,
        string imagePath,
        DateTimeOffset? capturedUtc,
        DateTimeOffset receivedUtc,
        string ocrStatus,
        string? ocrText,
        decimal? gallons,
        string? confidence)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();

        command.CommandText = """
            INSERT INTO FuelCaptures
                (Id, ApiTokenId, ImagePath, CapturedUtc, ReceivedUtc, OcrStatus, OcrText, Gallons, OcrConfidence, ConfirmedUtc)
            VALUES
                ($id, $tokenId, $imagePath, $capturedUtc, $receivedUtc, $ocrStatus, $ocrText, $gallons, $confidence, NULL);
            """;

        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$tokenId", apiTokenId);
        command.Parameters.AddWithValue("$imagePath", imagePath);
        command.Parameters.AddWithValue(
            "$capturedUtc",
            capturedUtc.HasValue
                ? capturedUtc.Value.ToString("O")
                : DBNull.Value);
        command.Parameters.AddWithValue("$receivedUtc", receivedUtc.ToString("O"));
        command.Parameters.AddWithValue("$ocrStatus", ocrStatus);
        command.Parameters.AddWithValue("$ocrText", (object?)ocrText ?? DBNull.Value);
        command.Parameters.AddWithValue(
            "$gallons",
            gallons.HasValue
                ? gallons.Value
                : DBNull.Value);
        command.Parameters.AddWithValue("$confidence", (object?)confidence ?? DBNull.Value);

        await command.ExecuteNonQueryAsync();
    }

    private static async Task<bool> ConfirmFuelGallonsAsync(
        string connectionString,
        string id,
        string apiTokenId,
        decimal gallons)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();

        command.CommandText = """
            UPDATE FuelCaptures
            SET Gallons = $gallons,
                ConfirmedUtc = $confirmedUtc
            WHERE Id = $id
              AND ApiTokenId = $tokenId;
            """;

        command.Parameters.AddWithValue("$gallons", gallons);
        command.Parameters.AddWithValue(
            "$confirmedUtc",
            DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$tokenId", apiTokenId);

        return await command.ExecuteNonQueryAsync() > 0;
    }

    private sealed record FuelGallonsConfirmRequest(decimal Gallons);

    private static bool TryResolveExpiration(
        int? expiresInDays,
        DateTimeOffset? expiresAtUtc,
        out DateTimeOffset? resolvedUtc,
        out string? error)
    {
        resolvedUtc = null;
        error = null;

        if (expiresInDays.HasValue && expiresAtUtc.HasValue)
        {
            error = "Choose either a preset expiration or a custom expiration.";
            return false;
        }

        if (expiresInDays.HasValue && expiresInDays.Value is not (30 or 90 or 365))
        {
            error = "API token expiration must be Never, 30 days, 90 days, 1 year, or a custom date/time.";
            return false;
        }

        if (expiresAtUtc.HasValue)
        {
            var customUtc = expiresAtUtc.Value.ToUniversalTime();
            if (customUtc <= DateTimeOffset.UtcNow.AddMinutes(1))
            {
                error = "Custom expiration must be at least one minute in the future.";
                return false;
            }

            resolvedUtc = customUtc;
            return true;
        }

        if (expiresInDays.HasValue)
            resolvedUtc = DateTimeOffset.UtcNow.AddDays(expiresInDays.Value);

        return true;
    }

    private static string GenerateToken()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        var payload = Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');

        return $"gl_{payload}";
    }

    private static string HashToken(string token) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static async Task<ApiTokenRecord?> AuthenticateBearerAsync(
        string connectionString,
        HttpContext context,
        string requiredScope)
    {
        var authorization = context.Request.Headers.Authorization.ToString();
        if (!authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return null;

        var rawToken = authorization["Bearer ".Length..].Trim();
        if (rawToken.Length is < 20 or > 256 || !rawToken.StartsWith("gl_", StringComparison.Ordinal))
            return null;

        var token = await FindByHashAsync(connectionString, HashToken(rawToken));
        if (token is null)
            return null;

        var now = DateTimeOffset.UtcNow;
        if (token.RevokedUtc.HasValue || (token.ExpiresUtc.HasValue && token.ExpiresUtc.Value <= now))
            return null;

        if (!token.Scopes.Contains(requiredScope, StringComparer.Ordinal))
            return null;

        await TouchTokenAsync(connectionString, token.Id, now);
        return token with { LastUsedUtc = now };
    }

    private static async Task InsertTokenAsync(string connectionString, ApiTokenRecord token)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();

        command.CommandText = """
            INSERT INTO ApiTokens
                (Id, Name, TokenHash, TokenPrefix, ScopesJson, CreatedByUserId, CreatedUtc, ExpiresUtc, RevokedUtc, LastUsedUtc)
            VALUES
                ($id, $name, $tokenHash, $tokenPrefix, $scopesJson, $createdByUserId, $createdUtc, $expiresUtc, NULL, NULL);
            """;

        command.Parameters.AddWithValue("$id", token.Id);
        command.Parameters.AddWithValue("$name", token.Name);
        command.Parameters.AddWithValue("$tokenHash", token.TokenHash);
        command.Parameters.AddWithValue("$tokenPrefix", token.TokenPrefix);
        command.Parameters.AddWithValue("$scopesJson", JsonSerializer.Serialize(token.Scopes));
        command.Parameters.AddWithValue("$createdByUserId", (object?)token.CreatedByUserId ?? DBNull.Value);
        command.Parameters.AddWithValue("$createdUtc", token.CreatedUtc.ToString("O"));
        command.Parameters.AddWithValue("$expiresUtc", token.ExpiresUtc.HasValue ? token.ExpiresUtc.Value.ToString("O") : DBNull.Value);

        await command.ExecuteNonQueryAsync();
    }

    private static async Task<List<ApiTokenDto>> ReadTokensAsync(string connectionString)
    {
        var result = new List<ApiTokenDto>();

        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();

        command.CommandText = """
            SELECT
                t.Id,
                t.Name,
                t.TokenHash,
                t.TokenPrefix,
                t.ScopesJson,
                t.CreatedByUserId,
                u.DisplayName,
                t.CreatedUtc,
                t.ExpiresUtc,
                t.RevokedUtc,
                t.LastUsedUtc
            FROM ApiTokens t
            LEFT JOIN Users u ON u.Id = t.CreatedByUserId
            ORDER BY t.CreatedUtc DESC;
            """;

        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var record = ReadRecord(reader);
            result.Add(ToDto(record));
        }

        return result;
    }

    private static async Task<ApiTokenRecord?> FindByHashAsync(string connectionString, string tokenHash)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();

        command.CommandText = """
            SELECT
                t.Id,
                t.Name,
                t.TokenHash,
                t.TokenPrefix,
                t.ScopesJson,
                t.CreatedByUserId,
                u.DisplayName,
                t.CreatedUtc,
                t.ExpiresUtc,
                t.RevokedUtc,
                t.LastUsedUtc
            FROM ApiTokens t
            LEFT JOIN Users u ON u.Id = t.CreatedByUserId
            WHERE t.TokenHash = $tokenHash
            LIMIT 1;
            """;

        command.Parameters.AddWithValue("$tokenHash", tokenHash);

        await using var reader = await command.ExecuteReaderAsync();
        return await reader.ReadAsync() ? ReadRecord(reader) : null;
    }

    private static ApiTokenRecord ReadRecord(SqliteDataReader reader)
    {
        string[] scopes;
        try
        {
            scopes = JsonSerializer.Deserialize<string[]>(reader.GetString(4)) ?? Array.Empty<string>();
        }
        catch
        {
            scopes = Array.Empty<string>();
        }

        return new ApiTokenRecord(
            Id: reader.GetString(0),
            Name: reader.GetString(1),
            TokenHash: reader.GetString(2),
            TokenPrefix: reader.GetString(3),
            Scopes: scopes,
            CreatedByUserId: reader.IsDBNull(5) ? null : reader.GetString(5),
            CreatedBy: reader.IsDBNull(6) ? null : reader.GetString(6),
            CreatedUtc: DateTimeOffset.Parse(reader.GetString(7)),
            ExpiresUtc: reader.IsDBNull(8) ? null : DateTimeOffset.Parse(reader.GetString(8)),
            RevokedUtc: reader.IsDBNull(9) ? null : DateTimeOffset.Parse(reader.GetString(9)),
            LastUsedUtc: reader.IsDBNull(10) ? null : DateTimeOffset.Parse(reader.GetString(10)));
    }

    private static async Task<bool> RevokeTokenAsync(string connectionString, string id)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();

        command.CommandText = """
            UPDATE ApiTokens
            SET RevokedUtc = COALESCE(RevokedUtc, $now)
            WHERE Id = $id;
            """;

        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        return await command.ExecuteNonQueryAsync() > 0;
    }

    private static async Task<bool> DeleteTokenAsync(string connectionString, string id)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();

        command.CommandText = "DELETE FROM ApiTokens WHERE Id = $id;";
        command.Parameters.AddWithValue("$id", id);
        return await command.ExecuteNonQueryAsync() > 0;
    }

    private static async Task TouchTokenAsync(string connectionString, string id, DateTimeOffset usedAt)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();

        command.CommandText = """
            UPDATE ApiTokens
            SET LastUsedUtc = $usedAt
            WHERE Id = $id;
            """;

        command.Parameters.AddWithValue("$usedAt", usedAt.ToString("O"));
        command.Parameters.AddWithValue("$id", id);
        await command.ExecuteNonQueryAsync();
    }

    private static ApiTokenDto ToDto(ApiTokenRecord token)
    {
        var now = DateTimeOffset.UtcNow;
        var status = token.RevokedUtc.HasValue
            ? "Revoked"
            : token.ExpiresUtc.HasValue && token.ExpiresUtc.Value <= now
                ? "Expired"
                : "Active";

        return new ApiTokenDto(
            token.Id,
            token.Name,
            token.TokenPrefix,
            token.Scopes,
            token.CreatedBy,
            token.CreatedUtc,
            token.ExpiresUtc,
            token.RevokedUtc,
            token.LastUsedUtc,
            status);
    }

    private sealed record ApiTokenRecord(
        string Id,
        string Name,
        string TokenHash,
        string TokenPrefix,
        string[] Scopes,
        string? CreatedByUserId,
        string? CreatedBy,
        DateTimeOffset CreatedUtc,
        DateTimeOffset? ExpiresUtc,
        DateTimeOffset? RevokedUtc,
        DateTimeOffset? LastUsedUtc);
}

sealed record GarageVehicleSummary(
    string Id,
    string Name,
    string Year,
    string Make,
    string Model,
    string Type,
    string? ImageStoredName,
    string? Vin,
    string? MaskedVin,
    double Mileage,
    string LifecycleStatus);

sealed record ObdDeviceRecord(
    string DeviceId,
    string? ApiTokenId,
    string? DisplayName,
    string? LastVin,
    string? VehicleId,
    string? AssociationSource,
    DateTimeOffset CreatedUtc,
    DateTimeOffset LastSeenUtc,
    DateTimeOffset? LastAssociationUtc,
    string? TrustedVehicleId,
    bool AutoApproveMileage,
    DateTimeOffset? TrustedUtc);

sealed record VehicleAssociationResolution(
    string? DeviceId,
    string? Vin,
    string? VehicleId,
    string? VehicleName,
    string Status,
    string? Method,
    string? SuggestedVehicleId,
    string? SuggestedVehicleName);

sealed record OdometerProposalResult(
    string Status,
    double? BaselineMileage,
    double? CandidateOdometer,
    string? CandidateSource);

sealed record ObdDeviceDto(
    string DeviceId,
    string DisplayName,
    string? LastVin,
    string? VehicleId,
    string? VehicleName,
    string? AssociationSource,
    DateTimeOffset CreatedUtc,
    DateTimeOffset LastSeenUtc,
    DateTimeOffset? LastAssociationUtc,
    bool IsTrusted,
    bool AutoApproveMileage,
    DateTimeOffset? TrustedUtc);

sealed record OdometerProposalDto(
    string TripId,
    string? DeviceId,
    string? VehicleId,
    string? VehicleName,
    string AssociationStatus,
    double? BaselineMileage,
    double? CandidateOdometer,
    string? CandidateSource,
    string StoredStatus,
    string EffectiveStatus,
    double? CurrentMileage,
    DateTimeOffset EndedAt,
    double DistanceMiles,
    DateTimeOffset? AppliedUtc,
    DateTimeOffset? DismissedUtc);

sealed record OdometerApplyResult(
    bool Found,
    bool Applied,
    string? VehicleId,
    double? PreviousMileage,
    double? Mileage,
    string Message);

sealed record ObdDeviceAssociateRequest(
    string? VehicleId,
    string? DisplayName,
    string? Vin);

sealed record ObdDeviceSettingsRequest(
    bool Trusted,
    bool AutoApproveMileage);

sealed record MobileMileageUpdateRequest(
    double Mileage,
    DateTimeOffset? RecordedUtc,
    string? Source,
    bool IsCorrection);

sealed record MobileMileageApplyResult(
    bool Found,
    bool Accepted,
    bool Changed,
    string VehicleId,
    string? VehicleName,
    double? PreviousMileage,
    double? Mileage,
    string Message);

sealed record FuelReceiptExtraction(
    decimal? Gallons,
    decimal? Amount,
    string? Merchant,
    decimal? PricePerGallon,
    string? Confidence);

sealed record TelemetryTripUploadRequest(
    string? TripId,
    DateTimeOffset StartedAt,
    DateTimeOffset EndedAt,
    double DistanceMiles,
    double? StartOdometer,
    double? EndOdometer,
    string? Source,
    string? DeviceId,
    string? DeviceName,
    string? Vin);

sealed record TelemetryTripReceipt(
    string ReceiptId,
    bool Duplicate,
    DateTimeOffset ReceivedUtc);

sealed record ApiTokenCreateRequest(
    string? Name,
    string[]? Scopes,
    int? ExpiresInDays,
    DateTimeOffset? ExpiresAtUtc);

sealed record ApiTokenDto(
    string Id,
    string Name,
    string TokenPrefix,
    string[] Scopes,
    string? CreatedBy,
    DateTimeOffset CreatedUtc,
    DateTimeOffset? ExpiresUtc,
    DateTimeOffset? RevokedUtc,
    DateTimeOffset? LastUsedUtc,
    string Status);
