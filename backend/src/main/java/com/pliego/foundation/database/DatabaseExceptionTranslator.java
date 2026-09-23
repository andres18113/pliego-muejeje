package com.pliego.foundation.database;

import java.sql.SQLException;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Queue;
import java.util.Set;

import org.springframework.stereotype.Component;

/** Converts JDBC/Spring database failures using SQLSTATE only, never the SQL message. */
@Component
public final class DatabaseExceptionTranslator {

    public DatabaseException translate(Throwable failure) {
        if (failure instanceof DatabaseException databaseException) {
            return databaseException;
        }

        String sqlState = findSqlState(failure);
        DatabaseError error = DatabaseError.fromSqlState(sqlState);
        if (error == DatabaseError.DATABASE_CONTRACT_VIOLATION) {
            return new DatabaseContractViolationException(sqlState, failure);
        }
        return new DatabaseException(error, sqlState, failure);
    }

    private String findSqlState(Throwable failure) {
        if (failure == null) {
            return null;
        }

        Set<Throwable> visited = Collections.newSetFromMap(new IdentityHashMap<>());
        Queue<Throwable> pending = new ArrayDeque<>();
        pending.add(failure);
        String fallbackSqlState = null;

        while (!pending.isEmpty()) {
            Throwable current = pending.remove();
            if (!visited.add(current)) {
                continue;
            }

            if (current instanceof SQLException sqlException) {
                SQLException next = sqlException;
                while (next != null) {
                    if (next != sqlException && !visited.add(next)) {
                        break;
                    }
                    String sqlState = next.getSQLState();
                    if (sqlState != null) {
                        if (DatabaseError.fromSqlState(sqlState) != DatabaseError.INTERNAL_SERVER_ERROR) {
                            return sqlState;
                        }
                        if (fallbackSqlState == null) {
                            fallbackSqlState = sqlState;
                        }
                    }
                    if (next.getCause() != null) {
                        pending.add(next.getCause());
                    }
                    next = next.getNextException();
                }
            }
            if (current.getCause() != null) {
                pending.add(current.getCause());
            }
        }
        return fallbackSqlState;
    }
}
