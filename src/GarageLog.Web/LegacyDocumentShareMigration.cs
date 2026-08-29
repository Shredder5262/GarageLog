using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

internal static class LegacyDocumentShareMigration
{
    internal const string MigrationId = "20260829_02_legacy_document_share_cleanup";

    public static async Task ApplyAsync(string connectionString, bool importLegacyRows)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        await using (var alreadyApplied = connection.CreateCommand())
        {
            alreadyApplied.Transaction = (SqliteTransaction)transaction;
            alreadyApplied.CommandText = "SELECT 1 FROM SchemaMigrations WHERE Id = $id LIMIT 1;";
            alreadyApplied.Parameters.AddWithValue("$id", MigrationId);
            if (await alreadyApplied.ExecuteScalarAsync() is not null)
            {
                await transaction.CommitAsync();
                return;
            }
        }

        string stateJson;
        long revision;
        await using (var stateCommand = connection.CreateCommand())
        {
            stateCommand.Transaction = (SqliteTransaction)transaction;
            stateCommand.CommandText = "SELECT Json, Revision FROM AppState WHERE Id = 1;";
            await using var reader = await stateCommand.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
            {
                await transaction.CommitAsync();
                return;
            }
            stateJson = reader.GetString(0);
            revision = reader.GetInt64(1);
        }

        var root = JsonNode.Parse(stateJson)?.AsObject() ?? new JsonObject();
        var documents = root["documents"] as JsonArray;
        var changedState = false;

        if (documents is not null)
        {
            foreach (var documentNode in documents.OfType<JsonObject>())
            {
                var token = ReadString(documentNode["shareToken"]);
                var shareEnabled = ReadBool(documentNode["shareEnabled"]) ?? true;
                var storedName = Path.GetFileName(ReadString(documentNode["storedName"]));

                // DocumentShareLinks is authoritative in current GarageLog builds.
                // If that table predates this startup, the legacy token has already
                // had its opportunity to migrate and must not be resurrected after
                // a user permanently deletes it.
                if (importLegacyRows
                    && shareEnabled
                    && !string.IsNullOrWhiteSpace(token)
                    && Regex.IsMatch(token, "^[A-Za-z0-9_-]{16,128}$")
                    && !string.IsNullOrWhiteSpace(storedName))
                {
                    var createdUtc = DateTimeOffset.UtcNow;
                    if (DateTimeOffset.TryParse(ReadString(documentNode["addedAt"]), out var addedUtc))
                        createdUtc = addedUtc;

                    await using var insert = connection.CreateCommand();
                    insert.Transaction = (SqliteTransaction)transaction;
                    insert.CommandText = """
                        INSERT OR IGNORE INTO DocumentShareLinks
                            (Token, StoredName, CreatedByUserId, CreatedUtc, ExpiresUtc, RevokedUtc, LastAccessUtc, AccessCount)
                        VALUES
                            ($token, $storedName, NULL, $createdUtc, NULL, NULL, NULL, 0);
                        """;
                    insert.Parameters.AddWithValue("$token", token);
                    insert.Parameters.AddWithValue("$storedName", storedName);
                    insert.Parameters.AddWithValue("$createdUtc", createdUtc.ToString("O"));
                    await insert.ExecuteNonQueryAsync();
                }

                changedState |= documentNode.Remove("shareToken");
                changedState |= documentNode.Remove("shareEnabled");
            }
        }

        if (changedState)
        {
            await using var updateState = connection.CreateCommand();
            updateState.Transaction = (SqliteTransaction)transaction;
            updateState.CommandText = """
                UPDATE AppState
                SET Json = $json, UpdatedUtc = $updatedUtc, Revision = Revision + 1
                WHERE Id = 1 AND Revision = $revision;
                """;
            updateState.Parameters.AddWithValue("$json", root.ToJsonString(new JsonSerializerOptions
            {
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                WriteIndented = true
            }));
            updateState.Parameters.AddWithValue("$updatedUtc", DateTimeOffset.UtcNow.ToString("O"));
            updateState.Parameters.AddWithValue("$revision", revision);
            await updateState.ExecuteNonQueryAsync();
        }

        await using (var mark = connection.CreateCommand())
        {
            mark.Transaction = (SqliteTransaction)transaction;
            mark.CommandText = "INSERT OR IGNORE INTO SchemaMigrations (Id, AppliedUtc) VALUES ($id, $now);";
            mark.Parameters.AddWithValue("$id", MigrationId);
            mark.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
            await mark.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();
    }

    private static string? ReadString(JsonNode? node)
        => node is JsonValue value && value.TryGetValue<string>(out var result) ? result : null;

    private static bool? ReadBool(JsonNode? node)
        => node is JsonValue value && value.TryGetValue<bool>(out var result) ? result : null;
}
