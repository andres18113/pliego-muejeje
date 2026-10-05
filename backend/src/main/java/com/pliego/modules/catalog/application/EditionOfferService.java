package com.pliego.modules.catalog.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.pliego.modules.catalog.gateway.EditionOfferGateway;

@Service
public class EditionOfferService {
    private final EditionOfferGateway gateway;
    public EditionOfferService(EditionOfferGateway gateway) { this.gateway = gateway; }
    @Transactional
    public void set(long actorId, long editionId, EditionOfferCommand command) {
        gateway.set(actorId, editionId, command);
    }
    @Transactional
    public void clear(long actorId, long editionId) { gateway.clear(actorId, editionId); }
}
