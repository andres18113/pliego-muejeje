package com.pliego.foundation.database;

import java.util.Arrays;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;

/** Approved database error codes and their REST status mapping. */
public enum DatabaseError {
    INVALID_ARGUMENT("P1001", "INVALID_ARGUMENT", HttpStatus.BAD_REQUEST),
    ACTOR_NOT_FOUND("P1002", "ACTOR_NOT_FOUND", HttpStatus.UNAUTHORIZED),
    ACTOR_INACTIVE("P1003", "ACTOR_INACTIVE", HttpStatus.UNAUTHORIZED),
    ACTOR_NOT_ADMIN("P1004", "ACTOR_NOT_ADMIN", HttpStatus.FORBIDDEN),
    ACTOR_NOT_CUSTOMER("P1005", "ACTOR_NOT_CUSTOMER", HttpStatus.FORBIDDEN),
    EMAIL_ALREADY_EXISTS("P1101", "EMAIL_ALREADY_EXISTS", HttpStatus.CONFLICT),
    CUSTOMER_NOT_FOUND("P1102", "CUSTOMER_NOT_FOUND", HttpStatus.NOT_FOUND),
    ADDRESS_NOT_FOUND("P1103", "ADDRESS_NOT_FOUND", HttpStatus.NOT_FOUND),
    AUTHOR_NOT_FOUND("P2001", "AUTHOR_NOT_FOUND", HttpStatus.NOT_FOUND),
    AUTHOR_INACTIVE("P2002", "AUTHOR_INACTIVE", HttpStatus.CONFLICT),
    PUBLISHER_NOT_FOUND("P2011", "PUBLISHER_NOT_FOUND", HttpStatus.NOT_FOUND),
    PUBLISHER_INACTIVE("P2012", "PUBLISHER_INACTIVE", HttpStatus.CONFLICT),
    CATEGORY_NOT_FOUND("P2021", "CATEGORY_NOT_FOUND", HttpStatus.NOT_FOUND),
    CATEGORY_INACTIVE("P2022", "CATEGORY_INACTIVE", HttpStatus.CONFLICT),
    CATEGORY_INVALID_HIERARCHY("P2023", "CATEGORY_INVALID_HIERARCHY", HttpStatus.CONFLICT),
    CATEGORY_SLUG_EXISTS("P2024", "CATEGORY_SLUG_EXISTS", HttpStatus.CONFLICT),
    BOOK_NOT_FOUND("P2031", "BOOK_NOT_FOUND", HttpStatus.NOT_FOUND),
    BOOK_REQUIRES_AUTHOR("P2032", "BOOK_REQUIRES_AUTHOR", HttpStatus.CONFLICT),
    BOOK_REQUIRES_CATEGORY("P2033", "BOOK_REQUIRES_CATEGORY", HttpStatus.CONFLICT),
    AUTHOR_ORDER_INVALID("P2034", "AUTHOR_ORDER_INVALID", HttpStatus.BAD_REQUEST),
    EDITION_NOT_FOUND("P2041", "EDITION_NOT_FOUND", HttpStatus.NOT_FOUND),
    EDITION_INACTIVE("P2042", "EDITION_INACTIVE", HttpStatus.CONFLICT),
    BOOK_INACTIVE("P2043", "BOOK_INACTIVE", HttpStatus.CONFLICT),
    SKU_ALREADY_EXISTS("P2044", "SKU_ALREADY_EXISTS", HttpStatus.CONFLICT),
    ISBN_ALREADY_EXISTS("P2045", "ISBN_ALREADY_EXISTS", HttpStatus.CONFLICT),
    ISBN_INVALID("P2046", "ISBN_INVALID", HttpStatus.BAD_REQUEST),
    COVER_METADATA_INVALID("P2047", "COVER_METADATA_INVALID", HttpStatus.BAD_REQUEST),
    EDITION_DATA_INVALID("P2048", "EDITION_DATA_INVALID", HttpStatus.BAD_REQUEST),
    INVENTORY_NOT_FOUND("P3001", "INVENTORY_NOT_FOUND", HttpStatus.NOT_FOUND),
    INSUFFICIENT_STOCK("P3002", "INSUFFICIENT_STOCK", HttpStatus.CONFLICT),
    STOCK_QUANTITY_INVALID("P3003", "STOCK_QUANTITY_INVALID", HttpStatus.BAD_REQUEST),
    STOCK_MINIMUM_INVALID("P3004", "STOCK_MINIMUM_INVALID", HttpStatus.BAD_REQUEST),
    STOCK_MOVEMENT_DUPLICATE("P3005", "STOCK_MOVEMENT_DUPLICATE", HttpStatus.CONFLICT),
    SALE_REQUIRED_FOR_CANCELLATION("P3006", "SALE_REQUIRED_FOR_CANCELLATION", HttpStatus.CONFLICT),
    CART_NOT_ACTIVE("P4001", "CART_NOT_ACTIVE", HttpStatus.CONFLICT),
    CART_EMPTY("P4002", "CART_EMPTY", HttpStatus.CONFLICT),
    CART_ITEM_NOT_FOUND("P4003", "CART_ITEM_NOT_FOUND", HttpStatus.NOT_FOUND),
    CART_QUANTITY_INVALID("P4004", "CART_QUANTITY_INVALID", HttpStatus.BAD_REQUEST),
    ORDER_NOT_FOUND("P5001", "ORDER_NOT_FOUND", HttpStatus.NOT_FOUND),
    ORDER_INVALID_TRANSITION("P5002", "ORDER_INVALID_TRANSITION", HttpStatus.CONFLICT),
    ORDER_NOT_CANCELLABLE("P5003", "ORDER_NOT_CANCELLABLE", HttpStatus.CONFLICT),
    CHECKOUT_ADDRESS_INVALID("P5004", "CHECKOUT_ADDRESS_INVALID", HttpStatus.NOT_FOUND),
    PAYMENT_OUTCOME_INVALID("P5005", "PAYMENT_OUTCOME_INVALID", HttpStatus.BAD_REQUEST),
    PAYMENT_STATE_INVALID("P5006", "PAYMENT_STATE_INVALID", HttpStatus.CONFLICT),
    PAYMENT_REFERENCE_CONFLICT("P5007", "PAYMENT_REFERENCE_CONFLICT", HttpStatus.INTERNAL_SERVER_ERROR),
    IMMUTABLE_HISTORY_VIOLATION("P9001", "IMMUTABLE_HISTORY_VIOLATION", HttpStatus.INTERNAL_SERVER_ERROR),
    DATABASE_CONTRACT_VIOLATION("23514", "DATABASE_CONTRACT_VIOLATION", HttpStatus.INTERNAL_SERVER_ERROR),
    INTERNAL_SERVER_ERROR("", "INTERNAL_SERVER_ERROR", HttpStatus.INTERNAL_SERVER_ERROR);

    private static final Map<String, DatabaseError> BY_SQL_STATE = Arrays.stream(values())
            .filter(error -> !error.sqlState.isEmpty())
            .collect(Collectors.toUnmodifiableMap(DatabaseError::sqlState, Function.identity()));

    private final String sqlState;
    private final String code;
    private final HttpStatusCode httpStatus;

    DatabaseError(String sqlState, String code, HttpStatusCode httpStatus) {
        this.sqlState = sqlState;
        this.code = code;
        this.httpStatus = httpStatus;
    }

    public String sqlState() {
        return sqlState;
    }

    public String code() {
        return code;
    }

    public HttpStatusCode httpStatus() {
        return httpStatus;
    }

    public static DatabaseError fromSqlState(String sqlState) {
        if (sqlState == null) {
            return INTERNAL_SERVER_ERROR;
        }
        return BY_SQL_STATE.getOrDefault(sqlState, INTERNAL_SERVER_ERROR);
    }
}
