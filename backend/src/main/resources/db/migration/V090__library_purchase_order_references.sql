-- Add the immutable public order reference to every library purchase source.
-- CREATE OR REPLACE preserves the routine identity, owner and existing runtime ACL.
-- List and detail share this projection; internal order IDs and purchase ordering stay unchanged.
CREATE OR REPLACE FUNCTION pliego.fn_library_item(p_owned BIGINT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER AS $$
 SELECT jsonb_build_object('ownedItemId',o.owned_item_id::TEXT,'editionId',o.edicion_id::TEXT,
 'coverUrl',g.metadata_snapshot->'coverUrl','title',i.titulo_snapshot,'authors',i.autores_snapshot,
 'productType',i.formato_snapshot,'acquiredAt',g.acquired_at,
 'ownershipState',CASE WHEN active.owned THEN 'OWNED' ELSE 'REVOKED' END,
 'accessState',CASE WHEN active.owned THEN 'OWNERSHIP_ONLY' ELSE 'REVOKED' END,'contentAccessSupported',FALSE,
 'metadata',jsonb_build_object('isbn',i.isbn_snapshot,'publisher',i.editorial_snapshot,'language',i.idioma_snapshot,
 'pageCount',g.metadata_snapshot->'pageCount','publicationDate',g.metadata_snapshot->'publicationDate',
 'ebookFileFormat',g.metadata_snapshot->'ebookFileFormat','audioDurationSeconds',g.metadata_snapshot->'audioDurationSeconds',
 'narrators',g.metadata_snapshot->'narrators'),
 'sourcePurchases',(SELECT jsonb_agg(jsonb_build_object('orderId',pi.pedido_id::TEXT,'orderReference',p.referencia_publica,'orderItemId',gr.pedido_item_id::TEXT,
 'acquiredAt',gr.acquired_at,'paymentState',pa.estado,'orderState',p.estado,'grantState',gr.state) ORDER BY gr.acquired_at DESC,gr.pedido_item_id DESC)
 FROM pliego.digital_grant gr JOIN pliego.pedido_item pi USING(pedido_item_id) JOIN pliego.pedido p USING(pedido_id)
 JOIN pliego.pago pa USING(pedido_id) WHERE gr.owned_item_id=o.owned_item_id),
 'availableActions',jsonb_build_array(jsonb_build_object('type','VIEW_ORDER','label','Ver pedido','href','/orders/'||i.pedido_id),
 jsonb_build_object('type','HELP','label','Ayuda','href',CASE WHEN i.formato_snapshot='EBOOK' THEN '/ayuda/ebooks' ELSE '/ayuda/audiolibros' END)))
 FROM pliego.digital_ownership o
 CROSS JOIN LATERAL (SELECT EXISTS(SELECT FROM pliego.digital_grant gr WHERE gr.owned_item_id=o.owned_item_id AND gr.state='ACTIVE') AS owned) active
 JOIN LATERAL (SELECT gr.* FROM pliego.digital_grant gr WHERE gr.owned_item_id=o.owned_item_id
 ORDER BY gr.acquired_at,gr.pedido_item_id LIMIT 1) g ON TRUE
 JOIN pliego.pedido_item i USING(pedido_item_id) WHERE o.owned_item_id=p_owned;
$$;
