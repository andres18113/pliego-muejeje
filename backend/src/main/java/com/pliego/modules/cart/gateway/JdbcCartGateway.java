package com.pliego.modules.cart.gateway;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.util.ArrayList;
import java.util.List;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.cart.application.CartModels.Cart;
import com.pliego.modules.cart.application.CartModels.CartItem;
import com.pliego.modules.cart.application.CartModels.CartItemResult;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Invokes only PostgreSQL's approved public cart Function and Procedures. */
@Repository
public class JdbcCartGateway extends JdbcGatewaySupport implements CartGateway {

    private static final String CART_GET = "SELECT cart_id,state,items::text AS items,total_current "
            + "FROM pliego.fn_cart_get(?)";
    private static final String CART_ADD_ITEM = "CALL pliego.sp_cart_add_item(?,?,?,?,?,?)";
    private static final String CART_UPDATE_ITEM = "CALL pliego.sp_cart_update_item(?,?,?,?,?,?)";
    private static final String CART_REMOVE_ITEM = "CALL pliego.sp_cart_remove_item(?,?)";

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public JdbcCartGateway(DatabaseExceptionTranslator exceptionTranslator, JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper) {
        super(exceptionTranslator);
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public Cart get(long actorId) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.queryForObject(CART_GET, CART_ROW_MAPPER, actorId));
    }

    @Override
    public CartItemResult addItem(long actorId, long editionId, int quantity) {
        return callCartItemMutation(CART_ADD_ITEM, statement -> {
            statement.setLong(1, actorId);
            statement.setLong(2, editionId);
            statement.setInt(3, quantity);
            statement.setNull(4, Types.BIGINT);
            statement.setNull(5, Types.BIGINT);
            statement.setNull(6, Types.INTEGER);
        });
    }

    @Override
    public CartItemResult updateItem(long actorId, long cartItemId, int quantity) {
        return callCartItemMutation(CART_UPDATE_ITEM, statement -> {
            statement.setLong(1, actorId);
            statement.setLong(2, cartItemId);
            statement.setInt(3, quantity);
            statement.setNull(4, Types.BIGINT);
            statement.setNull(5, Types.BIGINT);
            statement.setNull(6, Types.INTEGER);
        });
    }

    @Override
    public void removeItem(long actorId, long cartItemId) {
        withDatabaseErrorTranslation(() -> jdbcTemplate.execute((ConnectionCallback<Void>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(CART_REMOVE_ITEM)) {
                statement.setLong(1, actorId);
                statement.setLong(2, cartItemId);
                statement.execute();
                return null;
            }
        }));
    }

    private CartItemResult callCartItemMutation(String call, StatementBinder binder) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute(
                (ConnectionCallback<CartItemResult>) connection -> {
                    try (PreparedStatement statement = connection.prepareStatement(call)) {
                        binder.bind(statement);
                        try (ResultSet output = statement.executeQuery()) {
                            if (!output.next()) throw missingProcedureOutput();
                            return new CartItemResult(id(output, "o_cart_id"),
                                    id(output, "o_cart_item_id"), output.getInt("o_quantity"));
                        }
                    }
                }));
    }

    private final RowMapper<Cart> CART_ROW_MAPPER = (rs, row) -> {
        return new Cart(nullableId(rs, "cart_id"), rs.getString("state"), parseItems(rs.getString("items")),
                rs.getBigDecimal("total_current"));
    };

    private List<CartItem> parseItems(String json) throws SQLException {
        JsonNode items;
        try {
            items = objectMapper.readTree(json);
        } catch (JacksonException exception) {
            throw new SQLException("Approved cart Function returned invalid items JSON", "XX000", exception);
        }
        if (items == null || !items.isArray()) {
            throw new SQLException("Approved cart Function returned a non-array items value", "XX000");
        }
        List<CartItem> result = new ArrayList<>(items.size());
        for (JsonNode item : items) {
            result.add(new CartItem(text(item, "cartItemId"), text(item, "editionId"), text(item, "title"),
                    text(item, "authors"), text(item, "sku"), nullableText(item, "coverUrl"),
                    item.path("quantity").intValue(), decimal(item, "currentPrice"),
                    decimal(item, "currentSubtotal"), item.path("available").booleanValue(),
                    nullableText(item, "unavailabilityReason")));
        }
        return List.copyOf(result);
    }

    private static String text(JsonNode object, String field) {
        JsonNode value = object.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static String nullableText(JsonNode object, String field) {
        return text(object, field);
    }

    private static BigDecimal decimal(JsonNode object, String field) {
        JsonNode value = object.get(field);
        return value == null || value.isNull() ? null : value.decimalValue();
    }

    private static String id(ResultSet rs, String column) throws SQLException {
        return Long.toString(rs.getLong(column));
    }

    private static String nullableId(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : Long.toString(value);
    }

    private static SQLException missingProcedureOutput() {
        return new SQLException("Approved cart Procedure returned no output", "02000");
    }

    @FunctionalInterface
    private interface StatementBinder {
        void bind(PreparedStatement statement) throws SQLException;
    }
}
