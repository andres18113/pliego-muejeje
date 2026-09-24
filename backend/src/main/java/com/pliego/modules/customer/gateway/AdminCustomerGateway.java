package com.pliego.modules.customer.gateway;

import com.pliego.modules.customer.application.AdminCustomerModels.Page;
import com.pliego.modules.customer.application.AdminCustomerModels.Search;

/** ADMIN customer access backed exclusively by PostgreSQL's approved Database API. */
public interface AdminCustomerGateway {
    Page search(long actorUserId, Search search);

    void setStatus(long actorUserId, long customerId, String state);
}
