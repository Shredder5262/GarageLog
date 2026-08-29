using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;

var failures = new List<string>();

await RunAsync("state revision rejects stale writes", TestStateRevisionAsync);
await RunAsync("legacy share cleanup does not resurrect deleted links", TestLegacyShareCleanupAsync);
Run("telemetry fingerprint is deterministic", TestTelemetryFingerprint);
await RunAsync("historical duplicate telemetry is superseded", TestTelemetryBackfillAsync);
await RunAsync("server notifications persist and dedupe", TestServerNotificationPersistenceAsync);
await RunAsync("server notification settings persist", TestServerNotificationSettingsAsync);
await RunAsync("recall schedule migrates existing settings", TestRecallScheduleMigrationAsync);
await RunAsync("NHTSA vehicle match validates alternate make/model", TestRecallVehicleMatchAsync);
await RunAsync("NHTSA zero-recall HTTP 400 is treated as empty success", TestNhtsaZeroRecall400Async);
await RunAsync("recall badge dismissal does not delete cached recall data", TestRecallDismissalAsync);
await RunAsync("linked maintenance reminder produces one server alert", TestLinkedReminderDedupeAsync);

if (failures.Count > 0)
{
    Console.Error.WriteLine();
    Console.Error.WriteLine($"{failures.Count} GarageLog regression check(s) failed:");
    foreach (var failure in failures) Console.Error.WriteLine($" - {failure}");
    return 1;
}

Console.WriteLine();
Console.WriteLine("All GarageLog regression checks passed.");
return 0;

async Task RunAsync(string name, Func<Task> test)
{
    try
    {
        await test();
        Console.WriteLine($"PASS  {name}");
    }
    catch (Exception ex)
    {
        failures.Add($"{name}: {ex.Message}");
        Console.Error.WriteLine($"FAIL  {name}: {ex.Message}");
    }
}

void Run(string name, Action test)
{
    try
    {
        test();
        Console.WriteLine($"PASS  {name}");
    }
    catch (Exception ex)
    {
        failures.Add($"{name}: {ex.Message}");
        Console.Error.WriteLine($"FAIL  {name}: {ex.Message}");
    }
}

static async Task TestStateRevisionAsync()
{
    var path = TempDatabasePath();
    try
    {
        var cs = ConnectionString(path);
        await using (var connection = new SqliteConnection(cs))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE AppState (
                    Id INTEGER PRIMARY KEY CHECK (Id = 1),
                    Json TEXT NOT NULL,
                    UpdatedUtc TEXT NOT NULL,
                    Revision INTEGER NOT NULL DEFAULT 1
                );
                INSERT INTO AppState (Id, Json, UpdatedUtc, Revision)
                VALUES (1, '{"vehicles":[]}', $now, 1);
                """;
            command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            await command.ExecuteNonQueryAsync();
        }

        var first = await StateStore.WriteAsync(cs, "{\"vehicles\":[{\"id\":\"a\"}]}", 1);
        Assert(first.Saved && first.Revision == 2, "first revision-aware write should advance revision to 2");

        var stale = await StateStore.WriteAsync(cs, "{\"vehicles\":[]}", 1);
        Assert(!stale.Saved && stale.Revision == 2, "stale revision must be rejected without overwriting current state");

        var stored = await StateStore.ReadAsync(cs, "{}");
        Assert(stored.Json.Contains("\"id\":\"a\"", StringComparison.Ordinal), "stale write overwrote the newer state");
    }
    finally
    {
        TryDelete(path);
    }
}

static async Task TestLegacyShareCleanupAsync()
{
    var path = TempDatabasePath();
    try
    {
        var cs = ConnectionString(path);
        const string token = "legacy_share_token_1234567890";
        var state = new JsonObject
        {
            ["documents"] = new JsonArray
            {
                new JsonObject
                {
                    ["id"] = "doc-1",
                    ["storedName"] = "receipt.pdf",
                    ["shareToken"] = token,
                    ["shareEnabled"] = true,
                    ["addedAt"] = "2026-08-01T12:00:00Z"
                }
            }
        };

        await using (var connection = new SqliteConnection(cs))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE AppState (
                    Id INTEGER PRIMARY KEY CHECK (Id = 1),
                    Json TEXT NOT NULL,
                    UpdatedUtc TEXT NOT NULL,
                    Revision INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE SchemaMigrations (Id TEXT PRIMARY KEY, AppliedUtc TEXT NOT NULL);
                CREATE TABLE DocumentShareLinks (
                    Token TEXT PRIMARY KEY,
                    StoredName TEXT NOT NULL,
                    CreatedByUserId TEXT NULL,
                    CreatedUtc TEXT NOT NULL,
                    ExpiresUtc TEXT NULL,
                    RevokedUtc TEXT NULL,
                    LastAccessUtc TEXT NULL,
                    AccessCount INTEGER NOT NULL DEFAULT 0
                );
                INSERT INTO AppState (Id, Json, UpdatedUtc, Revision) VALUES (1, $json, $now, 1);
                """;
            command.Parameters.AddWithValue("$json", state.ToJsonString());
            command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            await command.ExecuteNonQueryAsync();
        }

        // Simulates a current GarageLog database whose share table already
        // existed and from which the user permanently deleted the legacy row.
        await LegacyDocumentShareMigration.ApplyAsync(cs, importLegacyRows: false);
        await LegacyDocumentShareMigration.ApplyAsync(cs, importLegacyRows: false);

        await using var verify = new SqliteConnection(cs);
        await verify.OpenAsync();
        await using var count = verify.CreateCommand();
        count.CommandText = "SELECT COUNT(*) FROM DocumentShareLinks WHERE Token = $token;";
        count.Parameters.AddWithValue("$token", token);
        Assert(Convert.ToInt32(await count.ExecuteScalarAsync()) == 0, "deleted legacy share link was re-created");

        var stored = await StateStore.ReadAsync(cs, "{}");
        var root = JsonNode.Parse(stored.Json)!.AsObject();
        var document = root["documents"]!.AsArray()[0]!.AsObject();
        Assert(document["shareToken"] is null && document["shareEnabled"] is null, "legacy share metadata was not removed from AppState");
    }
    finally
    {
        TryDelete(path);
    }
}

static void TestTelemetryFingerprint()
{
    var started = new DateTimeOffset(2026, 8, 28, 22, 0, 0, TimeSpan.Zero);
    var ended = started.AddMinutes(20);
    var first = ApiTokenFeature.BuildTelemetryTripFingerprint("obd-device-01", started, ended, 12.3456, 1000, 1012.3456);
    var duplicate = ApiTokenFeature.BuildTelemetryTripFingerprint("OBD-DEVICE-01", started.AddMilliseconds(200), ended.AddMilliseconds(200), 12.34559, 1000, 1012.34559);
    var different = ApiTokenFeature.BuildTelemetryTripFingerprint("obd-device-01", started, ended.AddSeconds(1), 12.3456, 1000, 1012.3456);

    Assert(first == duplicate, "retry-only casing/sub-second/rounding differences should keep the same trip fingerprint");
    Assert(first != different, "materially different trips should not share a fingerprint");
}


static async Task TestTelemetryBackfillAsync()
{
    var path = TempDatabasePath();
    try
    {
        var cs = ConnectionString(path);
        await using var connection = new SqliteConnection(cs);
        await connection.OpenAsync();
        await using (var schema = connection.CreateCommand())
        {
            schema.CommandText = """
                CREATE TABLE TelemetryTrips (
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
                    TripFingerprint TEXT NULL
                );
                CREATE UNIQUE INDEX UX_TelemetryTrips_ApiToken_TripFingerprint
                    ON TelemetryTrips(ApiTokenId, TripFingerprint)
                    WHERE TripFingerprint IS NOT NULL;
                CREATE TABLE TelemetryTripAssociations (
                    TripId TEXT PRIMARY KEY,
                    DeviceId TEXT NULL,
                    OdometerStatus TEXT NOT NULL,
                    UpdatedUtc TEXT NOT NULL
                );
                INSERT INTO TelemetryTrips VALUES
                    ('trip-a','token-1','client-a','2026-08-28T22:00:00Z','2026-08-28T22:20:00Z',12.5,1000,1012.5,'OBD','2026-08-28T22:21:00Z',NULL),
                    ('trip-b','token-1','client-b','2026-08-28T22:00:00.200Z','2026-08-28T22:20:00.200Z',12.5001,1000,1012.5001,'retry','2026-08-28T22:22:00Z',NULL);
                INSERT INTO TelemetryTripAssociations VALUES
                    ('trip-a','obd-device-01','pending','2026-08-28T22:21:00Z'),
                    ('trip-b','OBD-DEVICE-01','pending','2026-08-28T22:22:00Z');
                """;
            await schema.ExecuteNonQueryAsync();
        }

        await ApiTokenFeature.BackfillTelemetryTripFingerprintsAsync(connection);

        await using var verify = connection.CreateCommand();
        verify.CommandText = """
            SELECT t.Id, t.TripFingerprint, a.OdometerStatus
            FROM TelemetryTrips t
            JOIN TelemetryTripAssociations a ON a.TripId = t.Id
            ORDER BY t.ReceivedUtc;
            """;
        await using var reader = await verify.ExecuteReaderAsync();
        Assert(await reader.ReadAsync(), "canonical telemetry row missing");
        var canonicalFingerprint = reader.GetString(1);
        Assert(reader.GetString(2) == "pending", "canonical proposal should remain pending");
        Assert(await reader.ReadAsync(), "duplicate telemetry row missing");
        Assert(reader.GetString(1).StartsWith(canonicalFingerprint + "-duplicate-", StringComparison.Ordinal), "duplicate telemetry row was not archived under the canonical fingerprint");
        Assert(reader.GetString(2) == "superseded", "duplicate odometer proposal was not superseded");
    }
    finally
    {
        TryDelete(path);
    }
}

static async Task TestServerNotificationPersistenceAsync()
{
    var path = TempDatabasePath();
    try
    {
        var cs = ConnectionString(path);
        await NotificationFeature.InitializeAsync(cs);
        var created = new DateTimeOffset(2026, 8, 29, 12, 0, 0, TimeSpan.Zero);
        await NotificationFeature.UpsertAsync(cs, new ServerNotificationDto(
            "reminder:test:Due Soon", "reminder", "Oil change — Due Soon", "Test Vehicle · Due in 7 days",
            "orange", "bell", "Reminders", "vehicle-1", "reminder-1", null, created, created.AddDays(7)));
        await NotificationFeature.UpsertAsync(cs, new ServerNotificationDto(
            "reminder:test:Due Soon", "reminder", "Oil change — Due Soon", "Test Vehicle · Due in 5 days",
            "orange", "bell", "Reminders", "vehicle-1", "reminder-1", null, created, created.AddDays(5)));

        var items = await NotificationFeature.ReadActiveNotificationsAsync(cs, null, 20);
        Assert(items.Count == 1, "repeated evaluation created duplicate server notification rows");
        Assert(items[0].Detail.Contains("5 days", StringComparison.Ordinal), "existing server notification was not refreshed in place");
    }
    finally
    {
        TryDelete(path);
    }
}

static async Task TestServerNotificationSettingsAsync()
{
    var path = TempDatabasePath();
    try
    {
        var cs = ConnectionString(path);
        await NotificationFeature.InitializeAsync(cs);
        var defaults = await NotificationFeature.ReadSettingsAsync(cs);
        Assert(!defaults.Enabled && !defaults.ReminderNotificationsEnabled && !defaults.RecallNotificationsEnabled, "notification and recall services should default to disabled");
        var saved = await NotificationFeature.SaveSettingsAsync(cs, false, true, false, 14, 750, "quarterly");
        Assert(!saved.Enabled, "server notification master switch did not persist");
        Assert(saved.ReminderLeadDays == 14 && saved.MileageLeadMiles == 750 && saved.RecallCheckSchedule == "quarterly",
            "server notification thresholds or recall schedule were not saved");
        var read = await NotificationFeature.ReadSettingsAsync(cs);
        Assert(!read.Enabled && !read.RecallNotificationsEnabled && read.RecallCheckSchedule == "quarterly", "server notification settings did not round-trip");
    }
    finally
    {
        TryDelete(path);
    }
}

static async Task TestRecallScheduleMigrationAsync()
{
    var path = TempDatabasePath();
    try
    {
        var cs = ConnectionString(path);
        await using (var connection = new SqliteConnection(cs))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE NotificationServerSettings (
                    Id INTEGER PRIMARY KEY CHECK (Id = 1),
                    Enabled INTEGER NOT NULL DEFAULT 1,
                    ReminderNotificationsEnabled INTEGER NOT NULL DEFAULT 1,
                    RecallNotificationsEnabled INTEGER NOT NULL DEFAULT 0,
                    ReminderLeadDays INTEGER NOT NULL DEFAULT 7,
                    MileageLeadMiles INTEGER NOT NULL DEFAULT 500,
                    RecallCheckIntervalHours INTEGER NOT NULL DEFAULT 24,
                    UpdatedUtc TEXT NOT NULL
                );
                INSERT INTO NotificationServerSettings
                    (Id, Enabled, ReminderNotificationsEnabled, RecallNotificationsEnabled, ReminderLeadDays, MileageLeadMiles, RecallCheckIntervalHours, UpdatedUtc)
                VALUES (1, 1, 1, 1, 7, 500, 24, '2026-08-29T00:00:00.0000000+00:00');
                """;
            await command.ExecuteNonQueryAsync();
        }

        await NotificationFeature.InitializeAsync(cs);
        var settings = await NotificationFeature.ReadSettingsAsync(cs);
        Assert(settings.RecallCheckSchedule == "monthly", "existing notification settings did not receive the default monthly recall schedule");
        Assert(!settings.Enabled && !settings.ReminderNotificationsEnabled && !settings.RecallNotificationsEnabled, "existing pre-release notification settings were not reset to opt-in defaults");
        var sample = new DateTimeOffset(2026, 1, 31, 12, 0, 0, TimeSpan.Zero);
        Assert(NotificationFeature.NextRecallCheckUtc(sample, "quarterly") == sample.AddMonths(3), "quarterly recall schedule interval is incorrect");
    }
    finally
    {
        TryDelete(path);
    }
}

static async Task TestRecallVehicleMatchAsync()
{
    var path = TempDatabasePath();
    try
    {
        var cs = ConnectionString(path);
        await using (var connection = new SqliteConnection(cs))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE AppState (
                    Id INTEGER PRIMARY KEY CHECK (Id = 1),
                    Json TEXT NOT NULL,
                    UpdatedUtc TEXT NOT NULL,
                    Revision INTEGER NOT NULL DEFAULT 1
                );
                INSERT INTO AppState (Id, Json, UpdatedUtc, Revision)
                VALUES (1, $json, $now, 1);
                """;
            command.Parameters.AddWithValue("$json", "{\"vehicles\":[{\"id\":\"truck-1\",\"year\":\"2015\",\"make\":\"Dodge\",\"model\":\"RAM 1500\",\"name\":\"2015 Dodge RAM 1500\"}]}");
            command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            await command.ExecuteNonQueryAsync();
        }
        await RecallFeature.InitializeAsync(cs);
        using var client = new HttpClient(new FakeNhtsaCatalogHandler()) { BaseAddress = new Uri("https://api.nhtsa.gov/") };
        var match = await RecallFeature.BuildVehicleMatchAsync(cs, "{}", "truck-1", client);
        Assert(match is not null, "vehicle match response was null");
        Assert(match!.Suggestions.Any(item => item.Make == "RAM" && item.Model == "1500"), "GarageLog did not suggest NHTSA RAM 1500 for Dodge RAM 1500");
        var profile = await RecallFeature.SaveVehicleMatchAsync(cs, "{}", "truck-1", "2015", "RAM", "1500", client);
        Assert(profile.IsValidated && profile.NhtsaMake == "RAM" && profile.NhtsaModel == "1500", "validated NHTSA profile did not persist canonical make/model");
        var summary = await RecallFeature.ReadSummaryAsync(cs, "{}");
        var vehicle = summary.Vehicles.Single(item => item.VehicleId == "truck-1");
        Assert(vehicle.IsValidated && vehicle.Query == "2015 RAM 1500", "recall summary did not expose the saved NHTSA match");
    }
    finally
    {
        TryDelete(path);
    }
}

static async Task TestNhtsaZeroRecall400Async()
{
    var path = TempDatabasePath();
    try
    {
        var cs = ConnectionString(path);
        await using (var connection = new SqliteConnection(cs))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE AppState (
                    Id INTEGER PRIMARY KEY CHECK (Id = 1),
                    Json TEXT NOT NULL,
                    UpdatedUtc TEXT NOT NULL,
                    Revision INTEGER NOT NULL DEFAULT 1
                );
                INSERT INTO AppState (Id, Json, UpdatedUtc, Revision)
                VALUES (1, $json, $now, 1);
                """;
            command.Parameters.AddWithValue("$json", "{\"vehicles\":[{\"id\":\"bike-1\",\"year\":\"2008\",\"make\":\"Harley Davidson\",\"model\":\"FXSTB\",\"name\":\"2008 Harley Davidson FXSTB\"}]}");
            command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            await command.ExecuteNonQueryAsync();
        }
        await RecallFeature.InitializeAsync(cs);
        using var client = new HttpClient(new FakeNhtsaHarleyNoRecallsHandler()) { BaseAddress = new Uri("https://api.nhtsa.gov/") };
        var match = await RecallFeature.BuildVehicleMatchAsync(cs, "{}", "bike-1", client);
        Assert(match is not null && match.Suggestions.Any(item => item.Make == "HARLEY-DAVIDSON" && item.Model == "FXSTB"), "GarageLog did not match Harley Davidson FXSTB to NHTSA's canonical identity");
        await RecallFeature.SaveVehicleMatchAsync(cs, "{}", "bike-1", "2008", "HARLEY-DAVIDSON", "FXSTB", client);
        var result = await RecallFeature.RefreshDueAsync(cs, "{}", client, NullLogger.Instance, force: true);
        Assert(result.VehiclesChecked == 1 && result.CampaignsFound == 0 && result.Errors == 0, "NHTSA's HTTP 400 empty-success response was incorrectly treated as an error");
        var summary = await RecallFeature.ReadSummaryAsync(cs, "{}");
        var vehicle = summary.Vehicles.Single(item => item.VehicleId == "bike-1");
        Assert(vehicle.LastSuccessUtc is not null && string.IsNullOrWhiteSpace(vehicle.LastError) && vehicle.RecallCount == 0, "zero-recall NHTSA response did not persist as a successful check");
    }
    finally
    {
        TryDelete(path);
    }
}

static async Task TestRecallDismissalAsync()
{
    var path = TempDatabasePath();
    try
    {
        var cs = ConnectionString(path);
        await using (var connection = new SqliteConnection(cs))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE AppState (
                    Id INTEGER PRIMARY KEY CHECK (Id = 1),
                    Json TEXT NOT NULL,
                    UpdatedUtc TEXT NOT NULL,
                    Revision INTEGER NOT NULL DEFAULT 1
                );
                INSERT INTO AppState (Id, Json, UpdatedUtc, Revision)
                VALUES (1, '{"vehicles":[{"id":"vehicle-1","name":"Test Vehicle"}]}', $now, 1);
                """;
            command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            await command.ExecuteNonQueryAsync();
        }
        await RecallFeature.InitializeAsync(cs);
        await using (var connection = new SqliteConnection(cs))
        {
            await connection.OpenAsync();
            await using var insert = connection.CreateCommand();
            insert.CommandText = """
                INSERT INTO VehicleRecalls
                    (VehicleId, CampaignNumber, Manufacturer, Component, Summary, Consequence, Remedy,
                     SourceUrl, FirstSeenUtc, LastSeenUtc, IsCurrent)
                VALUES
                    ('vehicle-1','26V000001','TEST','BRAKES','Recall summary','Risk','Repair',
                     'https://www.nhtsa.gov/recalls',$now,$now,1);
                """;
            insert.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            await insert.ExecuteNonQueryAsync();
        }

        var before = await RecallFeature.ReadRecallsAsync(cs, "{}");
        Assert(before.Count == 1 && !before[0].IsDismissed, "new recall should surface on the recall badge");
        await RecallFeature.DismissCurrentRecallsAsync(cs, "vehicle-1", new[] { "26V000001" });
        var after = await RecallFeature.ReadRecallsAsync(cs, "{}");
        Assert(after.Count == 1, "clearing the recall badge must not delete cached recall details");
        Assert(after[0].IsDismissed, "cleared recall campaign was not marked dismissed");
    }
    finally
    {
        TryDelete(path);
    }
}

static async Task TestLinkedReminderDedupeAsync()
{
    var path = TempDatabasePath();
    try
    {
        var cs = ConnectionString(path);
        await using (var connection = new SqliteConnection(cs))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE AppState (
                    Id INTEGER PRIMARY KEY CHECK (Id = 1),
                    Json TEXT NOT NULL,
                    UpdatedUtc TEXT NOT NULL,
                    Revision INTEGER NOT NULL DEFAULT 1
                );
                INSERT INTO AppState (Id, Json, UpdatedUtc, Revision)
                VALUES (1, $json, $now, 1);
                """;
            var due = DateTime.Now.Date.AddDays(1).ToString("yyyy-MM-dd");
            var state = new JsonObject
            {
                ["vehicles"] = new JsonArray
                {
                    new JsonObject { ["id"] = "vehicle-1", ["name"] = "Test Vehicle", ["mileage"] = 10000 }
                },
                ["reminders"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["id"] = "reminder-1", ["vehicleId"] = "vehicle-1", ["maintenanceId"] = "maintenance-1",
                        ["name"] = "Oil Change", ["due"] = due, ["status"] = "Upcoming", ["leadTime"] = 7, ["leadUnit"] = "days"
                    }
                },
                ["maintenance"] = new JsonArray
                {
                    new JsonObject
                    {
                        ["id"] = "maintenance-1", ["vehicleId"] = "vehicle-1", ["reminderId"] = "reminder-1",
                        ["name"] = "Oil Change", ["due"] = due, ["status"] = "Upcoming", ["leadTime"] = 7
                    }
                }
            };
            command.Parameters.AddWithValue("$json", state.ToJsonString());
            command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            await command.ExecuteNonQueryAsync();
        }

        await NotificationFeature.InitializeAsync(cs);
        await NotificationFeature.SaveSettingsAsync(
            cs,
            enabled: true,
            reminderNotificationsEnabled: true,
            recallNotificationsEnabled: false,
            reminderLeadDays: 7,
            mileageLeadMiles: 500,
            recallCheckSchedule: "monthly");
        await NotificationFeature.EvaluateReminderNotificationsAsync(cs, "{}", NullLogger.Instance);
        var items = await NotificationFeature.ReadActiveNotificationsAsync(cs, null, 20);
        Assert(items.Count == 1, $"linked reminder and maintenance item should create exactly one server alert, but created {items.Count}");
        Assert(items[0].Category == "reminder", "linked maintenance should use the reminder as the canonical alert");
    }
    finally
    {
        TryDelete(path);
    }
}

static string TempDatabasePath()
    => Path.Combine(Path.GetTempPath(), $"garagelog-regression-{Guid.NewGuid():N}.db");

static string ConnectionString(string path)
    => new SqliteConnectionStringBuilder
    {
        DataSource = path,
        Mode = SqliteOpenMode.ReadWriteCreate,
        ForeignKeys = true,
        DefaultTimeout = 10
    }.ToString();

static void TryDelete(string path)
{
    foreach (var candidate in new[] { path, path + "-wal", path + "-shm" })
    {
        try { if (File.Exists(candidate)) File.Delete(candidate); }
        catch { }
    }
}

static void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException(message);
}


sealed class FakeNhtsaHarleyNoRecallsHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var uri = request.RequestUri?.ToString() ?? string.Empty;
        if (uri.Contains("/products/vehicle/makes", StringComparison.OrdinalIgnoreCase))
            return Json(System.Net.HttpStatusCode.OK, "{\"results\":[{\"modelYear\":\"2008\",\"make\":\"HARLEY-DAVIDSON\"}]}");
        if (uri.Contains("/products/vehicle/models", StringComparison.OrdinalIgnoreCase))
            return Json(System.Net.HttpStatusCode.OK, "{\"results\":[{\"modelYear\":\"2008\",\"make\":\"HARLEY-DAVIDSON\",\"model\":\"FXSTB\"}]}");
        if (uri.Contains("/recalls/recallsByVehicle", StringComparison.OrdinalIgnoreCase))
            return Json(System.Net.HttpStatusCode.BadRequest, "{\"Count\":0,\"Message\":\"Results returned successfully\",\"results\":[]}");
        return Json(System.Net.HttpStatusCode.NotFound, "{}");
    }

    private static Task<HttpResponseMessage> Json(System.Net.HttpStatusCode status, string json)
        => Task.FromResult(new HttpResponseMessage(status)
        {
            Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json")
        });
}

sealed class FakeNhtsaCatalogHandler : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var uri = request.RequestUri?.ToString() ?? string.Empty;
        string json;
        if (uri.Contains("/products/vehicle/makes", StringComparison.OrdinalIgnoreCase))
            json = "{\"results\":[{\"modelYear\":\"2015\",\"make\":\"DODGE\"},{\"modelYear\":\"2015\",\"make\":\"RAM\"}]}";
        else if (uri.Contains("make=RAM", StringComparison.OrdinalIgnoreCase))
            json = "{\"results\":[{\"modelYear\":\"2015\",\"make\":\"RAM\",\"model\":\"1500\"},{\"modelYear\":\"2015\",\"make\":\"RAM\",\"model\":\"2500\"}]}";
        else
            json = "{\"results\":[{\"modelYear\":\"2015\",\"make\":\"DODGE\",\"model\":\"DURANGO\"}]}";
        return Task.FromResult(new HttpResponseMessage(System.Net.HttpStatusCode.OK)
        {
            Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json")
        });
    }
}

