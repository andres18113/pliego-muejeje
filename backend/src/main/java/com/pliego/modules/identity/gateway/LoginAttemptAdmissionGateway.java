package com.pliego.modules.identity.gateway;

import java.time.OffsetDateTime;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;

@Repository
public class LoginAttemptAdmissionGateway extends JdbcGatewaySupport {
    private final JdbcTemplate jdbc;

    public LoginAttemptAdmissionGateway(DatabaseExceptionTranslator translator,
            @Qualifier("loginAdmissionJdbcTemplate") JdbcTemplate jdbc) {
        super(translator);
        this.jdbc = jdbc;
    }

    public int admit(String email, String ipHash, OffsetDateTime pairBlockedUntil) {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_login_attempt_admit(?,?,?)", Integer.class, email, ipHash, pairBlockedUntil));
    }
}
