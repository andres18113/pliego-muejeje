package com.pliego.foundation.database;

import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.List;

/** Typed PostgreSQL arrays at the shared JDBC boundary. */
public final class JdbcArrays {
    private JdbcArrays() { }

    public static List<String> strings(ResultSet row, String column) throws SQLException {
        Array array = row.getArray(column);
        if (array == null) return List.of();
        try {
            return List.copyOf(Arrays.asList((String[]) array.getArray()));
        } finally {
            array.free();
        }
    }
}
