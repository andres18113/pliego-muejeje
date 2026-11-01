package com.pliego.modules.identity.gateway;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.identity.application.EmailChangeResult;

@Repository
public class JdbcEmailChangeGateway extends JdbcGatewaySupport implements EmailChangeGateway {
    private final JdbcTemplate jdbc;

    public JdbcEmailChangeGateway(DatabaseExceptionTranslator translator, JdbcTemplate jdbc) {
        super(translator);
        this.jdbc = jdbc;
    }

    @Override
    public EmailChangeResult request(long actor, String email, String confirmHash, String confirmNonce,
            String cancelHash, String cancelNonce) {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT * FROM pliego.fn_customer_email_change_request(?,?,?,?,?,?)",
                (row, index) -> new EmailChangeResult(row.getString("email"), row.getString("address"),
                        row.getTimestamp("expires_at").toInstant()),
                actor, email, confirmHash, confirmNonce, cancelHash, cancelNonce));
    }

    @Override
    public void resend(long actor, String hash, String nonce) {
        withDatabaseErrorTranslation(() -> jdbc.query("SELECT pliego.fn_customer_email_change_resend(?,?,?)",
                statement -> { statement.setLong(1, actor); statement.setString(2, hash); statement.setString(3, nonce); },
                results -> null));
    }

    @Override
    public void cancelForUser(long actor) {
        withDatabaseErrorTranslation(() -> jdbc.query("SELECT pliego.fn_customer_email_change_cancel(?)",
                statement -> statement.setLong(1, actor), results -> null));
    }

    @Override
    public String findNonce(String type, String hash) {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_email_change_token_nonce(?,?)", String.class, type, hash));
    }

    @Override
    public String confirm(String hash) {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_email_change_confirm(?)", String.class, hash));
    }

    @Override
    public void cancelWithToken(String hash) {
        withDatabaseErrorTranslation(() -> jdbc.query("SELECT pliego.fn_email_change_cancel(?)",
                statement -> statement.setString(1, hash), results -> null));
    }
}
