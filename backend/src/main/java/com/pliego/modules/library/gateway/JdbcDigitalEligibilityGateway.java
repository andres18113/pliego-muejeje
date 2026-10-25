package com.pliego.modules.library.gateway;

import java.util.List;
import java.util.stream.Collectors;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.library.application.DigitalEligibility;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcDigitalEligibilityGateway extends JdbcGatewaySupport implements DigitalEligibilityGateway {
    private final JdbcTemplate jdbc;

    public JdbcDigitalEligibilityGateway(DatabaseExceptionTranslator translator, JdbcTemplate jdbc) {
        super(translator);
        this.jdbc = jdbc;
    }

    @Override
    public List<DigitalEligibility> get(long actorId, List<Long> editionIds) {
        String ids = editionIds.stream().map(String::valueOf).collect(Collectors.joining(","));
        return withDatabaseErrorTranslation(() -> jdbc.query(
                "SELECT * FROM pliego.fn_customer_digital_eligibility(?,string_to_array(?,',')::bigint[])",
                (rs, row) -> new DigitalEligibility(rs.getString("edition_id"), rs.getBoolean("owned"),
                        rs.getString("owned_item_id"), rs.getBoolean("pending_order"), rs.getString("pending_order_id"),
                        rs.getBoolean("in_cart"), rs.getBoolean("purchasable")), actorId, ids));
    }
}
