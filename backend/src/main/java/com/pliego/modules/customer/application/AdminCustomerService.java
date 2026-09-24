package com.pliego.modules.customer.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.modules.customer.application.AdminCustomerModels.Page;
import com.pliego.modules.customer.application.AdminCustomerModels.Search;
import com.pliego.modules.customer.gateway.AdminCustomerGateway;

/** Coordinates ADMIN customer use cases while PostgreSQL owns customer state rules. */
@Service
public class AdminCustomerService {
    private final AdminCustomerGateway gateway;

    public AdminCustomerService(AdminCustomerGateway gateway) {
        this.gateway = gateway;
    }

    @Transactional(readOnly = true)
    public Page search(long actorUserId, Search search) {
        return gateway.search(actorUserId, search);
    }

    @Transactional
    public void setStatus(long actorUserId, long customerId, String state) {
        gateway.setStatus(actorUserId, customerId, state);
    }
}
