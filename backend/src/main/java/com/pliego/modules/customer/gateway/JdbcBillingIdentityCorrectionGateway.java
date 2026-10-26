package com.pliego.modules.customer.gateway;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Types;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.customer.application.AdminBillingIdentityCorrection;
import com.pliego.modules.customer.application.BillingIdentityCorrection;
import com.pliego.modules.customer.application.BillingIdentityCorrectionDecision;
import com.pliego.modules.customer.application.BillingIdentityCorrectionPage;

/** Calls only the PostgreSQL Database API for identity correction requests. */
@Repository
public class JdbcBillingIdentityCorrectionGateway extends JdbcGatewaySupport implements BillingIdentityCorrectionGateway {
    private static final String SUBMIT = "CALL pliego.sp_customer_billing_identity_correction_request_submit(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)";
    private static final String DECIDE = "CALL pliego.sp_admin_billing_identity_correction_decide(?,?,?,?,?,?,?,?)";
    private final JdbcTemplate jdbc;
    private record AdminRequestRow(AdminBillingIdentityCorrection request, long totalCount) { }

    public JdbcBillingIdentityCorrectionGateway(DatabaseExceptionTranslator translator, JdbcTemplate jdbc) {
        super(translator);
        this.jdbc = jdbc;
    }

    @Override
    public BillingIdentityCorrection submit(long actorUserId, UUID idempotencyKey, String currentNumber,
            String proposedType, String proposedNumber, String reasonCode, String note) {
        return withDatabaseErrorTranslation(() -> jdbc.execute((ConnectionCallback<BillingIdentityCorrection>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(SUBMIT)) {
                statement.setLong(1, actorUserId);
                statement.setObject(2, idempotencyKey);
                statement.setString(3, currentNumber);
                statement.setString(4, proposedType);
                statement.setString(5, proposedNumber);
                statement.setString(6, reasonCode);
                if (note == null) statement.setNull(7, Types.VARCHAR); else statement.setString(7, note);
                for (int index = 8; index <= 16; index++) statement.setNull(index, index == 8 ? Types.BIGINT
                        : (index == 13 || index == 14 || index == 15 ? Types.TIMESTAMP_WITH_TIMEZONE : Types.VARCHAR));
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) throw new SQLException("Correction request Procedure returned no output", "02000");
                    return customerRequest(rs);
                }
            }
        }));
    }

    @Override public void withdraw(long actorUserId, long requestId) {
        withDatabaseErrorTranslation(() -> jdbc.update(
                "CALL pliego.sp_customer_billing_identity_correction_request_withdraw(?,?)", actorUserId, requestId));
    }

    @Override
    public BillingIdentityCorrectionPage search(long actorUserId, String status, int page, int pageSize) {
        return withDatabaseErrorTranslation(() -> {
            List<AdminRequestRow> rows = jdbc.query(
                    "SELECT * FROM pliego.fn_admin_billing_identity_correction_requests(?,?,?,?)", ps -> {
                        ps.setLong(1, actorUserId);
                        if (status == null) ps.setNull(2, Types.VARCHAR); else ps.setString(2, status);
                        ps.setInt(3, page);
                        ps.setInt(4, pageSize);
                    }, (rs, rowNum) -> new AdminRequestRow(adminRequest(rs), rs.getLong("total_count")));
            return new BillingIdentityCorrectionPage(rows.stream().map(AdminRequestRow::request)
                    .filter(java.util.Objects::nonNull).toList(),
                    rows.isEmpty() ? 0 : rows.getFirst().totalCount());
        });
    }

    @Override
    public BillingIdentityCorrectionDecision decide(long actorUserId, long requestId, String decision,
            String decisionReason) {
        return withDatabaseErrorTranslation(() -> jdbc.execute((ConnectionCallback<BillingIdentityCorrectionDecision>) connection -> {
            try (PreparedStatement statement = connection.prepareStatement(DECIDE)) {
                statement.setLong(1, actorUserId);
                statement.setLong(2, requestId);
                statement.setString(3, decision);
                if (decisionReason == null) statement.setNull(4, Types.VARCHAR); else statement.setString(4, decisionReason);
                statement.setNull(5, Types.VARCHAR);
                statement.setNull(6, Types.TIMESTAMP_WITH_TIMEZONE);
                statement.setNull(7, Types.BIGINT);
                statement.setNull(8, Types.VARCHAR);
                try (ResultSet rs = statement.executeQuery()) {
                    if (!rs.next()) throw new SQLException("Correction decision Procedure returned no output", "02000");
                    Long decidedBy = rs.getObject("o_decided_by", Long.class);
                    return new BillingIdentityCorrectionDecision(Long.toString(requestId), rs.getString("o_status"),
                            rs.getObject("o_decided_at", OffsetDateTime.class), decidedBy == null ? null : Long.toString(decidedBy),
                            rs.getString("o_decision_reason"));
                }
            }
        }));
    }

    private static BillingIdentityCorrection customerRequest(ResultSet rs) throws SQLException {
        Long requestId = rs.getObject("o_request_id", Long.class);
        return new BillingIdentityCorrection(Long.toString(requestId), rs.getString("o_status"),
                rs.getString("o_proposed_type"), rs.getString("o_proposed_number"), rs.getString("o_reason_code"),
                rs.getObject("o_created_at", OffsetDateTime.class), rs.getObject("o_due_at", OffsetDateTime.class),
                rs.getObject("o_decided_at", OffsetDateTime.class), rs.getString("o_decision_reason"));
    }

    private static AdminBillingIdentityCorrection adminRequest(ResultSet rs) throws SQLException {
        Long requestId = rs.getObject("request_id", Long.class);
        if (requestId == null) return null;
        Long customerId = rs.getObject("customer_id", Long.class);
        Long decidedBy = rs.getObject("decided_by", Long.class);
        return new AdminBillingIdentityCorrection(Long.toString(requestId), Long.toString(customerId),
                rs.getString("customer_name"), rs.getString("customer_email"), rs.getString("current_type"),
                rs.getString("current_number"), rs.getString("proposed_type"), rs.getString("proposed_number"),
                rs.getString("reason_code"), rs.getString("note"), rs.getString("status"),
                rs.getObject("created_at", OffsetDateTime.class), rs.getObject("due_at", OffsetDateTime.class),
                rs.getObject("decided_at", OffsetDateTime.class), decidedBy == null ? null : Long.toString(decidedBy),
                rs.getString("decision_reason"));
    }
}
