package com.pliego.modules.catalog.application;

import java.util.List;

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
    public OffersFilterOptions getOffersFilterOptions() { return catalogGateway.findOffersFilterOptions(); }

    @Transactional(readOnly = true)
    public List<PublicCatalogCategory> listPublicCategories() {
        return catalogGateway.findPublicCategories();
    }

    @Transactional(readOnly = true)
    public PublicCatalogFilterOptions getPublicFilterOptions() {
        return catalogGateway.findPublicFilterOptions();
    }

    @Transactional(readOnly = true)
    public CatalogEditionDetail getPublicEdition(long editionId) {
        return catalogGateway.findPublicEdition(editionId).orElseThrow(EditionNotFoundException::new);
    }
}
