package com.pliego.modules.library.application;
import com.pliego.modules.library.gateway.LibraryGateway;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
@Service
@Transactional(readOnly=true)
public class LibraryService {
    private final LibraryGateway gateway;
    public LibraryService(LibraryGateway gateway) { this.gateway=gateway; }
    public LibraryModels.Page list(long actorId,String productType,int page,int pageSize) {
        return gateway.list(actorId,productType,page,pageSize);
    }
    public LibraryModels.Item detail(long actorId,long ownedItemId) { return gateway.detail(actorId,ownedItemId); }
}
