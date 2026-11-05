package com.pliego.modules.identity.gateway;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.PreparedStatementSetter;
import org.springframework.jdbc.core.ResultSetExtractor;
import com.pliego.foundation.database.DatabaseExceptionTranslator;

class JdbcIdentitySessionGatewayTest {
    @Test
    void identityAwareSessionCreationBindsCanonicalEmailAndPreservesDatabaseRejection() throws Exception {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PreparedStatement statement = mock(PreparedStatement.class);
        ResultSet results = mock(ResultSet.class);
        when(results.next()).thenReturn(true);
        when(results.getBoolean(1)).thenReturn(false);
        when(jdbc.query(eq("SELECT pliego.fn_auth_session_create_identity_checked(?,?,?,?,?)"),
                any(PreparedStatementSetter.class), org.mockito.ArgumentMatchers.<ResultSetExtractor<Boolean>>any()))
                .thenAnswer(call -> {
                    call.<PreparedStatementSetter>getArgument(1).setValues(statement);
                    return call.<ResultSetExtractor<Boolean>>getArgument(2).extractData(results);
                });
        var gateway = new JdbcIdentityGateway(new DatabaseExceptionTranslator(), jdbc);
        Instant expires = Instant.parse("2026-12-01T12:00:00Z");
        assertFalse(gateway.createSession(7, "refresh-hash", expires, "password-hash", "old@example.com"));
        verify(statement).setLong(1, 7);
        verify(statement).setString(2, "refresh-hash");
        verify(statement).setTimestamp(3, Timestamp.from(expires));
        verify(statement).setString(4, "password-hash");
        verify(statement).setString(5, "old@example.com");
    }
}
