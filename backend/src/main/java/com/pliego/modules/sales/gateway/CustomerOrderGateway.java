package com.pliego.modules.sales.gateway;

import com.pliego.modules.sales.application.OrderModels.Cancellation;
import com.pliego.modules.sales.application.OrderModels.Detail;
import com.pliego.modules.sales.application.OrderModels.Page;

public interface CustomerOrderGateway {
    Page list(long actorUserId, int page, int pageSize);
    Detail detail(long actorUserId, long orderId);
    Cancellation cancel(long actorUserId, long orderId);
}
