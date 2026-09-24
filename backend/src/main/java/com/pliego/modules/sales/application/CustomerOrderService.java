package com.pliego.modules.sales.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.modules.sales.application.OrderModels.Cancellation;
import com.pliego.modules.sales.application.OrderModels.Detail;
import com.pliego.modules.sales.application.OrderModels.Page;
import com.pliego.modules.sales.gateway.CustomerOrderGateway;

/** Delegates order visibility and cancellation invariants to PostgreSQL. */
@Service
public class CustomerOrderService {

    private final CustomerOrderGateway gateway;

    public CustomerOrderService(CustomerOrderGateway gateway) {
        this.gateway = gateway;
    }

    @Transactional(readOnly = true)
    public Page list(long actorUserId, int page, int pageSize) {
        return gateway.list(actorUserId, page, pageSize);
    }

    @Transactional(readOnly = true)
    public Detail detail(long actorUserId, long orderId) {
        return gateway.detail(actorUserId, orderId);
    }

    @Transactional
    public Cancellation cancel(long actorUserId, long orderId) {
        return gateway.cancel(actorUserId, orderId);
    }
}
