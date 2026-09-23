package com.pliego.foundation.database;

/** A PostgreSQL CHECK constraint escaped the approved Database API validation. */
public final class DatabaseContractViolationException extends DatabaseException {

    DatabaseContractViolationException(String sqlState, Throwable cause) {
        super(DatabaseError.DATABASE_CONTRACT_VIOLATION, sqlState, cause);
    }
}
