package com.pliego.modules.sales.gateway;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.sales.application.OrderModels.Address;
import com.pliego.modules.sales.application.OrderModels.Cancellation;
import com.pliego.modules.sales.application.OrderModels.Detail;
import com.pliego.modules.sales.application.OrderModels.History;
import com.pliego.modules.sales.application.OrderModels.Item;
import com.pliego.modules.sales.application.OrderModels.Page;
import com.pliego.modules.sales.application.OrderModels.Payment;
import com.pliego.modules.sales.application.OrderModels.Summary;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Reads stored order snapshots and invokes only the three approved public routines. */
@Repository
public class JdbcCustomerOrderGateway extends JdbcGatewaySupport implements CustomerOrderGateway {

    private static final String LIST = "SELECT order_id,created_at,order_state,total,payment_state,total_count "
            + "FROM pliego.fn_customer_orders(?,?,?)";
    private static final String DETAIL = "SELECT order_id,order_state,subtotal,total,created_at,updated_at,"
            + "items::text AS items,address::text AS address,payment::text AS payment,"
            + "state_history::text AS state_history FROM pliego.fn_customer_order_detail(?,?)";
    private static final String CANCEL = "CALL pliego.sp_order_cancel(?,?,?,?,?,?,?)";

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public JdbcCustomerOrderGateway(DatabaseExceptionTranslator exceptionTranslator, JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper) {
        super(exceptionTranslator);
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public Page list(long actorUserId, int page, int pageSize) {
        return withDatabaseErrorTranslation(() -> {
            List<CountedSummary> rows = listRows(actorUserId, page, pageSize);
            long totalCount;
            if (!rows.isEmpty()) {
                totalCount = rows.getFirst().totalCount();
            } else if (page > 0) {
                // total_count is present only on returned rows; use the same approved Function.
                List<CountedSummary> firstPage = listRows(actorUserId, 0, pageSize);
                totalCount = firstPage.isEmpty() ? 0 : firstPage.getFirst().totalCount();
            } else {
                totalCount = 0;
            }
            return new Page(rows.stream().map(CountedSummary::summary).toList(), totalCount);
        });
    }

    private List<CountedSummary> listRows(long actorUserId, int page, int pageSize) {
        return jdbcTemplate.query(LIST, statement -> {
            statement.setLong(1, actorUserId);
            statement.setInt(2, page);
            statement.setInt(3, pageSize);
        }, (rs, row) -> new CountedSummary(new Summary(Long.toString(rs.getLong("order_id")),
                rs.getObject("created_at", OffsetDateTime.class).toInstant(), rs.getString("order_state"),
                rs.getBigDecimal("total"), rs.getString("payment_state")), rs.getLong("total_count")));
    }

    @Override
    public Detail detail(long actorUserId, long orderId) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.queryForObject(DETAIL,
                detailMapper(), actorUserId, orderId));
    }

    @Override
    public Cancellation cancel(long actorUserId, long orderId) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute((ConnectionCallback<Cancellation>) connection -> {
            try (var statement = connection.prepareStatement(CANCEL)) {
                statement.setLong(1, actorUserId);
                statement.setLong(2, orderId);
                statement.setNull(3, Types.BIGINT);
                statement.setNull(4, Types.VARCHAR);
                statement.setNull(5, Types.VARCHAR);
                statement.setNull(6, Types.VARCHAR);
                statement.setNull(7, Types.BIGINT);
                try (ResultSet output = statement.executeQuery()) {
                    if (!output.next()) throw new SQLException("Order cancellation Procedure returned no output", "02000");
                    return new Cancellation(Long.toString(output.getLong("o_order_id")),
                            output.getString("o_previous_state"), output.getString("o_order_state"),
                            output.getString("o_payment_state"), output.getLong("o_restored_units"));
                }
            }
        }));
    }

    private RowMapper<Detail> detailMapper() {
        return (rs, row) -> {
            JsonNode items = parseJson(rs.getString("items"), "items");
            JsonNode address = parseJson(rs.getString("address"), "address");
            JsonNode payment = parseJson(rs.getString("payment"), "payment");
            JsonNode history = parseJson(rs.getString("state_history"), "state history");
            if (!items.isArray() || !address.isObject() || !payment.isObject() || !history.isArray()) {
                throw new SQLException("Order detail Function returned incomplete JSON", "XX000");
            }
            return new Detail(Long.toString(rs.getLong("order_id")), rs.getString("order_state"),
                    rs.getBigDecimal("subtotal"), rs.getBigDecimal("total"),
                    rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                    rs.getObject("updated_at", OffsetDateTime.class).toInstant(),
                    parseItems(items), new Address(text(address, "destinatario"),
                            text(address, "direccion_linea1"), text(address, "direccion_linea2"),
                            text(address, "ciudad"), text(address, "provincia"),
                            text(address, "pais_codigo"), text(address, "codigo_postal"),
                            text(address, "referencia"), text(address, "telefono")),
                    new Payment(text(payment, "paymentId"), text(payment, "method"),
                            text(payment, "state"), decimal(payment, "amount"),
                            text(payment, "reference"), text(payment, "resultDetail"),
                            text(payment, "createdAt"), text(payment, "updatedAt")), parseHistory(history));
        };
    }

    private JsonNode parseJson(String value, String name) throws SQLException {
        try {
            JsonNode parsed = objectMapper.readTree(value);
            if (parsed == null || parsed.isNull()) throw new SQLException("Order detail Function returned null " + name, "XX000");
            return parsed;
        } catch (JacksonException exception) {
            throw new SQLException("Order detail Function returned invalid " + name + " JSON", "XX000", exception);
        }
    }

    private static List<Item> parseItems(JsonNode array) {
        List<Item> result = new ArrayList<>(array.size());
        for (JsonNode item : array) {
            result.add(new Item(text(item, "orderItemId"), text(item, "editionId"),
                    text(item, "sku"), text(item, "isbn"), text(item, "title"),
                    text(item, "authors"), text(item, "publisher"), text(item, "format"),
                    text(item, "language"), decimal(item, "unitPrice"),
                    item.path("quantity").intValue(), decimal(item, "subtotal")));
        }
        return List.copyOf(result);
    }

    private static List<History> parseHistory(JsonNode array) {
        List<History> result = new ArrayList<>(array.size());
        for (JsonNode history : array) {
            result.add(new History(text(history, "historyId"), text(history, "actorUserId"),
                    text(history, "origin"), text(history, "previousState"),
                    text(history, "newState"), text(history, "at")));
        }
        return List.copyOf(result);
    }

    private static String text(JsonNode object, String field) {
        JsonNode value = object.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static java.math.BigDecimal decimal(JsonNode object, String field) {
        JsonNode value = object.get(field);
        return value == null || value.isNull() ? null : value.decimalValue();
    }

    private record CountedSummary(Summary summary, long totalCount) { }
}
