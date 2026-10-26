package com.pliego.modules.sales.gateway;

import java.util.List;
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
    public JdbcPickupLocationGateway(DatabaseExceptionTranslator errors, JdbcTemplate jdbc) { super(errors); this.jdbc=jdbc; }
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
    public void collect(long actorId, long orderId, String pickupCode) {
        withDatabaseErrorTranslation(() -> { jdbc.update("CALL pliego.sp_pickup_collect(?,?,?)",actorId,orderId,pickupCode); return null; });
    }
}
