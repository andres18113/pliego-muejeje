package com.pliego.modules.sales.gateway;

import java.util.List;
import java.sql.SQLException;
import com.pliego.modules.sales.application.PickupModels;
import tools.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.sales.application.PickupLocationReference;
import com.pliego.modules.sales.application.PickupLocation;
import com.pliego.modules.sales.application.PickupLocation.OpeningHours;

@Repository
public class JdbcPickupLocationGateway extends JdbcGatewaySupport implements PickupLocationGateway {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    public JdbcPickupLocationGateway(DatabaseExceptionTranslator errors, JdbcTemplate jdbc, ObjectMapper mapper) {
        super(errors); this.jdbc=jdbc; this.mapper=mapper;
    }
    public List<PickupLocationReference> activeLocations() {
        return withDatabaseErrorTranslation(() -> jdbc.query("SELECT * FROM pliego.fn_pickup_locations()", (rs,n) ->
            new PickupLocationReference(Long.toString(rs.getLong("pickup_location_id")),rs.getString("name"),rs.getString("address"),
                rs.getString("city"),rs.getString("province"),stringId(rs.getObject("province_id",Long.class)),
                stringId(rs.getObject("city_id",Long.class)),
                rs.getObject("province_id",Long.class)==null || rs.getObject("city_id",Long.class)==null,
                rs.getString("country_code"),rs.getString("postal_code"),
                rs.getBigDecimal("latitude"),rs.getBigDecimal("longitude"),rs.getString("timezone"),
                new OpeningHours(rs.getString("opens_at"),rs.getString("closes_at")),rs.getBoolean("active"),rs.getInt("preparation_minutes"))));
    }
    private static String stringId(Long value) { return value == null ? null : value.toString(); }
    @Override
    public void collect(long actorId, long orderId, String pickupCode, boolean identityVerified) {
        withDatabaseErrorTranslation(() -> {
            jdbc.update("CALL pliego.sp_pickup_collect(?,?,?,?)", actorId, orderId, pickupCode, identityVerified);
            return null;
        });
    }

    @Override
    public PickupModels.View detail(long actorId, long orderId) {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_admin_pickup_detail(?,?)::text AS pickup",
                (rs, row) -> pickup(rs.getString("pickup")), actorId, orderId));
    }

    @Override
    public PickupModels.Detail handoverDetail(long actorId, long orderId) {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_admin_pickup_handover_detail(?,?)::text AS pickup",
                (rs, row) -> pickupDetail(rs.getString("pickup")), actorId, orderId));
    }

    @Override
    public PickupModels.Detail verifyCode(long actorId, long orderId, String code) {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_admin_pickup_verify_code(?,?,?)::text AS pickup",
                (rs, row) -> pickupDetail(rs.getString("pickup")), actorId, orderId, code));
    }

    private PickupModels.Detail pickupDetail(String json) throws SQLException {
        try {
            var value = mapper.readValue(json, PickupModels.Detail.class);
            if (value == null) throw new SQLException("Missing administrative pickup detail", "XX000");
            return value;
        } catch (tools.jackson.core.JacksonException error) {
            throw new SQLException("Invalid administrative pickup detail", "XX000", error);
        }
    }

    @Override
    public PickupModels.View lookup(long actorId, String code) {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_admin_pickup_lookup(?,?)::text AS pickup",
                (rs, row) -> pickup(rs.getString("pickup")), actorId, code));
    }

    @Override
    public PickupModels.Page search(long actorId,
            PickupModels.Search search) {
        return withDatabaseErrorTranslation(() -> {
            var rows = searchRows(actorId, search, search.page());
            long total = rows.isEmpty() && search.page() > 0 ? count(searchRows(actorId, search, 0)) : count(rows);
            return new PickupModels.Page(
                    rows.stream().map(CountedPickup::pickup).toList(), total);
        });
    }

    private List<CountedPickup> searchRows(long actorId,
            PickupModels.Search search, int page) {
        return jdbc.query("SELECT pickup::text,total_count FROM pliego.fn_admin_pickups(?,?,?,?,?)", statement -> {
            statement.setLong(1, actorId);
            statement.setString(2, search.state());
            statement.setString(3, search.q());
            statement.setInt(4, page);
            statement.setInt(5, search.pageSize());
        }, (rs, row) -> new CountedPickup(pickup(rs.getString("pickup")), rs.getLong("total_count")));
    }

    private PickupModels.View pickup(String json) throws SQLException {
        try {
            var value = mapper.readValue(json, PickupModels.View.class);
            if (value == null) throw new SQLException("Missing administrative pickup projection", "XX000");
            return value;
        } catch (tools.jackson.core.JacksonException error) {
            throw new SQLException("Invalid administrative pickup projection", "XX000", error);
        }
    }

    private static long count(List<CountedPickup> rows) { return rows.isEmpty() ? 0 : rows.getFirst().totalCount(); }
    private record CountedPickup(PickupModels.View pickup, long totalCount) { }
}
