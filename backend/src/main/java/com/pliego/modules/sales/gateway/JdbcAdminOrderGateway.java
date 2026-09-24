package com.pliego.modules.sales.gateway;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.sales.application.AdminOrderModels.Address;
import com.pliego.modules.sales.application.AdminOrderModels.Cancellation;
import com.pliego.modules.sales.application.AdminOrderModels.Detail;
import com.pliego.modules.sales.application.AdminOrderModels.History;
import com.pliego.modules.sales.application.AdminOrderModels.InventoryMovement;
import com.pliego.modules.sales.application.AdminOrderModels.Item;
import com.pliego.modules.sales.application.AdminOrderModels.Page;
import com.pliego.modules.sales.application.AdminOrderModels.Payment;
import com.pliego.modules.sales.application.AdminOrderModels.Search;
import com.pliego.modules.sales.application.AdminOrderModels.Summary;
import com.pliego.modules.sales.application.AdminOrderModels.Transition;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Calls only approved ADMIN order Functions and Procedures; it contains no business-table SQL. */
@Repository
public class JdbcAdminOrderGateway extends JdbcGatewaySupport implements AdminOrderGateway {

    private static final String SEARCH = "SELECT order_id,customer_id,customer_name,created_at,order_state,"
            + "total,payment_state,total_count FROM pliego.fn_admin_orders(?,?,?,?,?,?,?)";
    private static final String DETAIL = "SELECT order_id,customer_id,customer_email,customer_name,order_state,"
            + "subtotal,total,created_at,updated_at,items::text AS items,address::text AS address,"
            + "payment::text AS payment,state_history::text AS state_history,"
            + "inventory_movements::text AS inventory_movements "
            + "FROM pliego.fn_admin_order_detail(?,?)";
    private static final String TRANSITION = "CALL pliego.sp_order_change_status(?,?,?,?,?,?)";
    private static final String CANCEL = "CALL pliego.sp_order_cancel(?,?,?,?,?,?,?)";

    private final JdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public JdbcAdminOrderGateway(DatabaseExceptionTranslator exceptionTranslator, JdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper) {
        super(exceptionTranslator);
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public Page search(long actorUserId, Search search) {
        return withDatabaseErrorTranslation(() -> {
            List<CountedSummary> rows = searchRows(actorUserId, search, search.page());
            long totalCount = rows.isEmpty() && search.page() > 0
                    ? firstCount(searchRows(actorUserId, search, 0)) : firstCount(rows);
            return new Page(rows.stream().map(CountedSummary::summary).toList(), totalCount);
        });
    }

    private List<CountedSummary> searchRows(long actorUserId, Search search, int page) {
        return jdbcTemplate.query(SEARCH, statement -> {
            statement.setLong(1, actorUserId);
            nullableString(statement, 2, search.state());
            nullableTimestamp(statement, 3, search.dateFrom());
            nullableTimestamp(statement, 4, search.dateTo());
            nullableLong(statement, 5, search.customerId());
            statement.setInt(6, page);
            statement.setInt(7, search.pageSize());
        }, (rs, row) -> new CountedSummary(new Summary(id(rs, "order_id"), id(rs, "customer_id"),
                rs.getString("customer_name"), rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                rs.getString("order_state"), rs.getBigDecimal("total"), rs.getString("payment_state")),
                rs.getLong("total_count")));
    }

    @Override
    public Detail detail(long actorUserId, long orderId) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.queryForObject(DETAIL, detailMapper(),
                actorUserId, orderId));
    }

    @Override
    public Transition transition(long actorUserId, long orderId, String targetState) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute(
                (ConnectionCallback<Transition>) connection -> {
                    try (var statement = connection.prepareStatement(TRANSITION)) {
                        statement.setLong(1, actorUserId);
                        statement.setLong(2, orderId);
                        statement.setString(3, targetState);
                        statement.setNull(4, Types.BIGINT);
                        statement.setNull(5, Types.VARCHAR);
                        statement.setNull(6, Types.VARCHAR);
                        try (ResultSet output = statement.executeQuery()) {
                            if (!output.next()) throw new SQLException(
                                    "Order transition Procedure returned no output", "02000");
                            return new Transition(Long.toString(output.getLong("o_order_id")),
                                    output.getString("o_previous_state"), output.getString("o_order_state"));
                        }
                    }
                }));
    }

    @Override
    public Cancellation cancel(long actorUserId, long orderId) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute(
                (ConnectionCallback<Cancellation>) connection -> {
                    try (var statement = connection.prepareStatement(CANCEL)) {
                        statement.setLong(1, actorUserId);
                        statement.setLong(2, orderId);
                        statement.setNull(3, Types.BIGINT);
                        statement.setNull(4, Types.VARCHAR);
                        statement.setNull(5, Types.VARCHAR);
                        statement.setNull(6, Types.VARCHAR);
                        statement.setNull(7, Types.BIGINT);
                        try (ResultSet output = statement.executeQuery()) {
                            if (!output.next()) throw new SQLException(
                                    "Order cancellation Procedure returned no output", "02000");
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
            JsonNode movements = parseJson(rs.getString("inventory_movements"), "inventory movements");
            if (!items.isArray() || !address.isObject() || !payment.isObject()
                    || !history.isArray() || !movements.isArray()) {
                throw new SQLException("Admin order detail Function returned incomplete JSON", "XX000");
            }
            return new Detail(id(rs, "order_id"), id(rs, "customer_id"), rs.getString("customer_email"),
                    rs.getString("customer_name"), rs.getString("order_state"), rs.getBigDecimal("subtotal"),
                    rs.getBigDecimal("total"), rs.getObject("created_at", OffsetDateTime.class).toInstant(),
                    rs.getObject("updated_at", OffsetDateTime.class).toInstant(), parseItems(items),
                    new Address(text(address, "destinatario"), text(address, "direccion_linea1"),
                            text(address, "direccion_linea2"), text(address, "ciudad"),
                            text(address, "provincia"), text(address, "pais_codigo"),
                            text(address, "codigo_postal"), text(address, "referencia"),
                            text(address, "telefono")),
                    new Payment(id(payment, "pago_id"), text(payment, "metodo"), text(payment, "estado"),
                            decimal(payment, "monto"), text(payment, "referencia"),
                            text(payment, "detalle_resultado"), timestamp(payment, "fecha_creacion"),
                            timestamp(payment, "fecha_actualizacion")),
                    parseHistory(history), parseMovements(movements));
        };
    }

    private JsonNode parseJson(String value, String name) throws SQLException {
        try {
            JsonNode parsed = objectMapper.readTree(value);
            if (parsed == null || parsed.isNull()) {
                throw new SQLException("Admin order detail Function returned null " + name, "XX000");
            }
            return parsed;
        } catch (JacksonException exception) {
            throw new SQLException("Admin order detail Function returned invalid " + name + " JSON", "XX000", exception);
        }
    }

    private static List<Item> parseItems(JsonNode array) {
        List<Item> result = new ArrayList<>(array.size());
        for (JsonNode item : array) {
            result.add(new Item(id(item, "pedido_item_id"), id(item, "edicion_id"),
                    text(item, "sku_snapshot"), text(item, "isbn_snapshot"), text(item, "titulo_snapshot"),
                    text(item, "autores_snapshot"), text(item, "editorial_snapshot"),
                    text(item, "formato_snapshot"), text(item, "idioma_snapshot"),
                    decimal(item, "precio_unitario"), item.path("cantidad").intValue(),
                    decimal(item, "subtotal")));
        }
        return List.copyOf(result);
    }

    private static List<History> parseHistory(JsonNode array) throws SQLException {
        List<History> result = new ArrayList<>(array.size());
        for (JsonNode history : array) {
            result.add(new History(id(history, "pedido_estado_historial_id"),
                    id(history, "usuario_actor_id"), text(history, "origen"),
                    text(history, "estado_anterior"), text(history, "estado_nuevo"),
                    timestamp(history, "fecha")));
        }
        return List.copyOf(result);
    }

    private static List<InventoryMovement> parseMovements(JsonNode array) throws SQLException {
        List<InventoryMovement> result = new ArrayList<>(array.size());
        for (JsonNode movement : array) {
            result.add(new InventoryMovement(id(movement, "movimiento_inventario_id"),
                    id(movement, "edicion_id"), id(movement, "pedido_id"),
                    id(movement, "usuario_actor_id"), text(movement, "tipo"),
                    movement.path("cantidad").intValue(), movement.path("stock_anterior").intValue(),
                    movement.path("stock_posterior").intValue(), text(movement, "motivo"),
                    timestamp(movement, "fecha")));
        }
        return List.copyOf(result);
    }

    private static String id(ResultSet rs, String field) throws SQLException {
        long value = rs.getLong(field);
        return rs.wasNull() ? null : Long.toString(value);
    }

    private static String id(JsonNode object, String field) {
        JsonNode value = object.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static String text(JsonNode object, String field) {
        JsonNode value = object.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static java.math.BigDecimal decimal(JsonNode object, String field) {
        JsonNode value = object.get(field);
        return value == null || value.isNull() ? null : value.decimalValue();
    }

    private static String timestamp(JsonNode object, String field) throws SQLException {
        String value = text(object, field);
        if (value == null) return null;
        try {
            return OffsetDateTime.parse(value).toInstant().toString();
        } catch (DateTimeParseException exception) {
            throw new SQLException("Admin order detail Function returned an invalid timestamp", "XX000", exception);
        }
    }

    private static void nullableTimestamp(java.sql.PreparedStatement statement, int index, OffsetDateTime value)
            throws SQLException {
        if (value == null) statement.setNull(index, Types.TIMESTAMP_WITH_TIMEZONE);
        else statement.setObject(index, value);
    }

    private static void nullableString(java.sql.PreparedStatement statement, int index, String value)
            throws SQLException {
        if (value == null) statement.setNull(index, Types.VARCHAR);
        else statement.setString(index, value);
    }

    private static void nullableLong(java.sql.PreparedStatement statement, int index, Long value)
            throws SQLException {
        if (value == null) statement.setNull(index, Types.BIGINT);
        else statement.setLong(index, value);
    }

    private static long firstCount(List<CountedSummary> rows) {
        return rows.isEmpty() ? 0 : rows.getFirst().totalCount();
    }

    private record CountedSummary(Summary summary, long totalCount) { }
}
