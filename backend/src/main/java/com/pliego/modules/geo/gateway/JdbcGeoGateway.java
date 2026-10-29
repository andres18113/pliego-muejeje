package com.pliego.modules.geo.gateway;

import java.util.List;
import java.sql.Array;
import java.sql.SQLException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.geo.gateway.GeoGateway.CityRow;
import com.pliego.modules.geo.gateway.GeoGateway.ProvinceRow;

@Repository
public class JdbcGeoGateway extends JdbcGatewaySupport implements GeoGateway {
    private final JdbcTemplate jdbc;

    public JdbcGeoGateway(DatabaseExceptionTranslator exceptionTranslator, JdbcTemplate jdbc) {
        super(exceptionTranslator);
        this.jdbc = jdbc;
    }

    @Override
    public List<ProvinceRow> listProvinces() {
        return withDatabaseErrorTranslation(() -> jdbc.query(
                "SELECT province_id,code,name FROM pliego.fn_geo_provinces()",
                (rs, row) -> new ProvinceRow(rs.getLong("province_id"), rs.getString("code"), rs.getString("name"))));
    }

    @Override
    public List<CityRow> listCities(long provinceId) {
        return withDatabaseErrorTranslation(() -> jdbc.query(
                "SELECT city_id,code,name,kind,canton_name,aliases FROM pliego.fn_geo_cities(?)",
                statement -> statement.setLong(1, provinceId),
                (rs, row) -> new CityRow(rs.getLong("city_id"), rs.getString("code"), rs.getString("name"),
                        rs.getString("kind"), rs.getString("canton_name"), stringArray(rs.getArray("aliases")))));
    }

    private static List<String> stringArray(Array array) throws SQLException {
        if (array == null) return List.of();
        Object value = array.getArray();
        if (!(value instanceof String[] strings)) throw new SQLException("Invalid geographic aliases projection", "XX000");
        return List.of(strings);
    }
}
