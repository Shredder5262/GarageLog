using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging;

internal static class DatabaseMaintenance
{
    public static async Task<bool> TableExistsAsync(string connectionString, string tableName)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name LIMIT 1;";
        command.Parameters.AddWithValue("$name", tableName);
        return await command.ExecuteScalarAsync() is not null;
    }

    public static async Task<bool> ColumnExistsAsync(string connectionString, string tableName, string columnName)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();
        return await ColumnExistsAsync(connection, tableName, columnName);
    }

    public static async Task<bool> ColumnExistsAsync(SqliteConnection connection, string tableName, string columnName)
    {
        await using var pragma = connection.CreateCommand();
        pragma.CommandText = $"PRAGMA table_info({QuoteIdentifier(tableName)});";
        await using var reader = await pragma.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            if (string.Equals(reader.GetString(1), columnName, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }

    public static async Task EnsureColumnAsync(SqliteConnection connection, string tableName, string columnName, string definition)
    {
        if (await ColumnExistsAsync(connection, tableName, columnName))
            return;

        await using var alter = connection.CreateCommand();
        alter.CommandText = $"ALTER TABLE {QuoteIdentifier(tableName)} ADD COLUMN {QuoteIdentifier(columnName)} {definition};";
        await alter.ExecuteNonQueryAsync();
    }

    public static async Task<string?> BackupBeforeMigrationAsync(string connectionString, string databasePath, ILogger logger)
    {
        if (!File.Exists(databasePath))
            return null;

        var appStateExists = await TableExistsAsync(connectionString, "AppState");
        if (!appStateExists)
            return null;

        var needsBackup = !await ColumnExistsAsync(connectionString, "AppState", "Revision")
            || !await TableExistsAsync(connectionString, "SchemaMigrations")
            || (await TableExistsAsync(connectionString, "TelemetryTrips")
                && !await ColumnExistsAsync(connectionString, "TelemetryTrips", "TripFingerprint"));

        if (!needsBackup)
            return null;

        var backupDirectory = Path.Combine(Path.GetDirectoryName(databasePath) ?? ".", "backups");
        Directory.CreateDirectory(backupDirectory);
        var backupPath = Path.Combine(
            backupDirectory,
            $"garagelog-pre-migration-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.db");

        var backupConnectionString = new SqliteConnectionStringBuilder
        {
            DataSource = backupPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            ForeignKeys = true,
            DefaultTimeout = 10
        }.ToString();

        await using var source = new SqliteConnection(connectionString);
        await using var destination = new SqliteConnection(backupConnectionString);
        await source.OpenAsync();
        await destination.OpenAsync();
        source.BackupDatabase(destination);
        logger.LogInformation("Created pre-migration GarageLog database backup at {BackupPath}.", backupPath);
        return backupPath;
    }

    public static async Task ConfigureDatabaseAsync(string connectionString, ILogger logger)
    {
        await using var connection = new SqliteConnection(connectionString);
        await connection.OpenAsync();

        foreach (var pragmaSql in new[]
        {
            "PRAGMA journal_mode=WAL;",
            "PRAGMA synchronous=NORMAL;",
            "PRAGMA foreign_keys=ON;",
            "PRAGMA busy_timeout=10000;"
        })
        {
            await using var pragma = connection.CreateCommand();
            pragma.CommandText = pragmaSql;
            await pragma.ExecuteNonQueryAsync();
        }

        await using (var migrations = connection.CreateCommand())
        {
            migrations.CommandText = """
                CREATE TABLE IF NOT EXISTS SchemaMigrations (
                    Id TEXT PRIMARY KEY,
                    AppliedUtc TEXT NOT NULL
                );
                """;
            await migrations.ExecuteNonQueryAsync();
        }

        await EnsureColumnAsync(connection, "AppState", "Revision", "INTEGER NOT NULL DEFAULT 1");
        await MarkMigrationAsync(connection, "20260829_01_appstate_revision");

        var quickCheck = await QuickCheckAsync(connection);
        if (!string.Equals(quickCheck, "ok", StringComparison.OrdinalIgnoreCase))
            logger.LogWarning("GarageLog SQLite quick_check returned {QuickCheckResult}.", quickCheck);
        else
            logger.LogInformation("GarageLog SQLite quick_check passed.");
    }

    public static async Task MarkMigrationAsync(SqliteConnection connection, string id)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "INSERT OR IGNORE INTO SchemaMigrations (Id, AppliedUtc) VALUES ($id, $now);";
        command.Parameters.AddWithValue("$id", id);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
        await command.ExecuteNonQueryAsync();
    }

    public static async Task<bool> HasMigrationAsync(SqliteConnection connection, string id)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT 1 FROM SchemaMigrations WHERE Id = $id LIMIT 1;";
        command.Parameters.AddWithValue("$id", id);
        return await command.ExecuteScalarAsync() is not null;
    }

    private static async Task<string> QuickCheckAsync(SqliteConnection connection)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA quick_check;";
        return Convert.ToString(await command.ExecuteScalarAsync()) ?? "unknown";
    }

    private static string QuoteIdentifier(string value) => $"\"{value.Replace("\"", "\"\"")}\"";
}
