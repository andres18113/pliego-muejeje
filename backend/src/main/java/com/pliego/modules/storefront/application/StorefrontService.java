package com.pliego.modules.storefront.application;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.storefront.gateway.StorefrontGateway;
@Service
public class StorefrontService {
    private final StorefrontGateway gateway;
    public StorefrontService(StorefrontGateway gateway) { this.gateway = gateway; }
    @Transactional(readOnly=true) public StorefrontNavigation navigation() { return gateway.navigation(); }
}
