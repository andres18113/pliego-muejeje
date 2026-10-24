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
                "SELECT identity_type, identity_number FROM pliego.fn_customer_billing_identity(?)",
                ps -> ps.setLong(1, actorUserId),
                rs -> rs.next() ? new BillingIdentity(rs.getString("identity_type"), rs.getString("identity_number")) : null));
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
