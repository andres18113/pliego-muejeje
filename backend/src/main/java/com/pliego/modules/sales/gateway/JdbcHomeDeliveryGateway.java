package com.pliego.modules.sales.gateway;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;

@Repository
public class JdbcHomeDeliveryGateway extends JdbcGatewaySupport implements HomeDeliveryGateway {
    private final JdbcTemplate jdbc;

    public JdbcHomeDeliveryGateway(DatabaseExceptionTranslator errors, JdbcTemplate jdbc) {
        super(errors);
        this.jdbc = jdbc;
    }

    @Override
    public void advanceDue(int batchSize) {
        withDatabaseErrorTranslation(() -> {
            jdbc.update("CALL pliego.sp_home_delivery_advance_due(?)", batchSize);
            return null;
        });
    }
}
