package com.pliego.modules.catalog.gateway;

import java.util.Optional;

import com.pliego.modules.catalog.application.CatalogEditionDetail;
import com.pliego.modules.catalog.application.CatalogQuery;
import com.pliego.modules.catalog.application.CatalogSearchPage;

public interface CatalogGateway {

    CatalogSearchPage search(CatalogQuery query);

    Optional<CatalogEditionDetail> findPublicEdition(long editionId);
}
