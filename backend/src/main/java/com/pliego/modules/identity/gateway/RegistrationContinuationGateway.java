package com.pliego.modules.identity.gateway;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;

@Repository
public class RegistrationContinuationGateway extends JdbcGatewaySupport {
    private final JdbcTemplate jdbc;
    public RegistrationContinuationGateway(DatabaseExceptionTranslator translator, JdbcTemplate jdbc) {
        super(translator); this.jdbc=jdbc;
    }
    public Instant issue(long userId,String hash,String returnTo) {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_registration_session_issue(?,?,?)", Timestamp.class,userId,hash,returnTo).toInstant());
    }
    public Instant issueNeutral(String hash) {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_registration_decoy_issue(?)", Timestamp.class,hash).toInstant());
    }
    public Outcome exchange(String hash,String refreshHash,Instant expires,String requestHash) {
        return withDatabaseErrorTranslation(() -> jdbc.query(
                "SELECT * FROM pliego.fn_registration_session_exchange(?,?,?,?)",
                statement -> { statement.setString(1,hash); statement.setString(2,refreshHash);
                    statement.setTimestamp(3,Timestamp.from(expires)); statement.setString(4,requestHash); },
                result -> result.next()?read(result):null));
    }
    public Outcome verify(String verificationHash,String hash,String refreshHash,Instant expires,String requestHash) {
        return withDatabaseErrorTranslation(() -> jdbc.query(
                "SELECT * FROM pliego.fn_registration_verify_exchange(?,?,?,?,?)",
                statement -> { statement.setString(1,verificationHash); statement.setString(2,hash); statement.setString(3,refreshHash);
                    statement.setTimestamp(4,Timestamp.from(expires)); statement.setString(5,requestHash); },
                result -> result.next()?read(result):null));
    }
    public void invalidate(Long userId,String hash) {
        withDatabaseErrorTranslation(() -> jdbc.query("SELECT pliego.fn_registration_session_invalidate(?,?)",
                statement -> { statement.setObject(1,userId,java.sql.Types.BIGINT); statement.setString(2,hash); }, result -> null));
    }
    private static Outcome read(ResultSet result) throws SQLException {
        Timestamp expiry=result.getTimestamp("expires_at");
        return new Outcome(result.getString("state"),result.getLong("user_id"),result.getString("email_canonical"),
                result.getString("role"),expiry==null?null:expiry.toInstant(),result.getString("return_path"),
                result.getObject("retry_after_seconds",Integer.class));
    }
    public record Outcome(String state,long userId,String email,String role,Instant expiresAt,String returnTo,Integer retryAfterSeconds) {
        @Override public String toString() { return "RegistrationContinuationOutcome[state="+state+"]"; }
    }
}
