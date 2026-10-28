package com.pliego.modules.billing.gateway;

import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import com.pliego.foundation.database.DatabaseExceptionTranslator;
import com.pliego.foundation.database.JdbcGatewaySupport;
import com.pliego.modules.billing.application.InvoiceDownload;
import com.pliego.modules.billing.application.InvoiceArtifactAccessGrant;
import com.pliego.modules.billing.application.InvoiceJob;
import com.pliego.modules.billing.application.InvoiceStoredArtifact;

@Repository
public class JdbcBillingGateway extends JdbcGatewaySupport implements BillingGateway {
    private final JdbcTemplate jdbc;
    public JdbcBillingGateway(DatabaseExceptionTranslator errors, JdbcTemplate jdbc) { super(errors); this.jdbc = jdbc; }

    @Override public String metadata(long actorId, long orderId) {
        return withDatabaseErrorTranslation(() -> jdbc.queryForObject(
                "SELECT pliego.fn_invoice_artifact_metadata(?,?)::text", String.class, actorId, orderId));
    }

    @Override public InvoiceDownload download(long actorId, long orderId, String type) {
        return withDatabaseErrorTranslation(() -> jdbc.query(
                "SELECT * FROM pliego.fn_invoice_artifact_download(?,?,?)", s -> {
                    s.setLong(1, actorId); s.setLong(2, orderId); s.setString(3, type);
                }, r -> r.next() ? new InvoiceDownload(r.getBytes("content"), r.getString("mime_type"),
                        r.getString("file_name"), r.getString("checksum")) : null));
    }

    @Override public InvoiceArtifactAccessGrant access(long actorId, long orderId, String type) {
        return withDatabaseErrorTranslation(() -> jdbc.query(
                "SELECT * FROM pliego.fn_invoice_artifact_access_v085(?,?,?)", s -> {
                    s.setLong(1, actorId); s.setLong(2, orderId); s.setString(3, type);
                }, r -> r.next() ? new InvoiceArtifactAccessGrant(r.getLong("invoice_id"), r.getString("provenance"),
                        r.getString("file_state"), r.getString("storage_kind"), r.getString("object_key"),
                        r.getString("checksum"), r.getObject("size_bytes", Long.class), r.getString("mime_type"),
                        r.getString("file_name"), r.getString("document_number")) : null));
    }

    @Override public InvoiceJob claim() {
        return withDatabaseErrorTranslation(() -> jdbc.query("SELECT * FROM pliego.fn_invoice_artifact_claim()", r ->
                r.next() ? new InvoiceJob(r.getLong("invoice_id"), r.getString("file_type"),
                        r.getObject("lease_owner", UUID.class), r.getInt("attempt"), r.getString("snapshot")) : null));
    }

    @Override public boolean complete(InvoiceJob job, byte[] content) {
        return withDatabaseErrorTranslation(() -> jdbc.query("SELECT pliego.fn_invoice_artifact_complete(?,?,?,?)", s -> {
            s.setLong(1, job.invoiceId()); s.setString(2, job.type()); s.setObject(3, job.owner()); s.setBytes(4, content);
        }, r -> r.next() && r.getBoolean(1)));
    }

    @Override public boolean completeStored(InvoiceJob job, InvoiceStoredArtifact artifact) {
        return withDatabaseErrorTranslation(() -> jdbc.query("SELECT pliego.fn_invoice_artifact_complete_stored(?,?,?,?,?,?,?,?,?)", s -> {
            s.setLong(1, job.invoiceId()); s.setString(2, job.type()); s.setObject(3, job.owner());
            s.setString(4, artifact.storageKind()); s.setString(5, artifact.objectKey());
            s.setString(6, artifact.checksum()); s.setLong(7, artifact.sizeBytes()); s.setString(8, artifact.mimeType());
            if (artifact.content() == null) s.setNull(9, java.sql.Types.BINARY); else s.setBytes(9, artifact.content());
        }, r -> r.next() && r.getBoolean(1)));
    }

    @Override public boolean fail(InvoiceJob job) {
        return withDatabaseErrorTranslation(() -> jdbc.query("SELECT pliego.fn_invoice_artifact_fail(?,?,?)", s -> {
            s.setLong(1, job.invoiceId()); s.setString(2, job.type()); s.setObject(3, job.owner());
        }, r -> r.next() && r.getBoolean(1)));
    }
}
