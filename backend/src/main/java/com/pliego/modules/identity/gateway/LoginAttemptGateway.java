package com.pliego.modules.identity.gateway;

import java.time.OffsetDateTime;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;

@Repository
public class LoginAttemptGateway extends JdbcGatewaySupport {
    private final JdbcTemplate jdbc;

    public LoginAttemptGateway(DatabaseExceptionTranslator translator, JdbcTemplate jdbc) {
        super(translator);
        this.jdbc = jdbc;
    }

    public OffsetDateTime beginPair(String email, String ipHash) {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_login_attempt_pair_begin(?,?)", OffsetDateTime.class, email, ipHash));
    }

    public void reservePairFailure(String email, String ipHash) {
        withDatabaseErrorTranslation(() -> jdbc.query("SELECT pliego.fn_login_attempt_pair_reserve(?,?)",
                statement -> { statement.setString(1, email); statement.setString(2, ipHash); }, rows -> null));
    }

    public void success(String email, String ipHash) {
        withDatabaseErrorTranslation(() -> jdbc.query("SELECT pliego.fn_login_attempt_success(?,?)",
                statement -> { statement.setString(1, email); statement.setString(2, ipHash); }, rows -> null));
    }

    public int cleanup() {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_login_attempt_cleanup()", Integer.class));
    }
}
