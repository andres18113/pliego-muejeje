package com.pliego.modules.sales.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.modules.sales.application.AdminOrderModels.Cancellation;
import com.pliego.modules.sales.application.AdminOrderModels.Detail;
import com.pliego.modules.sales.application.AdminOrderModels.Page;
import com.pliego.modules.sales.application.AdminOrderModels.Search;
import com.pliego.modules.sales.application.AdminOrderModels.Transition;
import com.pliego.modules.sales.gateway.AdminOrderGateway;

/** Coordinates administrative order queries and delegates command invariants to PostgreSQL. */
@Service
public class AdminOrderService {

    private final AdminOrderGateway gateway;

    public AdminOrderService(AdminOrderGateway gateway) {
        this.gateway = gateway;
    }

    @Transactional(readOnly = true)
    public Page search(long actorUserId, Search search) {
        return gateway.search(actorUserId, search);
    }

    @Transactional(readOnly = true)
    public Detail detail(long actorUserId, long orderId) {
        return gateway.detail(actorUserId, orderId);
    }

    @Transactional
    public Transition transition(long actorUserId, long orderId, String targetState) {
        return gateway.transition(actorUserId, orderId, targetState);
    }

    @Transactional
    public Cancellation cancel(long actorUserId, long orderId) {
        return gateway.cancel(actorUserId, orderId);
    }
}
