package com.pliego.modules.customer.api;

import java.util.List;

import com.pliego.modules.customer.application.AdminBillingIdentityCorrection;
import com.pliego.modules.customer.application.BillingIdentityCorrectionDecision;

public final class AdminBillingIdentityCorrectionResponses {
    private AdminBillingIdentityCorrectionResponses() { }

    public record Request(String id, String customerId, String customerName, String customerEmail,
            String currentType, String currentNumber, String proposedType, String proposedNumber,
            String reasonCode, String note, String status, String createdAt, String dueAt,
            String decidedAt, String decidedBy, String decisionReason) {
        static Request from(AdminBillingIdentityCorrection row) {
            return new Request(row.id(), row.customerId(), row.customerName(), row.customerEmail(), row.currentType(),
                    row.currentNumber(), row.proposedType(), row.proposedNumber(), row.reasonCode(), row.note(),
                    row.status(), row.createdAt().toString(), row.dueAt().toString(),
                    row.decidedAt() == null ? null : row.decidedAt().toString(), row.decidedBy(), row.decisionReason());
        }
    }

    public record Page(List<Request> items, int page, int pageSize, String totalCount) {
        public Page { items = List.copyOf(items); }
    }

    public record Decision(String id, String status, String decidedAt, String decidedBy, String decisionReason) {
        static Decision from(BillingIdentityCorrectionDecision result) {
            return new Decision(result.id(), result.status(), result.decidedAt().toString(), result.decidedBy(),
                    result.decisionReason());
        }
    }
}
