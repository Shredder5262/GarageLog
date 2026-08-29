using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

var failures = new List<string>();

await RunAsync("state revision rejects stale writes", TestStateRevisionAsync);
await RunAsync("legacy share cleanup does not resurrect deleted links", TestLegacyShareCleanupAsync);
Run("telemetry fingerprint is deterministic", TestTelemetryFingerprint);
await RunAsync("historical duplicate telemetry is superseded", TestTelemetryBackfillAsync);

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
