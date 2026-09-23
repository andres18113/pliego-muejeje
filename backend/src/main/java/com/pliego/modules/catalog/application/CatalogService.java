package com.pliego.modules.catalog.application;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.pliego.modules.catalog.gateway.CatalogGateway;

@Service
public class CatalogService {

    private final CatalogGateway catalogGateway;

    public CatalogService(CatalogGateway catalogGateway) {
        this.catalogGateway = catalogGateway;
    }

    @Transactional(readOnly = true)
    public CatalogSearchPage search(CatalogQuery query) {
        return catalogGateway.search(query);
    }

    @Transactional(readOnly = true)
    public CatalogEditionDetail getPublicEdition(long editionId) {
        return catalogGateway.findPublicEdition(editionId).orElseThrow(EditionNotFoundException::new);
    }
}
