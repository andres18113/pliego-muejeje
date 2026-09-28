import java.util.Map;
import org.flywaydb.core.Flyway;

/** Local-only Flyway entry point; the application still migrates and validates on startup. */
class LocalFlyway {
    public static void main(String[] args) {
        if (args.length != 1) {
            throw new IllegalArgumentException("Expected the migration directory");
        }
        Flyway.configure()
            .dataSource(required("PLIEGO_DB_URL"), required("PLIEGO_DB_USERNAME"), required("PLIEGO_DB_PASSWORD"))
            .locations("filesystem:" + args[0])
            .schemas("public")
            .defaultSchema("public")
            .createSchemas(false)
            .validateOnMigrate(true)
            .placeholders(Map.of(
                "PLIEGO_ADMIN_EMAIL", required("PLIEGO_ADMIN_EMAIL"),
                "PLIEGO_ADMIN_PASSWORD_HASH", required("PLIEGO_ADMIN_PASSWORD_HASH")))
            .load()
            .migrate();
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required environment variable: " + name);
        }
        return value;
    }
}
