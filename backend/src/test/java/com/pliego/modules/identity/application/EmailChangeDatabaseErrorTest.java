package com.pliego.modules.identity.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import java.sql.SQLException;
import org.junit.jupiter.api.Test;
import com.pliego.foundation.database.DatabaseExceptionTranslator;

class EmailChangeDatabaseErrorTest {
    @Test
    void addsDistinctOutcomesWithoutChangingExistingUniquenessOrArgumentMappings() {
        var translator = new DatabaseExceptionTranslator();
        for (String[] expected : new String[][]{
                {"P1120", "EMAIL_CHANGE_SAME_ADDRESS", "400"},
                {"P1121", "EMAIL_CHANGE_NOT_PENDING", "404"},
                {"P1122", "EMAIL_CHANGE_RATE_LIMITED", "429"},
                {"P1123", "EMAIL_CHANGE_TOKEN_INVALID", "400"},
                {"P1124", "EMAIL_CHANGE_TOKEN_EXPIRED", "410"},
                {"P1125", "EMAIL_CHANGE_TOKEN_USED", "410"},
                {"P1126", "EMAIL_CHANGE_TOKEN_SUPERSEDED", "410"},
                {"P1127", "EMAIL_CHANGE_CANCELLED", "410"},
                {"P1128", "EMAIL_CHANGE_ALREADY_CONFIRMED", "410"},
                {"P1101", "EMAIL_ALREADY_EXISTS", "409"},
                {"P1001", "INVALID_ARGUMENT", "400"}}) {
            var failure = translator.translate(new SQLException("private token/address", expected[0]));
            assertEquals(expected[0], failure.sqlState());
            assertEquals(expected[1], failure.error().code());
            assertEquals(Integer.parseInt(expected[2]), failure.error().httpStatus().value());
        }
    }
}
