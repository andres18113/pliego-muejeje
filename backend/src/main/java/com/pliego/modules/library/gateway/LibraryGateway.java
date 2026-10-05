package com.pliego.modules.library.gateway;
import com.pliego.modules.library.application.LibraryModels;
public interface LibraryGateway {
    LibraryModels.Page list(long actorId, String productType, int page, int pageSize);
    LibraryModels.Item detail(long actorId, long ownedItemId);
}
