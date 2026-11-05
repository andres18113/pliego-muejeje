package com.pliego.modules.identity.gateway;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;

@Repository
public class RegistrationAttemptGateway extends JdbcGatewaySupport {
    private final JdbcTemplate admissionJdbc;
    private final JdbcTemplate jdbc;

    public RegistrationAttemptGateway(DatabaseExceptionTranslator translator,
            @Qualifier("loginAdmissionJdbcTemplate") JdbcTemplate admissionJdbc, JdbcTemplate jdbc) {
        super(translator);
        this.admissionJdbc = admissionJdbc;
        this.jdbc = jdbc;
    }

    public int admit(String email, String ipHash) {
        return withDatabaseErrorTranslation(() -> admissionJdbc.queryForObject(
                "SELECT pliego.fn_registration_attempt_admit(?,?)", Integer.class, email, ipHash));
    }

    public int cleanup() {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_registration_attempt_cleanup()", Integer.class));
    }

    public int cleanupNeutralReceipts() {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_registration_decoy_cleanup()", Integer.class));
    }
}
