package com.pliego.modules.catalog.gateway;

import java.util.List;
import java.util.Optional;

import com.pliego.modules.catalog.application.CatalogEditionDetail;
import com.pliego.modules.catalog.application.CatalogQuery;
import com.pliego.modules.catalog.application.CatalogSearchPage;
import com.pliego.modules.catalog.application.PublicCatalogCategory;
import com.pliego.modules.catalog.application.PublicCatalogFilterOptions;

public interface CatalogGateway {

    CatalogSearchPage search(CatalogQuery query);

    com.pliego.modules.catalog.application.OffersFilterOptions findOffersFilterOptions();

    List<PublicCatalogCategory> findPublicCategories();

    PublicCatalogFilterOptions findPublicFilterOptions();

    Optional<CatalogEditionDetail> findPublicEdition(long editionId);
}
