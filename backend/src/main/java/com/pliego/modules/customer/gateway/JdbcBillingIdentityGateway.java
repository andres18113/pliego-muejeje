package com.pliego.modules.customer.gateway;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.customer.application.BillingIdentity;

@Repository
public class JdbcBillingIdentityGateway extends JdbcGatewaySupport implements BillingIdentityGateway {
    private final JdbcTemplate jdbc;
    public JdbcBillingIdentityGateway(DatabaseExceptionTranslator translator, JdbcTemplate jdbc) {
        super(translator);
        this.jdbc = jdbc;
    }
    @Override public BillingIdentity find(long actorUserId) {
        return withDatabaseErrorTranslation(() -> jdbc.query(
                "SELECT * FROM pliego.fn_customer_billing_identity_read_model(?)",
                ps -> ps.setLong(1, actorUserId),
                rs -> {
                    if (!rs.next()) return null;
                    Long requestId = rs.getObject("correction_request_id", Long.class);
                    BillingIdentity.CorrectionRequest request = requestId == null ? null :
                            new BillingIdentity.CorrectionRequest(Long.toString(requestId),
                                    rs.getString("correction_request_status"), rs.getString("proposed_type"),
                                    rs.getString("proposed_number"), rs.getString("reason_code"),
                                    rs.getObject("created_at", java.time.OffsetDateTime.class),
                                    rs.getObject("due_at", java.time.OffsetDateTime.class),
                                    rs.getObject("decided_at", java.time.OffsetDateTime.class),
                                    rs.getString("decision_reason"));
                    return new BillingIdentity(rs.getString("identity_type"), rs.getString("identity_number"),
                            rs.getBoolean("used"), rs.getString("correction_mode"), request);
                }));
    }
    @Override public void register(long actorUserId, String type, String number) {
        withDatabaseErrorTranslation(() -> jdbc.update(
                "CALL pliego.sp_customer_billing_identity_register(?,?,?)", actorUserId, type, number));
    }
    @Override public void correct(long actorUserId, String type, String expectedNumber, String number) {
        withDatabaseErrorTranslation(() -> jdbc.update(
                "CALL pliego.sp_customer_billing_identity_correct(?,?,?,?)", actorUserId, type, expectedNumber, number));
    }
}
