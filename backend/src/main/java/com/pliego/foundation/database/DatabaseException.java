package com.pliego.foundation.database;

/** Safe application exception produced from a PostgreSQL SQLSTATE. */
public class DatabaseException extends RuntimeException {

    private final DatabaseError error;
    private final String sqlState;

    DatabaseException(DatabaseError error, String sqlState, Throwable cause) {
        super(error.code(), cause);
        this.error = error;
        this.sqlState = sqlState;
    }

    public DatabaseError error() {
        return error;
    }

    public String sqlState() {
        return sqlState;
    }
}
