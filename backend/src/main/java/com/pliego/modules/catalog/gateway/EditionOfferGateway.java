package com.pliego.modules.catalog.gateway;

import com.pliego.modules.catalog.application.EditionOfferCommand;
import com.pliego.modules.catalog.application.EditionOfferPrecondition;

public interface EditionOfferGateway {
    void set(long actorId, long editionId, EditionOfferCommand command);
    void createIfAbsent(long actorId, long editionId, EditionOfferCommand command, EditionOfferPrecondition precondition);
    void clear(long actorId, long editionId);
}
