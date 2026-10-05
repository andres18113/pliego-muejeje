package com.pliego.modules.catalog.gateway;

import com.pliego.modules.catalog.application.EditionOfferCommand;

public interface EditionOfferGateway {
    void set(long actorId, long editionId, EditionOfferCommand command);
    void clear(long actorId, long editionId);
}
