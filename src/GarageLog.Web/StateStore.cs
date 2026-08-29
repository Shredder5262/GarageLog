using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

internal sealed record StoredAppState(string Json, long Revision, DateTimeOffset UpdatedUtc);
internal sealed record StateWriteResult(bool Saved, long Revision);

internal static class StateStore
{
    public static async Task<StoredAppState> ReadAsync(string connectionString, string fallbackJson)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT Json, Revision, UpdatedUtc FROM AppState WHERE Id = 1;";
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
            return new StoredAppState(fallbackJson, 1, DateTimeOffset.UtcNow);

        var updatedUtc = DateTimeOffset.TryParse(reader.GetString(2), out var parsed)
            ? parsed
            : DateTimeOffset.UtcNow;
        return new StoredAppState(reader.GetString(0), reader.GetInt64(1), updatedUtc);
    }

    public static async Task<StateWriteResult> WriteAsync(
        string connectionString,
        string json,
        long expectedRevision)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();
        await using var command = connection.CreateCommand();
        command.Transaction = (SqliteTransaction)transaction;
        command.CommandText = """
            UPDATE AppState
            SET Json = $json, UpdatedUtc = $updatedUtc, Revision = Revision + 1
            WHERE Id = 1 AND Revision = $expectedRevision;
            """;
        command.Parameters.AddWithValue("$json", json);
        command.Parameters.AddWithValue("$updatedUtc", DateTimeOffset.UtcNow.ToString("O"));
        command.Parameters.AddWithValue("$expectedRevision", expectedRevision);

        var changed = await command.ExecuteNonQueryAsync();
        if (changed == 0)
        {
            await transaction.RollbackAsync();
            var current = await ReadAsync(connectionString, json);
            return new StateWriteResult(false, current.Revision);
        }

        await using var revisionCommand = connection.CreateCommand();
        revisionCommand.Transaction = (SqliteTransaction)transaction;
        revisionCommand.CommandText = "SELECT Revision FROM AppState WHERE Id = 1;";
        var revision = Convert.ToInt64(await revisionCommand.ExecuteScalarAsync());
        await transaction.CommitAsync();
        return new StateWriteResult(true, revision);
    }

    public static async Task<StateWriteResult> MutateAsync(
        string connectionString,
        Func<JsonObject, JsonObject> mutate,
        string fallbackJson)
    {
        // Read and write on separate short-lived connections. Under WAL this avoids
        // upgrading a long-lived read transaction into a writer (SQLITE_BUSY_SNAPSHOT).
        // The revision predicate still guarantees that we never overwrite a newer state.
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var current = await ReadAsync(connectionString, fallbackJson);
            var root = JsonNode.Parse(current.Json)?.AsObject() ?? new JsonObject();
            root = mutate(root);
            var json = root.ToJsonString(new System.Text.Json.JsonSerializerOptions
            {
                PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase,
                WriteIndented = true
            });

            var result = await WriteAsync(connectionString, json, current.Revision);
            if (result.Saved)
                return result;
        }

        var latest = await ReadAsync(connectionString, fallbackJson);
        return new StateWriteResult(false, latest.Revision);
    }
}
