package com.pliego.modules.inventory.gateway;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.OffsetDateTime;
import java.util.List;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.inventory.application.InventoryModels.Adjustment;
import com.pliego.modules.inventory.application.InventoryModels.Entry;
import com.pliego.modules.inventory.application.InventoryModels.InventoryItem;
import com.pliego.modules.inventory.application.InventoryModels.Movement;
import com.pliego.modules.inventory.application.InventoryModels.MovementResult;
import com.pliego.modules.inventory.application.InventoryModels.MovementSearch;
import com.pliego.modules.inventory.application.InventoryModels.Page;
import com.pliego.modules.inventory.application.InventoryModels.Search;

/** Invokes only approved inventory Functions and Procedures; it contains no business-table SQL. */
@Repository
public class JdbcInventoryGateway extends JdbcGatewaySupport implements InventoryGateway {

    private static final String INVENTORY_SEARCH = "SELECT edition_id,book_id,title,sku,btrim(isbn13::text) AS isbn13,"
            + "edition_state,stock_actual,stock_minimo,low_stock,updated_at,total_count "
            + "FROM pliego.fn_inventory_search(?,?,?,?,?,?,?)";
    private static final String INVENTORY_MOVEMENTS = "SELECT movement_id,edition_id,order_id,actor_user_id,type,"
            + "quantity,stock_before,stock_after,reason,event_at,total_count "
            + "FROM pliego.fn_inventory_movements(?,?,?,?,?)";
    private static final String INVENTORY_ENTRY = "CALL pliego.sp_inventory_entry(?,?,?,?,?,?,?)";
    private static final String INVENTORY_ADJUST = "CALL pliego.sp_inventory_adjust(?,?,?,?,?,?,?,?)";
    private static final String INVENTORY_SET_MINIMUM = "CALL pliego.sp_inventory_set_minimum(?,?,?,?)";

    private final JdbcTemplate jdbcTemplate;

    public JdbcInventoryGateway(DatabaseExceptionTranslator exceptionTranslator, JdbcTemplate jdbcTemplate) {
        super(exceptionTranslator);
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public Page<InventoryItem> search(long actorId, Search query) {
        return queryPage(INVENTORY_SEARCH, query.page(), query.pageSize(),
                (statement, page) -> {
                    statement.setLong(1, actorId);
                    nullableLong(statement, 2, query.editionId());
                    nullableString(statement, 3, query.title());
                    nullableString(statement, 4, query.sku());
                    statement.setBoolean(5, query.lowStockOnly());
                    statement.setInt(6, page);
                    statement.setInt(7, query.pageSize());
                }, (rs, row) -> new Counted<>(new InventoryItem(id(rs, "edition_id"), id(rs, "book_id"),
                        rs.getString("title"), rs.getString("sku"), rs.getString("isbn13"),
                        rs.getString("edition_state"), rs.getInt("stock_actual"), rs.getInt("stock_minimo"),
                        rs.getBoolean("low_stock"), timestamp(rs, "updated_at")), rs.getLong("total_count")));
    }

    @Override
    public Page<Movement> movements(long actorId, MovementSearch query) {
        return queryPage(INVENTORY_MOVEMENTS, query.page(), query.pageSize(),
                (statement, page) -> {
                    statement.setLong(1, actorId);
                    statement.setLong(2, query.editionId());
                    nullableString(statement, 3, query.type());
                    statement.setInt(4, page);
                    statement.setInt(5, query.pageSize());
                }, (rs, row) -> new Counted<>(new Movement(id(rs, "movement_id"), id(rs, "edition_id"),
                        nullableId(rs, "order_id"), nullableId(rs, "actor_user_id"), rs.getString("type"),
                        rs.getInt("quantity"), rs.getInt("stock_before"), rs.getInt("stock_after"),
                        rs.getString("reason"), timestamp(rs, "event_at")), rs.getLong("total_count")));
    }

    @Override
    public MovementResult entry(long actorId, long editionId, Entry request) {
        return callMovement(INVENTORY_ENTRY, statement -> {
            statement.setLong(1, actorId);
            statement.setLong(2, editionId);
            statement.setInt(3, request.quantity());
            statement.setString(4, request.reason());
            statement.setNull(5, Types.BIGINT);
            statement.setNull(6, Types.INTEGER);
            statement.setNull(7, Types.INTEGER);
        });
    }

    @Override
    public MovementResult adjust(long actorId, long editionId, Adjustment request) {
        return callMovement(INVENTORY_ADJUST, statement -> {
            statement.setLong(1, actorId);
            statement.setLong(2, editionId);
            statement.setString(3, request.type());
            statement.setInt(4, request.quantity());
            statement.setString(5, request.reason());
            statement.setNull(6, Types.BIGINT);
            statement.setNull(7, Types.INTEGER);
            statement.setNull(8, Types.INTEGER);
        });
    }

    @Override
    public void setMinimum(long actorId, long editionId, int stockMinimum) {
        withDatabaseErrorTranslation(() -> jdbcTemplate.execute((ConnectionCallback<Void>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(INVENTORY_SET_MINIMUM)) {
                statement.setLong(1, actorId);
                statement.setLong(2, editionId);
                statement.setInt(3, stockMinimum);
                statement.setNull(4, Types.INTEGER);
                try (ResultSet output = statement.executeQuery()) {
                    if (!output.next()) throw missingProcedureOutput("minimum");
                    output.getInt("o_stock_minimum");
                }
                return null;
            }
        }));
    }

    private MovementResult callMovement(String call, StatementBinder binder) {
        return withDatabaseErrorTranslation(() -> jdbcTemplate.execute((ConnectionCallback<MovementResult>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(call)) {
                binder.bind(statement);
                try (ResultSet output = statement.executeQuery()) {
                    if (!output.next()) throw missingProcedureOutput("movement");
                    return new MovementResult(Long.toString(output.getLong("o_movement_id")),
                            output.getInt("o_stock_before"), output.getInt("o_stock_after"));
                }
            }
        }));
    }

    private <T> Page<T> queryPage(String function, int page, int pageSize, SearchBinder binder,
            RowMapper<Counted<T>> mapper) {
        return withDatabaseErrorTranslation(() -> {
            List<Counted<T>> rows = runSearch(function, page, pageSize, binder, mapper);
            long total = rows.isEmpty() && page > 0
                    ? firstCount(runSearch(function, 0, pageSize, binder, mapper)) : firstCount(rows);
            return new Page<>(rows.stream().map(Counted::value).toList(), total);
        });
    }

    private <T> List<Counted<T>> runSearch(String function, int page, int pageSize, SearchBinder binder,
            RowMapper<Counted<T>> mapper) {
        return jdbcTemplate.query(function, statement -> binder.bind(statement, page), mapper);
    }

    private static long firstCount(List<? extends Counted<?>> rows) {
        return rows.isEmpty() ? 0 : rows.getFirst().totalCount();
    }

    private static SQLException missingProcedureOutput(String output) {
        return new SQLException("Approved inventory Procedure returned no " + output, "02000");
    }

    private static String id(ResultSet rs, String column) throws SQLException {
        return Long.toString(rs.getLong(column));
    }

    private static String nullableId(ResultSet rs, String column) throws SQLException {
        long value = rs.getLong(column);
        return rs.wasNull() ? null : Long.toString(value);
    }

    private static String timestamp(ResultSet rs, String column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toString();
    }

    private static void nullableString(PreparedStatement statement, int index, String value) throws SQLException {
        if (value == null) statement.setNull(index, Types.VARCHAR);
        else statement.setString(index, value);
    }

    private static void nullableLong(PreparedStatement statement, int index, Long value) throws SQLException {
        if (value == null) statement.setNull(index, Types.BIGINT);
        else statement.setLong(index, value);
    }

    @FunctionalInterface
    private interface SearchBinder {
        void bind(PreparedStatement statement, int page) throws SQLException;
    }

    @FunctionalInterface
    private interface StatementBinder {
        void bind(PreparedStatement statement) throws SQLException;
    }

    private record Counted<T>(T value, long totalCount) { }
}
