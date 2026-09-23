package com.pliego.foundation.database;

import java.util.function.Supplier;

import org.springframework.dao.DataAccessException;

/** Shared boundary for feature Gateways invoking PostgreSQL's public Database API. */
public abstract class JdbcGatewaySupport {

    private final DatabaseExceptionTranslator exceptionTranslator;

    protected JdbcGatewaySupport(DatabaseExceptionTranslator exceptionTranslator) {
        this.exceptionTranslator = exceptionTranslator;
    }

    protected final <T> T withDatabaseErrorTranslation(Supplier<T> databaseCall) {
        try {
            return databaseCall.get();
        } catch (DataAccessException exception) {
            throw exceptionTranslator.translate(exception);
        }
    }

    protected final void withDatabaseErrorTranslation(Runnable databaseCall) {
        withDatabaseErrorTranslation(() -> {
            databaseCall.run();
            return null;
        });
    }
}
