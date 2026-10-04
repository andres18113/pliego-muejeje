package com.pliego.modules.sales.gateway;

import com.pliego.modules.sales.application.AdminOrderModels.Cancellation;
import com.pliego.modules.sales.application.AdminOrderModels.Detail;
import com.pliego.modules.sales.application.AdminOrderModels.Page;
import com.pliego.modules.sales.application.AdminOrderModels.Search;
import com.pliego.modules.sales.application.AdminOrderModels.Transition;
import com.pliego.modules.sales.application.PostPurchaseModels;

/** Administrative order, shipment and document access through the public Database API. */
public interface AdminOrderGateway {
    void transitionShipment(long actorUserId, long orderId, String targetState);
    void updateTracking(long actorUserId, long orderId, PostPurchaseModels.Tracking tracking);
    long issueInvoice(long actorUserId, long orderId, PostPurchaseModels.IssueInvoice invoice);
    long issueCreditNote(long actorUserId, long orderId, String documentNumber, String reason);
    Page search(long actorUserId, Search search);
    Detail detail(long actorUserId, long orderId);
    Transition transition(long actorUserId, long orderId, String targetState);
    Cancellation cancel(long actorUserId, long orderId);
}
