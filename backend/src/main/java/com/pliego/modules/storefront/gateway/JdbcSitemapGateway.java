package com.pliego.modules.storefront.gateway;

import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;

/** Projects identifiers from the same public API as anonymous catalog/help reads. */
@Repository
public class JdbcSitemapGateway extends JdbcGatewaySupport implements SitemapGateway {
    // One literal per query: the PostgreSQL plan gate reads gateway SQL from source and binds it by name.
    static final String EDITIONS = "SELECT edition_id::text AS key, total_count FROM pliego.fn_catalog_search(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'TITLE_ASC',?,50,NULL)";
    static final String HELP = "SELECT slug AS key, total_count FROM pliego.fn_help_search(NULL,NULL,NULL,?,50)";
    private final JdbcTemplate jdbc;

    public JdbcSitemapGateway(DatabaseExceptionTranslator translator, JdbcTemplate jdbc) {
        super(translator);
        this.jdbc = jdbc;
    }

    @Override
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public List<String> paths() {
        return withDatabaseErrorTranslation(() -> {
            var paths = new ArrayList<String>();
            collect(paths, EDITIONS, "/catalog/editions/");
            collect(paths, HELP, "/ayuda/");
            return List.copyOf(paths);
        });
    }

    private void collect(List<String> paths, String sql, String prefix) {
        long expected = -1;
        long read = 0;
        for (int page = 0; ; page++) {
            var rows = jdbc.query(sql, (rs, index) -> new Entry(rs.getString("key"), rs.getLong("total_count")), page);
            if (rows.isEmpty()) {
                if (expected > read) throw new IllegalStateException("Listado público incompleto.");
                return;
            }
            if (expected < 0) expected = rows.getFirst().total();
            if (expected + paths.size() - read > 49996) {
                throw new IllegalStateException("El sitemap excede 50000 URLs.");
            }
            for (var row : rows) {
                if (row.total() != expected) throw new IllegalStateException("Listado público inconsistente.");
                paths.add(prefix + row.key());
                read++;
            }
            if (read == expected) return;
            if (read > expected || rows.size() != 50) throw new IllegalStateException("Listado público incompleto.");
        }
    }

    private record Entry(String key, long total) { }
}
