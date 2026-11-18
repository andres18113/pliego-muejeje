package com.pliego.modules.catalog.gateway;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.catalog.application.OfferLifecycleAdvance;
import com.pliego.modules.catalog.application.OfferLifecycleStatus;
import com.pliego.modules.catalog.application.OfferRefreshClock;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

@Repository
public class JdbcOfferLifecycleGateway extends JdbcGatewaySupport implements OfferLifecycleGateway {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public JdbcOfferLifecycleGateway(DatabaseExceptionTranslator errors, JdbcTemplate jdbc, ObjectMapper mapper) {
        super(errors);
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    @Override
    public OfferRefreshClock clock() {
        return query("SELECT pliego.fn_offer_refresh_clock()::TEXT", OfferRefreshClock.class);
    }

    @Override
    public OfferLifecycleAdvance advance(int limit) {
        return query("SELECT pliego.fn_offer_lifecycle_advance(?)::TEXT", OfferLifecycleAdvance.class, limit);
    }

    @Override
    public OfferLifecycleStatus status() {
        return query("SELECT pliego.fn_offer_lifecycle_status()::TEXT", OfferLifecycleStatus.class);
    }

    @Override
    public void failure(String code) {
        withDatabaseErrorTranslation(() -> {
            limits();
            jdbc.queryForObject("SELECT pliego.fn_offer_lifecycle_failure(?)", String.class, code);
        });
    }

    private <T> T query(String sql, Class<T> projection, Object... arguments) {
        return withDatabaseErrorTranslation(() -> {
            limits();
            return mapper.readValue(jdbc.queryForObject(sql, String.class, arguments), projection);
        });
    }

    private void limits() {
        // These settings are local to the Spring transaction and reset on commit or rollback.
        jdbc.execute("SET LOCAL lock_timeout = '100ms'");
        jdbc.execute("SET LOCAL statement_timeout = '2s'");
    }
}
