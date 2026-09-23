package com.pliego.foundation.database;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertSame;

import java.sql.SQLException;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpStatus;

class DatabaseExceptionTranslatorTest {

    private final DatabaseExceptionTranslator translator = new DatabaseExceptionTranslator();

    @Test
    void translatesDomainSqlStateThroughSpringDataAccessException() {
        SQLException sqlException = new SQLException("private postgres detail", "P3002");
        var translated = translator.translate(new DataAccessResourceFailureException("jdbc failure", sqlException));

        assertEquals(DatabaseError.INSUFFICIENT_STOCK, translated.error());
        assertEquals("P3002", translated.sqlState());
        assertEquals(HttpStatus.CONFLICT, translated.error().httpStatus());
        assertEquals("INSUFFICIENT_STOCK", translated.getMessage());
    }

    @Test
    void searchesNextSQLExceptionWhenTheDriverWrapperHasNoState() {
        SQLException outer = new SQLException("wrapper", "08000");
        outer.setNextException(new SQLException("private postgres detail", "P2046"));

        var translated = translator.translate(outer);

        assertEquals(DatabaseError.ISBN_INVALID, translated.error());
        assertEquals(HttpStatus.BAD_REQUEST, translated.error().httpStatus());
    }

    @Test
    void treatsCheckConstraintLeakAsDatabaseContractFailure() {
        var translated = translator.translate(new SQLException("constraint detail", "23514"));

        assertEquals(DatabaseContractViolationException.class, translated.getClass());
        assertEquals(DatabaseError.DATABASE_CONTRACT_VIOLATION, translated.error());
        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, translated.error().httpStatus());
    }

    @Test
    void hidesUnexpectedDatabaseErrorsBehindInternalServerError() {
        var translated = translator.translate(new SQLException("private database detail", "23505"));

        assertEquals(DatabaseError.INTERNAL_SERVER_ERROR, translated.error());
        assertEquals("INTERNAL_SERVER_ERROR", translated.getMessage());
    }

    @Test
    void doesNotWrapAnAlreadyTranslatedDatabaseException() {
        DatabaseException original = translator.translate(new SQLException("detail", "P1001"));

        assertSame(original, translator.translate(original));
    }

    @Test
    void gatewaySupportAppliesTheCentralTranslatorToJdbcFailures() {
        TestGateway gateway = new TestGateway(translator);

        DatabaseException translated = assertThrows(DatabaseException.class, gateway::call);

        assertEquals(DatabaseError.CHECKOUT_ADDRESS_INVALID, translated.error());
        assertEquals(HttpStatus.NOT_FOUND, translated.error().httpStatus());
    }

    private static final class TestGateway extends JdbcGatewaySupport {

        private TestGateway(DatabaseExceptionTranslator translator) {
            super(translator);
        }

        private void call() {
            withDatabaseErrorTranslation(() -> {
                throw new DataAccessResourceFailureException("jdbc failure", new SQLException("detail", "P5004"));
            });
        }
    }
}
