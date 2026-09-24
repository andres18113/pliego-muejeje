package com.pliego.modules.sales.gateway;

import com.pliego.modules.sales.application.AdminOrderModels.Cancellation;
import com.pliego.modules.sales.application.AdminOrderModels.Detail;
import com.pliego.modules.sales.application.AdminOrderModels.Page;
import com.pliego.modules.sales.application.AdminOrderModels.Search;
import com.pliego.modules.sales.application.AdminOrderModels.Transition;

/** Administrative order access through the four approved PostgreSQL public routines. */
public interface AdminOrderGateway {
    Page search(long actorUserId, Search search);
    Detail detail(long actorUserId, long orderId);
    Transition transition(long actorUserId, long orderId, String targetState);
    Cancellation cancel(long actorUserId, long orderId);
}
