package com.pliego.modules.storefront.gateway;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.sql.ResultSet;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import com.pliego.foundation.database.DatabaseExceptionTranslator;

class JdbcSitemapGatewayTest {
    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final JdbcSitemapGateway gateway = new JdbcSitemapGateway(new DatabaseExceptionTranslator(), jdbc);

    @Test void pagesOnlyPublicRoutinesAndKeepsEveryListableIdRegardlessOfAvailability() throws Exception {
        page(JdbcSitemapGateway.EDITIONS, 0, 50, 51, "");
        page(JdbcSitemapGateway.EDITIONS, 1, 1, 51, "50");
        page(JdbcSitemapGateway.HELP, 0, 1, 1, "published");
        var result = gateway.paths();
        assertThat(result).hasSize(52).contains("/catalog/editions/50", "/ayuda/published");
        verify(jdbc, times(3)).query(anyString(), any(RowMapper.class), anyInt());
        assertThat(JdbcSitemapGateway.EDITIONS).contains("fn_catalog_search(").doesNotContain("available", "WHERE");
        assertThat(JdbcSitemapGateway.HELP).contains("fn_help_search(");
    }

    @Test void emptyPublicSetsProduceNoDynamicPaths() throws Exception {
        page(JdbcSitemapGateway.EDITIONS, 0, 0, 0, "");
        page(JdbcSitemapGateway.HELP, 0, 0, 0, "");
        assertThat(gateway.paths()).isEmpty();
    }

    @Test void overflowAndIncompleteListingsFailClosed() throws Exception {
        page(JdbcSitemapGateway.EDITIONS, 0, 1, 50000, "1");
        assertThatThrownBy(gateway::paths).isInstanceOf(IllegalStateException.class);
        page(JdbcSitemapGateway.EDITIONS, 0, 1, 2, "1");
        assertThatThrownBy(gateway::paths).isInstanceOf(IllegalStateException.class);
    }

    private void page(String sql, int page, int size, long total, String key) throws Exception {
        when(jdbc.query(eq(sql), any(RowMapper.class), eq(page))).thenAnswer(call -> {
            var rows = new ArrayList<>();
            for (int i=0;i<size;i++) {
                var rs = mock(ResultSet.class);
                when(rs.getString("key")).thenReturn(size > 1 ? Integer.toString(i) : key);
                when(rs.getLong("total_count")).thenReturn(total);
                rows.add(((RowMapper<?>) call.getArgument(1)).mapRow(rs, i));
            }
            return rows;
        });
    }
}
