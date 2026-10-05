package com.pliego.modules.storefront.gateway;

import java.sql.SQLException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.storefront.application.StorefrontNavigation;
import tools.jackson.databind.ObjectMapper;

@Repository
public class JdbcStorefrontGateway extends JdbcGatewaySupport implements StorefrontGateway {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    public JdbcStorefrontGateway(DatabaseExceptionTranslator translator, JdbcTemplate jdbc, ObjectMapper mapper) {
        super(translator); this.jdbc = jdbc; this.mapper = mapper;
    }
    @Override public StorefrontNavigation navigation() {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject("SELECT pliego.fn_storefront_navigation()::text", (rs,row) -> {
            try { return mapper.readValue(rs.getString(1), StorefrontNavigation.class); }
            catch (RuntimeException exception) { throw new SQLException("Invalid navigation projection", exception); }
        }));
    }
}
