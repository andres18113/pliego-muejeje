package com.pliego.modules.sales.gateway;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.sales.application.PickupLocation;
import com.pliego.modules.sales.application.PickupLocation.OpeningHours;

@Repository
public class JdbcPickupLocationGateway extends JdbcGatewaySupport implements PickupLocationGateway {
    private final JdbcTemplate jdbc;
    public JdbcPickupLocationGateway(DatabaseExceptionTranslator errors, JdbcTemplate jdbc) { super(errors); this.jdbc=jdbc; }
    public List<PickupLocation> activeLocations() {
        return withDatabaseErrorTranslation(() -> jdbc.query("SELECT * FROM pliego.fn_pickup_locations()", (rs,n) ->
            new PickupLocation(Long.toString(rs.getLong("pickup_location_id")),rs.getString("name"),rs.getString("address"),
                rs.getString("city"),rs.getString("province"),rs.getString("country_code"),rs.getString("postal_code"),
                rs.getBigDecimal("latitude"),rs.getBigDecimal("longitude"),rs.getString("timezone"),
                new OpeningHours(rs.getString("opens_at"),rs.getString("closes_at")),rs.getBoolean("active"),rs.getInt("preparation_minutes"))));
    }
    public void collect(long actorId, long orderId, String pickupCode) {
        withDatabaseErrorTranslation(() -> { jdbc.update("CALL pliego.sp_pickup_collect(?,?,?)",actorId,orderId,pickupCode); return null; });
    }
}
