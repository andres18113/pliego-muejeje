package com.pliego.modules.identity.gateway;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.Instant;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;

@Repository
public class JdbcIdentityGateway extends JdbcGatewaySupport implements IdentityGateway {

    private static final String REGISTER_CALL = "CALL pliego.sp_customer_register(?,?,?,?,?,?,?,?)";
    private static final String AUTH_QUERY = "SELECT user_id, email_canonical, password_hash, role, state "
            + "FROM pliego.fn_user_auth_data(?)";
    private static final String CREATE_SESSION_QUERY = "SELECT pliego.fn_auth_session_create(?,?,?)";
    private static final String REFRESH_SESSION_QUERY = "SELECT user_id, email_canonical, role, expires_at "
            + "FROM pliego.fn_auth_session_refresh(?,?)";
    private static final String REVOKE_SESSION_QUERY = "SELECT pliego.fn_auth_session_revoke(?)";

    private final JdbcTemplate jdbcTemplate;

    public JdbcIdentityGateway(DatabaseExceptionTranslator exceptionTranslator, JdbcTemplate jdbcTemplate) {
        super(exceptionTranslator);
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public RegistrationResult register(String email, String passwordHash, String firstNames, String lastNames,
            String phone) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute(
                (ConnectionCallback<RegistrationResult>) connection -> {
                    try (PreparedStatement statement = connection.prepareStatement(REGISTER_CALL)) {
                        statement.setString(1, email);
                        statement.setString(2, passwordHash);
                        statement.setString(3, firstNames);
                        statement.setString(4, lastNames);
                        statement.setString(5, phone);
                        statement.setNull(6, Types.BIGINT);
                        statement.setNull(7, Types.BIGINT);
                        statement.setNull(8, Types.VARCHAR);
                        try (ResultSet outputs = statement.executeQuery()) {
                            if (!outputs.next()) {
                                throw new SQLException("sp_customer_register returned no result", "02000");
                            }
                            return new RegistrationResult(outputs.getLong("o_user_id"),
                                    outputs.getLong("o_customer_id"), outputs.getString("o_user_state"));
                        }
                    }
                }));
    }

    @Override
    public UserAuthData findAuthData(String email) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.query(AUTH_QUERY, statement -> statement.setString(1, email),
                resultSet -> resultSet.next()
                        ? new UserAuthData(resultSet.getLong("user_id"), resultSet.getString("email_canonical"),
                                resultSet.getString("password_hash"), resultSet.getString("role"),
                                resultSet.getString("state"))
                        : null));
    }

    @Override
    public void createSession(long userId, String refreshTokenHash, Instant expiresAt) {
        withDatabaseErrorTranslation(() -> jdbcTemplate.query(CREATE_SESSION_QUERY,
                statement -> {
                    statement.setLong(1, userId);
                    statement.setString(2, refreshTokenHash);
                    statement.setTimestamp(3, java.sql.Timestamp.from(expiresAt));
                }, resultSet -> null));
    }

    @Override
    public UserSessionData refreshSession(String currentRefreshTokenHash, String replacementRefreshTokenHash) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.query(REFRESH_SESSION_QUERY,
                statement -> {
                    statement.setString(1, currentRefreshTokenHash);
                    statement.setString(2, replacementRefreshTokenHash);
                }, resultSet -> resultSet.next()
                        ? new UserSessionData(resultSet.getLong("user_id"), resultSet.getString("email_canonical"),
                                resultSet.getString("role"), resultSet.getTimestamp("expires_at").toInstant())
                        : null));
    }

    @Override
    public void revokeSession(String refreshTokenHash) {
        withDatabaseErrorTranslation(() -> jdbcTemplate.query(REVOKE_SESSION_QUERY,
                statement -> statement.setString(1, refreshTokenHash), resultSet -> null));
    }
}
