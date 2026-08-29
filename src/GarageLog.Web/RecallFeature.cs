using System.Globalization;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

internal sealed record VehicleRecallDto(
    string VehicleId,
    string VehicleName,
    string CampaignNumber,
    string Manufacturer,
    string Component,
    string Summary,
    string Consequence,
    string Remedy,
    string? Notes,
    DateTimeOffset? ReportReceivedDate,
    bool ParkIt,
    bool ParkOutside,
    bool OverTheAirUpdate,
    string SourceUrl,
    DateTimeOffset FirstSeenUtc,
    DateTimeOffset LastSeenUtc);

internal sealed record VehicleRecallSyncStatusDto(
    string VehicleId,
    string VehicleName,
    string? LastCheckedUtc,
    string? LastSuccessUtc,
    string? LastError,
    int RecallCount,
    string Query,
    string SourceUrl,
    bool IsValidated,
    string GarageQuery);

internal sealed record RecallVehicleMatchSuggestion(string Year, string Make, string Model, int Score);

internal sealed record RecallVehicleMatchDto(
    string VehicleId,
    string VehicleName,
    string GarageYear,
    string GarageMake,
    string GarageModel,
    bool IsValidated,
    string? NhtsaYear,
    string? NhtsaMake,
    string? NhtsaModel,
    IReadOnlyList<RecallVehicleMatchSuggestion> Suggestions,
    IReadOnlyList<string> AvailableMakes,
    IReadOnlyList<string> AvailableModels);

internal sealed record RecallVehicleProfileDto(
    string VehicleId,
    string GarageYear,
    string GarageMake,
    string GarageModel,
    string NhtsaYear,
    string NhtsaMake,
    string NhtsaModel,
    bool IsValidated,
    DateTimeOffset? ValidatedUtc);

internal sealed record RecallIntegrationSummary(
    string Provider,
    string ProviderUrl,
    int EligibleVehicleCount,
    int CachedRecallCount,
    DateTimeOffset? LastCheckedUtc,
    DateTimeOffset? LastSuccessUtc,
    string? LastError,
    DateTimeOffset? NextAutomaticCheckUtc,
    IReadOnlyList<VehicleRecallSyncStatusDto> Vehicles);

internal sealed record RecallRefreshResult(int VehiclesChecked, int CampaignsFound, int NewCampaigns, int Errors, int VehiclesNeedingValidation);

internal static class RecallFeature
{
    public const string ProviderName = "NHTSA Recall API";
    public const string ProviderUrl = "https://www.nhtsa.gov/recalls";

    public static async Task InitializeAsync(string connectionString)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE IF NOT EXISTS SchemaMigrations (
                Id TEXT PRIMARY KEY,
                AppliedUtc TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS VehicleRecalls (
                VehicleId TEXT NOT NULL,
                CampaignNumber TEXT NOT NULL,
                Manufacturer TEXT NOT NULL,
                Component TEXT NOT NULL,
                Summary TEXT NOT NULL,
                Consequence TEXT NOT NULL,
                Remedy TEXT NOT NULL,
                Notes TEXT NULL,
                ReportReceivedDate TEXT NULL,
                ParkIt INTEGER NOT NULL DEFAULT 0,
                ParkOutside INTEGER NOT NULL DEFAULT 0,
                OverTheAirUpdate INTEGER NOT NULL DEFAULT 0,
                SourceUrl TEXT NOT NULL,
                FirstSeenUtc TEXT NOT NULL,
                LastSeenUtc TEXT NOT NULL,
                IsCurrent INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY(VehicleId, CampaignNumber)
            );

            CREATE INDEX IF NOT EXISTS IX_VehicleRecalls_Current
                ON VehicleRecalls(VehicleId, IsCurrent, ReportReceivedDate DESC);

            CREATE TABLE IF NOT EXISTS VehicleRecallSyncStatus (
                VehicleId TEXT PRIMARY KEY,
                QueryYear TEXT NOT NULL,
                QueryMake TEXT NOT NULL,
                QueryModel TEXT NOT NULL,
                LastCheckedUtc TEXT NULL,
                LastSuccessUtc TEXT NULL,
                LastError TEXT NULL,
                RecallCount INTEGER NOT NULL DEFAULT 0,
                SourceUrl TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS VehicleRecallProfiles (
                VehicleId TEXT PRIMARY KEY,
                GarageYear TEXT NOT NULL,
                GarageMake TEXT NOT NULL,
                GarageModel TEXT NOT NULL,
                QueryYear TEXT NOT NULL,
                QueryMake TEXT NOT NULL,
                QueryModel TEXT NOT NULL,
                IsValidated INTEGER NOT NULL DEFAULT 0,
                ValidatedUtc TEXT NULL,
                UpdatedUtc TEXT NOT NULL
            );
            """;
        await command.ExecuteNonQueryAsync();
        await DatabaseMaintenance.MarkMigrationAsync(connection, "20260829_05_nhtsa_recall_cache");
        const string vehicleProfileMigration = "20260829_08_nhtsa_vehicle_profiles";
        if (!await DatabaseMaintenance.HasMigrationAsync(connection, vehicleProfileMigration))
        {
            await using var reset = connection.CreateCommand();
            reset.CommandText = "DELETE FROM VehicleRecalls; DELETE FROM VehicleRecallSyncStatus;";
            await reset.ExecuteNonQueryAsync();
            await DatabaseMaintenance.MarkMigrationAsync(connection, vehicleProfileMigration);
        }
    }

    public static async Task<RecallRefreshResult> RefreshDueAsync(
        string connectionString,
        string fallbackStateJson,
        HttpClient client,
        ILogger logger,
        bool force)
    {
        var settings = await NotificationFeature.ReadSettingsAsync(connectionString);
        var stored = await StateStore.ReadAsync(connectionString, fallbackStateJson);
        var root = JsonNode.Parse(stored.Json)?.AsObject() ?? new JsonObject();
        var vehicles = (root["vehicles"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()
            .Where(vehicle => !string.Equals(ReadString(vehicle, "lifecycleStatus"), "Sold", StringComparison.OrdinalIgnoreCase)
                           && !string.Equals(ReadString(vehicle, "lifecycleStatus"), "Decommissioned", StringComparison.OrdinalIgnoreCase))
            .ToArray();

        var checkedCount = 0;
        var campaignCount = 0;
        var newCampaignCount = 0;
        var errors = 0;
        var needsValidation = 0;

        foreach (var vehicle in vehicles)
        {
            var vehicleId = ReadString(vehicle, "id");
            var garageYear = ReadString(vehicle, "year");
            var garageMake = ReadString(vehicle, "make");
            var garageModel = ReadString(vehicle, "model");
            if (string.IsNullOrWhiteSpace(vehicleId)
                || string.IsNullOrWhiteSpace(garageYear)
                || string.IsNullOrWhiteSpace(garageMake)
                || string.IsNullOrWhiteSpace(garageModel))
                continue;

            var profile = await ReadVehicleProfileAsync(connectionString, vehicleId);
            if (profile is null || !profile.IsValidated || !ProfileMatchesGarageVehicle(profile, vehicle))
            {
                needsValidation++;
                logger.LogInformation("Skipping NHTSA recall check for {Vehicle}; recall identity has not been validated.", VehicleName(vehicle));
                continue;
            }

            var priorStatus = await ReadVehicleStatusAsync(connectionString, vehicleId);
            if (!force)
            {
                if (NotificationFeature.NormalizeRecallSchedule(settings.RecallCheckSchedule) is "manual" or "startup")
                    continue;
                if (priorStatus?.LastSuccessUtc is not null
                    && DateTimeOffset.TryParse(priorStatus.LastSuccessUtc, out var lastSuccess)
                    && NotificationFeature.NextRecallCheckUtc(lastSuccess, settings.RecallCheckSchedule) is { } nextCheck
                    && DateTimeOffset.UtcNow < nextCheck)
                    continue;
            }

            var year = profile.NhtsaYear;
            var make = profile.NhtsaMake;
            var model = profile.NhtsaModel;
            checkedCount++;
            var sourcePath = $"recalls/recallsByVehicle?make={Uri.EscapeDataString(make)}&model={Uri.EscapeDataString(model)}&modelYear={Uri.EscapeDataString(year)}";
            var sourceUrl = $"https://api.nhtsa.gov/{sourcePath}";
            try
            {
                using var response = await client.GetAsync(sourcePath);
                var payload = await ReadRecallResponseAsync(response);
                var recalls = payload.Results ?? new List<NhtsaRecallItem>();
                campaignCount += recalls.Count;
                var result = await StoreVehicleRecallsAsync(connectionString, vehicle, year, make, model, sourceUrl, recalls);
                newCampaignCount += result.NewCampaigns;

                if (settings.RecallNotificationsEnabled)
                {
                    var verificationUrl = VehicleVerificationUrl(vehicle);
                    if (!result.HadPriorSuccess && recalls.Count > 0)
                    {
                        await NotificationFeature.UpsertAsync(connectionString, new ServerNotificationDto(
                            $"recall-baseline:{vehicleId}",
                            "recall",
                            $"{recalls.Count} recall campaign{(recalls.Count == 1 ? string.Empty : "s")} found",
                            $"{VehicleName(vehicle)} · Review NHTSA results and verify the VIN for unrepaired recalls.",
                            recalls.Any(item => item.ParkIt) ? "red" : "orange",
                            "warning",
                            "Garage",
                            vehicleId,
                            vehicleId,
                            verificationUrl,
                            DateTimeOffset.UtcNow,
                            null));
                    }
                    else
                    {
                        foreach (var recall in result.NewItems)
                        {
                            await NotificationFeature.UpsertAsync(connectionString, new ServerNotificationDto(
                                $"recall:{vehicleId}:{recall.NhtsaCampaignNumber}",
                                "recall",
                                $"New safety recall: {recall.NhtsaCampaignNumber}",
                                $"{VehicleName(vehicle)} · {CleanComponent(recall.Component)}",
                                recall.ParkIt ? "red" : "orange",
                                "warning",
                                "Garage",
                                vehicleId,
                                vehicleId,
                                verificationUrl,
                                DateTimeOffset.UtcNow,
                                ParseReportDate(recall.ReportReceivedDate)));
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                errors++;
                await SaveVehicleStatusErrorAsync(connectionString, vehicleId, year, make, model, sourceUrl, ex.Message);
                logger.LogWarning(ex, "NHTSA recall check failed for {Vehicle} using validated lookup {Year} {Make} {Model}.", VehicleName(vehicle), year, make, model);
            }
        }

        if (checkedCount > 0 || needsValidation > 0)
            logger.LogInformation("NHTSA recall check completed: {VehicleCount} checked, {NeedsValidation} need validation, {CampaignCount} campaign(s), {NewCampaignCount} new, {ErrorCount} error(s).",
                checkedCount, needsValidation, campaignCount, newCampaignCount, errors);
        return new RecallRefreshResult(checkedCount, campaignCount, newCampaignCount, errors, needsValidation);
    }

    public static async Task<RecallIntegrationSummary> ReadSummaryAsync(
        string connectionString,
        string fallbackStateJson,
        HashSet<string>? visibleVehicleIds = null)
    {
        var settings = await NotificationFeature.ReadSettingsAsync(connectionString);
        var stored = await StateStore.ReadAsync(connectionString, fallbackStateJson);
        var root = JsonNode.Parse(stored.Json)?.AsObject() ?? new JsonObject();
        var vehicles = (root["vehicles"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()
            .Where(vehicle => !string.Equals(ReadString(vehicle, "lifecycleStatus"), "Sold", StringComparison.OrdinalIgnoreCase)
                           && !string.Equals(ReadString(vehicle, "lifecycleStatus"), "Decommissioned", StringComparison.OrdinalIgnoreCase))
            .Where(vehicle => !string.IsNullOrWhiteSpace(ReadString(vehicle, "id")))
            .Where(vehicle => visibleVehicleIds is null || visibleVehicleIds.Contains(ReadString(vehicle, "id")!))
            .ToArray();

        var syncRows = await ReadAllVehicleStatusesAsync(connectionString);
        var statuses = new List<VehicleRecallSyncStatusDto>();
        DateTimeOffset? latestChecked = null;
        DateTimeOffset? latestSuccess = null;
        string? latestError = null;
        var eligible = 0;

        foreach (var vehicle in vehicles)
        {
            var vehicleId = ReadString(vehicle, "id")!;
            var garageYear = ReadString(vehicle, "year") ?? string.Empty;
            var garageMake = ReadString(vehicle, "make") ?? string.Empty;
            var garageModel = ReadString(vehicle, "model") ?? string.Empty;
            if (string.IsNullOrWhiteSpace(garageYear) || string.IsNullOrWhiteSpace(garageMake) || string.IsNullOrWhiteSpace(garageModel))
                continue;

            eligible++;
            var garageQuery = $"{garageYear} {garageMake} {garageModel}".Trim();
            var profile = await ReadVehicleProfileAsync(connectionString, vehicleId);
            var validated = profile is not null && profile.IsValidated && ProfileMatchesGarageVehicle(profile, vehicle);
            syncRows.TryGetValue(vehicleId, out var sync);

            string? checkedText = null;
            string? successText = null;
            string? error = null;
            var recallCount = 0;
            var query = "Needs NHTSA validation";
            var sourceUrl = ProviderUrl;

            if (validated && profile is not null)
            {
                query = $"{profile.NhtsaYear} {profile.NhtsaMake} {profile.NhtsaModel}";
                if (sync is not null)
                {
                    checkedText = sync.LastCheckedUtc;
                    successText = sync.LastSuccessUtc;
                    error = sync.LastError;
                    recallCount = sync.RecallCount;
                    sourceUrl = sync.SourceUrl;
                }
                if (DateTimeOffset.TryParse(checkedText, out var checkedUtc) && (!latestChecked.HasValue || checkedUtc > latestChecked)) latestChecked = checkedUtc;
                if (DateTimeOffset.TryParse(successText, out var successUtc) && (!latestSuccess.HasValue || successUtc > latestSuccess)) latestSuccess = successUtc;
                if (!string.IsNullOrWhiteSpace(error) && latestError is null) latestError = error;
            }

            statuses.Add(new VehicleRecallSyncStatusDto(
                vehicleId,
                VehicleName(vehicle),
                checkedText,
                successText,
                error,
                recallCount,
                query,
                sourceUrl,
                validated,
                garageQuery));
        }

        var cachedCount = await CountRecallsAsync(connectionString, visibleVehicleIds);
        DateTimeOffset? next = latestSuccess.HasValue ? NotificationFeature.NextRecallCheckUtc(latestSuccess.Value, settings.RecallCheckSchedule) : null;
        return new RecallIntegrationSummary(ProviderName, ProviderUrl, eligible, cachedCount, latestChecked, latestSuccess, latestError, next, statuses);
    }

    public static async Task<List<VehicleRecallDto>> ReadRecallsAsync(
        string connectionString,
        string fallbackStateJson,
        HashSet<string>? visibleVehicleIds = null,
        int limit = 250)
    {
        var stored = await StateStore.ReadAsync(connectionString, fallbackStateJson);
        var root = JsonNode.Parse(stored.Json)?.AsObject() ?? new JsonObject();
        var names = (root["vehicles"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()
            .Where(vehicle => !string.IsNullOrWhiteSpace(ReadString(vehicle, "id")))
            .ToDictionary(vehicle => ReadString(vehicle, "id")!, VehicleName, StringComparer.Ordinal);

        var recalls = new List<VehicleRecallDto>();
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT VehicleId, CampaignNumber, Manufacturer, Component, Summary, Consequence, Remedy, Notes,
                   ReportReceivedDate, ParkIt, ParkOutside, OverTheAirUpdate, SourceUrl, FirstSeenUtc, LastSeenUtc
            FROM VehicleRecalls
            WHERE IsCurrent = 1
            ORDER BY COALESCE(ReportReceivedDate, '') DESC, CampaignNumber DESC
            LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, 500));
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var vehicleId = reader.GetString(0);
            if (visibleVehicleIds is not null && !visibleVehicleIds.Contains(vehicleId)) continue;
            recalls.Add(new VehicleRecallDto(
                vehicleId,
                names.TryGetValue(vehicleId, out var name) ? name : "Vehicle",
                reader.GetString(1), reader.GetString(2), reader.GetString(3), reader.GetString(4), reader.GetString(5), reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.IsDBNull(8) ? null : ParseReportDate(reader.GetString(8)),
                reader.GetInt64(9) != 0, reader.GetInt64(10) != 0, reader.GetInt64(11) != 0,
                reader.GetString(12),
                ParseRoundtrip(reader.GetString(13)) ?? DateTimeOffset.UtcNow,
                ParseRoundtrip(reader.GetString(14)) ?? DateTimeOffset.UtcNow));
        }
        return recalls;
    }

    private static async Task<(bool HadPriorSuccess, int NewCampaigns, List<NhtsaRecallItem> NewItems)> StoreVehicleRecallsAsync(
        string connectionString,
        JsonObject vehicle,
        string year,
        string make,
        string model,
        string sourceUrl,
        List<NhtsaRecallItem> recalls)
    {
        var vehicleId = ReadString(vehicle, "id")!;
        var now = DateTimeOffset.UtcNow;
        var existing = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var hadPriorSuccess = false;

        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using (var readExisting = connection.CreateCommand())
        {
            readExisting.CommandText = "SELECT CampaignNumber FROM VehicleRecalls WHERE VehicleId = $vehicleId;";
            readExisting.Parameters.AddWithValue("$vehicleId", vehicleId);
            await using var reader = await readExisting.ExecuteReaderAsync();
            while (await reader.ReadAsync()) existing.Add(reader.GetString(0));
        }
        var queryChanged = false;
        await using (var readStatus = connection.CreateCommand())
        {
            readStatus.CommandText = "SELECT QueryYear, QueryMake, QueryModel, LastSuccessUtc FROM VehicleRecallSyncStatus WHERE VehicleId = $vehicleId LIMIT 1;";
            readStatus.Parameters.AddWithValue("$vehicleId", vehicleId);
            await using var statusReader = await readStatus.ExecuteReaderAsync();
            if (await statusReader.ReadAsync())
            {
                queryChanged = !string.Equals(statusReader.GetString(0), year, StringComparison.OrdinalIgnoreCase)
                    || !string.Equals(statusReader.GetString(1), make, StringComparison.OrdinalIgnoreCase)
                    || !string.Equals(statusReader.GetString(2), model, StringComparison.OrdinalIgnoreCase);
                hadPriorSuccess = !queryChanged && !statusReader.IsDBNull(3) && !string.IsNullOrWhiteSpace(statusReader.GetString(3));
            }
        }

        if (queryChanged)
        {
            existing.Clear();
            await using var clearOld = connection.CreateCommand();
            clearOld.CommandText = "DELETE FROM VehicleRecalls WHERE VehicleId = $vehicleId;";
            clearOld.Parameters.AddWithValue("$vehicleId", vehicleId);
            await clearOld.ExecuteNonQueryAsync();
        }

        await using var transaction = await connection.BeginTransactionAsync();
        await using (var clear = connection.CreateCommand())
        {
            clear.Transaction = (SqliteTransaction)transaction;
            clear.CommandText = "UPDATE VehicleRecalls SET IsCurrent = 0 WHERE VehicleId = $vehicleId;";
            clear.Parameters.AddWithValue("$vehicleId", vehicleId);
            await clear.ExecuteNonQueryAsync();
        }

        var newItems = new List<NhtsaRecallItem>();
        foreach (var recall in recalls)
        {
            var campaign = recall.NhtsaCampaignNumber?.Trim();
            if (string.IsNullOrWhiteSpace(campaign)) continue;
            if (!existing.Contains(campaign)) newItems.Add(recall);
            await using var upsert = connection.CreateCommand();
            upsert.Transaction = (SqliteTransaction)transaction;
            upsert.CommandText = """
                INSERT INTO VehicleRecalls
                    (VehicleId, CampaignNumber, Manufacturer, Component, Summary, Consequence, Remedy, Notes,
                     ReportReceivedDate, ParkIt, ParkOutside, OverTheAirUpdate, SourceUrl, FirstSeenUtc, LastSeenUtc, IsCurrent)
                VALUES
                    ($vehicleId, $campaign, $manufacturer, $component, $summary, $consequence, $remedy, $notes,
                     $reportDate, $parkIt, $parkOutside, $ota, $sourceUrl, $firstSeen, $lastSeen, 1)
                ON CONFLICT(VehicleId, CampaignNumber) DO UPDATE SET
                    Manufacturer = excluded.Manufacturer,
                    Component = excluded.Component,
                    Summary = excluded.Summary,
                    Consequence = excluded.Consequence,
                    Remedy = excluded.Remedy,
                    Notes = excluded.Notes,
                    ReportReceivedDate = excluded.ReportReceivedDate,
                    ParkIt = excluded.ParkIt,
                    ParkOutside = excluded.ParkOutside,
                    OverTheAirUpdate = excluded.OverTheAirUpdate,
                    SourceUrl = excluded.SourceUrl,
                    LastSeenUtc = excluded.LastSeenUtc,
                    IsCurrent = 1;
                """;
            upsert.Parameters.AddWithValue("$vehicleId", vehicleId);
            upsert.Parameters.AddWithValue("$campaign", campaign);
            upsert.Parameters.AddWithValue("$manufacturer", recall.Manufacturer?.Trim() ?? string.Empty);
            upsert.Parameters.AddWithValue("$component", recall.Component?.Trim() ?? string.Empty);
            upsert.Parameters.AddWithValue("$summary", recall.Summary?.Trim() ?? string.Empty);
            upsert.Parameters.AddWithValue("$consequence", recall.Consequence?.Trim() ?? string.Empty);
            upsert.Parameters.AddWithValue("$remedy", recall.Remedy?.Trim() ?? string.Empty);
            upsert.Parameters.AddWithValue("$notes", string.IsNullOrWhiteSpace(recall.Notes) ? DBNull.Value : recall.Notes.Trim());
            upsert.Parameters.AddWithValue("$reportDate", string.IsNullOrWhiteSpace(recall.ReportReceivedDate) ? DBNull.Value : recall.ReportReceivedDate.Trim());
            upsert.Parameters.AddWithValue("$parkIt", recall.ParkIt ? 1 : 0);
            upsert.Parameters.AddWithValue("$parkOutside", recall.ParkOutside ? 1 : 0);
            upsert.Parameters.AddWithValue("$ota", recall.OverTheAirUpdate ? 1 : 0);
            upsert.Parameters.AddWithValue("$sourceUrl", sourceUrl);
            upsert.Parameters.AddWithValue("$firstSeen", now.ToString("O"));
            upsert.Parameters.AddWithValue("$lastSeen", now.ToString("O"));
            await upsert.ExecuteNonQueryAsync();
        }

        await using (var status = connection.CreateCommand())
        {
            status.Transaction = (SqliteTransaction)transaction;
            status.CommandText = """
                INSERT INTO VehicleRecallSyncStatus
                    (VehicleId, QueryYear, QueryMake, QueryModel, LastCheckedUtc, LastSuccessUtc, LastError, RecallCount, SourceUrl)
                VALUES
                    ($vehicleId, $year, $make, $model, $now, $now, NULL, $count, $sourceUrl)
                ON CONFLICT(VehicleId) DO UPDATE SET
                    QueryYear = excluded.QueryYear,
                    QueryMake = excluded.QueryMake,
                    QueryModel = excluded.QueryModel,
                    LastCheckedUtc = excluded.LastCheckedUtc,
                    LastSuccessUtc = excluded.LastSuccessUtc,
                    LastError = NULL,
                    RecallCount = excluded.RecallCount,
                    SourceUrl = excluded.SourceUrl;
                """;
            status.Parameters.AddWithValue("$vehicleId", vehicleId);
            status.Parameters.AddWithValue("$year", year);
            status.Parameters.AddWithValue("$make", make);
            status.Parameters.AddWithValue("$model", model);
            status.Parameters.AddWithValue("$now", now.ToString("O"));
            status.Parameters.AddWithValue("$count", recalls.Count);
            status.Parameters.AddWithValue("$sourceUrl", sourceUrl);
            await status.ExecuteNonQueryAsync();
        }
        await transaction.CommitAsync();
        return (hadPriorSuccess, newItems.Count, newItems);
    }

    private static async Task SaveVehicleStatusErrorAsync(
        string connectionString, string vehicleId, string year, string make, string model, string sourceUrl, string error)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO VehicleRecallSyncStatus
                (VehicleId, QueryYear, QueryMake, QueryModel, LastCheckedUtc, LastSuccessUtc, LastError, RecallCount, SourceUrl)
            VALUES
                ($vehicleId, $year, $make, $model, $now, NULL, $error, 0, $sourceUrl)
            ON CONFLICT(VehicleId) DO UPDATE SET
                QueryYear = excluded.QueryYear,
                QueryMake = excluded.QueryMake,
                QueryModel = excluded.QueryModel,
                LastCheckedUtc = excluded.LastCheckedUtc,
                LastError = excluded.LastError,
                SourceUrl = excluded.SourceUrl;
            """;
        command.Parameters.AddWithValue("$vehicleId", vehicleId);
        command.Parameters.AddWithValue("$year", year);
        command.Parameters.AddWithValue("$make", make);
        command.Parameters.AddWithValue("$model", model);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$error", error.Length > 500 ? error[..500] : error);
        command.Parameters.AddWithValue("$sourceUrl", sourceUrl);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<VehicleRecallSyncStatusDto?> ReadVehicleStatusAsync(string connectionString, string vehicleId)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT QueryYear, QueryMake, QueryModel, LastCheckedUtc, LastSuccessUtc, LastError, RecallCount, SourceUrl
            FROM VehicleRecallSyncStatus WHERE VehicleId = $vehicleId LIMIT 1;
            """;
        command.Parameters.AddWithValue("$vehicleId", vehicleId);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        return new VehicleRecallSyncStatusDto(vehicleId, $"{reader.GetString(0)} {reader.GetString(1)} {reader.GetString(2)}",
            reader.IsDBNull(3) ? null : reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            reader.GetInt32(6),
            $"{reader.GetString(0)} {reader.GetString(1)} {reader.GetString(2)}",
            reader.GetString(7),
            true,
            string.Empty);
    }

    public static async Task<RecallVehicleMatchDto?> BuildVehicleMatchAsync(
        string connectionString,
        string fallbackStateJson,
        string vehicleId,
        HttpClient client)
    {
        var vehicle = await FindVehicleAsync(connectionString, fallbackStateJson, vehicleId);
        if (vehicle is null) return null;
        var year = ReadString(vehicle, "year") ?? string.Empty;
        var make = ReadString(vehicle, "make") ?? string.Empty;
        var model = ReadString(vehicle, "model") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(year) || string.IsNullOrWhiteSpace(make) || string.IsNullOrWhiteSpace(model))
            throw new InvalidOperationException("This vehicle needs a model year, make, and model before recall monitoring can be configured.");

        var profile = await ReadVehicleProfileAsync(connectionString, vehicleId);
        var isValidated = profile is not null && profile.IsValidated && ProfileMatchesGarageVehicle(profile, vehicle);
        var suggestionMakes = await ReadCatalogMakesAsync(client, year);
        var suggestions = await SuggestVehicleMatchesAsync(client, year, make, model, suggestionMakes);

        var selectedYear = isValidated ? profile!.NhtsaYear : suggestions.FirstOrDefault()?.Year ?? year;
        var makes = string.Equals(selectedYear, year, StringComparison.OrdinalIgnoreCase)
            ? suggestionMakes
            : await ReadCatalogMakesAsync(client, selectedYear);
        var selectedMake = isValidated ? profile!.NhtsaMake : suggestions.FirstOrDefault()?.Make ?? makes.FirstOrDefault(value => string.Equals(value, make, StringComparison.OrdinalIgnoreCase)) ?? string.Empty;
        var selectedModel = isValidated ? profile!.NhtsaModel : suggestions.FirstOrDefault()?.Model;
        var models = string.IsNullOrWhiteSpace(selectedMake) ? Array.Empty<string>() : (await ReadCatalogModelsAsync(client, selectedYear, selectedMake)).ToArray();

        return new RecallVehicleMatchDto(
            vehicleId,
            VehicleName(vehicle),
            year,
            make,
            model,
            isValidated,
            isValidated ? profile!.NhtsaYear : selectedYear,
            isValidated ? profile!.NhtsaMake : selectedMake,
            isValidated ? profile!.NhtsaModel : selectedModel,
            suggestions,
            makes,
            models);
    }

    public static async Task<IReadOnlyList<string>> ReadCatalogMakesAsync(HttpClient client, string year)
    {
        if (string.IsNullOrWhiteSpace(year)) return Array.Empty<string>();
        var path = $"products/vehicle/makes?modelYear={Uri.EscapeDataString(year.Trim())}&issueType=r";
        using var response = await client.GetAsync(path);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<NhtsaProductResponse>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new NhtsaProductResponse();
        return (payload.Results ?? new List<NhtsaProductItem>())
            .Select(item => item.Make?.Trim())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public static async Task<IReadOnlyList<string>> ReadCatalogModelsAsync(HttpClient client, string year, string make)
    {
        if (string.IsNullOrWhiteSpace(year) || string.IsNullOrWhiteSpace(make)) return Array.Empty<string>();
        var path = $"products/vehicle/models?modelYear={Uri.EscapeDataString(year.Trim())}&make={Uri.EscapeDataString(make.Trim())}&issueType=r";
        using var response = await client.GetAsync(path);
        response.EnsureSuccessStatusCode();
        var payload = await response.Content.ReadFromJsonAsync<NhtsaProductResponse>(new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new NhtsaProductResponse();
        return (payload.Results ?? new List<NhtsaProductItem>())
            .Select(item => item.Model?.Trim())
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Select(value => value!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public static async Task<RecallVehicleProfileDto> SaveVehicleMatchAsync(
        string connectionString,
        string fallbackStateJson,
        string vehicleId,
        string year,
        string make,
        string model,
        HttpClient client)
    {
        var vehicle = await FindVehicleAsync(connectionString, fallbackStateJson, vehicleId)
            ?? throw new InvalidOperationException("Vehicle not found.");
        var garageYear = ReadString(vehicle, "year") ?? string.Empty;
        var garageMake = ReadString(vehicle, "make") ?? string.Empty;
        var garageModel = ReadString(vehicle, "model") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(garageYear) || string.IsNullOrWhiteSpace(garageMake) || string.IsNullOrWhiteSpace(garageModel))
            throw new InvalidOperationException("This vehicle needs a model year, make, and model before recall monitoring can be configured.");

        year = year.Trim();
        make = make.Trim();
        model = model.Trim();
        if (string.IsNullOrWhiteSpace(year) || string.IsNullOrWhiteSpace(make) || string.IsNullOrWhiteSpace(model))
            throw new InvalidOperationException("Choose an NHTSA model year, make, and model.");

        var makes = await ReadCatalogMakesAsync(client, year);
        var canonicalMake = makes.FirstOrDefault(value => string.Equals(value, make, StringComparison.OrdinalIgnoreCase));
        if (canonicalMake is null)
            throw new InvalidOperationException($"NHTSA does not list '{make}' as a recall make for {year}.");
        var models = await ReadCatalogModelsAsync(client, year, canonicalMake);
        var canonicalModel = models.FirstOrDefault(value => string.Equals(value, model, StringComparison.OrdinalIgnoreCase));
        if (canonicalModel is null)
            throw new InvalidOperationException($"NHTSA does not list '{model}' under {year} {canonicalMake}.");

        var now = DateTimeOffset.UtcNow;
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using (var upsert = connection.CreateCommand())
        {
            upsert.Transaction = (SqliteTransaction)transaction;
            upsert.CommandText = """
                INSERT INTO VehicleRecallProfiles
                    (VehicleId, GarageYear, GarageMake, GarageModel, QueryYear, QueryMake, QueryModel, IsValidated, ValidatedUtc, UpdatedUtc)
                VALUES
                    ($vehicleId, $garageYear, $garageMake, $garageModel, $queryYear, $queryMake, $queryModel, 1, $now, $now)
                ON CONFLICT(VehicleId) DO UPDATE SET
                    GarageYear = excluded.GarageYear,
                    GarageMake = excluded.GarageMake,
                    GarageModel = excluded.GarageModel,
                    QueryYear = excluded.QueryYear,
                    QueryMake = excluded.QueryMake,
                    QueryModel = excluded.QueryModel,
                    IsValidated = 1,
                    ValidatedUtc = excluded.ValidatedUtc,
                    UpdatedUtc = excluded.UpdatedUtc;
                """;
            upsert.Parameters.AddWithValue("$vehicleId", vehicleId);
            upsert.Parameters.AddWithValue("$garageYear", garageYear);
            upsert.Parameters.AddWithValue("$garageMake", garageMake);
            upsert.Parameters.AddWithValue("$garageModel", garageModel);
            upsert.Parameters.AddWithValue("$queryYear", year);
            upsert.Parameters.AddWithValue("$queryMake", canonicalMake);
            upsert.Parameters.AddWithValue("$queryModel", canonicalModel);
            upsert.Parameters.AddWithValue("$now", now.ToString("O"));
            await upsert.ExecuteNonQueryAsync();
        }
        await using (var clearRecalls = connection.CreateCommand())
        {
            clearRecalls.Transaction = (SqliteTransaction)transaction;
            clearRecalls.CommandText = "DELETE FROM VehicleRecalls WHERE VehicleId = $vehicleId;";
            clearRecalls.Parameters.AddWithValue("$vehicleId", vehicleId);
            await clearRecalls.ExecuteNonQueryAsync();
        }
        await using (var clearStatus = connection.CreateCommand())
        {
            clearStatus.Transaction = (SqliteTransaction)transaction;
            clearStatus.CommandText = "DELETE FROM VehicleRecallSyncStatus WHERE VehicleId = $vehicleId;";
            clearStatus.Parameters.AddWithValue("$vehicleId", vehicleId);
            await clearStatus.ExecuteNonQueryAsync();
        }
        await using (var notificationTable = connection.CreateCommand())
        {
            notificationTable.Transaction = (SqliteTransaction)transaction;
            notificationTable.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'NotificationEvents';";
            var hasNotificationEvents = Convert.ToInt32(await notificationTable.ExecuteScalarAsync()) > 0;
            if (hasNotificationEvents)
            {
                await using var clearNotifications = connection.CreateCommand();
                clearNotifications.Transaction = (SqliteTransaction)transaction;
                clearNotifications.CommandText = "UPDATE NotificationEvents SET IsActive = 0, UpdatedUtc = $now WHERE Category = 'recall' AND VehicleId = $vehicleId;";
                clearNotifications.Parameters.AddWithValue("$vehicleId", vehicleId);
                clearNotifications.Parameters.AddWithValue("$now", now.ToString("O"));
                await clearNotifications.ExecuteNonQueryAsync();
            }
        }
        await transaction.CommitAsync();

        return new RecallVehicleProfileDto(vehicleId, garageYear, garageMake, garageModel, year, canonicalMake, canonicalModel, true, now);
    }

    private static async Task<IReadOnlyList<RecallVehicleMatchSuggestion>> SuggestVehicleMatchesAsync(
        HttpClient client,
        string year,
        string garageMake,
        string garageModel,
        IReadOnlyList<string> makes)
    {
        var makeCandidates = makes
            .Select(make => new { Make = make, Score = ScoreMakeCandidate(make, garageMake, garageModel) })
            .Where(item => item.Score > 0)
            .OrderByDescending(item => item.Score)
            .ThenBy(item => item.Make, StringComparer.OrdinalIgnoreCase)
            .Take(6)
            .ToArray();
        var suggestions = new List<RecallVehicleMatchSuggestion>();
        foreach (var candidate in makeCandidates)
        {
            var models = await ReadCatalogModelsAsync(client, year, candidate.Make);
            var strippedModel = RemoveLeadingPhrase(garageModel, candidate.Make);
            foreach (var model in models)
            {
                var modelScore = ScoreModelCandidate(model, garageModel, strippedModel);
                if (modelScore <= 0) continue;
                suggestions.Add(new RecallVehicleMatchSuggestion(year, candidate.Make, model, candidate.Score + modelScore));
            }
        }
        return suggestions
            .OrderByDescending(item => item.Score)
            .ThenBy(item => item.Make, StringComparer.OrdinalIgnoreCase)
            .ThenBy(item => item.Model, StringComparer.OrdinalIgnoreCase)
            .DistinctBy(item => $"{item.Year}\u001f{item.Make}\u001f{item.Model}", StringComparer.OrdinalIgnoreCase)
            .Take(6)
            .ToArray();
    }

    private static int ScoreMakeCandidate(string candidate, string garageMake, string garageModel)
    {
        var score = 0;
        if (SameMatchText(candidate, garageMake)) score += 140;
        if (ContainsPhrase(garageModel, candidate)) score += 120;
        if (ContainsPhrase($"{garageMake} {garageModel}", candidate)) score += 50;
        if (NormalizeCompact(garageModel).StartsWith(NormalizeCompact(candidate), StringComparison.OrdinalIgnoreCase)) score += 30;
        return score;
    }

    private static int ScoreModelCandidate(string candidate, string garageModel, string strippedModel)
    {
        if (SameMatchText(candidate, strippedModel)) return 180;
        if (SameMatchText(candidate, garageModel)) return 160;
        if (ContainsPhrase(garageModel, candidate)) return 110;
        if (ContainsPhrase(candidate, strippedModel) && !string.IsNullOrWhiteSpace(strippedModel)) return 80;
        return 0;
    }

    private static string RemoveLeadingPhrase(string value, string phrase)
    {
        var valueWords = NormalizeWords(value);
        var phraseWords = NormalizeWords(phrase);
        if (string.IsNullOrWhiteSpace(phraseWords)) return value;
        if (valueWords.Equals(phraseWords, StringComparison.OrdinalIgnoreCase)) return string.Empty;
        if (valueWords.StartsWith(phraseWords + " ", StringComparison.OrdinalIgnoreCase))
            return valueWords[(phraseWords.Length + 1)..];
        return value;
    }

    private static bool SameMatchText(string left, string right)
        => NormalizeCompact(left).Equals(NormalizeCompact(right), StringComparison.OrdinalIgnoreCase);

    private static bool ContainsPhrase(string text, string phrase)
    {
        var normalizedText = $" {NormalizeWords(text)} ";
        var normalizedPhrase = NormalizeWords(phrase);
        return !string.IsNullOrWhiteSpace(normalizedPhrase)
            && normalizedText.Contains($" {normalizedPhrase} ", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeCompact(string value)
        => new string(value.Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());

    private static string NormalizeWords(string value)
    {
        var builder = new StringBuilder();
        var pendingSpace = false;
        foreach (var ch in value ?? string.Empty)
        {
            if (char.IsLetterOrDigit(ch))
            {
                if (pendingSpace && builder.Length > 0) builder.Append(' ');
                builder.Append(char.ToUpperInvariant(ch));
                pendingSpace = false;
            }
            else pendingSpace = true;
        }
        return builder.ToString();
    }

    private static bool ProfileMatchesGarageVehicle(RecallVehicleProfileDto profile, JsonObject vehicle)
        => string.Equals(profile.GarageYear, ReadString(vehicle, "year"), StringComparison.OrdinalIgnoreCase)
        && string.Equals(profile.GarageMake, ReadString(vehicle, "make"), StringComparison.OrdinalIgnoreCase)
        && string.Equals(profile.GarageModel, ReadString(vehicle, "model"), StringComparison.OrdinalIgnoreCase);

    private static async Task<RecallVehicleProfileDto?> ReadVehicleProfileAsync(string connectionString, string vehicleId)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT GarageYear, GarageMake, GarageModel, QueryYear, QueryMake, QueryModel, IsValidated, ValidatedUtc
            FROM VehicleRecallProfiles WHERE VehicleId = $vehicleId LIMIT 1;
            """;
        command.Parameters.AddWithValue("$vehicleId", vehicleId);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        return new RecallVehicleProfileDto(
            vehicleId,
            reader.GetString(0), reader.GetString(1), reader.GetString(2),
            reader.GetString(3), reader.GetString(4), reader.GetString(5),
            reader.GetInt64(6) != 0,
            reader.IsDBNull(7) ? null : ParseRoundtrip(reader.GetString(7)));
    }

    private static async Task<JsonObject?> FindVehicleAsync(string connectionString, string fallbackStateJson, string vehicleId)
    {
        var stored = await StateStore.ReadAsync(connectionString, fallbackStateJson);
        var root = JsonNode.Parse(stored.Json)?.AsObject() ?? new JsonObject();
        return (root["vehicles"] as JsonArray ?? new JsonArray()).OfType<JsonObject>()
            .FirstOrDefault(vehicle => string.Equals(ReadString(vehicle, "id"), vehicleId, StringComparison.Ordinal));
    }

    private sealed record RecallSyncRow(string? LastCheckedUtc, string? LastSuccessUtc, string? LastError, int RecallCount, string SourceUrl);

    private static async Task<Dictionary<string, RecallSyncRow>> ReadAllVehicleStatusesAsync(string connectionString)
    {
        var rows = new Dictionary<string, RecallSyncRow>(StringComparer.Ordinal);
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT VehicleId, LastCheckedUtc, LastSuccessUtc, LastError, RecallCount, SourceUrl FROM VehicleRecallSyncStatus;";
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows[reader.GetString(0)] = new RecallSyncRow(
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.GetInt32(4),
                reader.GetString(5));
        }
        return rows;
    }

    private static async Task<int> CountRecallsAsync(string connectionString, HashSet<string>? visibleVehicleIds)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        if (visibleVehicleIds is null)
        {
            await using var count = connection.CreateCommand();
            count.CommandText = "SELECT COUNT(*) FROM VehicleRecalls WHERE IsCurrent = 1;";
            return Convert.ToInt32(await count.ExecuteScalarAsync());
        }
        if (visibleVehicleIds.Count == 0) return 0;
        await using var command = connection.CreateCommand();
        var parameters = new List<string>();
        var index = 0;
        foreach (var id in visibleVehicleIds)
        {
            var parameter = $"$vehicle{index++}";
            parameters.Add(parameter);
            command.Parameters.AddWithValue(parameter, id);
        }
        command.CommandText = $"SELECT COUNT(*) FROM VehicleRecalls WHERE IsCurrent = 1 AND VehicleId IN ({string.Join(",", parameters)});";
        return Convert.ToInt32(await command.ExecuteScalarAsync());
    }

    private static string VehicleVerificationUrl(JsonObject vehicle)
    {
        var vin = ReadString(vehicle, "vin");
        return !string.IsNullOrWhiteSpace(vin) && vin.Length == 17
            ? $"https://www.nhtsa.gov/recalls?vin={Uri.EscapeDataString(vin)}"
            : ProviderUrl;
    }

    private static string CleanComponent(string? component)
        => string.IsNullOrWhiteSpace(component) ? "Safety recall campaign" : component.Replace(':', ' ').Trim();

    private static string VehicleName(JsonObject vehicle)
    {
        var name = ReadString(vehicle, "name");
        if (!string.IsNullOrWhiteSpace(name)) return name;
        return string.Join(" ", new[] { ReadString(vehicle, "year"), ReadString(vehicle, "make"), ReadString(vehicle, "model") }.Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value!));
    }

    private static string? ReadString(JsonObject? obj, string name)
    {
        if (obj?[name] is not JsonValue value) return null;
        return value.TryGetValue<string>(out var text) ? text?.Trim() : value.ToString().Trim();
    }


    private static async Task<NhtsaRecallResponse> ReadRecallResponseAsync(HttpResponseMessage response)
    {
        var body = await response.Content.ReadAsStringAsync();
        NhtsaRecallResponse? payload = null;
        if (!string.IsNullOrWhiteSpace(body))
        {
            try
            {
                payload = JsonSerializer.Deserialize<NhtsaRecallResponse>(body, new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
            }
            catch (JsonException) when (response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException("NHTSA returned an unreadable recall response.");
            }
        }

        if (response.IsSuccessStatusCode) return payload ?? new NhtsaRecallResponse();

        // NHTSA's recallsByVehicle endpoint can respond with HTTP 400 for a valid
        // vehicle that simply has no recall rows, while its JSON envelope still says
        // "Results returned successfully" and contains an empty results array.
        // The vehicle identity has already been validated against NHTSA's catalog, so
        // this specific response is a legitimate zero-recall result rather than a failure.
        if ((int)response.StatusCode == 400
            && payload is not null
            && payload.Count == 0
            && (payload.Results?.Count ?? 0) == 0
            && string.Equals(payload.Message?.Trim(), "Results returned successfully", StringComparison.OrdinalIgnoreCase))
            return payload;

        var detail = payload?.Message?.Trim();
        if (string.IsNullOrWhiteSpace(detail)) detail = response.ReasonPhrase ?? "Unknown upstream error";
        throw new HttpRequestException($"NHTSA recall API returned {(int)response.StatusCode} ({response.StatusCode}): {detail}", null, response.StatusCode);
    }

    private static DateTimeOffset? ParseReportDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (DateTimeOffset.TryParseExact(value, new[] { "MM/dd/yyyy", "yyyy-MM-dd", "dd/MM/yyyy" }, CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var exact)) return exact;
        return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed) ? parsed : null;
    }

    private static DateTimeOffset? ParseRoundtrip(string? value)
        => DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed) ? parsed : null;

    private sealed class NhtsaProductResponse
    {
        public List<NhtsaProductItem>? Results { get; set; }
    }

    private sealed class NhtsaProductItem
    {
        public string? Make { get; set; }
        public string? Model { get; set; }
    }

    private sealed class NhtsaRecallResponse
    {
        public int Count { get; set; }
        public string? Message { get; set; }
        public List<NhtsaRecallItem>? Results { get; set; }
    }

    internal sealed class NhtsaRecallItem
    {
        public string? Manufacturer { get; set; }
        public string? NhtsaCampaignNumber { get; set; }
        public bool ParkIt { get; set; }
        public bool ParkOutside { get; set; }
        public bool OverTheAirUpdate { get; set; }
        public string? ReportReceivedDate { get; set; }
        public string? Component { get; set; }
        public string? Summary { get; set; }
        public string? Consequence { get; set; }
        public string? Remedy { get; set; }
        public string? Notes { get; set; }
        public string? ModelYear { get; set; }
        public string? Make { get; set; }
        public string? Model { get; set; }
    }
}
