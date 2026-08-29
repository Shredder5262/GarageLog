using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

internal sealed record NotificationServerSettings(
    bool Enabled,
    bool ReminderNotificationsEnabled,
    bool RecallNotificationsEnabled,
    int ReminderLeadDays,
    int MileageLeadMiles,
    string RecallCheckSchedule,
    DateTimeOffset UpdatedUtc);

internal sealed record ServerNotificationDto(
    string Id,
    string Category,
    string Title,
    string Detail,
    string Tone,
    string Icon,
    string Page,
    string? VehicleId,
    string? RecordId,
    string? Url,
    DateTimeOffset CreatedUtc,
    DateTimeOffset? RelevantUtc);

internal static class NotificationFeature
{
    private static readonly Regex MileagePattern = new(@"(?<miles>\d[\d,]*(?:\.\d+)?)\s*(?:mi|mile|miles)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

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

            CREATE TABLE IF NOT EXISTS NotificationServerSettings (
                Id INTEGER PRIMARY KEY CHECK (Id = 1),
                Enabled INTEGER NOT NULL DEFAULT 0,
                ReminderNotificationsEnabled INTEGER NOT NULL DEFAULT 0,
                RecallNotificationsEnabled INTEGER NOT NULL DEFAULT 0,
                ReminderLeadDays INTEGER NOT NULL DEFAULT 7,
                MileageLeadMiles INTEGER NOT NULL DEFAULT 500,
                RecallCheckIntervalHours INTEGER NOT NULL DEFAULT 24,
                RecallCheckSchedule TEXT NOT NULL DEFAULT 'monthly',
                UpdatedUtc TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS NotificationEvents (
                Id TEXT PRIMARY KEY,
                Category TEXT NOT NULL,
                Title TEXT NOT NULL,
                Detail TEXT NOT NULL,
                Tone TEXT NOT NULL,
                Icon TEXT NOT NULL,
                Page TEXT NOT NULL,
                VehicleId TEXT NULL,
                RecordId TEXT NULL,
                Url TEXT NULL,
                CreatedUtc TEXT NOT NULL,
                RelevantUtc TEXT NULL,
                IsActive INTEGER NOT NULL DEFAULT 1,
                UpdatedUtc TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS IX_NotificationEvents_ActiveCreated
                ON NotificationEvents(IsActive, CreatedUtc DESC);

            CREATE INDEX IF NOT EXISTS IX_NotificationEvents_Vehicle
                ON NotificationEvents(VehicleId, IsActive);
            """;
        await command.ExecuteNonQueryAsync();
        await DatabaseMaintenance.EnsureColumnAsync(connection, "NotificationServerSettings", "RecallCheckSchedule", "TEXT NOT NULL DEFAULT 'monthly'");
        await using (var seed = connection.CreateCommand())
        {
            seed.CommandText = """
                INSERT INTO NotificationServerSettings
                    (Id, Enabled, ReminderNotificationsEnabled, RecallNotificationsEnabled,
                     ReminderLeadDays, MileageLeadMiles, RecallCheckIntervalHours, RecallCheckSchedule, UpdatedUtc)
                SELECT 1, 0, 0, 0, 7, 500, 24, 'monthly', $now
                WHERE NOT EXISTS (SELECT 1 FROM NotificationServerSettings WHERE Id = 1);
                """;
            seed.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            await seed.ExecuteNonQueryAsync();
        }
        await DatabaseMaintenance.MarkMigrationAsync(connection, "20260829_04_server_notifications");
        await DatabaseMaintenance.MarkMigrationAsync(connection, "20260829_06_recall_schedule_modes");

        const string optInDefaultsMigration = "20260829_07_notification_opt_in_defaults";
        if (!await DatabaseMaintenance.HasMigrationAsync(connection, optInDefaultsMigration))
        {
            await using var optInDefaults = connection.CreateCommand();
            optInDefaults.CommandText = """
                UPDATE NotificationServerSettings
                SET Enabled = 0,
                    ReminderNotificationsEnabled = 0,
                    RecallNotificationsEnabled = 0,
                    UpdatedUtc = $now
                WHERE Id = 1;
                """;
            optInDefaults.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            await optInDefaults.ExecuteNonQueryAsync();
            await DatabaseMaintenance.MarkMigrationAsync(connection, optInDefaultsMigration);
        }
    }

    public static async Task<NotificationServerSettings> ReadSettingsAsync(string connectionString)
    {
        // Settings are also consumed by Recall Monitoring. Make the read path
        // resilient when that feature initializes before Server Notifications.
        await InitializeAsync(connectionString);
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT Enabled, ReminderNotificationsEnabled, RecallNotificationsEnabled,
                   ReminderLeadDays, MileageLeadMiles, RecallCheckSchedule, UpdatedUtc
            FROM NotificationServerSettings
            WHERE Id = 1;
            """;
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            var now = DateTimeOffset.UtcNow;
            return new NotificationServerSettings(false, false, false, 7, 500, "monthly", now);
        }

        return new NotificationServerSettings(
            reader.GetInt64(0) != 0,
            reader.GetInt64(1) != 0,
            reader.GetInt64(2) != 0,
            Math.Clamp(reader.GetInt32(3), 0, 90),
            Math.Clamp(reader.GetInt32(4), 0, 10000),
            NormalizeRecallSchedule(reader.IsDBNull(5) ? null : reader.GetString(5)),
            DateTimeOffset.TryParse(reader.GetString(6), out var updated) ? updated : DateTimeOffset.UtcNow);
    }

    public static async Task<NotificationServerSettings> SaveSettingsAsync(
        string connectionString,
        bool enabled,
        bool reminderNotificationsEnabled,
        bool recallNotificationsEnabled,
        int reminderLeadDays,
        int mileageLeadMiles,
        string? recallCheckSchedule)
    {
        reminderLeadDays = Math.Clamp(reminderLeadDays, 0, 90);
        mileageLeadMiles = Math.Clamp(mileageLeadMiles, 0, 10000);
        recallCheckSchedule = NormalizeRecallSchedule(recallCheckSchedule);
        var now = DateTimeOffset.UtcNow;

        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE NotificationServerSettings
            SET Enabled = $enabled,
                ReminderNotificationsEnabled = $reminders,
                RecallNotificationsEnabled = $recalls,
                ReminderLeadDays = $leadDays,
                MileageLeadMiles = $leadMiles,
                RecallCheckSchedule = $recallSchedule,
                UpdatedUtc = $updated
            WHERE Id = 1;
            """;
        command.Parameters.AddWithValue("$enabled", enabled ? 1 : 0);
        command.Parameters.AddWithValue("$reminders", reminderNotificationsEnabled ? 1 : 0);
        command.Parameters.AddWithValue("$recalls", recallNotificationsEnabled ? 1 : 0);
        command.Parameters.AddWithValue("$leadDays", reminderLeadDays);
        command.Parameters.AddWithValue("$leadMiles", mileageLeadMiles);
        command.Parameters.AddWithValue("$recallSchedule", recallCheckSchedule);
        command.Parameters.AddWithValue("$updated", now.ToString("O"));
        await command.ExecuteNonQueryAsync();

        if (!enabled || !reminderNotificationsEnabled)
            await DeactivateCategoriesAsync(connectionString, new[] { "reminder", "maintenance" });
        if (!recallNotificationsEnabled)
            await DeactivateCategoriesAsync(connectionString, new[] { "recall" });

        return new NotificationServerSettings(enabled, reminderNotificationsEnabled, recallNotificationsEnabled,
            reminderLeadDays, mileageLeadMiles, recallCheckSchedule, now);
    }

    public static async Task<List<ServerNotificationDto>> ReadActiveNotificationsAsync(
        string connectionString,
        HashSet<string>? visibleVehicleIds = null,
        int limit = 100)
    {
        limit = Math.Clamp(limit, 1, 250);
        var items = new List<ServerNotificationDto>();
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT Id, Category, Title, Detail, Tone, Icon, Page, VehicleId, RecordId, Url,
                   CreatedUtc, RelevantUtc
            FROM NotificationEvents
            WHERE IsActive = 1
            ORDER BY CASE Tone WHEN 'red' THEN 0 WHEN 'orange' THEN 1 ELSE 2 END,
                     COALESCE(RelevantUtc, CreatedUtc) DESC,
                     CreatedUtc DESC
            LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$limit", limit);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            var vehicleId = reader.IsDBNull(7) ? null : reader.GetString(7);
            if (visibleVehicleIds is not null && vehicleId is not null && !visibleVehicleIds.Contains(vehicleId))
                continue;

            items.Add(new ServerNotificationDto(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetString(6),
                vehicleId,
                reader.IsDBNull(8) ? null : reader.GetString(8),
                reader.IsDBNull(9) ? null : reader.GetString(9),
                ParseDateTimeOffset(reader.GetString(10)) ?? DateTimeOffset.UtcNow,
                reader.IsDBNull(11) ? null : ParseDateTimeOffset(reader.GetString(11))));
        }
        return items;
    }

    public static async Task EvaluateReminderNotificationsAsync(
        string connectionString,
        string fallbackStateJson,
        ILogger logger)
    {
        var settings = await ReadSettingsAsync(connectionString);
        if (!settings.Enabled || !settings.ReminderNotificationsEnabled)
        {
            await DeactivateCategoriesAsync(connectionString, new[] { "reminder", "maintenance" });
            return;
        }

        var stored = await StateStore.ReadAsync(connectionString, fallbackStateJson);
        var root = JsonNode.Parse(stored.Json)?.AsObject() ?? new JsonObject();
        var vehicles = (root["vehicles"] as JsonArray ?? new JsonArray())
            .OfType<JsonObject>()
            .Where(vehicle => !string.IsNullOrWhiteSpace(ReadString(vehicle, "id")))
            .ToDictionary(vehicle => ReadString(vehicle, "id")!, vehicle => vehicle, StringComparer.Ordinal);

        await DeactivateCategoriesAsync(connectionString, new[] { "reminder", "maintenance" });
        var now = DateTimeOffset.Now;
        var reminders = (root["reminders"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().ToArray();
        var maintenanceItems = (root["maintenance"] as JsonArray ?? new JsonArray()).OfType<JsonObject>().ToArray();
        var linkedMaintenanceIds = reminders
            .Select(item => ReadString(item, "maintenanceId"))
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id!)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var reminder in reminders)
        {
            if (string.Equals(ReadString(reminder, "status"), "Completed", StringComparison.OrdinalIgnoreCase))
                continue;
            var id = ReadString(reminder, "id");
            if (string.IsNullOrWhiteSpace(id)) continue;
            var vehicleId = ReadString(reminder, "vehicleId");
            vehicles.TryGetValue(vehicleId ?? string.Empty, out var vehicle);
            if (!TryResolveDueStatus(reminder, vehicle, settings, now, out var status, out var relevantUtc, out var dueDescription))
                continue;

            await UpsertAsync(connectionString, new ServerNotificationDto(
                $"reminder:{id}:{status}",
                "reminder",
                $"{ReadString(reminder, "name") ?? "Reminder"} — {status}",
                $"{VehicleName(vehicle)} · {dueDescription}",
                status == "Overdue" ? "red" : "orange",
                "bell",
                "Reminders",
                vehicleId,
                id,
                null,
                DateTimeOffset.UtcNow,
                relevantUtc));
        }

        foreach (var maintenance in maintenanceItems)
        {
            if (string.Equals(ReadString(maintenance, "status"), "Completed", StringComparison.OrdinalIgnoreCase))
                continue;
            var id = ReadString(maintenance, "id");
            if (string.IsNullOrWhiteSpace(id)) continue;
            if (linkedMaintenanceIds.Contains(id) || !string.IsNullOrWhiteSpace(ReadString(maintenance, "reminderId")))
                continue;
            var vehicleId = ReadString(maintenance, "vehicleId");
            vehicles.TryGetValue(vehicleId ?? string.Empty, out var vehicle);
            if (!TryResolveDueStatus(maintenance, vehicle, settings, now, out var status, out var relevantUtc, out var dueDescription))
                continue;

            await UpsertAsync(connectionString, new ServerNotificationDto(
                $"maintenance:{id}:{status}",
                "maintenance",
                $"{ReadString(maintenance, "name") ?? "Maintenance"} — {status}",
                $"{VehicleName(vehicle)} · {dueDescription}",
                status == "Overdue" ? "red" : "orange",
                "wrench",
                "Maintenance",
                vehicleId,
                id,
                null,
                DateTimeOffset.UtcNow,
                relevantUtc));
        }

        logger.LogDebug("GarageLog server notification evaluation completed.");
    }

    public static void StartBackgroundProcessing(
        IHostApplicationLifetime lifetime,
        string connectionString,
        string fallbackStateJson,
        IHttpClientFactory httpClientFactory,
        ILogger logger)
    {
        var cancellationToken = lifetime.ApplicationStopping;
        _ = Task.Run(async () =>
        {
            var startupPass = true;
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(20), cancellationToken);
                while (!cancellationToken.IsCancellationRequested)
                {
                    try
                    {
                        await EvaluateReminderNotificationsAsync(connectionString, fallbackStateJson, logger);
                        var settings = await ReadSettingsAsync(connectionString);
                        if (settings.RecallNotificationsEnabled)
                        {
                            var schedule = NormalizeRecallSchedule(settings.RecallCheckSchedule);
                            var client = httpClientFactory.CreateClient("NhtsaRecalls");
                            if (schedule == "startup" && startupPass)
                                await RecallFeature.RefreshDueAsync(connectionString, fallbackStateJson, client, logger, force: true);
                            else if (schedule is "monthly" or "quarterly" or "semiannual")
                                await RecallFeature.RefreshDueAsync(connectionString, fallbackStateJson, client, logger, force: false);
                        }
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        break;
                    }
                    catch (Exception ex)
                    {
                        logger.LogWarning(ex, "GarageLog background notification evaluation failed.");
                    }
                    finally
                    {
                        startupPass = false;
                    }

                    await Task.Delay(TimeSpan.FromMinutes(15), cancellationToken);
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
            }
        }, cancellationToken);
    }

    internal static string NormalizeRecallSchedule(string? value)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        return normalized switch
        {
            "manual" => "manual",
            "startup" => "startup",
            "monthly" => "monthly",
            "quarterly" or "3months" or "3-months" => "quarterly",
            "semiannual" or "6months" or "6-months" => "semiannual",
            _ => "monthly"
        };
    }

    internal static DateTimeOffset? NextRecallCheckUtc(DateTimeOffset lastSuccessUtc, string? value)
    {
        return NormalizeRecallSchedule(value) switch
        {
            "monthly" => lastSuccessUtc.AddMonths(1),
            "quarterly" => lastSuccessUtc.AddMonths(3),
            "semiannual" => lastSuccessUtc.AddMonths(6),
            _ => null
        };
    }

    internal static async Task UpsertAsync(string connectionString, ServerNotificationDto item)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO NotificationEvents
                (Id, Category, Title, Detail, Tone, Icon, Page, VehicleId, RecordId, Url,
                 CreatedUtc, RelevantUtc, IsActive, UpdatedUtc)
            VALUES
                ($id, $category, $title, $detail, $tone, $icon, $page, $vehicleId, $recordId, $url,
                 $createdUtc, $relevantUtc, 1, $updatedUtc)
            ON CONFLICT(Id) DO UPDATE SET
                Category = excluded.Category,
                Title = excluded.Title,
                Detail = excluded.Detail,
                Tone = excluded.Tone,
                Icon = excluded.Icon,
                Page = excluded.Page,
                VehicleId = excluded.VehicleId,
                RecordId = excluded.RecordId,
                Url = excluded.Url,
                RelevantUtc = excluded.RelevantUtc,
                IsActive = 1,
                UpdatedUtc = excluded.UpdatedUtc;
            """;
        command.Parameters.AddWithValue("$id", item.Id);
        command.Parameters.AddWithValue("$category", item.Category);
        command.Parameters.AddWithValue("$title", item.Title);
        command.Parameters.AddWithValue("$detail", item.Detail);
        command.Parameters.AddWithValue("$tone", item.Tone);
        command.Parameters.AddWithValue("$icon", item.Icon);
        command.Parameters.AddWithValue("$page", item.Page);
        command.Parameters.AddWithValue("$vehicleId", (object?)item.VehicleId ?? DBNull.Value);
        command.Parameters.AddWithValue("$recordId", (object?)item.RecordId ?? DBNull.Value);
        command.Parameters.AddWithValue("$url", (object?)item.Url ?? DBNull.Value);
        command.Parameters.AddWithValue("$createdUtc", item.CreatedUtc.ToString("O"));
        command.Parameters.AddWithValue("$relevantUtc", item.RelevantUtc.HasValue ? (object)item.RelevantUtc.Value.ToString("O") : DBNull.Value);
        command.Parameters.AddWithValue("$updatedUtc", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync();
    }

    internal static async Task DeactivateCategoriesAsync(string connectionString, IEnumerable<string> categories)
    {
        var values = categories.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        if (values.Length == 0) return;
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        var parameters = new List<string>();
        for (var i = 0; i < values.Length; i++)
        {
            var name = $"$category{i}";
            parameters.Add(name);
            command.Parameters.AddWithValue(name, values[i]);
        }
        command.CommandText = $"UPDATE NotificationEvents SET IsActive = 0, UpdatedUtc = $now WHERE Category IN ({string.Join(",", parameters)});";
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync();
    }

    private static bool TryResolveDueStatus(
        JsonObject item,
        JsonObject? vehicle,
        NotificationServerSettings settings,
        DateTimeOffset now,
        out string status,
        out DateTimeOffset? relevantUtc,
        out string dueDescription)
    {
        status = string.Empty;
        relevantUtc = null;
        dueDescription = string.Empty;
        var due = ReadString(item, "due") ?? string.Empty;
        var rule = ReadString(item, "rule") ?? ReadString(item, "interval") ?? string.Empty;

        if (TryParseDate(due, out var dueDate) || TryParseDate(rule, out dueDate))
        {
            var localDue = new DateTimeOffset(DateTime.SpecifyKind(dueDate.Date, DateTimeKind.Unspecified), now.Offset);
            var today = new DateTimeOffset(DateTime.SpecifyKind(now.Date, DateTimeKind.Unspecified), now.Offset);
            var days = (localDue - today).Days;
            var leadDays = ReadNumber(item, "leadTime") is double configuredLeadDays
                && !string.Equals(ReadString(item, "leadUnit"), "miles", StringComparison.OrdinalIgnoreCase)
                ? Math.Clamp((int)Math.Round(configuredLeadDays), 0, 90)
                : settings.ReminderLeadDays;
            if (days > leadDays) return false;
            status = days < 0 ? "Overdue" : "Due Soon";
            relevantUtc = localDue.ToUniversalTime();
            dueDescription = days < 0
                ? $"{Math.Abs(days)} day{(Math.Abs(days) == 1 ? string.Empty : "s")} overdue"
                : days == 0 ? "Due today" : $"Due in {days} day{(days == 1 ? string.Empty : "s")}";
            return true;
        }

        var mileageText = !string.IsNullOrWhiteSpace(due) ? due : rule;
        if (!TryParseMileage(mileageText, out var dueMileage)) return false;
        var currentMileage = ReadNumber(vehicle, "mileage");
        if (!currentMileage.HasValue) return false;
        var remaining = dueMileage - currentMileage.Value;
        var mileageLead = ReadNumber(item, "leadTime") is double configuredMileageLead
            && string.Equals(ReadString(item, "leadUnit"), "miles", StringComparison.OrdinalIgnoreCase)
            ? Math.Clamp(configuredMileageLead, 0, 10000)
            : settings.MileageLeadMiles;
        if (remaining > mileageLead) return false;
        status = remaining <= 0 ? "Overdue" : "Due Soon";
        dueDescription = remaining <= 0
            ? $"Due at {dueMileage:N0} mi · {Math.Abs(remaining):N0} mi overdue"
            : $"Due at {dueMileage:N0} mi · {remaining:N0} mi remaining";
        return true;
    }

    private static bool TryParseDate(string? value, out DateTime date)
    {
        date = default;
        if (string.IsNullOrWhiteSpace(value)) return false;
        return DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AllowWhiteSpaces, out date)
            || DateTime.TryParse(value, CultureInfo.CurrentCulture, DateTimeStyles.AllowWhiteSpaces, out date);
    }

    private static bool TryParseMileage(string? value, out double miles)
    {
        miles = 0;
        if (string.IsNullOrWhiteSpace(value)) return false;
        var match = MileagePattern.Match(value);
        return match.Success
            && double.TryParse(match.Groups["miles"].Value.Replace(",", string.Empty), NumberStyles.Float, CultureInfo.InvariantCulture, out miles)
            && miles >= 0;
    }

    private static string VehicleName(JsonObject? vehicle)
    {
        if (vehicle is null) return "Vehicle";
        var name = ReadString(vehicle, "name");
        if (!string.IsNullOrWhiteSpace(name)) return name;
        return string.Join(" ", new[] { ReadString(vehicle, "year"), ReadString(vehicle, "make"), ReadString(vehicle, "model") }.Where(value => !string.IsNullOrWhiteSpace(value)).Select(value => value!));
    }

    private static string? ReadString(JsonObject? obj, string name)
    {
        if (obj?[name] is not JsonValue value) return null;
        return value.TryGetValue<string>(out var text) ? text?.Trim() : value.ToString().Trim();
    }

    private static double? ReadNumber(JsonObject? obj, string name)
    {
        if (obj?[name] is not JsonValue value) return null;
        if (value.TryGetValue<double>(out var number) && double.IsFinite(number)) return number;
        if (value.TryGetValue<long>(out var whole)) return whole;
        if (value.TryGetValue<string>(out var text)
            && double.TryParse(text?.Replace(",", string.Empty), NumberStyles.Float, CultureInfo.InvariantCulture, out number)) return number;
        return null;
    }

    private static DateTimeOffset? ParseDateTimeOffset(string? value)
        => DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed) ? parsed : null;
}
