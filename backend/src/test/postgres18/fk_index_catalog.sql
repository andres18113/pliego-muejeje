-- Read-only inventory. A prefix consists of KEY attributes, never INCLUDE columns.
-- Raw absence matches RQ-IDX01's "any index" definition; partial predicates are
-- exposed separately because a state-filtered index cannot service every RI check.
SELECT jsonb_build_object(
 'constraint',c.conname,'table',c.conrelid::regclass::text,
 'columns',(SELECT jsonb_agg(a.attname ORDER BY k.ordinality)
   FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum),
 'parent',c.confrelid::regclass::text,'definition',pg_get_constraintdef(c.oid),
 'delete_action',c.confdeltype,'update_action',c.confupdtype,
 'indexes',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'name',i.indexrelid::regclass::text,'predicate',pg_get_expr(i.indpred,i.indrelid),
   'definition',pg_get_indexdef(i.indexrelid)) ORDER BY i.indexrelid::regclass::text)
 FROM pg_index i JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_am am ON am.oid=ix.relam
 WHERE i.indrelid=c.conrelid AND i.indisvalid AND i.indisready AND i.indislive
   AND am.amname='btree' AND i.indnkeyatts>=cardinality(c.conkey)
   AND (i.indkey::smallint[])[0:cardinality(c.conkey)-1]=c.conkey),'[]'::jsonb))
FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
WHERE n.nspname='pliego' AND c.contype='f'
ORDER BY c.conrelid::regclass::text,c.conname;
